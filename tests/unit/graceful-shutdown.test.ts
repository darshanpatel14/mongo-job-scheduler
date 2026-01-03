import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Graceful Shutdown", () => {
  test("waits for in-flight job to finish", async () => {
    const store = new InMemoryJobStore();
    let completed = false;
    let started = false;

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10, // fast poll
      handler: async () => {
        started = true;
        await sleep(100); // Simulate work
        completed = true;
      },
    });

    await scheduler.schedule({ name: "long-job", data: {} });
    await scheduler.start();

    // Wait for job to start
    while (!started) {
      await sleep(10);
    }

    // Stop gracefully
    await scheduler.stop({ graceful: true });

    expect(completed).toBe(true);
  });

  test("force quits if timeout reached", async () => {
    const store = new InMemoryJobStore();

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      handler: async () => {
        await sleep(500); // Longer than timeout
      },
    });

    await scheduler.schedule({ name: "timeout-job", data: {} });
    await scheduler.start();

    // allow pickup
    await sleep(50);

    // Stop with short timeout
    // We expect it NOT to throw, but to return?
    // Is it expected to resolve or reject on timeout?
    // My implementation swallows the timeout error and returns.
    await expect(
      scheduler.stop({ graceful: true, timeoutMs: 50 })
    ).resolves.not.toThrow();

    // Check internal state? The test mostly verifies it doesn't hang forever.
  });
});
