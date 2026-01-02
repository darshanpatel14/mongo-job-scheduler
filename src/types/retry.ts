export interface RetryOptions {
  /**
   * Total allowed attempts (including first)
   */
  maxAttempts: number;

  /**
   * Backoff strategy:
   * - number = fixed delay (ms)
   * - function = dynamic delay
   */
  delay: number | ((attempt: number) => number);
}
