import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Scheduler.getJob()", () => {
  test("retrieves an existing job", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const created = await scheduler.schedule({ name: "find-me", data: {} });

    const found = await scheduler.getJob(created._id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("find-me");
    expect(found?._id).toBe(created._id);
  });

  test("returns null for non-existent job", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const found = await scheduler.getJob("non-existent-id");
    expect(found).toBeNull();
  });
});
