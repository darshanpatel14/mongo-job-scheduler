import { SchedulerEmitter } from "../events";
import { SchedulerEventMap } from "../types/events";
import { JobStore } from "../store";
import { Worker } from "../worker";
import { Job } from "../types/job";

export interface SchedulerOptions {
  id?: string;

  store?: JobStore;
  handler?: (job: Job) => Promise<void>;

  workers?: number;
  pollIntervalMs?: number;
  lockTimeoutMs?: number;
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

  constructor(options: SchedulerOptions = {}) {
    this.id = options.id ?? `scheduler-${Math.random().toString(36).slice(2)}`;

    this.store = options.store;
    this.handler = options.handler;

    this.workerCount = options.workers ?? 1;
    this.pollInterval = options.pollIntervalMs ?? 500;
    this.lockTimeout = options.lockTimeoutMs ?? 30_000;
  }

  on<K extends keyof SchedulerEventMap>(
    event: K,
    listener: (payload: SchedulerEventMap[K]) => void
  ): this {
    this.emitter.on(event, listener);
    return this;
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
