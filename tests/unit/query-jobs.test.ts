import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Job Query API", () => {
  let scheduler: Scheduler;

  beforeEach(async () => {
    scheduler = new Scheduler({ store: new InMemoryJobStore() });

    // Seed data
    await scheduler.scheduleBulk([
      { name: "job A", data: { id: 1 }, runAt: new Date(Date.now() + 1000) },
      { name: "job B", data: { id: 2 }, runAt: new Date(Date.now() + 2000) },
      { name: "job A", data: { id: 3 }, runAt: new Date(Date.now() + 3000) },
    ]);
  });

  test("filters by name", async () => {
    const jobs = await scheduler.getJobs({ name: "job A" });
    expect(jobs).toHaveLength(2);
    expect(jobs[0].name).toBe("job A");
    expect(jobs[1].name).toBe("job A");
  });

  test("sorts by nextRunAt desc", async () => {
    const jobs = await scheduler.getJobs({
      sort: { field: "nextRunAt", order: "desc" },
    });
    expect(jobs[0].data).toEqual({ id: 3 });
    expect(jobs[1].data).toEqual({ id: 2 });
    expect(jobs[2].data).toEqual({ id: 1 });
  });

  test("paginates via skip/limit", async () => {
    const jobs = await scheduler.getJobs({
      sort: { field: "nextRunAt", order: "asc" },
      skip: 1,
      limit: 1,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({ id: 2 }); // id: 1 is skipped
  });
});
