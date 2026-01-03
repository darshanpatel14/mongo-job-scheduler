import { JobStore } from "../store";
import { SchedulerEmitter } from "../events";
import { Job } from "../types/job";
import { WorkerOptions, JobHandler } from "./types";
import { getRetryDelay } from "./retry";
import { RetryOptions } from "../types/retry";
import { getNextRunAt } from "./repeat";

export class Worker {
  private running = false;
  private readonly pollInterval: number;
  private readonly lockTimeout: number;
  private readonly workerId: string;
  private readonly defaultTimezone?: string;

  constructor(
    private readonly store: JobStore,
    private readonly emitter: SchedulerEmitter,
    private readonly handler: JobHandler,
    options: WorkerOptions = {}
  ) {
    this.pollInterval = options.pollIntervalMs ?? 500;
    this.lockTimeout = options.lockTimeoutMs ?? 30_000;
    this.workerId =
      options.workerId ?? `worker-${Math.random().toString(36).slice(2)}`;
    this.defaultTimezone = options.defaultTimezone;
  }

  private loopPromise?: Promise<void>;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

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
    this.emitter.emitSafe("worker:stop", this.workerId);

    if (options?.graceful && this.loopPromise) {
      const timeoutMs = options.timeoutMs ?? 30000; // default 30s

      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Worker stop timed out")), timeoutMs)
      );

      try {
        await Promise.race([this.loopPromise, timeout]);
      } catch (err) {
        if (err instanceof Error && err.message === "Worker stop timed out") {
          return;
        }
        throw err;
      }
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      // stop requested before poll
      if (!this.running) break;

      const job = await this.store.findAndLockNext({
        now: new Date(),
        workerId: this.workerId,
        lockTimeoutMs: this.lockTimeout,
      });

      // stop requested after polling
      if (!this.running) break;

      if (!job) {
        await this.sleep(this.pollInterval);
        continue;
      }

      await this.execute(job);
    }
  }

  private async execute(job: Job): Promise<void> {
    this.emitter.emitSafe("job:start", job);

    const now = Date.now();

    // ---------------------------
    // CRON: pre-schedule BEFORE execution
    // ---------------------------
    if (job.repeat?.cron) {
      let base = job.lastScheduledAt ?? job.nextRunAt ?? new Date(now);

      let next = getNextRunAt(job.repeat, base, this.defaultTimezone);

      // skip missed cron slots
      while (next.getTime() <= now) {
        base = next;
        next = getNextRunAt(job.repeat, base, this.defaultTimezone);
      }

      // persist schedule immediately
      job.lastScheduledAt = next;
      await this.store.reschedule(job._id, next);
    }

    // ---------------------------
    // HEARTBEAT
    // ---------------------------
    const heartbeatIntervalMs = Math.max(50, this.lockTimeout / 2);
    const heartbeatParams = {
      jobId: job._id,
      workerId: this.workerId,
    };

    let stopHeartbeat = false;

    const heartbeatLoop = async () => {
      while (!stopHeartbeat) {
        await this.sleep(heartbeatIntervalMs);
        if (stopHeartbeat) break;

        try {
          await this.store.renewLock(
            heartbeatParams.jobId,
            heartbeatParams.workerId
          );
        } catch (err) {
          this.emitter.emitSafe(
            "worker:error",
            new Error(
              `Heartbeat failed for job ${heartbeatParams.jobId}: ${err}`
            )
          );
          break;
        }
      }
    };
    const heartbeatPromise = heartbeatLoop();

    try {
      const current = await this.store.findById(job._id);
      if (current && current.status === "cancelled") {
        this.emitter.emitSafe("job:complete", job);
        stopHeartbeat = true; // stop fast
        return;
      }

      await this.handler(job);

      // ---------------------------
      // INTERVAL: schedule AFTER execution
      // ---------------------------
      if (job.repeat?.every != null) {
        const next = new Date(Date.now() + Math.max(job.repeat.every, 100));
        await this.store.reschedule(job._id, next);
      }

      if (!job.repeat) {
        await this.store.markCompleted(job._id);
        this.emitter.emitSafe("job:success", job);
      }

      this.emitter.emitSafe("job:complete", job);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));

      const attempts = (job.attempts ?? 0) + 1;
      const retry = job.retry;

      if (retry && attempts < retry.maxAttempts) {
        const nextRunAt = new Date(Date.now() + getRetryDelay(retry, attempts));
        await this.store.reschedule(job._id, nextRunAt, { attempts });

        this.emitter.emitSafe("job:retry", {
          ...job,
          attempts,
          lastError: error.message,
        });
      } else {
        await this.store.markFailed(job._id, error.message);
        this.emitter.emitSafe("job:fail", { job, error });
      }
    } finally {
      stopHeartbeat = true;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
