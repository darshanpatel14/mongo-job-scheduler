import { JobStatus } from "./lifecycle";
import { RetryOptions } from "./retry";
import { RepeatOptions } from "./repeat";

export interface Job<Data = unknown> {
  _id?: unknown;

  name: string;
  data: Data;

  status: JobStatus;

  nextRunAt: Date;
  lastRunAt?: Date;
  lastScheduledAt?: Date;

  lockedAt?: Date;
  lockedBy?: string;

  attempts: number;
  lastError?: string;

  retry?: RetryOptions;
  repeat?: RepeatOptions;

  dedupeKey?: string;

  createdAt: Date;
  updatedAt: Date;
}
