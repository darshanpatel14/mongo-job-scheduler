export interface RetryOptions {
  /**
   * Maximum number of attempts (including first run)
   */
  maxAttempts: number;

  /**
   * Delay before retry (ms)
   * Can be static or computed dynamically
   */
  delay: number | ((attempt: number) => number);
}
