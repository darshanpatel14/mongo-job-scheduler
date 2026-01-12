/**
 * Retry wrapper for MongoDB operations with exponential backoff.
 * Handles transient network errors and connection issues.
 */

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms before first retry (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 5000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Optional callback on each retry attempt */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, "onRetry">> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Error names that indicate transient MongoDB connection issues.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongoNetworkTimeoutError",
  "MongoWriteConcernError",
]);

/**
 * Error codes that indicate transient connection issues.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
]);

/**
 * MongoDB server error codes that are retryable.
 * See: https://www.mongodb.com/docs/manual/reference/error-codes/
 */
const RETRYABLE_MONGO_CODES = new Set([
  6, // HostUnreachable
  7, // HostNotFound
  89, // NetworkTimeout
  91, // ShutdownInProgress
  189, // PrimarySteppedDown
  262, // ExceededTimeLimit
  9001, // SocketException
  10107, // NotWritablePrimary
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13435, // NotPrimaryNoSecondaryOk
  13436, // NotPrimaryOrSecondary
]);

/**
 * Determines if an error is retryable (transient).
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check error name
  if (RETRYABLE_ERROR_NAMES.has(error.name)) {
    return true;
  }

  // Check for error code property (Node.js system errors)
  const anyError = error as any;
  if (anyError.code && RETRYABLE_ERROR_CODES.has(anyError.code)) {
    return true;
  }

  // Check for MongoDB error code
  if (
    typeof anyError.code === "number" &&
    RETRYABLE_MONGO_CODES.has(anyError.code)
  ) {
    return true;
  }

  // Check error message for common patterns
  const message = error.message.toLowerCase();
  if (
    message.includes("connection") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("not primary") ||
    message.includes("topology was destroyed")
  ) {
    return true;
  }

  return false;
}

/**
 * Adds jitter to delay to prevent thundering herd.
 */
function addJitter(delayMs: number): number {
  const jitter = Math.random() * 0.3; // 0-30% jitter
  return Math.floor(delayMs * (1 + jitter));
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async operation with retry logic for transient errors.
 *
 * @param operation - The async operation to execute
 * @param config - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => collection.findOne({ _id: id }),
 *   { maxAttempts: 3, initialDelayMs: 100 }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_RETRY_CONFIG.maxAttempts,
    initialDelayMs = DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier = DEFAULT_RETRY_CONFIG.backoffMultiplier,
    onRetry,
  } = config;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Don't retry if it's the last attempt
      if (attempt >= maxAttempts) {
        break;
      }

      // Don't retry non-retryable errors
      if (!isRetryableError(err)) {
        throw err;
      }

      // Calculate delay with jitter
      const actualDelay = addJitter(Math.min(delayMs, maxDelayMs));

      // Invoke callback if provided
      if (onRetry) {
        onRetry(err, attempt, actualDelay);
      }

      // Wait before retrying
      await sleep(actualDelay);

      // Increase delay for next attempt
      delayMs = delayMs * backoffMultiplier;
    }
  }

  throw lastError;
}
