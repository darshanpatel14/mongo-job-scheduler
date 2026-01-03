import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Scheduler.scheduleBulk()", () => {
  test("creates multiple jobs", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const jobs = await scheduler.scheduleBulk([
      { name: "job-1", data: { id: 1 } },
      { name: "job-2", data: { id: 2 } },
    ]);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe("job-1");
    expect(jobs[1].name).toBe("job-2");

    const found1 = await store.findById(jobs[0]._id);
    const found2 = await store.findById(jobs[1]._id);
    expect(found1).toBeDefined();
    expect(found2).toBeDefined();
  });

  test("validates jobs in bulk", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    await expect(
      scheduler.scheduleBulk([
        { name: "valid", data: {} },
        { name: "", data: {} }, // Invalid
      ])
    ).rejects.toThrow("Job name is required");
  });
});
