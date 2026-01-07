import { getNextRunAt } from "../../src/worker/repeat";

describe("Timezone Defaults", () => {
  test("defaults to UTC when no timezone is provided anywhere", () => {
    const base = new Date("2023-01-01T12:00:00Z"); // 12:00 UTC
    const repeat = { cron: "0 15 * * *" }; // 15:00

    const next = getNextRunAt(repeat, base, undefined);

    // Should be 15:00 UTC same day
    expect(next.toISOString()).toBe("2023-01-01T15:00:00.000Z");
  });

  test("uses defaultTimezone when provided and job has none", () => {
    const base = new Date("2023-01-01T12:00:00Z");
    const repeat = { cron: "0 15 * * *" }; // 15:00

    // Target: Asia/Tokyo (UTC+9). 15:00 Tokyo is 06:00 UTC.
    // However, if base is 12:00 UTC (21:00 Tokyo), next 15:00 Tokyo is tomorrow.
    // 15:00 tomorrow Tokyo = 2023-01-02 06:00 UTC.

    const next = getNextRunAt(repeat, base, "Asia/Tokyo");

    // 21:00 Tokyo (base) -> next 15:00 Tokyo is tomorrow
    expect(next.toISOString()).toBe("2023-01-02T06:00:00.000Z");
  });

  test("job timezone overrides defaultTimezone", () => {
    const base = new Date("2023-01-01T12:00:00Z");
    const repeat = {
      cron: "0 15 * * *",
      timezone: "America/New_York", // UTC-5
    };
    // 12:00 UTC is 07:00 NY.
    // Next 15:00 NY is same day.
    // 15:00 NY = 20:00 UTC.

    const next = getNextRunAt(repeat, base, "Asia/Tokyo");

    expect(next.toISOString()).toBe("2023-01-01T20:00:00.000Z");
  });
});
