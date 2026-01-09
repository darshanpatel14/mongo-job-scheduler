import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { Scheduler } from "../../src/core/scheduler";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db, ObjectId } from "mongodb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoDB Concurrency Tests", () => {
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

  test("creates job with concurrency limit", async () => {
    const store = new MongoJobStore(db);

    const job = await store.create({
      name: "api-sync",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      concurrency: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(job.concurrency).toBe(5);
  });

  test("findAndLockNext respects concurrency limit", async () => {
    const store = new MongoJobStore(db);

    // Create 3 jobs with concurrency limit of 2
    for (let i = 0; i < 3; i++) {
      await store.create({
        name: "rate-limited",
        data: { index: i },
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        concurrency: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Lock first two
    const job1 = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-1",
      lockTimeoutMs: 10000,
    });
    const job2 = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-2",
      lockTimeoutMs: 10000,
    });

    // Third should be blocked
    const job3 = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-3",
      lockTimeoutMs: 10000,
    });

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job3).toBeNull();
  });

  test("countRunning returns correct count", async () => {
    const store = new MongoJobStore(db);

    await store.create({
      name: "test-job",
      data: {},
      status: "running",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.create({
      name: "test-job",
      data: {},
      status: "running",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.create({
      name: "test-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const count = await store.countRunning("test-job");
    expect(count).toBe(2);
  });

  test("concurrency update is persisted", async () => {
    const store = new MongoJobStore(db);

    const job = await store.create({
      name: "update-concurrency",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      concurrency: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.update(job._id as ObjectId, { concurrency: 10 });

    const updated = await store.findById(job._id as ObjectId);
    expect(updated?.concurrency).toBe(10);
  });

  test("concurrency enforced with scheduler execution", async () => {
    const store = new MongoJobStore(db);
    const concurrentCount: number[] = [];
    let currentlyRunning = 0;

    const scheduler = new Scheduler({
      store,
      handler: async (job) => {
        currentlyRunning++;
        concurrentCount.push(currentlyRunning);

        await sleep(100);

        currentlyRunning--;
      },
      workers: 5,
      pollIntervalMs: 30,
    });

    // Schedule 5 jobs with concurrency limit of 2
    for (let i = 0; i < 5; i++) {
      await scheduler.schedule({
        name: "rate-limited-mongo",
        concurrency: 2,
      });
    }

    await scheduler.start();

    await sleep(800);

    await scheduler.stop();

    // Max concurrent should be at most 2
    const maxConcurrent = Math.max(...concurrentCount);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
