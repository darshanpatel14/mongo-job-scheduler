import { Scheduler } from "../../src";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Job } from "../../src/types/job";
import { Db } from "mongodb";

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

describe("Mongo Retry Integration Test", () => {
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

  test("job retries once and then succeeds", async () => {
    const store = new MongoJobStore(db);

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
    await sleep(500); // Increased from 150ms for Mongo latency
    await scheduler.stop();

    expect(attempts).toBe(2);
  });

  test("job fails after max retry attempts", async () => {
    const store = new MongoJobStore(db);

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

    await store.create(
      makeJob({
        retry: { maxAttempts: 3, delay: 10 },
      })
    );

    await scheduler.start();
    await sleep(800); // Increased from 300ms
    await scheduler.stop();

    expect(calls).toBe(3);

    // Additional Mongo verification
    const jobs = await store.findAll({ name: "retry-job" });
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].attempts).toBe(3);
  });

  test("retry respects delay", async () => {
    const store = new MongoJobStore(db);

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
        retry: { maxAttempts: 2, delay: 300 }, // Increased delay for stability
      })
    );

    await scheduler.start();
    await sleep(1000); // Increased wait
    await scheduler.stop();

    expect(timestamps.length).toBe(2);

    const delta = timestamps[1] - timestamps[0];
    expect(delta).toBeGreaterThanOrEqual(280); // Allow some jitter
  });

  test("retry emits job:retry event", async () => {
    const store = new MongoJobStore(db);

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
    await sleep(500);
    await scheduler.stop();

    expect(events).toContain("retry");
    expect(events).toContain("fail");
  });

  test("retry survives scheduler restart", async () => {
    const store = new MongoJobStore(db);

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
        retry: { maxAttempts: 2, delay: 500 }, // Longer delay to survive restart time
      })
    );

    await scheduler.start();
    await sleep(200); // Should run once and fail
    await scheduler.stop();

    expect(attempts).toBe(1);

    // restart scheduler
    scheduler = new Scheduler({
      store,
      handler,
      workers: 1,
      pollIntervalMs: 10,
    });

    await scheduler.start();
    await sleep(1000); // Wait for retry delay + poll
    await scheduler.stop();

    expect(attempts).toBe(2);
  });

  test("retry: number shorthand works (maxAttempts=N, delay=0)", async () => {
    const store = new MongoJobStore(db);
    let attempts = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler: async () => {
        attempts++;
        throw new Error("fail");
      },
    });

    // using retry: 3 shorthand
    await scheduler.schedule({
      name: "shorthand-job",
      retry: 3,
    });

    await scheduler.start();

    // Give it enough time to retry 3 times
    await sleep(800);
    await scheduler.stop();

    // Verify it attempted exactly 3 times
    expect(attempts).toBe(3);
  });
});
