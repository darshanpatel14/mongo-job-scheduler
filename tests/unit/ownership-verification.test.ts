import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { JobOwnershipError } from "../../src/store/store-errors";
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

describe("Ownership Verification", () => {
  describe("markCompleted", () => {
    test("succeeds when workerId matches lockedBy", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob());

      // Lock the job
      const locked = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 60000,
      });

      expect(locked).not.toBeNull();
      expect(locked!.lockedBy).toBe("worker-1");

      // Complete with correct workerId - should succeed
      await expect(
        store.markCompleted(locked!._id, "worker-1")
      ).resolves.not.toThrow();

      // Verify job is completed
      const completed = await store.findById(locked!._id);
      expect(completed?.status).toBe("completed");
      expect(completed?.lockedBy).toBeUndefined();
    });

    test("throws JobOwnershipError when workerId does not match lockedBy", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob());

      // Lock the job with worker-1
      const locked = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 60000,
      });

      expect(locked).not.toBeNull();

      // Try to complete with different workerId - should fail
      await expect(
        store.markCompleted(locked!._id, "worker-2")
      ).rejects.toThrow(JobOwnershipError);

      // Verify job is still running
      const stillRunning = await store.findById(locked!._id);
      expect(stillRunning?.status).toBe("running");
    });

    test("throws JobOwnershipError when job is not running", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob());

      // Lock and complete the job
      const locked = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 60000,
      });

      await store.markCompleted(locked!._id, "worker-1");

      // Try to complete again - should fail (job is no longer running)
      await expect(
        store.markCompleted(locked!._id, "worker-1")
      ).rejects.toThrow(JobOwnershipError);
    });

    test("throws JobOwnershipError when lock was stolen by another worker", async () => {
      const store = new InMemoryJobStore();
      const job = await store.create(makeJob());

      // Worker 1 locks the job
      const locked = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-1",
        lockTimeoutMs: 100, // Short timeout
      });

      expect(locked).not.toBeNull();

      // Simulate lock expiry and worker 2 reclaiming (via stale recovery)
      await new Promise((r) => setTimeout(r, 150));

      // Manually recover and relock (simulating what would happen)
      await store.recoverStaleJobs({
        now: new Date(),
        lockTimeoutMs: 100,
      });

      const relocked = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker-2",
        lockTimeoutMs: 60000,
      });

      expect(relocked).not.toBeNull();
      expect(relocked!.lockedBy).toBe("worker-2");

      // Worker 1 tries to complete - should fail because lock was stolen
      await expect(store.markCompleted(job._id, "worker-1")).rejects.toThrow(
        JobOwnershipError
      );

      // Job should still be running under worker-2
      const current = await store.findById(relocked!._id);
      expect(current?.status).toBe("running");
      expect(current?.lockedBy).toBe("worker-2");
    });
  });
});
