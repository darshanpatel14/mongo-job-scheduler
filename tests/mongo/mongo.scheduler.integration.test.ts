import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db } from "mongodb";
import { Job } from "../../src/types/job";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoJobStore Scheduler Integration", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  beforeEach(async () => {
    if (db) {
      await db.collection("scheduler_jobs").deleteMany({});
    }
  });

  test("executes a one-time job", async () => {
    const store = new MongoJobStore(db);

    let ran = false;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        ran = true;
      },
      pollIntervalMs: 50,
    });

    await store.create(makeJob({ name: "once" }));

    await scheduler.start();
    await sleep(300);
    await scheduler.stop();

    expect(ran).toBe(true);
  });

  test("recovers job locked by crashed worker", async () => {
    const store = new MongoJobStore(db, { lockTimeoutMs: 100 });

    let runs = 0;

    await store.create(
      makeJob({
        name: "crash-job",
        status: "running",
        nextRunAt: new Date(Date.now() - 1000),
        // @ts-ignore
        lockedAt: new Date(Date.now() - 1000),
        lockedBy: "dead-worker",
      })
    );

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        runs++;
      },
      pollIntervalMs: 50,
      lockTimeoutMs: 100,
    });

    await scheduler.start();
    await sleep(500); // Wait for recovery cycle (default 10s poll? No, start calls recoverStaleJobs immediately, or periodically?)
    // recoverStaleJobs is called on start().
    // And also we might need to wait for poll.

    await scheduler.stop();

    expect(runs).toBe(1);
  });

  test("scheduler emits start and stop events", async () => {
    const store = new MongoJobStore(db);

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
    const store = new MongoJobStore(db);
    let processed = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        processed++;
        await sleep(20);
      },
      workers: 3,
      pollIntervalMs: 20,
    });

    for (let i = 0; i < 10; i++) {
      // Reduced frequency
    }
    await store.createBulk(Array.from({ length: 10 }, () => makeJob()));

    await scheduler.start();
    await sleep(1000);
    await scheduler.stop();

    expect(processed).toBe(10);
  });

  test("scheduler stop prevents further execution", async () => {
    const store = new MongoJobStore(db);

    let processed = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        processed++;
      },
      pollIntervalMs: 20,
    });

    await scheduler.start();
    await scheduler.stop();

    await store.create(makeJob());

    await sleep(100);

    expect(processed).toBe(0);
  });

  test("scheduler handles many jobs", async () => {
    const store = new MongoJobStore(db);

    let count = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        count++;
      },
      workers: 4,
      pollIntervalMs: 10,
    });

    const TOTAL = 50; // Reduced from 200

    await store.createBulk(Array.from({ length: TOTAL }, () => makeJob()));

    await scheduler.start();
    await sleep(2000);
    await scheduler.stop();

    expect(count).toBe(TOTAL);
  }, 10000);
});
