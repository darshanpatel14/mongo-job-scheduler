# Mongo Job Scheduler

A production-grade MongoDB-backed job scheduler for Node.js with distributed locking, retries, cron scheduling, and crash recovery.

[![npm version](https://img.shields.io/npm/v/mongo-job-scheduler.svg)](https://www.npmjs.com/package/mongo-job-scheduler)

---

## Features

- ✅ **Distributed locking** — safe for multiple instances
- ✅ **Atomic job execution** — no double processing
- ✅ **Job priority** — process important jobs first
- ✅ **Concurrency limits** — rate-limit job execution
- ✅ **Automatic retries** — with configurable backoff
- ✅ **Cron scheduling** — timezone-aware, non-drifting
- ✅ **Interval jobs** — repeated execution
- ✅ **Crash recovery** — resume on restart
- ✅ **Heartbeats** — automatic lock renewal for long jobs
- ✅ **Query API** — filter, sort, paginate jobs
- ✅ **Auto-indexing** — performance optimized out of the box
- ✅ **Sharding-safe** — designed for MongoDB sharding

---

> 🚀 **Ready to start?** Check out the [Complete Example Repository](https://github.com/darshanpatel14/mongo-job-scheduler-example) which demonstrates all features (Priority, Retries, Cron, UI) in a production-ready Express app with Docker.

---

## Quick Start

### Requirements

- Node.js >= 18.0.0
- MongoDB 5.0, 6.0, 7.0+
- The `mongodb` driver (v5, v6, or v7) must be installed as a peer dependency.

### Installation

```bash
npm install mongo-job-scheduler
```

### UI Dashboard (Optional)

For a visual web dashboard to manage and monitor your jobs, check out:

- **NPM**: [`mongo-scheduler-ui`](https://www.npmjs.com/package/mongo-scheduler-ui)
- **GitHub**: [mongo-scheduler-ui](https://github.com/darshanpatel14/mongo-job-scheduler-ui)
- **Full Example**: [mongo-job-scheduler-example](https://github.com/darshanpatel14/mongo-job-scheduler-example) (Backend + UI + Docker)
- **API Server**: [mongo-job-scheduler-api](https://github.com/darshanpatel14/mongo-job-scheduler-api)

### Basic Usage

```typescript
import { Scheduler, MongoJobStore } from "mongo-job-scheduler";
import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("my-app");

const scheduler = new Scheduler({
  store: new MongoJobStore(db),
  handler: async (job) => {
    console.log("Running job:", job.name);
  },
  workers: 3, // default is 1
});

await scheduler.start();
```

---

## Scheduling Jobs

### One-Time Job

```typescript
await scheduler.schedule({
  name: "send-email",
  data: { userId: 123 },
  runAt: new Date(Date.now() + 60000), // run in 1 minute
});
```

### Cron Jobs (Timezone-Aware)

```typescript
await scheduler.schedule({
  name: "daily-report",
  repeat: {
    cron: "0 9 * * *", // every day at 9 AM
    timezone: "Asia/Kolkata", // default is UTC
  },
});
```

### Interval Jobs

```typescript
// Using milliseconds directly
await scheduler.schedule({
  name: "cleanup-logs",
  data: {},
  repeat: {
    every: 5 * 60 * 1000, // every 5 minutes
  },
});

// Helper pattern for human-readable intervals
const minutes = (n: number) => n * 60 * 1000;
const hours = (n: number) => n * 60 * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;

await scheduler.schedule({
  name: "daily-backup",
  repeat: { every: days(1) }, // 1 day
});

await scheduler.schedule({
  name: "hourly-sync",
  repeat: { every: hours(2) }, // 2 hours
});
```

> **📌 Repeat Job Status**: Repeating jobs cycle through `pending` → `running` → `pending` (rescheduled). The same job document is reused with an updated `nextRunAt`. Jobs stay in the database until cancelled.

### Bulk Scheduling

For high-performance ingestion:

```typescript
const jobs = await scheduler.scheduleBulk([
  { name: "email", data: { userId: 1 } },
  { name: "email", data: { userId: 2 } },
  { name: "email", data: { userId: 3 } },
]);
```

---

## Job Management

### Get Job by ID

```typescript
const job = await scheduler.getJob(jobId);
```

### Query Jobs

List jobs with filtering, sorting, and pagination:

```typescript
const jobs = await scheduler.getJobs({
  name: "daily-report",
  status: "failed", // or ["failed", "pending"]
  sort: { field: "updatedAt", order: "desc" },
  limit: 10,
  skip: 0,
});
```

### Update Job

Update job data, reschedule, or modify configuration:

```typescript
await scheduler.updateJob(jobId, {
  data: { page: 2 },
  nextRunAt: new Date(Date.now() + 60000), // delay by 1 min
  repeat: { every: 60000 }, // change to run every minute
});
```

### Cancel Job

```typescript
await scheduler.cancel(jobId);
```

---

## Advanced Features

### Job Priority

Process important jobs first using priority levels (1-10, where 1 is highest priority):

```typescript
// High priority job - runs first
await scheduler.schedule({
  name: "urgent-alert",
  priority: 1,
});

// Normal priority (default is 5)
await scheduler.schedule({
  name: "regular-task",
});

// Low priority job - runs last
await scheduler.schedule({
  name: "background-cleanup",
  priority: 10,
});

// Update priority of existing job
await scheduler.updateJob(jobId, { priority: 2 });
```

> **Priority Scale**: 1 (highest) → 10 (lowest). Jobs with equal priority run in FIFO order by `nextRunAt`.

### Concurrency Limits

Limit how many instances of a job type can run simultaneously (useful for rate-limiting API calls):

```typescript
// Max 5 concurrent "api-sync" jobs globally
await scheduler.schedule({
  name: "api-sync",
  concurrency: 5,
});

// Max 2 concurrent "webhook" jobs
await scheduler.schedule({
  name: "webhook",
  data: { url: "https://..." },
  concurrency: 2,
});
```

> **Note**: Concurrency is enforced globally across all workers. Jobs exceeding the limit wait until a slot frees up.

### Retries with Backoff

```typescript
// Simple: 3 attempts with instant retry
await scheduler.schedule({
  name: "webhook",
  retry: 3,
});

// Advanced: custom delay and backoff
await scheduler.schedule({
  name: "api-call",
  retry: {
    maxAttempts: 5,
    delay: 1000, // 1 second fixed delay
    // or: delay: (attempt) => attempt * 1000 // dynamic backoff
  },
});
```

### Job Deduplication

Prevent duplicate jobs using idempotency keys:

```typescript
await scheduler.schedule({
  name: "email",
  data: { userId: 123 },
  dedupeKey: "email:user:123", // only one job with this key
});
```

### Event Monitoring

```typescript
scheduler.on("job:success", (job) => console.log("Job done:", job._id));
scheduler.on("job:fail", ({ job, error }) =>
  console.error("Job failed:", job._id, error)
);
scheduler.on("job:retry", (job) =>
  console.warn("Retrying:", job._id, "attempt", job.attempts)
);

// More events: scheduler:start, scheduler:stop, worker:start,
// worker:stop, job:created, job:start, job:cancel
```

### Graceful Shutdown

Wait for in-flight jobs to complete:

```typescript
await scheduler.stop({
  graceful: true,
  timeoutMs: 30000,
});
```

---

## Performance & Scaling

### Automatic Indexing

**MongoDB indexes are created automatically** when you initialize `MongoJobStore`. No manual setup required.

The library creates three indexes in background mode:

- `{ status: 1, priority: 1, nextRunAt: 1 }` — for priority-based job polling (critical)
- `{ dedupeKey: 1 }` — for deduplication (unique)
- `{ lockedAt: 1 }` — for stale lock recovery

These indexes prevent query time from degrading from O(log n) to O(n) at scale.

### Distributed Systems

Run **multiple scheduler instances** (different servers, pods, or processes) connected to the same MongoDB:

- **Atomic Locking** — uses `findOneAndUpdate` to prevent race conditions
- **Concurrency Control** — only one worker executes a job instance
- **Horizontally Scalable** — supports MongoDB sharding

---

## Documentation

- **Job lifecycle** — pending → running → completed/failed
- **Retry & repeat semantics** — at-most-once guarantees
- **Correctness guarantees** — what we ensure and what we don't

---

## Job Schema Reference

Use this schema for backend validation (Mongoose, Zod, Joi, etc.):

### TypeScript Interface

```typescript
interface Job<T = unknown> {
  _id: ObjectId;
  name: string; // Job type identifier (required)
  data?: T; // Your job payload
  status: "pending" | "running" | "completed" | "failed" | "cancelled";

  // Scheduling
  nextRunAt: Date; // When to run next (required)
  lastRunAt?: Date; // Last execution start
  lastScheduledAt?: Date; // For cron: prevents drift

  // Locking (internal)
  lockedAt?: Date; // When lock was acquired
  lockedBy?: string; // Worker ID holding lock
  lockUntil?: Date; // Lock expiry time
  lockVersion: number; // Optimistic locking version

  // Repeat configuration
  repeat?: {
    cron?: string; // Cron expression (e.g., "0 9 * * *")
    every?: number; // Interval in milliseconds
    timezone?: string; // IANA timezone (e.g., "America/New_York")
  };

  // Retry configuration
  retry?: {
    maxAttempts: number;
    delay: number; // Base delay in ms
    backoff?: "fixed" | "linear" | "exponential";
  };
  attempts: number; // Current attempt count
  lastError?: string; // Last error message

  // Other
  priority: number; // 1-10, lower = higher priority (default: 5)
  concurrency?: number; // Max concurrent jobs with same name
  dedupeKey?: string; // Unique key for deduplication

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### Mongoose Schema Example

```javascript
const jobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    nextRunAt: { type: Date, required: true, index: true },
    lastRunAt: { type: Date },
    lastScheduledAt: { type: Date },

    lockedAt: { type: Date },
    lockedBy: { type: String },
    lockUntil: { type: Date, index: true },
    lockVersion: { type: Number, default: 0 },

    repeat: {
      cron: { type: String },
      every: { type: Number },
      timezone: { type: String },
    },

    retry: {
      maxAttempts: { type: Number },
      delay: { type: Number },
      backoff: { type: String, enum: ["fixed", "linear", "exponential"] },
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },

    priority: { type: Number, default: 5, min: 1, max: 10 },
    concurrency: { type: Number, min: 1 },
    dedupeKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

// Recommended indexes (auto-created by MongoJobStore)
jobSchema.index({ status: 1, priority: 1, nextRunAt: 1 });
jobSchema.index({ name: 1, status: 1 });
```

### Field Reference

| Field         | Required | Description                             |
| ------------- | -------- | --------------------------------------- |
| `name`        | ✅       | Job type identifier used in handler     |
| `data`        | ❌       | Custom payload for your job             |
| `status`      | Auto     | Set by scheduler, don't modify directly |
| `nextRunAt`   | ✅       | When job should run (defaults to now)   |
| `priority`    | ❌       | 1-10, lower runs first (default: 5)     |
| `concurrency` | ❌       | Max concurrent jobs with same name      |
| `dedupeKey`   | ❌       | Prevents duplicate scheduling           |
| `retry`       | ❌       | Retry config on failure                 |
| `repeat`      | ❌       | Cron or interval config                 |

---

## License

MIT
