import {
  withRetry,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
} from "../../src/store/mongo/retry-wrapper";

describe("Retry Wrapper", () => {
  describe("isRetryableError", () => {
    test("returns false for non-Error values", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
      expect(isRetryableError("string error")).toBe(false);
      expect(isRetryableError(123)).toBe(false);
    });

    test("returns true for MongoNetworkError", () => {
      const error = new Error("Connection refused");
      error.name = "MongoNetworkError";
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for MongoServerSelectionError", () => {
      const error = new Error("Server selection timeout");
      error.name = "MongoServerSelectionError";
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for ECONNREFUSED code", () => {
      const error = new Error("connect ECONNREFUSED") as any;
      error.code = "ECONNREFUSED";
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for ETIMEDOUT code", () => {
      const error = new Error("connection timed out") as any;
      error.code = "ETIMEDOUT";
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for MongoDB numeric error codes", () => {
      const error = new Error("Network timeout") as any;
      error.code = 89; // NetworkTimeout
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for connection-related message", () => {
      const error = new Error("topology was destroyed");
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns true for network-related message", () => {
      const error = new Error("Network error occurred");
      expect(isRetryableError(error)).toBe(true);
    });

    test("returns false for regular errors", () => {
      const error = new Error("Validation failed");
      expect(isRetryableError(error)).toBe(false);
    });

    test("returns false for duplicate key errors", () => {
      const error = new Error("Duplicate key error") as any;
      error.code = 11000;
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe("withRetry", () => {
    test("returns result on first successful attempt", async () => {
      const operation = jest.fn().mockResolvedValue("success");

      const result = await withRetry(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("retries on retryable error and succeeds", async () => {
      const retryableError = new Error("Connection refused");
      retryableError.name = "MongoNetworkError";

      const operation = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue("success after retry");

      const result = await withRetry(operation, {
        maxAttempts: 3,
        initialDelayMs: 10,
      });

      expect(result).toBe("success after retry");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test("exhausts max attempts and throws last error", async () => {
      const retryableError = new Error("Connection refused");
      retryableError.name = "MongoNetworkError";

      const operation = jest.fn().mockRejectedValue(retryableError);

      await expect(
        withRetry(operation, { maxAttempts: 3, initialDelayMs: 10 })
      ).rejects.toThrow("Connection refused");

      expect(operation).toHaveBeenCalledTimes(3);
    });

    test("does not retry non-retryable errors", async () => {
      const nonRetryableError = new Error("Validation failed");

      const operation = jest.fn().mockRejectedValue(nonRetryableError);

      await expect(
        withRetry(operation, { maxAttempts: 3, initialDelayMs: 10 })
      ).rejects.toThrow("Validation failed");

      expect(operation).toHaveBeenCalledTimes(1);
    });

    test("calls onRetry callback on each retry", async () => {
      const retryableError = new Error("Network timeout");
      retryableError.name = "MongoNetworkError";

      const onRetry = jest.fn();
      const operation = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue("success");

      await withRetry(operation, {
        maxAttempts: 5,
        initialDelayMs: 10,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(
        retryableError,
        1,
        expect.any(Number)
      );
      expect(onRetry).toHaveBeenCalledWith(
        retryableError,
        2,
        expect.any(Number)
      );
    });

    test("uses default config values", () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(100);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(5000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
    });

    test("respects maxDelayMs cap", async () => {
      const retryableError = new Error("timeout");
      retryableError.name = "MongoNetworkError";

      const delays: number[] = [];
      const onRetry = jest.fn((_, __, delay) => delays.push(delay));

      const operation = jest
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue("success");

      await withRetry(operation, {
        maxAttempts: 10,
        initialDelayMs: 10,
        maxDelayMs: 50,
        backoffMultiplier: 3,
        onRetry,
      });

      // All delays should be <= maxDelayMs * 1.3 (accounting for 30% jitter)
      delays.forEach((delay) => {
        expect(delay).toBeLessThanOrEqual(65);
      });
    }, 10000);

    test("handles async operations correctly", async () => {
      const operation = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { data: "async result" };
      });

      const result = await withRetry(operation);

      expect(result).toEqual({ data: "async result" });
    });

    test("converts non-Error throws to Error", async () => {
      const operation = jest.fn().mockRejectedValue("string error");

      await expect(withRetry(operation, { maxAttempts: 1 })).rejects.toThrow();
    });
  });
});
