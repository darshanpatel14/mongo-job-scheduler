import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

describe("Date Validation", () => {
  let scheduler: Scheduler;
  let store: InMemoryJobStore;

  beforeEach(() => {
    store = new InMemoryJobStore();
    scheduler = new Scheduler({ store });
  });

  test("schedule throws error on invalid runAt date", async () => {
    await expect(async () => {
      await scheduler.schedule({
        name: "test-job",
        runAt: new Date("invalid-date-string"),
      });
    }).rejects.toThrow("Invalid Date");
  });

  test("scheduleBulk throws error on invalid runAt date", async () => {
    await expect(async () => {
      await scheduler.scheduleBulk([
        {
          name: "test-job-1",
          runAt: new Date(),
        },
        {
          name: "test-job-2",
          runAt: new Date("invalid-date"),
        },
      ]);
    }).rejects.toThrow("Invalid Date");
  });

  test("updateJob throws error on invalid nextRunAt date", async () => {
    const job = await scheduler.schedule({
      name: "valid-job",
    });

    await expect(async () => {
      await scheduler.updateJob(job._id, {
        nextRunAt: new Date("bad-date"),
      });
    }).rejects.toThrow("Invalid Date");
  });
});
