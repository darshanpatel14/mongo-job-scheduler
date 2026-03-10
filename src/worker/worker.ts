import { JobStore } from "../store";
import { SchedulerEmitter } from "../events";
import { Job } from "../types/job";
import { WorkerOptions, JobHandler } from "./types";
import { getRetryDelay } from "./retry";
import { RetryOptions } from "../types/retry";
import { getNextRunAt } from "./repeat";
import { DebugLogger, CategoryLogger, createNoOpLogger } from "../utils";

export class Worker {
  private running = false;
  private readonly pollInterval: number;
  private readonly lockTimeout: number;
  private readonly workerId: string;
  private readonly defaultTimezone?: string;
  private readonly defaultMaxExecutionMs?: number;
  private readonly log: CategoryLogger;
  private readonly heartbeatLog: CategoryLogger;

  constructor(
    private readonly store: JobStore,
    private readonly emitter: SchedulerEmitter,
    private readonly handler: JobHandler,
    options: WorkerOptions = {},
  ) {
    this.pollInterval = options.pollIntervalMs ?? 500;
    this.lockTimeout = options.lockTimeoutMs ?? 10 * 60 * 1000; // default 10 minutes
    this.workerId =
      options.workerId ?? `worker-${Math.random().toString(36).slice(2)}`;
    this.defaultTimezone = options.defaultTimezone;
    this.defaultMaxExecutionMs = options.maxExecutionMs;

    // Use provided debug logger or create no-op
    const debugLogger = options.debug ?? createNoOpLogger();
    this.log = debugLogger.child("worker");
    this.heartbeatLog = debugLogger.child("heartbeat");
  }

  private loopPromise?: Promise<void>;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.log.log(`Worker started`, { workerId: this.workerId });

    this.emitter.emitSafe("worker:start", this.workerId);

    this.loopPromise = this.loop();
    this.loopPromise.catch((err) => {
      this.emitter.emitSafe("worker:error", err as Error);
    });
  }

  async stop(options?: {
    graceful?: boolean;
    timeoutMs?: number;
  }): Promise<void> {
    this.running = false;

    this.log.log(`Worker stopping`, {
      workerId: this.workerId,
      graceful: options?.graceful,
    });

    this.emitter.emitSafe("worker:stop", this.workerId);

    if (options?.graceful && this.loopPromise) {
      const timeoutMs = options.timeoutMs ?? 30000; // default 30s

      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Worker stop timed out")), timeoutMs),
      );

      try {
        await Promise.race([this.loopPromise, timeout]);
      } catch (err) {
        if (err instanceof Error && err.message === "Worker stop timed out") {
          this.log.log(`Worker stop timed out`, { workerId: this.workerId });
          return;
        }
        throw err;
      }
    }

    this.log.log(`Worker stopped`, { workerId: this.workerId });
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (!this.running) break;

      this.log.log(`Polling for jobs`, { workerId: this.workerId });

      const job = await this.store.findAndLockNext({
        now: new Date(),
        workerId: this.workerId,
        lockTimeoutMs: this.lockTimeout,
      });

      if (!this.running) break;

      if (!job) {
        this.log.log(`No jobs available, sleeping`, {
          workerId: this.workerId,
          sleepMs: this.pollInterval,
        });
        await this.sleep(this.pollInterval);
        continue;
      }

      this.log.log(`Acquired lock`, {
        workerId: this.workerId,
        jobId: String(job._id),
        jobName: job.name,
        priority: job.priority,
        attempts: job.attempts,
      });

      try {
        await this.execute(job);
      } catch (err: any) {
        this.log.log(`Catastrophic error during job execution wrapper`, {
          workerId: this.workerId,
          jobId: String(job._id),
          error: err?.message || String(err),
        });
        this.emitter.emitSafe("worker:error", err as Error);
      }
    }
  }

  private async execute(job: Job): Promise<void> {
    this.emitter.emitSafe("job:start", job);

    const now = Date.now();

    this.log.log(`Executing job`, {
      jobId: String(job._id),
      jobName: job.name,
      workerId: this.workerId,
    });

    // Heartbeat to prevent lock expiry during long jobs
    const heartbeatIntervalMs = Math.max(50, this.lockTimeout / 2);
    const heartbeatParams = {
      jobId: job._id,
      workerId: this.workerId,
    };

    // Resolve effective max execution time: per-job overrides global default
    const effectiveMaxExec = job.maxExecutionMs ?? this.defaultMaxExecutionMs;

    let stopHeartbeat = false;
    let heartbeatCount = 0;

    const heartbeatLoop = async () => {
      const startedAt = Date.now();
      while (!stopHeartbeat) {
        await this.sleep(heartbeatIntervalMs);
        if (stopHeartbeat) break;

        // Stall detection: stop renewing if max execution time exceeded
        if (effectiveMaxExec && Date.now() - startedAt > effectiveMaxExec) {
          this.heartbeatLog.log(`Max execution time exceeded (stalled)`, {
            jobId: String(heartbeatParams.jobId),
            maxExecutionMs: effectiveMaxExec,
            elapsedMs: Date.now() - startedAt,
          });
          this.emitter.emitSafe("job:stalled", job);
          break; // stop renewing → lock expires → crash recovery picks it up
        }

        try {
          await this.store.renewLock(
            heartbeatParams.jobId,
            heartbeatParams.workerId,
          );
          heartbeatCount++;
          this.heartbeatLog.log(`Lock renewed`, {
            jobId: String(heartbeatParams.jobId),
            workerId: heartbeatParams.workerId,
            count: heartbeatCount,
          });
        } catch (err) {
          this.heartbeatLog.log(`Heartbeat failed`, {
            jobId: String(heartbeatParams.jobId),
            error: String(err),
          });
          this.emitter.emitSafe(
            "worker:error",
            new Error(
              `Heartbeat failed for job ${heartbeatParams.jobId}: ${err}`,
            ),
          );
          break;
        }
      }
    };
    const heartbeatPromise = heartbeatLoop();

    try {
      // Verify we still own the lock before any modifications
      // (another worker might have stolen it via stale recovery)
      const current = await this.store.findById(job._id);

      if (!current) {
        this.log.log(`Job not found, aborting`, { jobId: String(job._id) });
        stopHeartbeat = true;
        return;
      }

      if (current.status === "cancelled") {
        this.log.log(`Job was cancelled, skipping`, { jobId: String(job._id) });
        this.emitter.emitSafe("job:complete", job);
        stopHeartbeat = true;
        return;
      }

      if (current.lockedBy !== this.workerId) {
        this.log.log(`Lock stolen`, {
          jobId: String(job._id),
          ownedBy: current.lockedBy,
          workerId: this.workerId,
        });
        this.emitter.emitSafe(
          "worker:error",
          new Error(
            `Lock stolen for job ${job._id}: owned by ${current.lockedBy}, we are ${this.workerId}`,
          ),
        );
        stopHeartbeat = true;
        return;
      }

      if (current.status !== "running") {
        this.log.log(`Job no longer running`, {
          jobId: String(job._id),
          status: current.status,
        });
        this.emitter.emitSafe(
          "worker:error",
          new Error(
            `Job ${job._id} is no longer running (status: ${current.status})`,
          ),
        );
        stopHeartbeat = true;
        return;
      }

      // CRON: pre-schedule before execution (after lock verification)
      if (job.repeat?.cron) {
        let base = job.lastScheduledAt ?? job.nextRunAt ?? new Date(now);

        let next = getNextRunAt(job.repeat, base, this.defaultTimezone);

        // skip missed cron slots
        while (next.getTime() <= now) {
          base = next;
          next = getNextRunAt(job.repeat, base, this.defaultTimezone);
        }

        this.log.log(`Cron rescheduled`, {
          jobId: String(job._id),
          nextRunAt: next.toISOString(),
        });

        job.lastScheduledAt = next;
        await this.store.reschedule(job._id, next, {
          lastScheduledAt: next,
        });
      }

      await this.handler(job);

      // INTERVAL: schedule strictly based on lastScheduledAt or now
      if (job.repeat?.every != null) {
        let baseTime = Date.now();
        if (job.lastScheduledAt) {
          baseTime = job.lastScheduledAt.getTime();
        }

        let next = new Date(baseTime + Math.max(job.repeat.every, 100));

        // Skip missed intervals
        while (next.getTime() <= Date.now()) {
          next = new Date(next.getTime() + Math.max(job.repeat.every, 100));
        }

        this.log.log(`Interval rescheduled`, {
          jobId: String(job._id),
          nextRunAt: next.toISOString(),
          intervalMs: job.repeat.every,
        });

        job.lastScheduledAt = next;
        await this.store.reschedule(job._id, next, {
          lastScheduledAt: next,
        });
      }

      if (!job.repeat) {
        await this.store.markCompleted(job._id, this.workerId);

        this.log.log(`Job completed`, {
          jobId: String(job._id),
          jobName: job.name,
          duration: Date.now() - now,
        });

        this.emitter.emitSafe("job:success", job);
      }

      this.emitter.emitSafe("job:complete", job);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));

      this.log.log(`Job execution error`, {
        jobId: String(job._id),
        jobName: job.name,
        error: error.message,
      });

      const attempts = (job.attempts ?? 0) + 1;
      let retry = job.retry;

      if (typeof retry === "number") {
        retry = { maxAttempts: retry, delay: 0 };
      }

      if (retry && attempts < retry.maxAttempts) {
        const delay = getRetryDelay(retry, attempts);
        const nextRunAt = new Date(Date.now() + delay);

        this.log.log(`Scheduling retry`, {
          jobId: String(job._id),
          attempt: attempts,
          maxAttempts: retry.maxAttempts,
          delayMs: delay,
          nextRunAt: nextRunAt.toISOString(),
        });

        await this.store.reschedule(job._id, nextRunAt, {
          attempts,
          lastError: error.message,
        });

        this.emitter.emitSafe("job:retry", {
          ...job,
          attempts,
          lastError: error.message,
        });
      } else {
        this.log.log(`Job failed permanently`, {
          jobId: String(job._id),
          jobName: job.name,
          attempts,
          error: error.message,
        });

        this.emitter.emitSafe("job:fail", { job, error });

        if (job.repeat) {
          // If it's a repeating job, don't mark as permanently failed.
          // Instead, schedule the next rhythm tick as if it had succeeded,
          // but reset attempts to 0 for the new cycle.
          this.log.log(`Rescheduling failed repeating job for next cycle`, {
            jobId: String(job._id),
          });

          let next = new Date(); // Fallback for cron which already set lastScheduledAt

          if (job.repeat.every != null) {
            let baseTime = Date.now();
            if (job.lastScheduledAt) {
              baseTime = job.lastScheduledAt.getTime();
            }
            next = new Date(baseTime + Math.max(job.repeat.every, 100));
            while (next.getTime() <= Date.now()) {
              next = new Date(next.getTime() + Math.max(job.repeat.every, 100));
            }
            job.lastScheduledAt = next;
          } else if (job.repeat.cron) {
            // Cron already advanced lastScheduledAt before execution.
            // We just need to grab that value.
            next = job.lastScheduledAt ?? new Date();
          }

          await this.store.reschedule(job._id, next, {
            lastScheduledAt: next,
            attempts: 0, // Reset attempts for the next cycle
            lastError: error.message,
          });
        } else {
          await this.store.update(job._id, { attempts });
          await this.store.markFailed(job._id, error.message);
        }
      }
    } finally {
      stopHeartbeat = true;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
