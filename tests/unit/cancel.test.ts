import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Scheduler.cancel()", () => {
  test("cancels a pending job", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({ name: "cancel-me", data: {} });
    expect(job.status).toBe("pending");

    await scheduler.cancel(job._id);

    const check = await store.findById(job._id);
    expect(check?.status).toBe("cancelled");
  });

  test("cancel() on running job marks it cancelled", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({ name: "test", data: {} });

    // Simulate running via public API (lock)
    await store.findAndLockNext({
      now: new Date(),
      workerId: "test-w",
      lockTimeoutMs: 30000,
    });

    await scheduler.cancel(job._id);

    const check = await store.findById(job._id);
    expect(check?.status).toBe("cancelled");
  });
});
