import { JobStatus } from "./lifecycle";
import { RetryOptions } from "./retry";
import { RepeatOptions } from "./repeat";

export interface Job<Data = unknown> {
  _id?: unknown;

  name: string;
  data: Data;

  status: JobStatus;

  // scheduling
  nextRunAt: Date;

  // locking
  lockedAt?: Date;
  lockedBy?: string;

  // execution
  attempts: number;
  lastError?: string;

  // optional behavior
  retry?: RetryOptions;
  repeat?: RepeatOptions;

  // timestamps
  createdAt: Date;
  updatedAt: Date;
}