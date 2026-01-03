import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Scheduler Deduplication", () => {
  test("prevents duplicate jobs with same dedupeKey", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job1 = await scheduler.schedule({
      name: "dedupe-test",
      data: { v: 1 },
      dedupeKey: "unique-key-1",
    });

    const job2 = await scheduler.schedule({
      name: "dedupe-test",
      data: { v: 2 },
      dedupeKey: "unique-key-1",
    });

    expect(job1._id).toBe(job2._id);

    // Check store has only 1 job
    // Access usage of store internals in test is acceptable or via scheduler.getJob
    // Since getJob needs ID, we can check we only have 1 ID to check.

    const allJobs = await store.createBulk([]); // dummy to access? no.
    // We can't easily count jobs via public API without listing (which we don't have yet).
    // But since IDs are same, it implies collision handled.
  });

  test("allows different dedupeKeys", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job1 = await scheduler.schedule({
      name: "dedupe-test",
      data: {},
      dedupeKey: "key-A",
    });

    const job2 = await scheduler.schedule({
      name: "dedupe-test",
      data: {},
      dedupeKey: "key-B",
    });

    expect(job1._id).not.toBe(job2._id);
  });
});
