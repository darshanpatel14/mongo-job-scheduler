import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";

describe("Mongo concurrency", () => {
  let db: any;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  test("multiple workers do not execute same job twice", async () => {
    const store = new MongoJobStore(db);

    const executed = new Set<string>();

    const scheduler = new Scheduler({
      store,
      handler: async (job) => {
        if (executed.has(job._id!.toString())) {
          throw new Error("Duplicate execution detected");
        }
        executed.add(job._id!.toString());
      },
      pollIntervalMs: 20,
      workers: 5,
    });

    // create 50 jobs
    for (let i = 0; i < 50; i++) {
      await store.create({
        name: `job-${i}`,
        data: {},
        status: "pending",
        attempts: 0,
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 3000));
    await scheduler.stop();

    expect(executed.size).toBe(50);
  });

  test("lock contention does not cause double execution", async () => {
    const store = new MongoJobStore(db);

    let runs = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 50)); // slow job
      },
      pollIntervalMs: 10,
      workers: 10,
    });

    await store.create({
      name: "contended-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.stop();

    expect(runs).toBe(1);
  });

  test("retry works correctly with MongoJobStore", async () => {
    const store = new MongoJobStore(db);

    let runs = 0;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        runs++;
        throw new Error("fail");
      },
      pollIntervalMs: 50,
      workers: 1,
    });

    await store.create({
      name: "retry-job",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      retry: {
        maxAttempts: 3,
        delay: 50,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 2000));
    await scheduler.stop();

    expect(runs).toBe(3);
  });
});
