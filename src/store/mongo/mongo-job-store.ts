import { Collection, Db, ObjectId } from "mongodb";
import { JobStore, JobUpdates } from "../job-store";
import { Job } from "../../types/job";
import { JobQuery } from "../../types/query";
import { JobOwnershipError } from "../store-errors";

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

  private async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { status: 1, priority: 1, nextRunAt: 1 },
        { background: true }
      ),
      this.collection.createIndex(
        { dedupeKey: 1 },
        { unique: true, sparse: true, background: true }
      ),
      this.collection.createIndex(
        { lockUntil: 1 },
        { sparse: true, background: true }
      ),
      this.collection.createIndex({ name: 1, status: 1 }, { background: true }),
    ]);
  }

  async create(job: Job): Promise<Job> {
    const now = new Date();
    const { _id, ...jobWithoutId } = job;

    const doc: MongoJob = {
      ...jobWithoutId,
      status: job.status ?? "pending",
      attempts: job.attempts ?? 0,
      priority: job.priority ?? 5,
      lockVersion: job.lockVersion ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    if (doc.dedupeKey === undefined || doc.dedupeKey === null) {
      delete doc.dedupeKey;
    }

    if (job.dedupeKey) {
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
      const { _id, ...jobWithoutId } = job;
      const doc: MongoJob = {
        ...jobWithoutId,
        status: job.status ?? "pending",
        attempts: job.attempts ?? 0,
        priority: job.priority ?? 5,
        lockVersion: job.lockVersion ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      if (doc.dedupeKey === undefined || doc.dedupeKey === null) {
        delete doc.dedupeKey;
      }
      return doc;
    });

    if (docs.length === 0) return [];

    const result = await this.collection.insertMany(docs);

    return docs.map((doc, index) => ({
      ...doc,
      _id: result.insertedIds[index],
    }));
  }

  // Atomic find & lock with version-based optimistic locking
  async findAndLockNext(options: {
    now: Date;
    workerId: string;
    lockTimeoutMs: number;
  }): Promise<Job | null> {
    const { now, workerId, lockTimeoutMs } = options;
    const lockUntil = new Date(now.getTime() + lockTimeoutMs);

    // Fast path: jobs without concurrency limits
    const simpleQuery = {
      $or: [
        // Pending jobs (not locked)
        {
          status: "pending" as const,
          nextRunAt: { $lte: now },
          $or: [{ lockedBy: { $exists: false } }, { lockedBy: null }],
        },
        // Stale running jobs (lock expired - crash recovery)
        {
          status: "running" as const,
          nextRunAt: { $lte: now },
          lockUntil: { $lte: now },
        },
      ],
      $and: [
        { $or: [{ concurrency: { $exists: false } }, { concurrency: null }] },
      ],
    };

    const simpleResult = await this.collection.findOneAndUpdate(
      simpleQuery as any,
      {
        $set: {
          lockedAt: now,
          lockedBy: workerId,
          lockUntil: lockUntil,
          status: "running",
          lastRunAt: now,
          updatedAt: now,
        },
        $inc: { lockVersion: 1 },
      },
      {
        sort: { priority: 1, nextRunAt: 1 },
        returnDocument: "after",
      }
    );

    if (simpleResult) {
      return simpleResult as unknown as Job;
    }

    // Now handle jobs with concurrency limits
    // We need to check concurrency before locking
    const maxAttempts = 20;
    const checkedNames = new Set<string>();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Find a candidate with concurrency limit that we haven't checked yet
      const concurrencyQuery: any = {
        $or: [
          {
            status: "pending" as const,
            nextRunAt: { $lte: now },
            // Pending jobs should not have lockedBy set
            $or: [{ lockedBy: { $exists: false } }, { lockedBy: null }],
          },
          {
            // Stale running jobs (lock expired)
            status: "running" as const,
            nextRunAt: { $lte: now },
            lockUntil: { $lte: now },
          },
        ],
        concurrency: { $exists: true, $gt: 0 },
      };

      if (checkedNames.size > 0) {
        concurrencyQuery.name = { $nin: Array.from(checkedNames) };
      }

      const candidate = await this.collection.findOne(concurrencyQuery, {
        sort: { priority: 1, nextRunAt: 1 },
        projection: { name: 1, concurrency: 1, lockVersion: 1 },
      });

      if (!candidate) {
        return null; // No more candidates with concurrency limits
      }

      const runningCount = await this.collection.countDocuments({
        name: candidate.name,
        status: "running",
      });

      if (runningCount >= (candidate.concurrency as number)) {
        // At limit for this job name, skip all jobs with this name
        checkedNames.add(candidate.name as string);
        continue;
      }

      const lockResult = await this.collection.findOneAndUpdate(
        {
          name: candidate.name,
          concurrency: candidate.concurrency,
          $or: [
            {
              status: "pending",
              $or: [{ lockedBy: { $exists: false } }, { lockedBy: null }],
            },
            {
              status: "running",
              lockUntil: { $lte: now },
            },
          ],
          nextRunAt: { $lte: now },
        } as any,
        {
          $set: {
            lockedAt: now,
            lockedBy: workerId,
            lockUntil: lockUntil,
            status: "running",
            lastRunAt: now,
            updatedAt: now,
          },
          $inc: { lockVersion: 1 },
        },
        {
          sort: { priority: 1, nextRunAt: 1 },
          returnDocument: "after",
        }
      );

      if (lockResult) {
        // Verify concurrency wasn't exceeded by race condition
        const currentRunning = await this.collection.countDocuments({
          name: lockResult.name,
          status: "running",
        });

        if (currentRunning > (lockResult.concurrency as number)) {
          // We exceeded concurrency - release this job back to pending
          await this.collection.updateOne(
            {
              _id: lockResult._id,
              lockedBy: workerId,
              lockVersion: lockResult.lockVersion,
            },
            {
              $set: {
                status: "pending",
                updatedAt: new Date(),
              },
              $unset: {
                lockedAt: "",
                lockedBy: "",
                lockUntil: "",
                lastRunAt: "",
              },
            }
          );
          continue;
        }

        return lockResult as unknown as Job;
      }

      // Lock failed (another worker got it), try next job name
      checkedNames.add(candidate.name as string);
    }

    return null;
  }

  async markCompleted(id: ObjectId, workerId: string): Promise<void> {
    const result = await this.collection.updateOne(
      { _id: id, lockedBy: workerId, status: "running" },
      {
        $set: {
          status: "completed",
          updatedAt: new Date(),
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
          lockUntil: "",
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new JobOwnershipError(
        `Cannot complete job ${id}: ownership lost (expected workerId: ${workerId})`
      );
    }
  }

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
          lockUntil: "",
        },
      }
    );
  }

  async reschedule(
    id: ObjectId,
    nextRunAt: Date,
    updates?: { attempts?: number; lastError?: string }
  ): Promise<void> {
    const result = await this.collection.updateOne(
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
          lockUntil: "",
        },
      }
    );
  }

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
          lockUntil: "",
        },
      }
    );
  }

  async findById(id: ObjectId): Promise<Job | null> {
    const doc = await this.collection.findOne({ _id: id });
    if (!doc) return null;
    return doc as unknown as Job;
  }

  async recoverStaleJobs(options: {
    now: Date;
    lockTimeoutMs: number;
  }): Promise<number> {
    const { now, lockTimeoutMs } = options;
    const expiry = new Date(now.getTime() - lockTimeoutMs);

    const result = await this.collection.updateMany(
      {
        $or: [
          { lockUntil: { $lte: now } },
          { lockUntil: { $exists: false }, lockedAt: { $lte: expiry } },
        ],
      },
      {
        $set: {
          status: "pending",
          updatedAt: now,
        },
        $unset: {
          lockedAt: "",
          lockedBy: "",
          lockUntil: "",
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
          lockUntil: new Date(now.getTime() + this.defaultLockTimeoutMs),
        },
        $inc: { lockVersion: 1 },
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
    if (updates.attempts !== undefined) $set.attempts = updates.attempts;
    if (updates.priority !== undefined) $set.priority = updates.priority;
    if (updates.concurrency !== undefined)
      $set.concurrency = updates.concurrency;

    await this.collection.updateOne({ _id: id }, { $set });
  }

  async countRunning(jobName: string): Promise<number> {
    return this.collection.countDocuments({
      name: jobName,
      status: "running",
    });
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
