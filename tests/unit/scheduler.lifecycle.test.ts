import { Scheduler } from "../../src/core/scheduler";

describe("Scheduler lifecycle", () => {
  test("starts successfully", async () => {
    const scheduler = new Scheduler();

    await scheduler.start();

    expect(scheduler.isRunning()).toBe(true);
  });

  test("stops successfully", async () => {
    const scheduler = new Scheduler();

    await scheduler.start();
    await scheduler.stop();

    expect(scheduler.isRunning()).toBe(false);
  });

  test("emits scheduler:start event", async () => {
    const scheduler = new Scheduler();
    const calls: string[] = [];

    scheduler.on("scheduler:start", () => {
      calls.push("start");
    });

    await scheduler.start();

    expect(calls).toEqual(["start"]);
  });

  test("emits scheduler:stop event", async () => {
    const scheduler = new Scheduler();
    const calls: string[] = [];

    scheduler.on("scheduler:stop", () => {
      calls.push("stop");
    });

    await scheduler.start();
    await scheduler.stop();

    expect(calls).toEqual(["stop"]);
  });

  test("start is idempotent", async () => {
    const scheduler = new Scheduler();
    let count = 0;

    scheduler.on("scheduler:start", () => count++);

    await scheduler.start();
    await scheduler.start();
    await scheduler.start();

    expect(count).toBe(1);
    expect(scheduler.isRunning()).toBe(true);
  });

  test("stop is idempotent", async () => {
    const scheduler = new Scheduler();
    let count = 0;

    scheduler.on("scheduler:stop", () => count++);

    await scheduler.start();
    await scheduler.stop();
    await scheduler.stop();

    expect(count).toBe(1);
    expect(scheduler.isRunning()).toBe(false);
  });

  test("listener error does not crash scheduler", async () => {
    const scheduler = new Scheduler();

    scheduler.on("scheduler:start", () => {
      throw new Error("boom");
    });

    await expect(scheduler.start()).resolves.not.toThrow();
    expect(scheduler.isRunning()).toBe(true);
  });

  test("multiple listeners are executed", async () => {
    const scheduler = new Scheduler();
    const calls: string[] = [];

    scheduler.on("scheduler:start", () => calls.push("a"));
    scheduler.on("scheduler:start", () => calls.push("b"));
    scheduler.on("scheduler:start", () => calls.push("c"));

    await scheduler.start();

    expect(calls).toEqual(["a", "b", "c"]);
  });

  test("scheduler has an id", () => {
    const scheduler = new Scheduler();
    expect(typeof scheduler.getId()).toBe("string");
  });
});
