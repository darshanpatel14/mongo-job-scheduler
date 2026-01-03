import { Job } from "../types/job";

export type JobHandler<T = any> = (job: Job<T>) => Promise<void>;

export interface WorkerOptions {
  /**
   * Interval between polling attempts (ms)
   */
  pollIntervalMs?: number;

  /**
   * Lock timeout for stale job recovery
   */
  lockTimeoutMs?: number;

  /**
   * Worker id (used for locking)
   */
  workerId?: string;

  /**
   * Default timezone for cron scheduling
   */
  defaultTimezone?: string;
}
