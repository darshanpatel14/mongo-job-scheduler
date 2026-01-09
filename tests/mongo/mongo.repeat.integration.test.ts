import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Job } from "../../src/types/job";
import { Db } from "mongodb";

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

describe("Mongo Repeat Integration Test", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  beforeEach(async () => {
    if (db) {
      await db.collection("scheduler_jobs").deleteMany({}); // using default collection name
    }
  });

  test("cron repeat does not drift even if execution is slow", async () => {
    const store = new MongoJobStore(db);

    const executionTimes: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50, // Higher poll interval for Mongo
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
    // Loosened assertion for Mongo latencies
    deltas.forEach((d) => {
      expect(d).toBeGreaterThan(500);
      expect(d).toBeLessThan(1500);
    });
  });

  test("interval-based repeat drifts with execution time", async () => {
    const store = new MongoJobStore(db);

    const times: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
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
    await sleep(1000); // Increased wait time
    await scheduler.stop();

    expect(times.length).toBeGreaterThanOrEqual(2);

    const delta = times[1] - times[0];

    // should be >= execution time + delay
    expect(delta).toBeGreaterThanOrEqual(200);
  });

  test("cron repeat survives scheduler restart", async () => {
    const store = new MongoJobStore(db);
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
      pollIntervalMs: 50,
    });

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    // restart
    scheduler = new Scheduler({
      store,
      handler,
      pollIntervalMs: 50,
    });

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("retry does not break repeat scheduling", async () => {
    const store = new MongoJobStore(db);

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
    await sleep(3000);
    await scheduler.stop();

    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("missed cron executions are skipped after downtime", async () => {
    const store = new MongoJobStore(db);

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
    await new Promise((r) => setTimeout(r, 1500));
    await scheduler.stop();

    // should only run once (or twice if we cross a second boundary)
    // preventing 60 executions (backlog) is the real test
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(5);
  });
});
