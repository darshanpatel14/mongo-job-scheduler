import { JobStore } from "../store";
import { SchedulerEmitter } from "../events";
import { Job } from "../types/job";
import { WorkerOptions, JobHandler } from "./types";

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
      const job = await this.store.findAndLockNext({
        now: new Date(),
        workerId: this.workerId,
        lockTimeoutMs: this.lockTimeout,
      });

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
      this.emitter.emitSafe("job:fail", { job, error: err });

      await this.store.markFailed(job._id, err?.message ?? "Unknown error");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
