import { Job } from "../types/job";
import { JobStore, JobUpdates } from "./job-store";
import { JobQuery } from "../types/query";
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
      priority: job.priority ?? 5,
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
      // Sort jobs by priority (ascending), then nextRunAt (ascending)
      const sortedJobs = Array.from(this.jobs.values()).sort((a, b) => {
        const priorityA = a.priority ?? 5;
        const priorityB = b.priority ?? 5;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.nextRunAt.getTime() - b.nextRunAt.getTime();
      });

      for (const job of sortedJobs) {
        if (job.status !== "pending") continue;
        if (job.nextRunAt > now) continue;

        // lock expired?
        if (
          job.lockedAt &&
          now.getTime() - job.lockedAt.getTime() < lockTimeoutMs
        ) {
          continue;
        }

        // Check concurrency limit if defined
        if (job.concurrency !== undefined && job.concurrency > 0) {
          const runningCount = Array.from(this.jobs.values()).filter(
            (j) => j.name === job.name && j.status === "running"
          ).length;

          if (runningCount >= job.concurrency) {
            // At concurrency limit, skip this job
            continue;
          }
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

  async renewLock(jobId: unknown, workerId: string): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    if (job.status === "running" && job.lockedBy === workerId) {
      job.lockedAt = new Date();
      job.updatedAt = new Date();
    } else {
      throw new Error("Job lock lost or owner changed");
    }
  }

  async update(jobId: unknown, updates: JobUpdates): Promise<void> {
    const job = this.jobs.get(String(jobId));
    if (!job) throw new JobNotFoundError();

    if (updates.data !== undefined) {
      job.data = updates.data;
    }
    if (updates.nextRunAt !== undefined) {
      job.nextRunAt = updates.nextRunAt;
    }
    if (updates.retry !== undefined) {
      job.retry = updates.retry;
    }
    if (updates.repeat !== undefined) {
      job.repeat = updates.repeat;
    }
    if (updates.status !== undefined) {
      job.status = updates.status;
    }
    if (updates.attempts !== undefined) {
      job.attempts = updates.attempts;
    }
    if (updates.priority !== undefined) {
      job.priority = updates.priority;
    }
    if (updates.concurrency !== undefined) {
      job.concurrency = updates.concurrency;
    }
    job.updatedAt = new Date();
  }

  async countRunning(jobName: string): Promise<number> {
    return Array.from(this.jobs.values()).filter(
      (j) => j.name === jobName && j.status === "running"
    ).length;
  }

  async findAll(query: JobQuery): Promise<Job[]> {
    let jobs = Array.from(this.jobs.values());

    // Filter
    if (query.name) {
      jobs = jobs.filter((j) => j.name === query.name);
    }
    if (query.status) {
      const statuses = Array.isArray(query.status)
        ? query.status
        : [query.status];
      jobs = jobs.filter((j) => statuses.includes(j.status));
    }

    // Sort
    if (query.sort) {
      const { field, order } = query.sort;
      jobs.sort((a, b) => {
        const valA = (a[field] as Date).getTime();
        const valB = (b[field] as Date).getTime();
        return order === "asc" ? valA - valB : valB - valA;
      });
    }

    // Skip/Limit
    const start = query.skip ?? 0;
    const end = query.limit ? start + query.limit : undefined;

    return jobs.slice(start, end);
  }
}
