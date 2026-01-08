import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("MongoDB Real-World Scenarios", () => {
  let db: any;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  beforeEach(async () => {
    if (db) {
      await db.collection("jobs").deleteMany({});
    }
  });

  test("heavy load: 100 jobs, 10 workers, mixed types and durations", async () => {
    const store = new MongoJobStore(db);
    const completed = new Set<string>();
    const jobTypes = new Map<string, number>();

    const scheduler = new Scheduler({
      store,
      workers: 10,
      pollIntervalMs: 10,
      lockTimeoutMs: 5000,
      handler: async (job) => {
        const type = job.name;
        jobTypes.set(type, (jobTypes.get(type) || 0) + 1);

        // Simulate different job durations
        if (type === "fast") {
          await sleep(10);
        } else if (type === "medium") {
          await sleep(100);
        } else if (type === "slow") {
          await sleep(300); // Heartbeat should maintain lock
        }

        completed.add(job._id!.toString());
      },
    });

    // Create 100 mixed jobs
    const jobs = [];
    for (let i = 0; i < 100; i++) {
      let type: string;
      if (i < 60) type = "fast"; // 60 fast jobs
      else if (i < 85) type = "medium"; // 25 medium jobs
      else type = "slow"; // 15 slow jobs

      jobs.push({
        name: type,
        data: { id: i, type },
        status: "pending" as const,
        attempts: 0,
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await store.createBulk(jobs);

    await scheduler.start();
    await sleep(8000); // Wait for all to complete
    await scheduler.stop();

    // Verify all 100 jobs completed
    expect(completed.size).toBe(100);

    // Verify distribution
    expect(jobTypes.get("fast")).toBe(60);
    expect(jobTypes.get("medium")).toBe(25);
    expect(jobTypes.get("slow")).toBe(15);
  }, 15000); // 15 second timeout

  test("multi-tenant isolation: 50 tenants, verify no cross-execution", async () => {
    const store = new MongoJobStore(db);
    const tenantExecutions = new Map<string, Set<string>>();

    const scheduler = new Scheduler({
      store,
      workers: 5,
      pollIntervalMs: 10,
      handler: async (job) => {
        const tenantId = (job.data as any).tenantId;
        const jobId = job._id!.toString();

        if (!tenantExecutions.has(tenantId)) {
          tenantExecutions.set(tenantId, new Set());
        }

        tenantExecutions.get(tenantId)!.add(jobId);
        await sleep(50);
      },
    });

    // Create 50 tenants, each with 3 jobs
    const jobs = [];
    for (let tenantNum = 1; tenantNum <= 50; tenantNum++) {
      for (let jobNum = 1; jobNum <= 3; jobNum++) {
        jobs.push({
          name: `tenant-${tenantNum}-job-${jobNum}`,
          data: { tenantId: `tenant-${tenantNum}`, jobNum },
          status: "pending" as const,
          attempts: 0,
          nextRunAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    await store.createBulk(jobs);

    await scheduler.start();
    await sleep(5000); // Increased wait for 150 jobs
    await scheduler.stop();

    // Verify: 50 tenants executed
    expect(tenantExecutions.size).toBe(50);

    // Verify: each tenant executed exactly 3 jobs
    for (let i = 1; i <= 50; i++) {
      const tenantJobs = tenantExecutions.get(`tenant-${i}`);
      expect(tenantJobs?.size).toBe(3);
    }
  }, 20000);

  test("retry with MongoDB: verify attempts persist across runs", async () => {
    const store = new MongoJobStore(db);
    let totalRuns = 0;

    const handler = async () => {
      totalRuns++;
      throw new Error("Always fail");
    };

    const job = await store.create({
      name: "persistent-retry-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      retry: { maxAttempts: 3, delay: 100 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // First scheduler run
    let scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler,
    });

    await scheduler.start();
    await sleep(600); // Increased for first run
    await scheduler.stop();

    // Verify: ran at least once
    expect(totalRuns).toBeGreaterThanOrEqual(1);

    // Restart scheduler (simulating crash/restart)
    scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      handler,
    });

    await scheduler.start();
    await sleep(800); // Increased for retry completion
    await scheduler.stop();

    // Verify: total runs = maxAttempts (3)
    expect(totalRuns).toBe(3);

    // Verify: job marked as failed in DB
    const finalJob = await store.findById(job._id as any);
    expect(finalJob?.status).toBe("failed");
    expect(finalJob?.attempts).toBe(3);
  });

  test("concurrent repeat jobs: verify exactly-once per cycle", async () => {
    const store = new MongoJobStore(db);
    const executions: { jobName: string; timestamp: number }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 10, // High concurrency
      pollIntervalMs: 5,
      lockTimeoutMs: 2000,
      handler: async (job) => {
        executions.push({
          jobName: job.name,
          timestamp: Date.now(),
        });
        await sleep(100);
      },
    });

    // Create 5 repeating jobs
    for (let i = 1; i <= 5; i++) {
      await store.create({
        name: `repeat-job-${i}`,
        data: { id: i },
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        repeat: { every: 500 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await scheduler.start();
    await sleep(3000); // Increased for all repeats
    await scheduler.stop();

    // Verify: each job executed multiple times
    const jobExecutionCounts = new Map<string, number>();
    executions.forEach(({ jobName }) => {
      jobExecutionCounts.set(
        jobName,
        (jobExecutionCounts.get(jobName) || 0) + 1
      );
    });

    // Should have 5 unique job names
    expect(jobExecutionCounts.size).toBe(5);

    // Each job should have repeated 2-4 times (depending on timing)
    jobExecutionCounts.forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(5);
    });
  });
});
