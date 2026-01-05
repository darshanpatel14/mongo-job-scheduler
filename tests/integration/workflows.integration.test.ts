import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Production Workflow Scenarios", () => {
  test("e-commerce order lifecycle: payment → shipping → inventory → abandoned cart", async () => {
    const store = new InMemoryJobStore();
    const workflow: string[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 10,
      handler: async (job) => {
        workflow.push(job.name);

        if (job.name === "payment-notification") {
          // Immediate execution, retry 3x if fails
          if (
            workflow.filter((w) => w === "payment-notification").length === 1
          ) {
            throw new Error("Payment gateway timeout");
          }
        } else if (job.name === "shipping-label") {
          // Delayed 5 sec, retry 2x
          await sleep(50);
        } else if (job.name === "inventory-sync") {
          // Cron hourly, retry 5x
          await sleep(30);
        } else if (job.name === "abandoned-cart-email") {
          // Cron daily, no retry
          await sleep(20);
        }
      },
    });

    // 1. Payment notification (immediate, retry 3x)
    await scheduler.schedule({
      name: "payment-notification",
      data: { orderId: 123, amount: 99.99 },
      retry: { maxAttempts: 3, delay: 50 },
    });

    // 2. Shipping label (delayed, retry 2x)
    await scheduler.schedule({
      name: "shipping-label",
      data: { orderId: 123 },
      runAt: new Date(Date.now() + 200), // 200ms delay
      retry: { maxAttempts: 2, delay: 50 },
    });

    // 3. Inventory sync (repeating, retry 5x)
    await scheduler.schedule({
      name: "inventory-sync",
      data: { storeId: 1 },
      repeat: { every: 500 }, // every 500ms (simulating hourly)
      retry: { maxAttempts: 5, delay: 30 },
    });

    // 4. Abandoned cart email (repeating, no retry)
    await scheduler.schedule({
      name: "abandoned-cart-email",
      data: { cartId: 456 },
      repeat: { every: 600 }, // every 600ms (simulating daily)
    });

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    // Verify all job types executed
    expect(
      workflow.filter((w) => w === "payment-notification").length
    ).toBeGreaterThanOrEqual(2); // 1 fail + 1 success
    expect(
      workflow.filter((w) => w === "shipping-label").length
    ).toBeGreaterThanOrEqual(1);
    expect(
      workflow.filter((w) => w === "inventory-sync").length
    ).toBeGreaterThanOrEqual(2);
    expect(
      workflow.filter((w) => w === "abandoned-cart-email").length
    ).toBeGreaterThanOrEqual(1);
  });

  test("data pipeline: extract → transform → load with dependencies", async () => {
    const store = new InMemoryJobStore();
    const pipeline: { step: string; timestamp: number }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1, // Sequential execution
      pollIntervalMs: 10,
      lockTimeoutMs: 2000,
      handler: async (job) => {
        const step = job.name;
        pipeline.push({ step, timestamp: Date.now() });

        if (step === "extract") {
          await sleep(100); // Fast extraction
        } else if (step === "transform") {
          // Transform may fail, retry 3x
          await sleep(200);
          if (pipeline.filter((p) => p.step === "transform").length === 1) {
            throw new Error("Transform error");
          }
        } else if (step === "load") {
          // Long-running load (heartbeat test)
          await sleep(500);
        }
      },
    });

    // Pipeline jobs scheduled in order (but executed based on nextRunAt)
    await scheduler.schedule({
      name: "extract",
      data: { source: "api" },
      runAt: new Date(Date.now() + 50),
    });

    await scheduler.schedule({
      name: "transform",
      data: { format: "json" },
      runAt: new Date(Date.now() + 200),
      retry: { maxAttempts: 3, delay: 50 },
    });

    await scheduler.schedule({
      name: "load",
      data: { destination: "warehouse" },
      runAt: new Date(Date.now() + 400),
    });

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    // Verify execution order
    expect(pipeline.length).toBeGreaterThanOrEqual(4); // extract + transform(2x) + load

    const extractIdx = pipeline.findIndex((p) => p.step === "extract");
    const transformIdx = pipeline.findIndex((p) => p.step === "transform");
    const loadIdx = pipeline.findIndex((p) => p.step === "load");

    expect(extractIdx).toBeLessThan(transformIdx);
    expect(transformIdx).toBeLessThan(loadIdx);
  });

  test("multi-tenant: 10 tenants with different cron schedules", async () => {
    const store = new InMemoryJobStore();
    const tenantExecutions = new Map<string, number>();

    const scheduler = new Scheduler({
      store,
      workers: 5,
      pollIntervalMs: 10,
      handler: async (job) => {
        const tenantId = (job.data as any).tenantId;
        tenantExecutions.set(
          tenantId,
          (tenantExecutions.get(tenantId) || 0) + 1
        );
        await sleep(50);
      },
    });

    // Create 10 tenants with different repeat intervals
    for (let i = 1; i <= 10; i++) {
      await scheduler.schedule({
        name: `tenant-${i}-report`,
        data: { tenantId: `tenant-${i}` },
        repeat: { every: 200 + i * 50 }, // Different intervals: 250ms, 300ms, 350ms...
      });
    }

    await scheduler.start();
    await sleep(1500);
    await scheduler.stop();

    // Verify all tenants executed at least once
    expect(tenantExecutions.size).toBe(10);

    // Verify each tenant executed independently
    for (let i = 1; i <= 10; i++) {
      expect(tenantExecutions.get(`tenant-${i}`)).toBeGreaterThanOrEqual(1);
    }
  });

  test("graceful degradation: some jobs fail, others continue", async () => {
    const store = new InMemoryJobStore();
    const results: { name: string; status: "success" | "failed" }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 10,
      handler: async (job) => {
        if (job.name === "critical-job") {
          // Always succeeds
          await sleep(50);
          results.push({ name: job.name, status: "success" });
        } else if (job.name === "flaky-job") {
          // Fails 2x, then succeeds
          if (results.filter((r) => r.name === "flaky-job").length < 2) {
            results.push({ name: job.name, status: "failed" });
            throw new Error("Flaky failure");
          }
          results.push({ name: job.name, status: "success" });
        } else if (job.name === "broken-job") {
          // Always fails
          results.push({ name: job.name, status: "failed" });
          throw new Error("Permanently broken");
        }
      },
    });

    // Schedule mixed reliability jobs
    await scheduler.scheduleBulk([
      { name: "critical-job", data: { id: 1 } },
      { name: "critical-job", data: { id: 2 } },
      { name: "critical-job", data: { id: 3 } },
    ]);

    await scheduler.schedule({
      name: "flaky-job",
      data: {},
      retry: { maxAttempts: 3, delay: 50 },
    });

    await scheduler.schedule({
      name: "broken-job",
      data: {},
      retry: { maxAttempts: 2, delay: 50 },
    });

    await scheduler.start();
    await sleep(800);
    await scheduler.stop();

    // Verify: critical jobs succeeded
    const criticalSuccesses = results.filter(
      (r) => r.name === "critical-job" && r.status === "success"
    );
    expect(criticalSuccesses.length).toBe(3);

    // Verify: flaky job eventually succeeded
    const flakySuccess = results.find(
      (r) => r.name === "flaky-job" && r.status === "success"
    );
    expect(flakySuccess).toBeDefined();

    // Verify: broken job failed all retries
    const brokenFailures = results.filter(
      (r) => r.name === "broken-job" && r.status === "failed"
    );
    expect(brokenFailures.length).toBe(2); // maxAttempts
  });
});
