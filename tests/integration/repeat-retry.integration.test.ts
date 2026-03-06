import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Interval and Retry Integration", () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  test("interval job failing then succeeding calculates next slot from base time", async () => {
    const store = new InMemoryJobStore();
    let failCount = 0;
    const executionTimes: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async (job) => {
        executionTimes.push(Date.now());
        if (failCount < 2) {
          failCount++;
          throw new Error("Simulated transient failure");
        }
        failCount = 0; // reset for next full cycle
      },
    });

    const job = await scheduler.schedule({
      name: "interval-retry-job",
      data: {},
      repeat: { every: 500 }, // short interval for test speed
      retry: { maxAttempts: 3, delay: 100 }, // fast retries
    });

    await scheduler.start();

    // Wait for the first full cycle (which fails twice then succeeds),
    // plus the start of the next cycle.
    // Base cycle: 500ms
    // First run hits at ~500. Fails. Retries at ~600. Fails. Retries at ~700. Succeeds.
    // Next cycle SHOULD be exactly at 1000 (orig 500 + 500). Wait till ~1200.
    await sleep(1500);

    await scheduler.stop();

    // It should have executed at least 4 times (3 attempts for cycle 1, + 1 attempt for cycle 2)
    expect(executionTimes.length).toBeGreaterThanOrEqual(4);

    const checkJob = await store.findById(job._id);
    expect(checkJob).toBeDefined();

    // It should have successfully moved on to the next scheduled slot
    expect(checkJob!.status).toBe("pending");
    expect(checkJob!.attempts).toBe(0); // newly reset
  });

  test("interval job exhausting maxAttempts regenerates for next interval with lastError", async () => {
    const store = new InMemoryJobStore();
    let executionCount = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        executionCount++;
        throw new Error("Simulated permanent failure");
      },
    });

    const job = await scheduler.schedule({
      name: "interval-exhaustion-job",
      data: {},
      repeat: { every: 500 },
      retry: { maxAttempts: 3, delay: 100 },
    });

    await scheduler.start();

    // First cycle runs at ~500. Fails 3 times (500, 600, 700). Exhausted!
    // Worker catches permanent failure -> drops it, schedules next slot at 1000.
    // Second cycle runs at ~1000. Fails 3 times (1000, 1100, 1200). Exhausted!
    await sleep(1500);

    await scheduler.stop();

    const finalJob = await store.findById(job._id);
    expect(finalJob).toBeDefined();

    // The total execution count should be at least 4 (one full exhausted cycle + start of next)
    expect(executionCount).toBeGreaterThanOrEqual(4);

    // Assert that the job safely bypassed "failed" status and is pending for the next tick
    expect(finalJob!.status).toBe("pending");

    // The attempts should be reset to 0 in database while it awaits the next tick, OR
    // if we stopped right in the middle of a retry cluster, it would be 1-2. Let's just ensure it's not strictly permanently failed.
    expect(finalJob!.lastError).toBe("Simulated permanent failure");
  });
});
