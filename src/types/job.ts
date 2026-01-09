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
   * undefined = no limit.
   */
  concurrency?: number;

  createdAt: Date;
  updatedAt: Date;
}
