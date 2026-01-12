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

export class JobOwnershipError extends Error {
  constructor(message = "Job ownership lost") {
    super(message);
    this.name = "JobOwnershipError";
  }
}

export class MongoConnectionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = "MongoConnectionError";
  }
}
