import { Collection, Db, ObjectId } from "mongodb";
import { JobStore } from "../job-store";
import { Job } from "../../types/job";

type MongoJob<T = unknown> = Omit<Job<T>, "_id"> & {
  _id?: ObjectId;
};

export interface MongoJobStoreOptions {
  collectionName?: string;
  lockTimeoutMs?: number;
}

export class MongoJobStore implements JobStore {
  private readonly collection: Collection<MongoJob>;
  private readonly defaultLockTimeoutMs: number;

  constructor(db: Db, options: MongoJobStoreOptions = {}) {
    this.collection = db.collection<MongoJob>(
      options.collectionName ?? "scheduler_jobs"
    );
    this.defaultLockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  }

  // --------------------------------------------------
  // CREATE
  // --------------------------------------------------
  async create(job: Job): Promise<Job> {
    const now = new Date();

    // IMPORTANT: strip _id completely
    const { _id, ...jobWithoutId } = job;

    const doc: MongoJob = {
      ...jobWithoutId,
      status: job.status ?? "pending",
      attempts: job.attempts ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    if (job.dedupeKey) {
      // Idempotent insert
      const result = await this.collection.findOneAndUpdate(
        { dedupeKey: job.dedupeKey },
        { $setOnInsert: doc },
        { upsert: true, returnDocument: "after" }
      );
      return result as unknown as Job;
    }

    const result = await this.collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }

  async createBulk(jobs: Job[]): Promise<Job[]> {
    const now = new Date();
    const docs: MongoJob[] = jobs.map((job) => {
      // IMPORTANT: strip _id completely
      const { _id, ...jobWithoutId } = job;
      return {
        ...jobWithoutId,
        status: job.status ?? "pending",
        attempts: job.attempts ?? 0,
        createdAt: now,
        updatedAt: now,
      };
    });

    if (docs.length === 0) return [];

    const result = await this.collection.insertMany(docs);

    return docs.map((doc, index) => ({
      ...doc,
      _id: result.insertedIds[index],
    }));
  }

  // --------------------------------------------------
  // ATOMIC FIND & LOCK
  // --------------------------------------------------
  async findAndLockNext(options: {
    now: Date;
    workerId: string;
    lockTimeoutMs: number;
  }): Promise<Job | null> {
    const { now, workerId, lockTimeoutMs } = options;
    const lockExpiry = new Date(now.getTime() - lockTimeoutMs);

    const result = await this.collection.findOneAndUpdate(
      {
        status: "pending",
        nextRunAt: { $lte: now },
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: { $lte: lockExpiry } },
        ],
      },
      {
        $set: {
          lockedAt: now,
          lockedBy: workerId,
          status: "running",
          lastRunAt: now,
          updatedAt: now,
        },
      },
      {
        sort: { nextRunAt: 1 },
        returnDocument: "after",
      }
    );

    return result as unknown as Job | null;
  }

  // --------------------------------------------------
  // MARK COMPLETED
  // --------------------------------------------------
  async markCompleted(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: "completed",
          updatedAt: new Date(),
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
        },
      }
    );
  }

  // --------------------------------------------------
  // MARK FAILED
  // --------------------------------------------------
  async markFailed(id: ObjectId, error: string): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: "failed",
          lastError: error,
          updatedAt: new Date(),
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
        },
      }
    );
  }

  // --------------------------------------------------
  // RESCHEDULE
  // --------------------------------------------------
  async reschedule(
    id: ObjectId,
    nextRunAt: Date,
    updates?: { attempts?: number; lastError?: string }
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: "pending",
          nextRunAt,
          updatedAt: new Date(),
          ...(updates ?? {}),
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
        },
      }
    );
  }

  // --------------------------------------------------
  // CANCEL
  // --------------------------------------------------
  async cancel(id: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
        },
      }
    );
  }

  async findById(id: ObjectId): Promise<Job | null> {
    const doc = await this.collection.findOne({ _id: id });
    if (!doc) return null;
    return doc as unknown as Job;
  }

  // --------------------------------------------------
  // RECOVER STALE JOBS
  // --------------------------------------------------
  async recoverStaleJobs(options: {
    now: Date;
    lockTimeoutMs: number;
  }): Promise<number> {
    const { now, lockTimeoutMs } = options;
    const expiry = new Date(now.getTime() - lockTimeoutMs);

    const result = await this.collection.updateMany(
      {
        lockedAt: { $lte: expiry },
      },
      {
        $set: {
          status: "pending",
          updatedAt: now,
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
        },
      }
    );

    return result.modifiedCount;
  }

  async renewLock(id: ObjectId, workerId: string): Promise<void> {
    const now = new Date();
    const result = await this.collection.updateOne(
      {
        _id: id,
        lockedBy: workerId,
        status: "running",
      },
      {
        $set: {
          lockedAt: now,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new Error("Job lock lost or owner changed");
    }
  }
}
