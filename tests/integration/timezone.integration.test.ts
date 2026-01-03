import { Scheduler } from "../../src/core/scheduler";
import { InMemoryJobStore } from "../../src/store/in-memory-job-store";
import { Job } from "../../src/types/job";
import { getNextRunAt } from "../../src/worker/repeat";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    name: "timezone-job",
    data: {},
    status: "pending",
    nextRunAt: new Date(),
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Timezone Integration Test", () => {
  test("uses UTC by default", () => {
    // 12:00 UTC
    const base = new Date("2023-01-01T12:00:00Z");

    // cron: every hour at minute 0
    const next = getNextRunAt({ cron: "0 * * * *" }, base);

    // Should be 13:00 UTC
    expect(next.toISOString()).toBe("2023-01-01T13:00:00.000Z");
  });

  test("respects global default timezone", () => {
    // 12:00 UTC is 07:00 EST (America/New_York)
    const base = new Date("2023-01-01T12:00:00Z");

    // cron: 08:00 every day
    // If in EST, next run should be today at 08:00 EST (13:00 UTC)
    // base is 07:00 EST, so 08:00 EST is +1 hour

    const next = getNextRunAt({ cron: "0 8 * * *" }, base, "America/New_York");

    // 08:00 EST is 13:00 UTC
    expect(next.toISOString()).toBe("2023-01-01T13:00:00.000Z");
  });

  test("uses job-specific timezone over global default", () => {
    // 12:00 UTC
    const base = new Date("2023-01-01T12:00:00Z");

    // cron: 08:00 every day
    // Job timezone: Europe/London (GMT)
    // 12:00 UTC is 12:00 GMT. 08:00 GMT was in the past.
    // Next 08:00 GMT is tomorrow.

    // Global timezone: America/New_York (EST)
    // 12:00 UTC is 07:00 EST. 08:00 EST is today (+1 hour).

    // Should use London, so tomorrow
    const next = getNextRunAt(
      { cron: "0 8 * * *", timezone: "Europe/London" },
      base,
      "America/New_York"
    );

    expect(next.toISOString()).toBe("2023-01-02T08:00:00.000Z");
  });
});
