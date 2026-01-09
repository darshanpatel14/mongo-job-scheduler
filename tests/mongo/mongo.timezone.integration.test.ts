import { getNextRunAt } from "../../src/worker/repeat";

// Note: Timezone logic is mostly pure function testing (getNextRunAt).
// But we'll add the integration tests here to valid 'repeat' logic in Mongo context if needed.
// The original `timezone.integration.test.ts` was actually unit tests for `getNextRunAt` (no scheduler/store needed).
// However, since the user asked to port all integration tests, I'll copy the logic.
// If the original test didn't use `store`, then `Mongo` version is strictly not needed, but I'll add it for completeness
// or maybe adapt it to actually schedule a job in Mongo and verify `nextRunAt` calculation.

describe("Mongo Timezone Integration Test", () => {
  // Original tests were unit tests for `getNextRunAt`.
  // They didn't interact with the store.
  // I will duplicate them here as requested, but they are technically database-agnostic.

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

    const next = getNextRunAt({ cron: "0 8 * * *" }, base, "America/New_York");

    // 08:00 EST is 13:00 UTC
    expect(next.toISOString()).toBe("2023-01-01T13:00:00.000Z");
  });

  test("uses job-specific timezone over global default", () => {
    // 12:00 UTC
    const base = new Date("2023-01-01T12:00:00Z");

    const next = getNextRunAt(
      { cron: "0 8 * * *", timezone: "Europe/London" },
      base,
      "America/New_York"
    );

    expect(next.toISOString()).toBe("2023-01-02T08:00:00.000Z");
  });
});
