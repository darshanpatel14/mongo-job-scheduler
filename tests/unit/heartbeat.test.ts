import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Worker Heartbeat", () => {
  test("renews lock while job is running", async () => {
    const store = new InMemoryJobStore();
    // lockTimeoutMs is short (50ms)
    // job takes 150ms
    // heartbeat should run every 25ms and keep lock alive

    // We need to spy on renewLock
    const spyRenew = jest.spyOn(store, "renewLock");

    const scheduler = new Scheduler({
      store,
      pollIntervalMs: 10,
      lockTimeoutMs: 50,
      handler: async () => {
        await sleep(150);
      },
    });

    await scheduler.schedule({ name: "long-job", data: {} });
    await scheduler.start();

    // Wait for job to finish
    await sleep(200);

    await scheduler.stop();

    // Verify renewLock was called
    // Duration 150ms, interval 25ms -> approx 5-6 calls
    expect(spyRenew).toHaveBeenCalled();
    expect(spyRenew.mock.calls.length).toBeGreaterThan(1);
  });
});
