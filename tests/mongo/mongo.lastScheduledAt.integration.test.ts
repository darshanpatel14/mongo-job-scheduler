import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Job } from "../../src/types/job";
import { Db } from "mongodb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Mongo lastScheduledAt & nextRunAt Integration Test", () => {
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

  // =============================================
  // 1. lastScheduledAt is persisted via schedule()
  // =============================================
  test("lastScheduledAt is persisted when passed via schedule()", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    const pastDate = new Date("2026-01-15T10:00:00Z");

    const job = await scheduler.schedule({
      name: "lastScheduled-persist-test",
      data: { foo: "bar" },
      lastScheduledAt: pastDate,
    });

    expect(job).toBeDefined();
    expect(job.lastScheduledAt).toBeDefined();
    expect(job.lastScheduledAt!.getTime()).toBe(pastDate.getTime());

    // Verify persistence in DB
    // @ts-ignore
    const found = await store.findById(job._id);
    expect(found).toBeDefined();
    expect(found!.lastScheduledAt).toBeDefined();
    expect(new Date(found!.lastScheduledAt!).getTime()).toBe(
      pastDate.getTime(),
    );
  });

  // =============================================
  // 2. nextRunAt alias works
  // =============================================
  test("nextRunAt alias sets job.nextRunAt when runAt is not provided", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    const futureDate = new Date(Date.now() + 60000); // 1 minute from now

    const job = await scheduler.schedule({
      name: "nextRunAt-alias-test",
      data: { test: true },
      nextRunAt: futureDate,
    });

    expect(job).toBeDefined();
    expect(job.nextRunAt.getTime()).toBe(futureDate.getTime());

    // Verify persistence
    // @ts-ignore
    const found = await store.findById(job._id);
    expect(found).toBeDefined();
    expect(new Date(found!.nextRunAt).getTime()).toBe(futureDate.getTime());
  });

  // =============================================
  // 3. runAt takes precedence over nextRunAt
  // =============================================
  test("runAt takes precedence over nextRunAt when both are provided", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    const runAtDate = new Date(Date.now() + 30000);
    const nextRunAtDate = new Date(Date.now() + 90000);

    const job = await scheduler.schedule({
      name: "runAt-precedence-test",
      data: {},
      runAt: runAtDate,
      nextRunAt: nextRunAtDate,
    });

    expect(job).toBeDefined();
    // runAt should win
    expect(job.nextRunAt.getTime()).toBe(runAtDate.getTime());
    expect(job.nextRunAt.getTime()).not.toBe(nextRunAtDate.getTime());
  });

  // =============================================
  // 4. lastScheduledAt used as cron base
  // =============================================
  test("lastScheduledAt is used as base for cron scheduling", async () => {
    const store = new MongoJobStore(db);

    let executionCount = 0;
    const executedJobs: Job[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
      handler: async (job) => {
        executionCount++;
        executedJobs.push({ ...job });
      },
    });

    // Set lastScheduledAt to a recent past second boundary
    const now = new Date();
    const lastScheduled = new Date(now);
    lastScheduled.setMilliseconds(0);
    lastScheduled.setSeconds(lastScheduled.getSeconds() - 1);

    // Schedule a cron job (every second) with lastScheduledAt in the past
    await scheduler.schedule({
      name: "cron-lastScheduled-test",
      data: {},
      lastScheduledAt: lastScheduled,
      repeat: { cron: "*/1 * * * * *" }, // every second
    });

    await scheduler.start();
    await sleep(2500); // let it run for ~2.5 seconds
    await scheduler.stop();

    // Job should have executed at least once
    expect(executionCount).toBeGreaterThanOrEqual(1);
  });

  // =============================================
  // 5. lastScheduledAt survives reschedule (cron)
  // =============================================
  test("cron reschedule preserves lastScheduledAt and updates nextRunAt", async () => {
    const store = new MongoJobStore(db);
    let execCount = 0;

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
      handler: async () => {
        execCount++;
      },
    });

    // Use a recent lastScheduledAt (2 seconds ago)
    const now = new Date();
    const recentPast = new Date(now);
    recentPast.setMilliseconds(0);
    recentPast.setSeconds(recentPast.getSeconds() - 2);

    // Create job directly via store for full control
    const job = await store.create({
      name: "cron-reschedule-lastScheduled-test",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(), // run now
      lastScheduledAt: recentPast,
      repeat: { cron: "*/1 * * * * *" },
      createdAt: now,
      updatedAt: now,
    });

    await scheduler.start();
    await sleep(3500);
    await scheduler.stop();

    expect(execCount).toBeGreaterThanOrEqual(1);

    // After execution, verify job state
    // @ts-ignore
    const updated = await store.findById(job._id);
    expect(updated).toBeDefined();

    // lastScheduledAt should be preserved from creation
    expect(new Date(updated!.lastScheduledAt!).getTime()).toBe(
      recentPast.getTime(),
    );

    // nextRunAt should be updated to a future cron slot
    expect(new Date(updated!.nextRunAt).getTime()).toBeGreaterThan(
      now.getTime(),
    );

    // The job should still be pending (rescheduled for next cron tick)
    expect(updated!.status).toBe("pending");
  }, 15000);

  // =============================================
  // 6. lastScheduledAt undefined by default
  // =============================================
  test("lastScheduledAt is undefined when not provided", async () => {
    const store = new MongoJobStore(db);
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "no-lastScheduled-test",
      data: {},
    });

    expect(job.lastScheduledAt).toBeUndefined();

    // @ts-ignore
    const found = await store.findById(job._id);
    // MongoDB stores undefined fields as null
    expect(found!.lastScheduledAt).toBeNull();
  });

  // =============================================
  // 7. interval repeat with lastScheduledAt + nextRunAt
  // =============================================
  test("interval repeat works with nextRunAt and lastScheduledAt", async () => {
    const store = new MongoJobStore(db);
    const execTimes: number[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 50,
      handler: async () => {
        execTimes.push(Date.now());
      },
    });

    const now = Date.now();

    await scheduler.schedule({
      name: "interval-lastScheduled-combined-test",
      data: {},
      nextRunAt: new Date(now), // run immediately
      lastScheduledAt: new Date(now - 5000), // 5 seconds ago
      repeat: { every: 500 }, // repeat every 500ms
    });

    await scheduler.start();
    await sleep(2000);
    await scheduler.stop();

    // Should have executed multiple times
    expect(execTimes.length).toBeGreaterThanOrEqual(2);

    // Intervals should be roughly 500ms apart (+ execution time + poll)
    if (execTimes.length >= 2) {
      const delta = execTimes[1] - execTimes[0];
      expect(delta).toBeGreaterThanOrEqual(400);
      expect(delta).toBeLessThan(2000);
    }
  });
});
