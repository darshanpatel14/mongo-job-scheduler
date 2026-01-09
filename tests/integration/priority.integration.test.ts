import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

describe("Priority Integration Tests", () => {
  test("higher priority jobs run before lower priority jobs", async () => {
    const store = new InMemoryJobStore();
    const executionOrder: string[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        executionOrder.push(job.name);
      },
      workers: 1,
      pollIntervalMs: 50,
    });

    // Schedule jobs in reverse priority order
    await scheduler.schedule({ name: "low-priority", priority: 10 });
    await scheduler.schedule({ name: "high-priority", priority: 1 });
    await scheduler.schedule({ name: "medium-priority", priority: 5 });

    await scheduler.start();

    // Wait for all jobs to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    await scheduler.stop();

    // Jobs should run in priority order: 1, 5, 10
    expect(executionOrder).toEqual([
      "high-priority",
      "medium-priority",
      "low-priority",
    ]);
  });

  test("jobs with equal priority run in FIFO order by nextRunAt", async () => {
    const store = new InMemoryJobStore();
    const executionOrder: string[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        executionOrder.push(job.name);
      },
      workers: 1,
      pollIntervalMs: 50,
    });

    const earlier = new Date(Date.now() - 1000);
    const later = new Date();

    // Schedule with same priority but different times
    await scheduler.schedule({
      name: "later-job",
      priority: 1,
      runAt: later,
    });
    await scheduler.schedule({
      name: "earlier-job",
      priority: 1,
      runAt: earlier,
    });

    await scheduler.start();

    // Wait for all jobs to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    await scheduler.stop();

    // Jobs should run in nextRunAt order when priority is equal
    expect(executionOrder).toEqual(["earlier-job", "later-job"]);
  });

  test("priority changes take effect on next poll", async () => {
    const store = new InMemoryJobStore();
    const executionOrder: string[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        executionOrder.push(job.name);
      },
      workers: 1,
      pollIntervalMs: 50,
    });

    // Schedule job in the future
    const futureTime = new Date(Date.now() + 200);

    const job1 = await scheduler.schedule({
      name: "job-1",
      priority: 10,
      runAt: futureTime,
    });
    const job2 = await scheduler.schedule({
      name: "job-2",
      priority: 5,
      runAt: futureTime,
    });

    // Change job1 to higher priority before it runs
    await scheduler.updateJob(job1._id, { priority: 1 });

    await scheduler.start();

    // Wait for jobs to run
    await new Promise((resolve) => setTimeout(resolve, 500));

    await scheduler.stop();

    // job-1 should now run first due to updated priority
    expect(executionOrder).toEqual(["job-1", "job-2"]);
  });

  test("default priority 5 is used when not specified", async () => {
    const store = new InMemoryJobStore();
    const scheduler = new Scheduler({ store });

    const job = await scheduler.schedule({
      name: "default-priority-job",
    });

    // Store should have set default priority
    const fetched = await scheduler.getJob(job._id);
    expect(fetched?.priority).toBe(5);
  });
});
