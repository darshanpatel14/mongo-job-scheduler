import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { Scheduler } from "../../src/core/scheduler";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db, ObjectId } from "mongodb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoDB Priority Tests", () => {
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

  test("creates job with default priority 5", async () => {
    const store = new MongoJobStore(db);

    const job = await store.create({
      name: "test-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(job.priority).toBe(5);
  });

  test("creates job with custom priority", async () => {
    const store = new MongoJobStore(db);

    const job = await store.create({
      name: "high-priority-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(job.priority).toBe(1);
  });

  test("findAndLockNext returns highest priority job first", async () => {
    const store = new MongoJobStore(db);

    // Create jobs in reverse priority order
    await store.create({
      name: "low-priority",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      priority: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.create({
      name: "high-priority",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.create({
      name: "medium-priority",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      priority: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-1",
      lockTimeoutMs: 10000,
    });

    expect(first).not.toBeNull();
    expect(first!.name).toBe("high-priority");
    expect(first!.priority).toBe(1);
  });

  test("bulk create sets correct priorities", async () => {
    const store = new MongoJobStore(db);

    const jobs = await store.createBulk([
      {
        name: "job-1",
        data: {},
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        name: "job-2",
        data: {},
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        // No priority - should default to 5
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    expect(jobs[0].priority).toBe(2);
    expect(jobs[1].priority).toBe(5);
  });

  test("priority update is persisted", async () => {
    const store = new MongoJobStore(db);

    const job = await store.create({
      name: "update-priority-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      priority: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.update(job._id as ObjectId, { priority: 1 });

    const updated = await store.findById(job._id as ObjectId);
    expect(updated?.priority).toBe(1);
  });

  test("priority sorting with scheduler execution", async () => {
    const store = new MongoJobStore(db);
    const executionOrder: string[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job) => {
        executionOrder.push(job.name);
      },
      workers: 1,
      pollIntervalMs: 50,
    });

    // Schedule jobs in reverse priority order
    await scheduler.schedule({ name: "priority-10", priority: 10 });
    await scheduler.schedule({ name: "priority-1", priority: 1 });
    await scheduler.schedule({ name: "priority-5", priority: 5 });

    await scheduler.start();

    await sleep(500);

    await scheduler.stop();

    // Jobs should run in priority order: 1, 5, 10
    expect(executionOrder).toEqual(["priority-1", "priority-5", "priority-10"]);
  });
});
