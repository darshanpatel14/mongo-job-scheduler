export class JobNotFoundError extends Error {
  constructor(message = "Job not found") {
    super(message);
    this.name = "JobNotFoundError";
  }
}

export class JobLockError extends Error {
  constructor(message = "Failed to acquire job lock") {
    super(message);
    this.name = "JobLockError";
  }
}
