import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Job Updates", () => {
  test("updates job data persistence", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "data-job",
      data: { count: 1 },
    });

    // Update persistence
    await scheduler.updateJob(job._id, {
      data: { count: 2 },
    });

    const updated = await scheduler.getJob(job._id);
    expect(updated?.data).toEqual({ count: 2 });
  });

  test("reschedules via nextRunAt update", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const runAt = new Date();
    const job = await scheduler.schedule({
      name: "schedule-job",
      data: {},
      runAt,
    });

    const newRunAt = new Date(runAt.getTime() + 10000);
    await scheduler.updateJob(job._id, {
      nextRunAt: newRunAt,
    });

    const updated = await scheduler.getJob(job._id);
    expect(updated?.nextRunAt).toEqual(newRunAt);
    expect(updated?.status).toBe("pending");
  });

  test("resets status to pending when rescheduling completed job", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "completed-job",
    });

    // Lock the job first (required for ownership verification)
    const locked = await store.findAndLockNext({
      now: new Date(),
      workerId: "test-worker",
      lockTimeoutMs: 60000,
    });

    await store.markCompleted(locked!._id, "test-worker");

    // Reschedule
    const nextRunAt = new Date(Date.now() + 1000);
    await scheduler.updateJob(job._id, { nextRunAt });

    const updated = await scheduler.getJob(job._id);
    expect(updated?.status).toBe("pending");
    expect(updated?.nextRunAt).toEqual(nextRunAt);
  });

  test("updates repeat config dynamically", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "repeat-job",
      data: {},
      repeat: { every: 1000 },
    });

    // Update to run every hour instead
    await scheduler.updateJob(job._id, {
      repeat: { every: 3600000 },
      nextRunAt: new Date(Date.now() + 3600000), // Required now
    });

    const updated = await scheduler.getJob(job._id);
    expect(updated?.repeat?.every).toBe(3600000);
  });
});
