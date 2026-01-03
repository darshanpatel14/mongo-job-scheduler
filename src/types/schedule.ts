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
  retry?: RetryOptions;

  /**
   * Repeat configuration (cron or every)
   */
  repeat?: RepeatOptions;

  /**
   * Idempotency key to prevent duplicate jobs
   */
  dedupeKey?: string;
}
