import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db } from "mongodb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoDB Complex Scenarios", () => {
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

  test("long running repeating job with retry and heartbeat updates", async () => {
    const lockTimeoutMs = 200;
    const store = new MongoJobStore(db, { lockTimeoutMs }); // Short lock timeout
    const executionLogs: {
      attempt: number;
      time: number;
      type: "start" | "heartbeat" | "fail" | "success";
    }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
      lockTimeoutMs,
      handler: async (job) => {
        const attempt = job.attempts;
        executionLogs.push({ attempt, time: Date.now(), type: "start" });

        // Simulate long job (longer than lockTimeout)
        // We'll sleep in chunks and verify lock extension if possible, but mainly we assume worker does it.
        // We can check DB for lock extension.

        await sleep(150); // < 200
        // Lock should be valid.

        await sleep(150); // Total 300 > 200. Heartbeat should have fired.

        if (attempt === 0) {
          executionLogs.push({ attempt, time: Date.now(), type: "fail" });
          throw new Error("Simulated failure");
        }

        executionLogs.push({ attempt, time: Date.now(), type: "success" });
      },
    });

    await store.create({
      name: "complex-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      repeat: { every: 2000 },
      retry: { maxAttempts: 3, delay: 100 },
    });

    await scheduler.start();

    // Wait for:
    // 1. First run (fail): ~300ms.
    // 2. Retry delay: 100ms.
    // 3. Second run (success): ~300ms.
    // Total ~700ms.

    await sleep(1500);
    await scheduler.stop();

    // Verify logs
    const starts = executionLogs.filter((l) => l.type === "start");
    const fails = executionLogs.filter((l) => l.type === "fail");
    const successes = executionLogs.filter((l) => l.type === "success");

    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(fails.length).toBe(1);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Verify it was retried (attempt 0 then attempt 1)
    expect(starts[0].attempt).toBe(0);
    expect(starts[1].attempt).toBe(1);

    // Verify repeat scheduled next run
    const jobs = await store.findAll({ name: "complex-job" });
    // Should be pending for next run
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });
});
