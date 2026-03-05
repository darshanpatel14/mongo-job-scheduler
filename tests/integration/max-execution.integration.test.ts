import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Max Execution Time Integration", () => {
  test("stuck handler triggers stall detection and event", async () => {
    // NOTE: InMemoryJobStore does NOT recover stale running jobs
    // (only MongoJobStore has the stale lock recovery path).
    // This test verifies that:
    // 1. The stall is detected (heartbeat stops)
    // 2. The job:stalled event fires
    // Full recovery cycle (stall → lock expiry → another worker picks up)
    // is tested via the MongoDB stress test.

    const store = new InMemoryJobStore();
    let attempts = 0;
    const stalledJobs: string[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 2,
      pollIntervalMs: 10,
      lockTimeoutMs: 60,
      maxExecutionMs: 80,
      handler: async (job) => {
        attempts++;
        if (attempts === 1) {
          await sleep(500); // stuck
        }
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalledJobs.push(job.name);
    });

    await scheduler.schedule({
      name: "retry-after-stall",
      data: {},
      retry: { maxAttempts: 3, delay: 10 },
    });

    await scheduler.start();
    await sleep(400);
    await scheduler.stop();

    // Stall should have been detected
    expect(stalledJobs.length).toBe(1);
    expect(stalledJobs[0]).toBe("retry-after-stall");
    // At least 1 attempt was made
    expect(attempts).toBe(1);
  });

  test("normal long job under maxExecutionMs completes successfully", async () => {
    const store = new InMemoryJobStore();
    const completed: string[] = [];
    const stalledJobs: Job[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1,
      pollIntervalMs: 10,
      lockTimeoutMs: 100, // heartbeat every 50ms
      maxExecutionMs: 500, // generous limit
      handler: async (job) => {
        await sleep(150); // well under the 500ms limit
        completed.push(job.name);
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalledJobs.push(job);
    });

    await scheduler.schedule({ name: "normal-long-job", data: {} });
    await scheduler.start();

    await sleep(300);
    await scheduler.stop();

    // Job should complete normally
    expect(completed).toEqual(["normal-long-job"]);
    // No stall events
    expect(stalledJobs.length).toBe(0);
  });

  test("mixed jobs: some stall, others complete normally", async () => {
    const store = new InMemoryJobStore();
    const completed: string[] = [];
    const stalled: string[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 10,
      lockTimeoutMs: 60,
      maxExecutionMs: 100,
      handler: async (job) => {
        const data = job.data as { duration: number };
        await sleep(data.duration);
        completed.push(job.name);
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalled.push(job.name);
    });

    await scheduler.scheduleBulk([
      { name: "fast-job", data: { duration: 20 } },
      { name: "ok-job", data: { duration: 50 } },
      { name: "stuck-job", data: { duration: 500 } },
    ]);

    await scheduler.start();
    await sleep(400);
    await scheduler.stop();

    // Fast and ok jobs should complete
    expect(completed).toContain("fast-job");
    expect(completed).toContain("ok-job");
    // Stuck job should be detected as stalled
    expect(stalled).toContain("stuck-job");
  });
});
