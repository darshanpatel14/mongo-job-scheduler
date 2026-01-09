import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db } from "mongodb";

describe("Mongo Scheduler.schedule() Integration Test", () => {
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

  test("schedule() creates a job in the store with correct defaults", async () => {
    const store = new MongoJobStore(db);
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
    expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(now - 1000); // Allow more drift
    expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(now + 1000);

    // Verify persistence
    // @ts-ignore
    const found = await store.findById(job._id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("test-job");
  });

  test("schedule() respects provided options", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    const nextRun = new Date(Date.now() + 10000);
    // Truncate milliseconds as MongoDB stores Dates with varying precision depending on driver version/serialization
    // Actually JS dates have ms, Mongo does too. Usually safe directly.

    const retry = { maxAttempts: 5, delay: 1000 };
    const repeat = { cron: "* * * * *" };

    const job = await scheduler.schedule({
      name: "test-job-options",
      data: { payload: 123 },
      runAt: nextRun,
      retry,
      repeat,
    });

    // Check timestamps within margin (Mongo might roundtrip slightly differently? Usually not for ms)
    expect(job.nextRunAt.getTime()).toBe(nextRun.getTime());
    expect(job.retry).toEqual(retry);
    expect(job.repeat).toEqual(repeat);
  });

  test("schedule() throws error if job name is missing", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    await expect(
      // @ts-ignore
      scheduler.schedule({
        data: {},
      })
    ).rejects.toThrow("Job name is required");
  });

  test("schedule() throws error if both cron and every are provided", async () => {
    const store = new MongoJobStore(db);
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
