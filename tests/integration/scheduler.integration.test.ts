import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "test",
    data: {},
    status: "pending",
    nextRunAt: new Date(),
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Scheduler Integration Test", () => {
  test("scheduler processes jobs", async () => {
    const store = new InMemoryJobStore();

    let count = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        count++;
      },
      workers: 1,
      pollIntervalMs: 10,
    });

    await store.create(makeJob());
    await store.create(makeJob());

    await scheduler.start();
    await sleep(100);
    await scheduler.stop();

    expect(count).toBe(2);
  });

  test("scheduler emits start and stop events", async () => {
    const store = new InMemoryJobStore();

    const events: string[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async () => {},
    });

    scheduler.on("scheduler:start", () => events.push("start"));
    scheduler.on("scheduler:stop", () => events.push("stop"));

    await scheduler.start();
    await scheduler.stop();

    expect(events).toEqual(["start", "stop"]);
  });

  test("multiple workers do not double-process jobs", async () => {
    const store = new InMemoryJobStore();
    let processed = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        processed++;
        await sleep(10);
      },
      workers: 3,
      pollIntervalMs: 5,
    });

    for (let i = 0; i < 10; i++) {
      await store.create(makeJob());
    }

    await scheduler.start();
    await sleep(300);
    await scheduler.stop();

    expect(processed).toBe(10);
  });

  test("scheduler stop prevents further execution", async () => {
    const store = new InMemoryJobStore();

    let processed = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        processed++;
      },
      pollIntervalMs: 10,
    });

    await scheduler.start();
    await scheduler.stop();

    await store.create(makeJob());

    await sleep(100);

    expect(processed).toBe(0);
  });

  test("scheduler handles many jobs", async () => {
    const store = new InMemoryJobStore();

    let count = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        count++;
      },
      workers: 4,
      pollIntervalMs: 1,
    });

    const TOTAL = 200;

    for (let i = 0; i < TOTAL; i++) {
      await store.create(makeJob());
    }

    await scheduler.start();
    await sleep(500);
    await scheduler.stop();

    expect(count).toBe(TOTAL);
  });
});
