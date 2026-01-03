import { parseExpression } from "cron-parser";
import { RepeatOptions } from "../types/repeat";

export function getNextRunAt(
  repeat: RepeatOptions,
  base: Date,
  defaultTimezone?: string
): Date {
  if (repeat.every != null) {
    return new Date(base.getTime() + repeat.every);
  }

  if (repeat.cron) {
    const interval = parseExpression(repeat.cron, {
      currentDate: base,
      tz: repeat.timezone ?? defaultTimezone ?? "UTC",
    });

    return interval.next().toDate();
  }

  throw new Error("Invalid repeat configuration");
}
