import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Worker } from "../../src/worker/worker";
import { SchedulerEmitter } from "../../src/events";
import { Job } from "../../src/types/job";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "test",
    data: {},
    status: "pending",
    nextRunAt: new Date(),
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Worker Integration", () => {
  test("worker executes a job successfully", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    const executed: string[] = [];

    const worker = new Worker(
      store,
      emitter,
      async (job) => {
        executed.push(job.name);
      },
      { pollIntervalMs: 10 }
    );

    await store.create(makeJob({ name: "job-1" }));

    await worker.start();
    await sleep(50);
    await worker.stop();

    expect(executed).toEqual(["job-1"]);
  });

  test("emits job lifecycle events", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    const events: string[] = [];

    emitter.on("job:start", () => events.push("start"));
    emitter.on("job:success", () => events.push("success"));
    emitter.on("job:complete", () => events.push("complete"));

    const worker = new Worker(store, emitter, async () => {}, {
      pollIntervalMs: 10,
    });

    await store.create(makeJob());

    await worker.start();
    await sleep(50);
    await worker.stop();

    expect(events).toEqual(["start", "success", "complete"]);
  });

  test("marks job as failed when handler throws", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    const errors: string[] = [];

    emitter.on("job:fail", ({ error }) => {
      errors.push(error.message);
    });

    const worker = new Worker(
      store,
      emitter,
      async () => {
        throw new Error("boom");
      },
      { pollIntervalMs: 10 }
    );

    const job = await store.create(makeJob());

    await worker.start();
    await sleep(50);
    await worker.stop();

    expect(errors).toEqual(["boom"]);
  });

  test("multiple workers do not process same job", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    let count = 0;

    const handler = async () => {
      count++;
      await sleep(10);
    };

    const w1 = new Worker(store, emitter, handler, { pollIntervalMs: 5 });
    const w2 = new Worker(store, emitter, handler, { pollIntervalMs: 5 });

    await store.create(makeJob());

    await w1.start();
    await w2.start();

    await sleep(100);

    await w1.stop();
    await w2.stop();

    expect(count).toBe(1);
  });

  test("worker stops polling after stop()", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    let executions = 0;

    const worker = new Worker(
      store,
      emitter,
      async () => {
        executions++;
      },
      { pollIntervalMs: 10 }
    );

    await worker.start();

    // allow loop to initialize
    await sleep(20);

    await worker.stop();

    // ensure loop had time to exit
    await sleep(20);

    await store.create(makeJob());

    await sleep(50);

    expect(executions).toBe(0);
  });

  test("processes many jobs sequentially", async () => {
    const store = new InMemoryJobStore();
    const emitter = new SchedulerEmitter();

    const total = 200;
    let processed = 0;

    const worker = new Worker(
      store,
      emitter,
      async () => {
        processed++;
      },
      { pollIntervalMs: 1 }
    );

    for (let i = 0; i < total; i++) {
      await store.create(makeJob());
    }

    await worker.start();
    await sleep(300);
    await worker.stop();

    expect(processed).toBe(total);
  });
});
