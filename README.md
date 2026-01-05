# Mongo Job Scheduler

A production-grade MongoDB-backed job scheduler for Node.js with distributed locking, retries, cron scheduling, and crash recovery.

[![npm version](https://img.shields.io/npm/v/mongo-job-scheduler.svg)](https://www.npmjs.com/package/mongo-job-scheduler)

---

## Features

- ✅ **Distributed locking** — safe for multiple instances
- ✅ **Atomic job execution** — no double processing
- ✅ **Automatic retries** — with configurable backoff
- ✅ **Cron scheduling** — timezone-aware, non-drifting
- ✅ **Interval jobs** — repeated execution
- ✅ **Crash recovery** — resume on restart
- ✅ **Heartbeats** — automatic lock renewal for long jobs
- ✅ **Query API** — filter, sort, paginate jobs
- ✅ **Auto-indexing** — performance optimized out of the box
- ✅ **Sharding-safe** — designed for MongoDB sharding

---

## Quick Start

### Installation

```bash
npm install mongo-job-scheduler
```

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

- `{ status: 1, nextRunAt: 1 }` — for job polling (critical)
- `{ dedupeKey: 1 }` — for deduplication (unique)
- `{ lockedAt: 1 }` — for stale lock recovery

These indexes prevent query time from degrading from O(log n) to O(n) at scale.

### Distributed Systems

Run **multiple scheduler instances** (different servers, pods, or processes) connected to the same MongoDB:

- **Atomic Locking** — uses `findOneAndUpdate` to prevent race conditions
- **Concurrency Control** — only one worker executes a job instance
- **Horizontally Scalable** — supports MongoDB sharding

See `architecture.md` for sharding strategy and production guidelines.

---

## Documentation

- **`architecture.md`** — Internal design, MongoDB schema, sharding strategy, production checklist
- **Job lifecycle** — pending → running → completed/failed
- **Retry & repeat semantics** — at-most-once guarantees
- **Correctness guarantees** — what we ensure and what we don't

---

## Status

**Early-stage but production-tested.**  
API may evolve before 1.0.0.

---

## License

MIT
