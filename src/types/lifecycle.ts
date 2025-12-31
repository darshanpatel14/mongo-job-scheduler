export type JobStatus =
  | "pending" // waiting to be picked
  | "running" // currently executing
  | "completed" // finished successfully
  | "failed" // failed permanently
  | "cancelled"; // cancelled by user