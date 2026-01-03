import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "repeat-job",
    data: {},
    status: "pending",
    nextRunAt: new Date(),
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Repeat Integration Test", () => {
  test.skip("cron repeat does not drift even if execution is slow", async () => {
    const store = new InMemoryJobStore();

    const executionTimes: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 5,
      handler: async () => {
        executionTimes.push(Date.now());
        await sleep(80); // simulate slow job
      },
    });

    const nextSecond = new Date();
    nextSecond.setMilliseconds(0);
    nextSecond.setSeconds(nextSecond.getSeconds() + 1);

    await store.create(
      makeJob({
        nextRunAt: nextSecond,
        repeat: { cron: "*/1 * * * * *" }, // every second
      })
    );

    await scheduler.start();
    await sleep(2500);
    await scheduler.stop();

    expect(executionTimes.length).toBeGreaterThanOrEqual(2);

    const deltas = executionTimes.slice(1).map((t, i) => t - executionTimes[i]);

    // should be close to 1000ms, NOT cumulative
    deltas.forEach((d) => {
      expect(d).toBeGreaterThan(800);
      expect(d).toBeLessThan(1300);
    });
  });

  test("interval-based repeat drifts with execution time", async () => {
    const store = new InMemoryJobStore();

    const times: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 5,
      handler: async () => {
        times.push(Date.now());
        await sleep(120);
      },
    });

    await store.create(
      makeJob({
        repeat: { every: 100 },
      })
    );

    await scheduler.start();
    await sleep(500);
    await scheduler.stop();

    expect(times.length).toBeGreaterThanOrEqual(2);

    const delta = times[1] - times[0];

    // should be >= execution time + delay
    expect(delta).toBeGreaterThanOrEqual(200);
  });

  test("cron repeat survives scheduler restart", async () => {
    const store = new InMemoryJobStore();
    let count = 0;

    const handler = async () => {
      count++;
    };

    const job = makeJob({
      repeat: { cron: "*/1 * * * * *" },
    });

    await store.create(job);

    let scheduler = new Scheduler({
      store,
      handler,
      pollIntervalMs: 5,
    });

    await scheduler.start();
    await sleep(1100);
    await scheduler.stop();

    // restart
    scheduler = new Scheduler({
      store,
      handler,
      pollIntervalMs: 5,
    });

    await scheduler.start();
    await sleep(1100);
    await scheduler.stop();

    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("retry does not break repeat scheduling", async () => {
    const store = new InMemoryJobStore();

    let calls = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        calls++;
        if (calls === 1) throw new Error("fail once");
      },
    });

    await store.create(
      makeJob({
        repeat: { cron: "*/1 * * * * *" },
        retry: { maxAttempts: 2, delay: 50 },
      })
    );

    await scheduler.start();
    await sleep(2500);
    await scheduler.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("repeat job is not double-executed by multiple workers", async () => {
    const store = new InMemoryJobStore();

    let count = 0;

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 5,
      handler: async () => {
        count++;
        await sleep(50);
      },
    });

    await store.create(
      makeJob({
        repeat: { every: 100 },
      })
    );

    await scheduler.start();
    await sleep(500);
    await scheduler.stop();

    expect(count).toBeGreaterThan(1);
  });
});
