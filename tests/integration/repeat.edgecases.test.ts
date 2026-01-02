import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Repeat EdgeCase Test", () => {
  test("missed cron executions are skipped after downtime", async () => {
    const store = new InMemoryJobStore();

    let runs = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        runs++;
      },
      pollIntervalMs: 10,
    });

    await store.create({
      name: "cron",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(Date.now() - 60_000),
      repeat: { cron: "*/1 * * * * *" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 800));
    await scheduler.stop();

    // should only run once (or twice if we cross a second boundary)
    // preventing 60 executions (backlog) is the real test
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(5);
  });

  test("repeat never causes tight infinite loop", async () => {
    const store = new InMemoryJobStore();

    let executions = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        executions++;
      },
      pollIntervalMs: 1,
    });

    await store.create({
      name: "fast",
      data: {},
      status: "pending",
      attempts: 0,
      repeat: { every: 0 },
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    await scheduler.stop();

    expect(executions).toBeLessThan(20);
  });

  test("retry does not override repeat scheduling", async () => {
    const store = new InMemoryJobStore();
    let calls = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        calls++;
        if (calls === 1) throw new Error("fail");
      },
      pollIntervalMs: 10,
    });

    await store.create({
      name: "mixed",
      data: {},
      status: "pending",
      attempts: 0,
      retry: { maxAttempts: 2, delay: 50 },
      repeat: { cron: "*/1 * * * * *" },
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
