import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Real-World Combined Feature Scenarios", () => {
  test("heartbeat + retry + repeat: long job that fails then succeeds", async () => {
    const store = new InMemoryJobStore();
    const executionTimes: number[] = [];
    let attempts = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      lockTimeoutMs: 200, // 200ms lock timeout
      handler: async () => {
        attempts++;
        executionTimes.push(Date.now());

        // First attempt: fail after long execution
        if (attempts === 1) {
          await sleep(300); // heartbeat should renew lock
          throw new Error("Simulated failure");
        }

        // Second attempt: succeed after long execution
        await sleep(300); // heartbeat should renew lock
      },
    });

    // Schedule repeating job with retry
    await scheduler.schedule({
      name: "complex-job",
      data: { taskId: 1 },
      repeat: { every: 2000 }, // repeat every 2 seconds
      retry: { maxAttempts: 2, delay: 100 },
    });

    await scheduler.start();

    // Wait for: 1st attempt (fail) + retry + 2nd attempt (success) + 1st repeat
    await sleep(4000);

    await scheduler.stop();

    // Verify: 2 attempts (1 fail + 1 success) + at least 1 repeat = 3+ executions
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(executionTimes.length).toBeGreaterThanOrEqual(3);
  });

  test("mixed job types: fast + slow + cron running concurrently", async () => {
    const store = new InMemoryJobStore();
    const results: { type: string; duration: number }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 10,
      lockTimeoutMs: 5000,
      handler: async (job) => {
        const start = Date.now();

        if (job.name === "fast-email") {
          await sleep(10); // fast job
        } else if (job.name === "slow-report") {
          await sleep(500); // slow job (heartbeat should maintain lock)
        } else if (job.name === "cron-cleanup") {
          await sleep(100); // medium job
        }

        results.push({
          type: job.name,
          duration: Date.now() - start,
        });
      },
    });

    // Create mixed job types
    await scheduler.scheduleBulk([
      { name: "fast-email", data: { id: 1 } },
      { name: "fast-email", data: { id: 2 } },
      { name: "fast-email", data: { id: 3 } },
      { name: "slow-report", data: { reportType: "monthly" } },
      { name: "slow-report", data: { reportType: "yearly" } },
    ]);

    // Add repeating cron job
    await scheduler.schedule({
      name: "cron-cleanup",
      data: {},
      repeat: { every: 500 }, // every 500ms
    });

    await scheduler.start();
    await sleep(2000);
    await scheduler.stop();

    // Verify all job types executed
    expect(results.filter((r) => r.type === "fast-email").length).toBe(3);
    expect(results.filter((r) => r.type === "slow-report").length).toBe(2);
    expect(
      results.filter((r) => r.type === "cron-cleanup").length
    ).toBeGreaterThanOrEqual(2);

    // Verify slow jobs completed (heartbeat worked)
    const slowJobs = results.filter((r) => r.type === "slow-report");
    slowJobs.forEach((job) => {
      expect(job.duration).toBeGreaterThanOrEqual(450);
    });
  });

  test("deduplication + retry: idempotent retries preserve dedupeKey", async () => {
    const store = new InMemoryJobStore();
    let attempts = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Retry me");
        }
      },
    });

    // Try to schedule duplicate jobs with same dedupeKey
    const job1 = await scheduler.schedule({
      name: "payment",
      data: { orderId: 123 },
      dedupeKey: "payment:order:123",
      retry: { maxAttempts: 3, delay: 50 },
    });

    const job2 = await scheduler.schedule({
      name: "payment",
      data: { orderId: 123 },
      dedupeKey: "payment:order:123",
      retry: { maxAttempts: 3, delay: 50 },
    });

    // Should return same job
    expect(job1._id).toEqual(job2._id);

    await scheduler.start();
    await sleep(500);
    await scheduler.stop();

    // Verify: job retried but only one job existed
    expect(attempts).toBe(2); // 1 fail + 1 success
  });

  test("multi-worker + heartbeat + varying job lengths", async () => {
    const store = new InMemoryJobStore();
    const completedJobs = new Set<string>();

    const scheduler = new Scheduler({
      store,
      workers: 5,
      pollIntervalMs: 10,
      lockTimeoutMs: 300,
      handler: async (job) => {
        const duration = (job.data as any).duration;
        await sleep(duration);
        completedJobs.add(job._id!.toString());
      },
    });

    // Create jobs with varying durations
    await scheduler.scheduleBulk([
      { name: "short", data: { duration: 50 } }, // will complete quickly
      { name: "short", data: { duration: 50 } },
      { name: "short", data: { duration: 50 } },
      { name: "medium", data: { duration: 200 } }, // needs 1-2 heartbeats
      { name: "medium", data: { duration: 200 } },
      { name: "long", data: { duration: 400 } }, // needs 2-3 heartbeats
    ]);

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    // All jobs should complete despite varying lengths
    expect(completedJobs.size).toBe(6);
  });
});
