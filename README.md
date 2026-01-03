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
- **Sharding-safe design**

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

## Documentation

See `ARCHITECTURE.md` for:

- job lifecycle
- retry & repeat semantics
- MongoDB indexes
- sharding strategy
- production checklist

## Status

**Early-stage but production-tested.**
API may evolve before 1.0.0.
