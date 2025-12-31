import { SchedulerEmitter } from "../events";
import { SchedulerEventMap } from "../types/events";

export interface SchedulerOptions {
  /**
   * Optional unique id for this scheduler instance
   * Useful later for multi-worker setups
   */
  id?: string;
}

export class Scheduler {
  private readonly emitter: SchedulerEmitter;
  private started = false;
  private readonly id: string;

  constructor(options: SchedulerOptions = {}) {
    this.id = options.id ?? `scheduler-${Math.random().toString(36).slice(2)}`;
    this.emitter = new SchedulerEmitter();
  }

  /**
   * Subscribe to scheduler events
   */
  on<K extends keyof SchedulerEventMap>(
    event: K,
    listener: (payload: SchedulerEventMap[K]) => void
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Start scheduler lifecycle
   */
  async start(): Promise<void> {
    if (this.started) return;

    this.started = true;
    this.emitter.emitSafe("scheduler:start", undefined);

    // later:
    // - resume jobs
    // - start workers
    // - setup polling
  }

  /**
   * Stop scheduler gracefully
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    this.started = false;
    this.emitter.emitSafe("scheduler:stop", undefined);

    // later:
    // - stop workers
    // - release locks
  }

  /**
   * Internal access for submodules
   */
  protected getEmitter(): SchedulerEmitter {
    return this.emitter;
  }

  /**
   * For testing / inspection
   */
  isRunning(): boolean {
    return this.started;
  }

  getId(): string {
    return this.id;
  }
}
