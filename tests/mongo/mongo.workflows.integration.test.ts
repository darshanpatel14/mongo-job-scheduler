import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";
import { Db } from "mongodb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Mongo Production Workflow Scenarios", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  beforeEach(async () => {
    if (db) {
      await db.collection("scheduler_jobs").deleteMany({});
    }
  });

  test("e-commerce order lifecycle: payment → shipping → inventory → abandoned cart", async () => {
    const store = new MongoJobStore(db);
    const workflow: string[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 50,
      handler: async (job) => {
        workflow.push(job.name);

        if (job.name === "payment-notification") {
          // Immediate execution, retry 3x if fails
          // Check count in DB or memory? Memory is per process, here we are in same process.
          // We need reliable failure simulation.
          const fails = workflow.filter(
            (w) => w === "payment-notification"
          ).length;
          if (fails === 1) {
            throw new Error("Payment gateway timeout");
          }
        } else if (job.name === "shipping-label") {
          await sleep(50);
        } else if (job.name === "inventory-sync") {
          await sleep(30);
        } else if (job.name === "abandoned-cart-email") {
          await sleep(20);
        }
      },
    });

    // 1. Payment
    await scheduler.schedule({
      name: "payment-notification",
      data: { orderId: 123, amount: 99.99 },
      retry: { maxAttempts: 3, delay: 50 },
    });

    // 2. Shipping
    await scheduler.schedule({
      name: "shipping-label",
      data: { orderId: 123 },
      runAt: new Date(Date.now() + 200),
      retry: { maxAttempts: 2, delay: 50 },
    });

    // 3. Inventory
    await scheduler.schedule({
      name: "inventory-sync",
      data: { storeId: 1 },
      repeat: { every: 800 }, // Increased from 500
      retry: { maxAttempts: 5, delay: 30 },
    });

    // 4. Abandoned cart
    await scheduler.schedule({
      name: "abandoned-cart-email",
      data: { cartId: 456 },
      repeat: { every: 1000 },
    });

    await scheduler.start();
    await sleep(2500); // Wait longer
    await scheduler.stop();

    // Verify
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
  }, 10000);

  test("data pipeline: extract → transform → load with dependencies", async () => {
    const store = new MongoJobStore(db);
    const pipeline: { step: string; timestamp: number }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 1, // Sequential
      pollIntervalMs: 50,
      lockTimeoutMs: 2000,
      handler: async (job) => {
        const step = job.name;
        pipeline.push({ step, timestamp: Date.now() });

        if (step === "extract") {
          await sleep(100);
        } else if (step === "transform") {
          await sleep(200);
          if (pipeline.filter((p) => p.step === "transform").length === 1) {
            throw new Error("Transform error");
          }
        } else if (step === "load") {
          await sleep(500);
        }
      },
    });

    await scheduler.schedule({
      name: "extract",
      data: { source: "api" },
      runAt: new Date(Date.now() + 50),
    });

    await scheduler.schedule({
      name: "transform",
      data: { format: "json" },
      runAt: new Date(Date.now() + 400), // Increased spacing
      retry: { maxAttempts: 3, delay: 50 },
    });

    await scheduler.schedule({
      name: "load",
      data: { destination: "warehouse" },
      runAt: new Date(Date.now() + 1000), // Increased spacing
    });

    await scheduler.start();
    await sleep(3000);
    await scheduler.stop();

    expect(pipeline.length).toBeGreaterThanOrEqual(4);

    const extractIdx = pipeline.findIndex((p) => p.step === "extract");
    const transformIdx = pipeline.findIndex((p) => p.step === "transform");
    const loadIdx = pipeline.findIndex((p) => p.step === "load");

    expect(extractIdx).toBeLessThan(transformIdx);
    expect(transformIdx).toBeLessThan(loadIdx);
  }, 10000);

  test("multi-tenant: 10 tenants with different cron schedules", async () => {
    const store = new MongoJobStore(db);
    const tenantExecutions = new Map<string, number>();

    const scheduler = new Scheduler({
      store,
      workers: 5,
      pollIntervalMs: 20,
      handler: async (job) => {
        const tenantId = (job.data as any).tenantId;
        tenantExecutions.set(
          tenantId,
          (tenantExecutions.get(tenantId) || 0) + 1
        );
        await sleep(20);
      },
    });

    for (let i = 1; i <= 10; i++) {
      // Reduced frequency for Mongo test speed
      await scheduler.schedule({
        name: `tenant-${i}-report`,
        data: { tenantId: `tenant-${i}` },
        repeat: { every: 400 + i * 50 },
      });
    }

    await scheduler.start();
    await sleep(2000);
    await scheduler.stop();

    expect(tenantExecutions.size).toBe(10);

    for (let i = 1; i <= 10; i++) {
      expect(tenantExecutions.get(`tenant-${i}`)).toBeGreaterThanOrEqual(1);
    }
  }, 10000);

  test("graceful degradation: some jobs fail, others continue", async () => {
    const store = new MongoJobStore(db);
    const results: { name: string; status: "success" | "failed" }[] = [];

    const scheduler = new Scheduler({
      store,
      workers: 3,
      pollIntervalMs: 50,
      handler: async (job) => {
        if (job.name === "critical-job") {
          await sleep(50);
          results.push({ name: job.name, status: "success" });
        } else if (job.name === "flaky-job") {
          const failCount = results.filter(
            (r) => r.name === "flaky-job" && r.status === "failed"
          ).length;
          if (failCount < 2) {
            results.push({ name: job.name, status: "failed" });
            throw new Error("Flaky failure");
          }
          results.push({ name: job.name, status: "success" });
        } else if (job.name === "broken-job") {
          results.push({ name: job.name, status: "failed" });
          throw new Error("Permanently broken");
        }
      },
    });

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
    await sleep(2000);
    await scheduler.stop();

    // Critical success
    const criticalSuccesses = results.filter(
      (r) => r.name === "critical-job" && r.status === "success"
    );
    expect(criticalSuccesses.length).toBe(3);

    // Flaky eventual success
    const flakySuccess = results.find(
      (r) => r.name === "flaky-job" && r.status === "success"
    );
    expect(flakySuccess).toBeDefined();

    // Broken failures
    const brokenFailures = results.filter(
      (r) => r.name === "broken-job" && r.status === "failed"
    );
    expect(brokenFailures.length).toBe(2);
  }, 10000);
});
