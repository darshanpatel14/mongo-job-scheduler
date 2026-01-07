import { Collection, Db, ObjectId } from "mongodb";
import { JobStore, JobUpdates } from "../job-store";
import { Job } from "../../types/job";
import { JobQuery } from "../../types/query";

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

    // Auto-create indexes for performance
    this.ensureIndexes().catch((err) => {
      console.error("Failed to create indexes:", err);
    });
  }

  /**
   * Create necessary indexes for optimal query performance
   */
  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      // Primary index for job polling (findAndLockNext)
      this.collection.createIndex(
        { status: 1, nextRunAt: 1 },
        { background: true }
      ),

      // Index for deduplication
      this.collection.createIndex(
        { dedupeKey: 1 },
        { unique: true, sparse: true, background: true }
      ),

      // Index for stale lock recovery
      this.collection.createIndex(
        { lockedAt: 1 },
        { sparse: true, background: true }
      ),
    ]);
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

  async update(id: ObjectId, updates: JobUpdates): Promise<void> {
    if (Object.keys(updates).length === 0) return;

    const $set: any = { updatedAt: new Date() };
    if (updates.data !== undefined) $set.data = updates.data;
    if (updates.nextRunAt !== undefined) $set.nextRunAt = updates.nextRunAt;
    if (updates.retry !== undefined) $set.retry = updates.retry;
    if (updates.repeat !== undefined) $set.repeat = updates.repeat;
    if (updates.status !== undefined) $set.status = updates.status;

    await this.collection.updateOne({ _id: id }, { $set });
  }

  async findAll(query: JobQuery): Promise<Job[]> {
    const filter: any = {};

    if (query.name) {
      filter.name = query.name;
    }
    if (query.status) {
      filter.status = Array.isArray(query.status)
        ? { $in: query.status }
        : query.status;
    }

    let cursor = this.collection.find(filter);

    if (query.sort) {
      cursor = cursor.sort({
        [query.sort.field]: query.sort.order === "asc" ? 1 : -1,
      });
    }

    if (query.skip) {
      cursor = cursor.skip(query.skip);
    }
    if (query.limit) {
      cursor = cursor.limit(query.limit);
    }

    const docs = await cursor.toArray();
    return docs as unknown as Job[];
  }
}
