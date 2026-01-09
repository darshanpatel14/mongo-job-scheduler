import { RetryOptions } from "./retry";
import { RepeatOptions } from "./repeat";

export interface ScheduleOptions<T = unknown> {
  name: string;
  data?: T;

  /**
   * When the job should first run.
   * Defaults to now.
   */
  runAt?: Date;

  /**
   * Retry configuration
   */
  retry?: RetryOptions | number;

  /**
   * Repeat configuration (cron or every)
   */
  repeat?: RepeatOptions;

  /**
   * Idempotency key to prevent duplicate jobs
   */
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
}
