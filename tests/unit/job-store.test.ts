import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const now = () => new Date();

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

describe("In Memory Job Store", () => {
  test("creates a job", async () => {
    const store = new InMemoryJobStore();

    const job = await store.create(makeJob());

    expect(job._id).toBeDefined();
    expect(job.status).toBe("pending");
  });

  test("finds and locks next runnable job", async () => {
    const store = new InMemoryJobStore();

    const job = await store.create(makeJob());

    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-1",
      lockTimeoutMs: 1000,
    });

    expect(locked).not.toBeNull();
    expect(locked!.status).toBe("running");
    expect(locked!.lockedBy).toBe("worker-1");
  });

  test("does not allow double locking", async () => {
    const store = new InMemoryJobStore();

    await store.create(makeJob());

    const first = await store.findAndLockNext({
      now: new Date(),
      workerId: "w1",
      lockTimeoutMs: 1000,
    });

    const second = await store.findAndLockNext({
      now: new Date(),
      workerId: "w2",
      lockTimeoutMs: 1000,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test("recovers stale locked jobs", async () => {
    const store = new InMemoryJobStore();

    const job = await store.create(
      makeJob({
        status: "running",
        lockedAt: new Date(Date.now() - 10_000),
      })
    );

    const recovered = await store.recoverStaleJobs({
      now: new Date(),
      lockTimeoutMs: 1000,
    });

    expect(recovered).toBe(1);

    const relocked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker-2",
      lockTimeoutMs: 1000,
    });

    expect(relocked).not.toBeNull();
  });

  test("reschedules job", async () => {
    const store = new InMemoryJobStore();

    const job = await store.create(makeJob());

    const next = new Date(Date.now() + 60_000);
    await store.reschedule(job._id, next);

    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker",
      lockTimeoutMs: 1000,
    });

    expect(locked).toBeNull();
  });

  test("cancels job", async () => {
    const store = new InMemoryJobStore();

    const job = await store.create(makeJob());

    await store.cancel(job._id);

    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "worker",
      lockTimeoutMs: 1000,
    });

    expect(locked).toBeNull();
  });

  test("concurrent workers only lock one job", async () => {
    const store = new InMemoryJobStore();
    await store.create(makeJob());

    const attempts = await Promise.all(
      Array.from({ length: 20 }).map((_, i) =>
        store.findAndLockNext({
          now: new Date(),
          workerId: `w-${i}`,
          lockTimeoutMs: 1000,
        })
      )
    );

    const locked = attempts.filter(Boolean);
    expect(locked.length).toBe(1);
  });

  test("handles many jobs without crashing", async () => {
    const store = new InMemoryJobStore();

    const count = 1000;

    for (let i = 0; i < count; i++) {
      await store.create(makeJob());
    }

    let processed = 0;

    while (true) {
      const job = await store.findAndLockNext({
        now: new Date(),
        workerId: "worker",
        lockTimeoutMs: 1000,
      });

      if (!job) break;

      processed++;
      await store.markCompleted(job._id);
    }

    expect(processed).toBe(count);
  });
});
