import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Scheduler } from "../../src/core/scheduler";
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

describe("Concurrency Limits - Unit Tests", () => {
  describe("InMemoryJobStore Concurrency", () => {
    test("creates job with concurrency limit", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob({ concurrency: 3 }));

      expect(job.concurrency).toBe(3);
    });

    test("findAndLockNext respects concurrency limit", async () => {
      const store = new InMemoryJobStore();

      // Create 3 jobs with concurrency limit of 2
      await store.create(makeJob({ name: "api-sync", concurrency: 2 }));
      await store.create(makeJob({ name: "api-sync", concurrency: 2 }));
      await store.create(makeJob({ name: "api-sync", concurrency: 2 }));

      // Lock first two jobs
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

      // Third job should be blocked due to concurrency limit
      const job3 = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-3",
        lockTimeoutMs: 10000,
      });

      expect(job1).not.toBeNull();
      expect(job2).not.toBeNull();
      expect(job3).toBeNull(); // Blocked by concurrency
    });

    test("findAndLockNext allows when under limit", async () => {
      const store = new InMemoryJobStore();

      // Create 2 jobs with concurrency limit of 5
      await store.create(makeJob({ name: "api-sync", concurrency: 5 }));
      await store.create(makeJob({ name: "api-sync", concurrency: 5 }));

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

      expect(job1).not.toBeNull();
      expect(job2).not.toBeNull();
    });

    test("different job types have independent concurrency", async () => {
      const store = new InMemoryJobStore();

      // Create jobs of different types, each with concurrency 1
      await store.create(makeJob({ name: "type-a", concurrency: 1 }));
      await store.create(makeJob({ name: "type-b", concurrency: 1 }));

      const jobA = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 10000,
      });
      const jobB = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-2",
        lockTimeoutMs: 10000,
      });

      expect(jobA).not.toBeNull();
      expect(jobA!.name).toBe("type-a");
      expect(jobB).not.toBeNull();
      expect(jobB!.name).toBe("type-b");
    });

    test("jobs without concurrency limit are unrestricted", async () => {
      const store = new InMemoryJobStore();

      // Create 5 jobs without concurrency limit
      for (let i = 0; i < 5; i++) {
        await store.create(makeJob({ name: "unlimited" }));
      }

      const jobs = [];
      for (let i = 0; i < 5; i++) {
        const job = await store.findAndLockNext({
          now: new Date(),
          workerId: `worker-${i}`,
          lockTimeoutMs: 10000,
        });
        if (job) jobs.push(job);
      }

      expect(jobs.length).toBe(5);
    });

    test("countRunning returns correct count", async () => {
      const store = new InMemoryJobStore();

      await store.create(makeJob({ name: "test-job", status: "running" }));
      await store.create(makeJob({ name: "test-job", status: "running" }));
      await store.create(makeJob({ name: "test-job", status: "pending" }));
      await store.create(makeJob({ name: "other-job", status: "running" }));

      const count = await store.countRunning("test-job");
      expect(count).toBe(2);
    });

    test("updates job concurrency", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob({ concurrency: 5 }));

      await store.update(job._id, { concurrency: 10 });

      const updated = await store.findById(job._id);
      expect(updated?.concurrency).toBe(10);
    });
  });

  describe("Scheduler Concurrency", () => {
    test("schedule() accepts concurrency option", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const job = await scheduler.schedule({
        name: "api-sync",
        concurrency: 5,
      });

      expect(job.concurrency).toBe(5);
    });

    test("schedule() validates concurrency must be positive", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.schedule({
          name: "invalid-concurrency",
          concurrency: 0,
        })
      ).rejects.toThrow("Concurrency must be a positive integer");

      await expect(
        scheduler.schedule({
          name: "invalid-concurrency",
          concurrency: -1,
        })
      ).rejects.toThrow("Concurrency must be a positive integer");
    });

    test("schedule() rejects non-integer concurrency", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.schedule({
          name: "invalid-concurrency",
          concurrency: 2.5,
        })
      ).rejects.toThrow("Concurrency must be a positive integer");
    });

    test("scheduleBulk() accepts concurrency option", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const jobs = await scheduler.scheduleBulk([
        { name: "job-1", concurrency: 3 },
        { name: "job-2", concurrency: 5 },
      ]);

      expect(jobs[0].concurrency).toBe(3);
      expect(jobs[1].concurrency).toBe(5);
    });

    test("scheduleBulk() validates concurrency", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.scheduleBulk([
          { name: "valid-job", concurrency: 5 },
          { name: "invalid-job", concurrency: 0 },
        ])
      ).rejects.toThrow("Concurrency must be a positive integer");
    });

    test("updateJob() allows concurrency changes", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const job = await scheduler.schedule({
        name: "update-concurrency-job",
        concurrency: 5,
      });

      await scheduler.updateJob(job._id, { concurrency: 10 });

      const updated = await scheduler.getJob(job._id);
      expect(updated?.concurrency).toBe(10);
    });
  });
});
