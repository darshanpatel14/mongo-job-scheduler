import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Scheduler.schedule() Integration Test", () => {
  test("schedule() creates a job in the store with correct defaults", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "test-job",
      data: { foo: "bar" },
    });

    expect(job).toBeDefined();
    expect(job.name).toBe("test-job");
    expect(job.data).toEqual({ foo: "bar" });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.updatedAt).toBeInstanceOf(Date);

    // Default nextRunAt should be approximately now
    const now = Date.now();
    expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(now - 100);
    expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(now + 100);
  });

  test("schedule() respects provided options", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const nextRun = new Date(Date.now() + 10000);
    const retry = { maxAttempts: 5, delay: 1000 };
    const repeat = { cron: "* * * * *" };

    const job = await scheduler.schedule({
      name: "test-job-options",
      data: { payload: 123 },
      runAt: nextRun,
      retry,
      repeat,
    });

    expect(job.nextRunAt).toEqual(nextRun);
    expect(job.retry).toEqual(retry);
    expect(job.repeat).toEqual(repeat);
  });

  test("schedule() throws error if job name is missing", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    await expect(
      // @ts-ignore
      scheduler.schedule({
        data: {},
      })
    ).rejects.toThrow("Job name is required");
  });

  test("schedule() throws error if both cron and every are provided", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    await expect(
      scheduler.schedule({
        name: "bad-repeat",
        data: {},
        repeat: {
          cron: "* * * * *",
          every: 1000,
        },
      })
    ).rejects.toThrow("Use either cron or every, not both");
  });

  test("schedule() throws error if store is missing", async () => {
    const scheduler = new Scheduler({ workers: 1 }); // No store provided

    await expect(
      scheduler.schedule({
        name: "fail-job",
        data: {},
      })
    ).rejects.toThrow("Scheduler has no JobStore configured");
  });
});
