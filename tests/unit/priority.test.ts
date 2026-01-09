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

describe("Job Priority - Unit Tests", () => {
  describe("InMemoryJobStore Priority", () => {
    test("creates a job with default priority 5", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob());

      expect(job.priority).toBe(5);
    });

    test("creates a job with custom priority", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob({ priority: 1 }));

      expect(job.priority).toBe(1);
    });

    test("findAndLockNext returns highest priority job first", async () => {
      const store = new InMemoryJobStore();

      // Create jobs with different priorities (lower = higher priority)
      await store.create(makeJob({ name: "low-priority", priority: 10 }));
      await store.create(makeJob({ name: "high-priority", priority: 1 }));
      await store.create(makeJob({ name: "medium-priority", priority: 5 }));

      const first = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 1000,
      });

      expect(first).not.toBeNull();
      expect(first!.name).toBe("high-priority");
      expect(first!.priority).toBe(1);
    });

    test("findAndLockNext returns earlier job when priorities are equal", async () => {
      const store = new InMemoryJobStore();

      const earlier = new Date(Date.now() - 1000);
      const later = new Date();

      await store.create(
        makeJob({ name: "later-job", priority: 1, nextRunAt: later })
      );
      await store.create(
        makeJob({ name: "earlier-job", priority: 1, nextRunAt: earlier })
      );

      const first = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 1000,
      });

      expect(first).not.toBeNull();
      expect(first!.name).toBe("earlier-job");
    });

    test("updates job priority", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob({ priority: 5 }));

      await store.update(job._id, { priority: 1 });

      const updated = await store.findById(job._id);
      expect(updated?.priority).toBe(1);
    });
  });

  describe("Scheduler Priority", () => {
    test("schedule() accepts priority option", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const job = await scheduler.schedule({
        name: "priority-job",
        data: { test: true },
        priority: 2,
      });

      expect(job.priority).toBe(2);
    });

    test("schedule() validates priority must be 1-10", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.schedule({
          name: "invalid-priority",
          priority: 0,
        })
      ).rejects.toThrow("Priority must be an integer between 1 and 10");

      await expect(
        scheduler.schedule({
          name: "invalid-priority",
          priority: 11,
        })
      ).rejects.toThrow("Priority must be an integer between 1 and 10");
    });

    test("schedule() rejects non-integer priority", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.schedule({
          name: "invalid-priority",
          priority: 1.5,
        })
      ).rejects.toThrow("Priority must be an integer between 1 and 10");
    });

    test("scheduleBulk() accepts priority option", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const jobs = await scheduler.scheduleBulk([
        { name: "job-1", priority: 1 },
        { name: "job-2", priority: 10 },
      ]);

      expect(jobs[0].priority).toBe(1);
      expect(jobs[1].priority).toBe(10);
    });

    test("scheduleBulk() validates priority for each job", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      await expect(
        scheduler.scheduleBulk([
          { name: "valid-job", priority: 5 },
          { name: "invalid-job", priority: 15 },
        ])
      ).rejects.toThrow("Priority must be an integer between 1 and 10");
    });

    test("updateJob() allows priority changes", async () => {
      const store = new InMemoryJobStore();
      const scheduler = new Scheduler({ store });

      const job = await scheduler.schedule({
        name: "update-priority-job",
        priority: 5,
      });

      await scheduler.updateJob(job._id, { priority: 1 });

      const updated = await scheduler.getJob(job._id);
      expect(updated?.priority).toBe(1);
    });
  });
});
