export interface RepeatOptions {
  /**
   * Run every N milliseconds
   */
  every?: number;

  /**
   * Cron expression (optional)
   */
  cron?: string;

  /**
   * Timezone for cron
   */
  timezone?: string;
}
