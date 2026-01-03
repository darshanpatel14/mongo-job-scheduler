# Mongo Job Scheduler

A production-grade MongoDB-backed job scheduler for Node.js.

Designed for distributed systems that need:

- reliable background jobs
- retries with backoff
- cron & interval scheduling
- crash recovery
- MongoDB sharding safety

---

## Features

- **Distributed locking** using MongoDB
- **Multiple workers** support
- **Retry with backoff**
- **Cron jobs** (timezone-aware, non-drifting)
- **Interval jobs**
- **Resume on restart**
- **Stale lock recovery**
- **Automatic Lock Renewal** (Heartbeats): Long-running jobs automatically extend their lock.
- **Sharding-safe design**

## Distributed Systems

This library is designed for distributed environments. You can run **multiple scheduler instances** (on different servers, pods, or processes) connected to the same MongoDB.

- **Atomic Locking**: Uses `findOneAndUpdate` to safe-guard against race conditions.
- **Concurrency**: Only one worker will execute a given job instance.
- **Scalable**: Horizontal scaling is supported via MongoDB sharding.

---

## Install

```bash
npm install mongo-job-scheduler
```

## Basic Usage

```typescript
import { Scheduler, MongoJobStore } from "mongo-job-scheduler";
import { MongoClient } from "mongodb";

// ... connect to mongo ...
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

## Cron with Timezone

```typescript
await scheduler.schedule(
  "daily-report",
  { type: "report" }, // payload
  {
    repeat: {
      cron: "0 9 * * *",
      timezone: "Asia/Kolkata", // default is UTC
    },
  }
);
```

## Interval Scheduling

Run a job repeatedly with a fixed delay between executions (e.g., every 5 minutes).

```typescript
await scheduler.schedule({
  name: "cleanup-logs",
  data: {},
  repeat: {
    every: 5 * 60 * 1000, // 5 minutes in milliseconds
  },
});
```

## Job Deduplication

Prevent duplicate jobs using `dedupeKey`. If a job with the same key exists, it returns the existing job instead of creating a new one.

```typescript
await scheduler.schedule({
  name: "email",
  data: { userId: 123 },
  dedupeKey: "email:user:123",
});
```

## Job Cancellation

```typescript
// Cancel a pending or running job
await scheduler.cancel(jobId);
```

## Job Querying

```typescript
const job = await scheduler.getJob(jobId);
```

## Bulk Scheduling

For high-performance ingestion, use `scheduleBulk` to insert multiple jobs in a single database operation:

```typescript
const jobs = await scheduler.scheduleBulk([
  { name: "email", data: { userId: 1 } },
  { name: "email", data: { userId: 2 } },
]);
```

## Events

The scheduler emits typed events for lifecycle monitoring.

```typescript
// Scheduler events
scheduler.on("scheduler:start", () => console.log("Scheduler started"));
scheduler.on("scheduler:stop", () => console.log("Scheduler stopped"));
scheduler.on("scheduler:error", (err) =>
  console.error("Scheduler error:", err)
);

// Worker events
scheduler.on("worker:start", (workerId) =>
  console.log("Worker started:", workerId)
);
scheduler.on("worker:stop", (workerId) =>
  console.log("Worker stopped:", workerId)
);

// Job events
scheduler.on("job:created", (job) => console.log("Job created:", job._id));
scheduler.on("job:start", (job) => console.log("Job processing:", job._id));
scheduler.on("job:success", (job) => console.log("Job done:", job._id));
scheduler.on("job:fail", ({ job, error }) =>
  console.error("Job failed:", job._id, error)
);
scheduler.on("job:retry", (job) =>
  console.warn("Job retrying:", job._id, job.attempts)
);
scheduler.on("job:cancel", (job) => console.log("Job cancelled:", job._id));
```

## Documentation

See `ARCHITECTURE.md` for:

- job lifecycle
- retry & repeat semantics
- MongoDB indexes
- sharding strategy
- production checklist

## Graceful Shutdown

Stop the scheduler and wait for in-flight jobs to complete:

```typescript
await scheduler.stop({ graceful: true, timeoutMs: 30000 });
```

## Status

**Early-stage but production-tested.**
API may evolve before 1.0.0.
