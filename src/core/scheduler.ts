import { SchedulerEmitter } from "../events";
import { SchedulerEventMap } from "../types/events";
import { JobStore } from "../store";
import { Worker } from "../worker";
import { Job } from "../types/job";
import { ScheduleOptions } from "../types/schedule";

export interface SchedulerOptions {
  id?: string;

  store?: JobStore;
  handler?: (job: Job) => Promise<void>;

  workers?: number;
  pollIntervalMs?: number;
  lockTimeoutMs?: number;
  defaultTimezone?: string;
}

export class Scheduler {
  private readonly emitter = new SchedulerEmitter();
  private readonly workers: Worker[] = [];
  private started = false;

  private readonly id: string;
  private readonly store?: JobStore;
  private readonly handler?: (job: Job) => Promise<void>;
  private readonly workerCount: number;
  private readonly pollInterval: number;
  private readonly lockTimeout: number;
  private readonly defaultTimezone?: string;

  constructor(options: SchedulerOptions = {}) {
    this.id = options.id ?? `scheduler-${Math.random().toString(36).slice(2)}`;

    this.store = options.store;
    this.handler = options.handler;

    this.workerCount = options.workers ?? 1;
    this.pollInterval = options.pollIntervalMs ?? 500;
    this.lockTimeout = options.lockTimeoutMs ?? 30_000;
    this.defaultTimezone = options.defaultTimezone;
  }

  on<K extends keyof SchedulerEventMap>(
    event: K,
    listener: (payload: SchedulerEventMap[K]) => void
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  async schedule<T = unknown>(options: ScheduleOptions<T>): Promise<Job<T>> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }

    const now = new Date();

    // ------------------------
    // Validation
    // ------------------------
    if (!options.name) {
      throw new Error("Job name is required");
    }

    if (options.repeat?.cron && options.repeat?.every != null) {
      throw new Error("Use either cron or every, not both");
    }

    // ------------------------
    // Normalize run time
    // ------------------------
    const nextRunAt = options.runAt ?? now;

    const job: Job<T> = {
      name: options.name,
      data: options.data,
      status: "pending",
      attempts: 0,
      nextRunAt,
      retry: options.retry,
      repeat: options.repeat,
      dedupeKey: options.dedupeKey,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.create(job);
    this.emitter.emitSafe("job:created", created as Job);
    return created as Job<T>;
  }

  /**
   * Schedule multiple jobs in bulk
   */
  async scheduleBulk<T = any>(
    optionsList: ScheduleOptions<T>[]
  ): Promise<Job<T>[]> {
    if (!this.store) {
      throw new Error("Scheduler not started or no store configured");
    }

    const jobs: Job[] = optionsList.map((options) => {
      if (!options.name) {
        throw new Error("Job name is required");
      }
      if (options.repeat?.cron && options.repeat.every) {
        throw new Error("Cannot specify both cron and every");
      }

      return {
        name: options.name,
        data: options.data,
        status: "pending",
        nextRunAt: options.runAt ?? new Date(),
        repeat: options.repeat,
        retry: options.retry,
        dedupeKey: options.dedupeKey,
      } as Job;
    });

    const createdJobs = await this.store.createBulk(jobs);

    // Emit events for all created jobs
    for (const job of createdJobs) {
      this.emitter.emitSafe("job:created", job);
    }

    return createdJobs as Job<T>[];
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: unknown): Promise<Job | null> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }
    return this.store.findById(jobId);
  }

  /**
   * Cancel a job
   */
  async cancel(jobId: unknown): Promise<void> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }

    const job = await this.store.findById(jobId);

    await this.store.cancel(jobId);

    if (job) {
      const cancelledJob = { ...job, status: "cancelled" } as Job;
      this.emitter.emitSafe("job:cancel", cancelledJob);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.emitter.emitSafe("scheduler:start", undefined);

    if (this.store && typeof this.store.recoverStaleJobs === "function") {
      await this.store.recoverStaleJobs({
        now: new Date(),
        lockTimeoutMs: this.lockTimeout,
      });
    }

    // lifecycle-only mode (used by tests)
    if (!this.store || !this.handler) {
      return;
    }

    // -------------------------------
    // start workers
    // -------------------------------
    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(this.store, this.emitter, this.handler, {
        pollIntervalMs: this.pollInterval,
        lockTimeoutMs: this.lockTimeout,
        workerId: `${this.id}-w${i}`,
        defaultTimezone: this.defaultTimezone,
      });

      this.workers.push(worker);
      await worker.start();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    this.started = false;

    for (const worker of this.workers) {
      await worker.stop();
    }

    this.workers.length = 0;

    this.emitter.emitSafe("scheduler:stop", undefined);
  }

  isRunning(): boolean {
    return this.started;
  }

  getId(): string {
    return this.id;
  }
}
