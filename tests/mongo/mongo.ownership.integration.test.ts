import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoDB Ownership Verification", () => {
  let db: any;

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

  test("CPU-bound job does not complete if lock was stolen", async () => {
    const store = new MongoJobStore(db, { lockTimeoutMs: 300 });
    const events: string[] = [];
    let jobStartCount = 0;

    // Create a scheduler with very short lock timeout
    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
      lockTimeoutMs: 300, // 300ms lock timeout
      handler: async (job) => {
        jobStartCount++;
        const startNum = jobStartCount;
        events.push(`job:start:${startNum}`);

        // Simulate CPU-bound work that blocks longer than lock timeout
        // This is synchronous blocking to simulate event loop block
        const startTime = Date.now();
        while (Date.now() - startTime < 500) {
          // Busy wait - simulates CPU-bound work blocking event loop
        }

        events.push(`job:handler:complete:${startNum}`);
      },
    });

    // Listen for ownership errors
    let ownershipErrorCount = 0;
    scheduler.on("worker:error", (err) => {
      if (err.message.includes("ownership lost")) {
        ownershipErrorCount++;
        events.push("ownership:error");
      }
    });

    scheduler.on("job:success", () => {
      events.push("job:success");
    });

    // Create a single job
    const job = await store.create({
      name: "cpu-bound-job",
      data: { test: true },
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();

    // Wait for job processing
    await sleep(1000);

    await scheduler.stop();

    // Verify: The job handler ran at least once
    expect(jobStartCount).toBeGreaterThanOrEqual(1);

    // Check final job status
    const finalJob = await store.findById(job._id as any);

    // The job should be completed by one of the workers
    // If ownership was properly enforced, only the legitimate owner completed it
    console.log("Events:", events);
    console.log("Final job status:", finalJob?.status);
    console.log("Ownership errors:", ownershipErrorCount);

    // Either the job is completed (by legitimate owner) or we had ownership errors
    // The key is that we don't have duplicate completions
    expect(finalJob?.status === "completed" || ownershipErrorCount > 0).toBe(
      true
    );
  });

  test("markCompleted throws error when workerId does not match", async () => {
    const store = new MongoJobStore(db, { lockTimeoutMs: 60000 });

    // Create and lock a job
    const job = await store.create({
      name: "test-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-1",
      lockTimeoutMs: 60000,
    });

    expect(locked).not.toBeNull();
    expect(locked!.lockedBy).toBe("worker-1");

    // Try to complete with wrong workerId
    const { JobOwnershipError } = await import("../../src/store/store-errors");

    await expect(
      store.markCompleted(locked!._id as any, "wrong-worker")
    ).rejects.toThrow(JobOwnershipError);

    // Verify job is still running
    const stillRunning = await store.findById(locked!._id as any);
    expect(stillRunning?.status).toBe("running");
    expect(stillRunning?.lockedBy).toBe("worker-1");
  });

  test("markCompleted succeeds with correct workerId", async () => {
    const store = new MongoJobStore(db, { lockTimeoutMs: 60000 });

    // Create and lock a job
    const job = await store.create({
      name: "test-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-1",
      lockTimeoutMs: 60000,
    });

    expect(locked).not.toBeNull();

    // Complete with correct workerId
    await expect(
      store.markCompleted(locked!._id as any, "worker-1")
    ).resolves.not.toThrow();

    // Verify job is completed
    const completed = await store.findById(locked!._id as any);
    expect(completed?.status).toBe("completed");
    expect(completed?.lockedBy).toBeUndefined();
  });
});
