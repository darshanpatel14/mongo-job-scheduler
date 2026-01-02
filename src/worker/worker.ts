import { JobStore } from "../store";
import { SchedulerEmitter } from "../events";
import { Job } from "../types/job";
import { WorkerOptions, JobHandler } from "./types";
import { getRetryDelay } from "./retry";
import { RetryOptions } from "../types/retry";

export class Worker {
  private running = false;
  private readonly pollInterval: number;
  private readonly lockTimeout: number;
  private readonly workerId: string;

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
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.emitter.emitSafe("worker:start", this.workerId);

    this.loop().catch((err) => {
      this.emitter.emitSafe("worker:error", err as Error);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.emitter.emitSafe("worker:stop", this.workerId);
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

    try {
      await this.handler(job);

      await this.store.markCompleted(job._id);
      this.emitter.emitSafe("job:success", job);
      this.emitter.emitSafe("job:complete", job);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));

      const attempts = (job.attempts ?? 0) + 1;
      const retry = job.retry;

      // Retry path
      if (retry && attempts < retry.maxAttempts) {
        const delay = getRetryDelay(retry, attempts);
        const nextRun = new Date(Date.now() + delay);

        await this.store.reschedule(job._id, nextRun);

        this.emitter.emitSafe("job:retry", {
          ...job,
          attempts,
          lastError: error.message,
        });

        return;
      }

      // Permanent failure
      await this.store.markFailed(job._id, error.message);
      this.emitter.emitSafe("job:fail", { job, error });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
