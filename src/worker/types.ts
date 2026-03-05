import { Job } from "../types/job";
import { DebugLogger } from "../utils";

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

  /**
   * Debug logger instance (passed from Scheduler)
   */
  debug?: DebugLogger;

  /**
   * Default max execution time in milliseconds.
   * Jobs running longer will have their heartbeat stopped,
   * allowing crash recovery to take over.
   * undefined = no limit.
   */
  maxExecutionMs?: number;
}
