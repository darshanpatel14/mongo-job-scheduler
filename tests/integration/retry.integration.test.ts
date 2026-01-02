import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "retry-job",
    data: {},
    status: "pending",
    nextRunAt: new Date(),
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Retry Integration Test", () => {
  test("job retries once and then succeeds", async () => {
    const store = new InMemoryJobStore();

    let attempts = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("fail once");
        }
      },
    });

    await store.create(
      makeJob({
        retry: { maxAttempts: 2, delay: 10 },
      })
    );

    await scheduler.start();
    await sleep(150);
    await scheduler.stop();

    expect(attempts).toBe(2);
  });

  test("job fails after max retry attempts", async () => {
    const store = new InMemoryJobStore();

    let calls = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        calls++;
        throw new Error("always fail");
      },
    });

    const job = await store.create(
      makeJob({
        retry: { maxAttempts: 3, delay: 10 },
      })
    );

    await scheduler.start();
    await sleep(300);
    await scheduler.stop();

    expect(calls).toBe(3);
  });

  test("retry respects delay", async () => {
    const store = new InMemoryJobStore();

    const timestamps: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 5,
      handler: async () => {
        timestamps.push(Date.now());
        throw new Error("retry");
      },
    });

    await store.create(
      makeJob({
        retry: { maxAttempts: 2, delay: 100 },
      })
    );

    await scheduler.start();
    await sleep(300);
    await scheduler.stop();

    expect(timestamps.length).toBe(2);

    const delta = timestamps[1] - timestamps[0];
    expect(delta).toBeGreaterThanOrEqual(90);
  });

  test("retry respects delay", async () => {
    const store = new InMemoryJobStore();

    const timestamps: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 5,
      handler: async () => {
        timestamps.push(Date.now());
        throw new Error("retry");
      },
    });

    await store.create(
      makeJob({
        retry: { maxAttempts: 2, delay: 100 },
      })
    );

    await scheduler.start();
    await sleep(300);
    await scheduler.stop();

    expect(timestamps.length).toBe(2);

    const delta = timestamps[1] - timestamps[0];
    expect(delta).toBeGreaterThanOrEqual(90);
  });

  test("retry emits job:retry event", async () => {
    const store = new InMemoryJobStore();

    const events: string[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        throw new Error("boom");
      },
    });

    scheduler.on("job:retry", () => events.push("retry"));
    scheduler.on("job:fail", () => events.push("fail"));

    await store.create(
      makeJob({
        retry: { maxAttempts: 2, delay: 10 },
      })
    );

    await scheduler.start();
    await sleep(200);
    await scheduler.stop();

    expect(events).toContain("retry");
    expect(events).toContain("fail");
  });

  test("retry survives scheduler restart", async () => {
    const store = new InMemoryJobStore();

    let attempts = 0;

    const handler = async () => {
      attempts++;
      throw new Error("fail");
    };

    // first run
    let scheduler = new Scheduler({
      store,
      handler,
      workers: 1,
      pollIntervalMs: 10,
    });

    await store.create(
      makeJob({
        retry: { maxAttempts: 2, delay: 50 },
      })
    );

    await scheduler.start();
    await sleep(80);
    await scheduler.stop();

    // restart scheduler
    scheduler = new Scheduler({
      store,
      handler,
      workers: 1,
      pollIntervalMs: 10,
    });

    await scheduler.start();
    await sleep(200);
    await scheduler.stop();

    expect(attempts).toBe(2);
  });
});
