import { RetryOptions } from "../types/retry";

export function getRetryDelay(retry: RetryOptions, attempt: number): number {
  if (typeof retry.delay === "function") {
    return retry.delay(attempt);
  }

  return retry.delay;
}
