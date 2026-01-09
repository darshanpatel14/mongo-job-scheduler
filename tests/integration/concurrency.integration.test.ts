import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Concurrency Limits - Integration Tests", () => {
  test("only N jobs run concurrently with concurrency limit", async () => {
    const store = new InMemoryJobStore();
    const concurrentCount: number[] = [];
    let currentlyRunning = 0;

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        currentlyRunning++;
        concurrentCount.push(currentlyRunning);

        await sleep(100); // Simulate work

        currentlyRunning--;
      },
      workers: 5, // More workers than concurrency limit
      pollIntervalMs: 20,
    });

    // Schedule 5 jobs with concurrency limit of 2
    for (let i = 0; i < 5; i++) {
      await scheduler.schedule({
        name: "rate-limited-job",
        concurrency: 2,
      });
    }

    await scheduler.start();

    // Wait for all jobs to complete
    await sleep(800);

    await scheduler.stop();

    // Verify max concurrent was never more than 2
    const maxConcurrent = Math.max(...concurrentCount);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test("different job types have independent concurrency limits", async () => {
    const store = new InMemoryJobStore();
    const executionLog: { name: string; event: "start" | "end" }[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        executionLog.push({ name: job.name, event: "start" });
        await sleep(50);
        executionLog.push({ name: job.name, event: "end" });
      },
      workers: 4,
      pollIntervalMs: 20,
    });

    // Schedule 2 of each type, each with concurrency 1
    await scheduler.schedule({ name: "type-a", concurrency: 1 });
    await scheduler.schedule({ name: "type-a", concurrency: 1 });
    await scheduler.schedule({ name: "type-b", concurrency: 1 });
    await scheduler.schedule({ name: "type-b", concurrency: 1 });

    await scheduler.start();

    await sleep(400);

    await scheduler.stop();

    // All 4 jobs should complete
    const completedJobs = executionLog.filter((e) => e.event === "end").length;
    expect(completedJobs).toBe(4);
  });

  test("blocked jobs run after slots free up", async () => {
    const store = new InMemoryJobStore();
    const executionOrder: number[] = [];

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        executionOrder.push(job.data as number);
        await sleep(50);
      },
      workers: 3,
      pollIntervalMs: 20,
    });

    // Schedule 3 jobs with concurrency limit of 1
    await scheduler.schedule({ name: "sequential", data: 1, concurrency: 1 });
    await scheduler.schedule({ name: "sequential", data: 2, concurrency: 1 });
    await scheduler.schedule({ name: "sequential", data: 3, concurrency: 1 });

    await scheduler.start();

    await sleep(400);

    await scheduler.stop();

    // All jobs should have executed
    expect(executionOrder.length).toBe(3);
    expect(executionOrder).toContain(1);
    expect(executionOrder).toContain(2);
    expect(executionOrder).toContain(3);
  });

  test("jobs without concurrency limit run in parallel", async () => {
    const store = new InMemoryJobStore();
    const concurrentCount: number[] = [];
    let currentlyRunning = 0;

    const scheduler = new Scheduler({
      store,
      handler: async (job: Job) => {
        currentlyRunning++;
        concurrentCount.push(currentlyRunning);

        await sleep(100);

        currentlyRunning--;
      },
      workers: 5,
      pollIntervalMs: 20,
    });

    // Schedule 5 jobs WITHOUT concurrency limit
    for (let i = 0; i < 5; i++) {
      await scheduler.schedule({
        name: "unlimited-job",
        // No concurrency limit
      });
    }

    await scheduler.start();

    await sleep(300);

    await scheduler.stop();

    // Should see higher concurrency (depending on timing, could be up to 5)
    const maxConcurrent = Math.max(...concurrentCount);
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});
