import { Job } from "../types/job";
import { JobStatus } from "../types/lifecycle";

export interface JobStore {
  /**
   * Insert a new job
   */
  create(job: Job): Promise<Job>;

  /**
   * Create multiple jobs in bulk
   */
  createBulk(jobs: Job[]): Promise<Job[]>;

  /**
   * Find and lock the next runnable job.
   * Must be atomic.
   */
  findAndLockNext(options: {
    now: Date;
    workerId: string;
    lockTimeoutMs: number;
  }): Promise<Job | null>;

  /**
   * Mark job as completed
   */
  markCompleted(jobId: unknown): Promise<void>;

  /**
   * Mark job as failed
   */
  markFailed(jobId: unknown, error: string): Promise<void>;

  /**
   * Reschedule job (used for retry or repeat)
   */
  reschedule(
    jobId: unknown,
    nextRunAt: Date,
    updates?: { attempts?: number; lastError?: string }
  ): Promise<void>;

  /**
   * Recover jobs stuck in running state
   */
  recoverStaleJobs(options: {
    now: Date;
    lockTimeoutMs: number;
  }): Promise<number>;

  /**
   * Cancel job explicitly
   */
  cancel(jobId: unknown): Promise<void>;

  /**
   * Get job by ID
   */
  findById(jobId: unknown): Promise<Job | null>;

  /**
   * Renew the lock for a running job (heartbeat)
   */
  renewLock(jobId: unknown, workerId: string): Promise<void>;

  /**
   * Update job properties (data persistence)
   */
  update(jobId: unknown, updates: JobUpdates): Promise<void>;

  /**
   * Find all jobs matching query
   */
  findAll(query: JobQuery): Promise<Job[]>;

  /**
   * Count running jobs by name (for concurrency limits)
   */
  countRunning(jobName: string): Promise<number>;
}

import { RetryOptions } from "../types/retry";
import { RepeatOptions } from "../types/repeat";
import { JobQuery } from "../types/query";

export interface JobUpdates {
  data?: unknown;
  nextRunAt?: Date;
  retry?: RetryOptions;
  repeat?: RepeatOptions;
  status?: JobStatus;
  attempts?: number;
  priority?: number;
  concurrency?: number;
}
