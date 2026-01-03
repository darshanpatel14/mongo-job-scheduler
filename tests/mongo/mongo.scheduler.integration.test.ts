import { Scheduler } from "../../src/core/scheduler";
import { MongoJobStore } from "../../src/store/mongo/mongo-job-store";
import { setupMongo, teardownMongo } from "./mongo.setup";

describe("MongoJobStore Scheduler Integration", () => {
  let db: any;

  beforeAll(async () => {
    db = await setupMongo();
  });

  afterAll(async () => {
    await teardownMongo();
  });

  test("executes a one-time job", async () => {
    const store = new MongoJobStore(db);

    let ran = false;

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        ran = true;
      },
      pollIntervalMs: 50,
    });

    await store.create({
      name: "once",
      data: {},
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 300));
    await scheduler.stop();

    expect(ran).toBe(true);
  });

  test("recovers job locked by crashed worker", async () => {
    const store = new MongoJobStore(db, { lockTimeoutMs: 100 });

    let runs = 0;

    await store.create({
      name: "crash-job",
      data: {},
      status: "running",
      attempts: 0,
      nextRunAt: new Date(Date.now() - 1000),
      lockedAt: new Date(Date.now() - 1000),
      lockedBy: "dead-worker",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const scheduler = new Scheduler({
      store,
      handler: async () => {
        runs++;
      },
      pollIntervalMs: 50,
      lockTimeoutMs: 100,
    });

    await scheduler.start();
    await new Promise((r) => setTimeout(r, 300));
    await scheduler.stop();

    expect(runs).toBe(1);
  });
});
