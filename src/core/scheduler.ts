import { SchedulerEmitter } from "../events";
import { SchedulerEventMap } from "../types/events";
import { JobStore, JobUpdates } from "../store";
import { Worker } from "../worker";
import { Job } from "../types/job";
import { ScheduleOptions } from "../types/schedule";
import { JobQuery } from "../types/query";
import {
  DebugLogger,
  DebugConfig,
  CategoryLogger,
  createDebugLogger,
} from "../utils";

export interface SchedulerOptions {
  id?: string;

  store?: JobStore;
  handler?: (job: Job) => Promise<void>;

  workers?: number;
  pollIntervalMs?: number;
  lockTimeoutMs?: number;
  defaultTimezone?: string;

  /**
   * Default max execution time in milliseconds.
   * Jobs running longer will have their heartbeat stopped,
   * allowing crash recovery to take over.
   * undefined = no limit (backward compatible).
   */
  maxExecutionMs?: number;

  /** Enable debug logging (pass true or DebugConfig object) */
  debug?: boolean | DebugConfig;
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
  private readonly maxExecutionMs?: number;
  private readonly debugLogger: DebugLogger;
  private readonly log: CategoryLogger;

  constructor(options: SchedulerOptions = {}) {
    this.id = options.id ?? `scheduler-${Math.random().toString(36).slice(2)}`;

    this.store = options.store;
    this.handler = options.handler;

    this.workerCount = options.workers ?? 1;
    this.pollInterval = options.pollIntervalMs ?? 500;
    this.lockTimeout = options.lockTimeoutMs ?? 10 * 60 * 1000; // default 10 minutes
    this.defaultTimezone = options.defaultTimezone;
    this.maxExecutionMs = options.maxExecutionMs;

    // Validate maxExecutionMs
    if (this.maxExecutionMs !== undefined) {
      if (!Number.isInteger(this.maxExecutionMs) || this.maxExecutionMs <= 0) {
        throw new Error("maxExecutionMs must be a positive integer");
      }
    }

    // Initialize debug logger
    this.debugLogger = createDebugLogger(options.debug);
    this.log = this.debugLogger.child("scheduler");

    this.log.log(`Initialized scheduler`, {
      id: this.id,
      workers: this.workerCount,
      pollIntervalMs: this.pollInterval,
      lockTimeoutMs: this.lockTimeout,
    });
  }

  on<K extends keyof SchedulerEventMap>(
    event: K,
    listener: (payload: SchedulerEventMap[K]) => void,
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

    // Priority validation
    if (options.priority !== undefined) {
      if (
        !Number.isInteger(options.priority) ||
        options.priority < 1 ||
        options.priority > 10
      ) {
        throw new Error("Priority must be an integer between 1 and 10");
      }
    }

    // Concurrency validation
    if (options.concurrency !== undefined) {
      if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
        throw new Error("Concurrency must be a positive integer");
      }
    }

    // ------------------------
    // Normalize run time
    // ------------------------
    const nextRunAt = options.runAt ?? now;
    if (isNaN(nextRunAt.getTime())) {
      throw new Error("Invalid Date provided for runAt");
    }

    // Validate maxExecutionMs if set per-job
    if (options.maxExecutionMs !== undefined) {
      if (
        !Number.isInteger(options.maxExecutionMs) ||
        options.maxExecutionMs <= 0
      ) {
        throw new Error("maxExecutionMs must be a positive integer");
      }
    }

    const job: Job<T> = {
      name: options.name,
      data: options.data,
      status: "pending",
      attempts: 0,
      nextRunAt,
      retry: options.retry,
      repeat: options.repeat,
      dedupeKey: options.dedupeKey,
      priority: options.priority,
      concurrency: options.concurrency,
      maxExecutionMs: options.maxExecutionMs,
      lockVersion: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.log.log(`Scheduling job`, {
      name: job.name,
      nextRunAt: job.nextRunAt.toISOString(),
      priority: job.priority,
      concurrency: job.concurrency,
      retry: job.retry,
      repeat: job.repeat,
      dedupeKey: job.dedupeKey,
    });

    const created = await this.store.create(job);

    this.log.log(`Job created`, {
      id: String(created._id),
      name: created.name,
    });

    this.emitter.emitSafe("job:created", created as Job);
    return created as Job<T>;
  }

  /**
   * Schedule multiple jobs in bulk
   */
  async scheduleBulk<T = any>(
    optionsList: ScheduleOptions<T>[],
  ): Promise<Job<T>[]> {
    if (!this.store) {
      throw new Error("Scheduler not started or no store configured");
    }

    this.log.log(`Scheduling bulk jobs`, { count: optionsList.length });

    const jobs: Job[] = optionsList.map((options) => {
      if (!options.name) {
        throw new Error("Job name is required");
      }
      if (options.repeat?.cron && options.repeat.every) {
        throw new Error("Cannot specify both cron and every");
      }

      // Priority validation
      if (options.priority !== undefined) {
        if (
          !Number.isInteger(options.priority) ||
          options.priority < 1 ||
          options.priority > 10
        ) {
          throw new Error("Priority must be an integer between 1 and 10");
        }
      }

      // Concurrency validation
      if (options.concurrency !== undefined) {
        if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
          throw new Error("Concurrency must be a positive integer");
        }
      }

      // Validate maxExecutionMs if set per-job
      if (options.maxExecutionMs !== undefined) {
        if (
          !Number.isInteger(options.maxExecutionMs) ||
          options.maxExecutionMs <= 0
        ) {
          throw new Error("maxExecutionMs must be a positive integer");
        }
      }

      const job: Job = {
        name: options.name,
        data: options.data,
        status: "pending",
        nextRunAt: options.runAt ?? new Date(),
        repeat: options.repeat,
        retry: options.retry,
        dedupeKey: options.dedupeKey,
        priority: options.priority,
        concurrency: options.concurrency,
        maxExecutionMs: options.maxExecutionMs,
        lockVersion: 0,
      } as Job;

      if (isNaN(job.nextRunAt.getTime())) {
        throw new Error("Invalid Date provided for runAt");
      }

      return job;
    });

    const createdJobs = await this.store.createBulk(jobs);

    this.log.log(`Bulk jobs created`, { count: createdJobs.length });

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
   * Query jobs
   */
  async getJobs(query: JobQuery): Promise<Job[]> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }
    return this.store.findAll(query);
  }

  /**
   * Update job data or schedule
   */
  async updateJob(jobId: unknown, updates: JobUpdates): Promise<void> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }

    // Require runAt when changing repeat to ensure deterministic behavior
    if (updates.repeat && !updates.nextRunAt) {
      throw new Error("nextRunAt is required when updating repeat");
    }

    if (updates.nextRunAt && isNaN(updates.nextRunAt.getTime())) {
      throw new Error("Invalid Date provided for nextRunAt");
    }

    // If rescheduling, automatically reset status to pending
    if (updates.nextRunAt) {
      updates.status = "pending";
    }

    this.log.log(`Updating job`, {
      id: String(jobId),
      updates: Object.keys(updates),
    });

    await this.store.update(jobId, updates);
  }

  /**
   * Cancel a job
   */
  async cancel(jobId: unknown): Promise<void> {
    if (!this.store) {
      throw new Error("Scheduler has no JobStore configured");
    }

    const job = await this.store.findById(jobId);

    this.log.log(`Cancelling job`, { id: String(jobId), name: job?.name });

    await this.store.cancel(jobId);

    if (job) {
      const cancelledJob = { ...job, status: "cancelled" } as Job;
      this.emitter.emitSafe("job:cancel", cancelledJob);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.log.log(`Starting scheduler`, {
      id: this.id,
      workers: this.workerCount,
    });

    this.emitter.emitSafe("scheduler:start", undefined);

    if (this.store && typeof this.store.recoverStaleJobs === "function") {
      const recovered = await this.store.recoverStaleJobs({
        now: new Date(),
        lockTimeoutMs: this.lockTimeout,
      });
      this.log.log(`Recovered stale jobs`, { count: recovered });
    }

    // lifecycle-only mode (used by tests)
    if (!this.store || !this.handler) {
      return;
    }

    // -------------------------------
    // start workers
    // -------------------------------
    for (let i = 0; i < this.workerCount; i++) {
      const workerId = `${this.id}-w${i}`;

      this.log.log(`Creating worker`, { workerId, index: i });

      const worker = new Worker(this.store, this.emitter, this.handler, {
        pollIntervalMs: this.pollInterval,
        lockTimeoutMs: this.lockTimeout,
        workerId,
        defaultTimezone: this.defaultTimezone,
        debug: this.debugLogger,
        maxExecutionMs: this.maxExecutionMs,
      });

      this.workers.push(worker);
      await worker.start();
    }

    this.log.log(`Scheduler started`, {
      workers: this.workers.length,
    });
  }

  async stop(options?: {
    graceful?: boolean;
    timeoutMs?: number;
  }): Promise<void> {
    if (!this.started) return;

    this.log.log(`Stopping scheduler`, {
      graceful: options?.graceful,
      timeoutMs: options?.timeoutMs,
    });

    this.started = false;

    await Promise.all(this.workers.map((w) => w.stop(options)));

    this.workers.length = 0;

    this.log.log(`Scheduler stopped`);

    this.emitter.emitSafe("scheduler:stop", undefined);
  }

  isRunning(): boolean {
    return this.started;
  }

  getId(): string {
    return this.id;
  }
}
