import { Job } from "../types/job";
import { JobStore } from "./job-store";
import { JobNotFoundError, JobLockError } from "./store-errors";
import { Mutex } from "./mutex";

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();
  private mutex = new Mutex();

  private generateId(): string {
    return Math.random().toString(36).slice(2);
  }

  async create(job: Job): Promise<Job> {
    if (job.dedupeKey) {
      for (const existing of this.jobs.values()) {
        if (existing.dedupeKey === job.dedupeKey) {
          return existing;
        }
      }
    }

    const id = this.generateId();

    const stored: Job = {
      ...job,
      _id: id,
      createdAt: job.createdAt ?? new Date(),
      updatedAt: job.updatedAt ?? new Date(),
    };

    this.jobs.set(id, stored);
    return stored;
  }

  async createBulk(jobs: Job[]): Promise<Job[]> {
    return Promise.all(jobs.map((job) => this.create(job)));
  }

  async findAndLockNext({
    now,
    workerId,
    lockTimeoutMs,
  }: {
    now: Date;
    workerId: string;
    lockTimeoutMs: number;
  }): Promise<Job | null> {
    const release = await this.mutex.acquire();
    try {
      for (const job of this.jobs.values()) {
        if (job.status !== "pending") continue;
        if (job.nextRunAt > now) continue;

        // lock expired?
        if (
          job.lockedAt &&
          now.getTime() - job.lockedAt.getTime() < lockTimeoutMs
        ) {
          continue;
        }

        job.status = "running";
        job.lockedAt = now;
        job.lockedBy = workerId;
        job.updatedAt = new Date();
        job.lastRunAt = now;

        return { ...job };
      }

      return null;
    } finally {
      release();
    }
  }

  async markCompleted(jobId: unknown): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    job.status = "completed";
    job.lastRunAt = new Date();
    job.updatedAt = new Date();
  }

  async markFailed(jobId: unknown, error: string): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    job.status = "failed";
    job.lastError = error;
    job.updatedAt = new Date();
  }

  async reschedule(
    jobId: unknown,
    nextRunAt: Date,
    updates?: { attempts?: number }
  ): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    job.status = "pending";
    job.nextRunAt = nextRunAt;
    if (updates?.attempts != null) {
      job.attempts = updates.attempts;
    } else {
      job.attempts = (job.attempts ?? 0) + 1;
    }
    job.lockedAt = undefined;
    job.lockedBy = undefined;
    job.updatedAt = new Date();
    job.lastScheduledAt = nextRunAt;
  }

  async recoverStaleJobs({
    now,
    lockTimeoutMs,
  }: {
    now: Date;
    lockTimeoutMs: number;
  }): Promise<number> {
    let recovered = 0;

    for (const job of this.jobs.values()) {
      if (
        job.status === "running" &&
        job.lockedAt &&
        now.getTime() - job.lockedAt.getTime() > lockTimeoutMs
      ) {
        job.status = "pending";
        job.lockedAt = undefined;
        job.lockedBy = undefined;
        job.updatedAt = new Date();
        recovered++;
      }
    }

    return recovered;
  }

  async cancel(jobId: unknown): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    job.status = "cancelled";
    job.updatedAt = new Date();
    job.lockedAt = undefined;
    job.lockedBy = undefined;
  }

  async findById(jobId: unknown): Promise<Job | null> {
    const job = this.jobs.get(String(jobId));
    return job ? { ...job } : null;
  }
}
