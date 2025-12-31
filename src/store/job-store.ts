import { Job } from "../types/job";

export interface JobStore {
  /**
   * Insert a new job
   */
  create(job: Job): Promise<Job>;

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
  reschedule(jobId: unknown, nextRunAt: Date): Promise<void>;

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
}
