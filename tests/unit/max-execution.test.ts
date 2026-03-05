import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Max Execution Time (Stall Detection)", () => {
  test("heartbeat stops renewing after maxExecutionMs exceeded", async () => {
    const store = new InMemoryJobStore();
    const spyRenew = jest.spyOn(store, "renewLock");

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      lockTimeoutMs: 80, // heartbeat every 40ms
      maxExecutionMs: 200, // stall after 200ms
      handler: async () => {
        // Simulate a stuck job that never returns
        await sleep(600);
      },
    });

    await scheduler.schedule({ name: "stuck-job", data: {} });
    await scheduler.start();

    // Wait for stall detection + some buffer
    await sleep(500);
    await scheduler.stop();

    // Heartbeat should have been called a few times, then stopped
    // With 40ms interval and 200ms max, expect ~4 renewals before stall
    const renewCount = spyRenew.mock.calls.length;
    expect(renewCount).toBeGreaterThanOrEqual(1);
    expect(renewCount).toBeLessThanOrEqual(8); // should not keep going forever
  });

  test("emits job:stalled event when maxExecutionMs exceeded", async () => {
    const store = new InMemoryJobStore();
    const stalledJobs: Job[] = [];

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      lockTimeoutMs: 60,
      maxExecutionMs: 80,
      handler: async () => {
        await sleep(300); // will stall
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalledJobs.push(job);
    });

    await scheduler.schedule({ name: "will-stall", data: { test: true } });
    await scheduler.start();

    await sleep(250);
    await scheduler.stop();

    expect(stalledJobs.length).toBe(1);
    expect(stalledJobs[0].name).toBe("will-stall");
  });

  test("per-job maxExecutionMs overrides global default", async () => {
    const store = new InMemoryJobStore();
    const stalledJobs: string[] = [];

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      lockTimeoutMs: 60,
      maxExecutionMs: 500, // global: very long
      handler: async () => {
        await sleep(300); // runs for 300ms
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalledJobs.push(job.name);
    });

    // This job has a tighter per-job limit
    await scheduler.schedule({
      name: "tight-limit",
      data: {},
      maxExecutionMs: 80, // per-job: much shorter
    });

    await scheduler.start();
    await sleep(250);
    await scheduler.stop();

    // Per-job limit of 80ms should trigger stall even though global is 500ms
    expect(stalledJobs).toContain("tight-limit");
  });

  test("no limit when maxExecutionMs is not set (backward compat)", async () => {
    const store = new InMemoryJobStore();
    const spyRenew = jest.spyOn(store, "renewLock");
    const stalledJobs: Job[] = [];

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      lockTimeoutMs: 50, // heartbeat every 25ms
      // NO maxExecutionMs set
      handler: async () => {
        await sleep(200); // long job
      },
    });

    scheduler.on("job:stalled", (job) => {
      stalledJobs.push(job);
    });

    await scheduler.schedule({ name: "long-but-ok", data: {} });
    await scheduler.start();

    await sleep(350);
    await scheduler.stop();

    // Should have multiple renewals (no stall limit)
    expect(spyRenew.mock.calls.length).toBeGreaterThanOrEqual(2);
    // No stall events
    expect(stalledJobs.length).toBe(0);
  });

  test("validation rejects invalid maxExecutionMs on scheduler", () => {
    const store = new InMemoryJobStore();

    expect(() => new Scheduler({ store, maxExecutionMs: 0 })).toThrow(
      "maxExecutionMs must be a positive integer",
    );

    expect(() => new Scheduler({ store, maxExecutionMs: -1 })).toThrow(
      "maxExecutionMs must be a positive integer",
    );

    expect(() => new Scheduler({ store, maxExecutionMs: 1.5 })).toThrow(
      "maxExecutionMs must be a positive integer",
    );
  });

  test("validation rejects invalid maxExecutionMs on schedule()", async () => {
    const store = new InMemoryJobStore();

    const scheduler = new Scheduler({ store });

    await expect(
      scheduler.schedule({ name: "bad", maxExecutionMs: 0 }),
    ).rejects.toThrow("maxExecutionMs must be a positive integer");

    await expect(
      scheduler.schedule({ name: "bad", maxExecutionMs: -100 }),
    ).rejects.toThrow("maxExecutionMs must be a positive integer");
  });
});
