import { JobStatus } from "./lifecycle";
import { RetryOptions } from "./retry";
import { RepeatOptions } from "./repeat";

export interface Job<Data = unknown> {
  _id?: unknown;

  name: string;
  data?: Data;

  status: JobStatus;

  nextRunAt: Date;
  lastRunAt?: Date;
  lastScheduledAt?: Date;

  lockedAt?: Date;
  lockedBy?: string;
  /**
   * Lock expiry time. Job can be taken by another worker after this time.
   */
  lockUntil?: Date;
  /**
   * Optimistic locking version. Incremented on each lock acquisition.
   * Prevents race conditions in distributed environments.
   */
  lockVersion?: number;

  attempts: number;
  lastError?: string;

  retry?: RetryOptions | number;
  repeat?: RepeatOptions;

  dedupeKey?: string;

  /**
   * Job priority (1-10). Lower values = higher priority.
   * Default: 5
   */
  priority?: number;

  /**
   * Max concurrent running jobs with this name.
   * Useful for rate-limiting external API calls.
   */
  concurrency?: number;

  /**
   * Max execution time in milliseconds.
   * If the job handler runs longer than this, the heartbeat stops renewing
   * the lock, allowing crash recovery to pick it up.
   * undefined = no limit (heartbeat renews indefinitely).
   */
  maxExecutionMs?: number;

  createdAt: Date;
  updatedAt: Date;
}
