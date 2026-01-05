# Mongo Job Scheduler — Architecture & Production Guide

This document explains **how the scheduler works internally**, why certain design decisions were made, and how to run it safely in production.

This is **not a tutorial**. It is meant for engineers who want to understand correctness, scalability, and failure handling.

---

## 1. High‑level overview

Mongo Job Scheduler is a **distributed job scheduler** built on top of MongoDB.

It provides:

- distributed locking
- safe multi‑worker execution
- retries with backoff
- cron & interval scheduling
- crash recovery
- sharding‑safe behavior

It intentionally prioritizes **correctness and predictability** over strict ordering or real‑time guarantees.

---

## 2. Core components

```
┌─────────────┐
│  Scheduler  │   owns lifecycle
└──────┬──────┘
       │ creates
       ▼
┌─────────────┐    poll + execute
│   Worker(s) │──────────────────▶ JobStore
└─────────────┘                    (Mongo / Memory)
```

### Scheduler

- starts and stops workers
- runs stale‑lock recovery on startup
- emits lifecycle events
- **never executes jobs directly**

### Worker

- polls for jobs
- atomically locks a single job
- executes user handler
- applies retry & repeat logic

### JobStore

- persistence layer
- atomic locking via `findOneAndUpdate`
- rescheduling
- recovery of crashed jobs

---

## 3. Job lifecycle

```
pending
  │
  │ findAndLockNext()
  ▼
running
  │
  ├── success → completed
  │
  ├── retry → pending (with nextRunAt)
  │
  └── failure → failed
```

### Important fields

- `status`: pending | running | completed | failed
- `nextRunAt`: when job becomes eligible
- `lockedAt`: when job was locked
- `lockedBy`: worker id holding the lock

Only jobs with `status = "pending"` are eligible for execution.

---

## 4. Locking model (critical)

Locking is implemented using **a single atomic MongoDB operation**:

- `findOneAndUpdate`
- sorted by `nextRunAt`
- guarded by `status` and lock expiry

This guarantees:

- no double execution
- safe contention handling
- correctness under concurrency

If a worker crashes, locks are reclaimed via recovery.

---

## 5. Retry semantics

### Definition

> `maxAttempts` = total attempts across the entire system

Not per worker. Not per process.

### Behavior

- attempts are **persisted in the store**
- retry delay uses backoff
- retry overrides repeat scheduling
- retry reschedule is atomic

### Example

```ts
retry: {
  maxAttempts: 3,
  delay: 100
}
```

Result:

- run 1 → fail
- run 2 → fail
- run 3 → fail
- run 4 ❌ blocked

---

## 6. Repeat semantics

Repeat scheduling is intentionally split into two models.

### Interval (`every`)

```ts
repeat: {
  every: 1000;
}
```

- scheduled **after execution**
- execution time adds drift
- minimum enforced delay = 100ms

Used for polling‑style jobs.

---

### Cron (`cron`)

```ts
repeat: {
  cron: "0 9 * * *",
  timezone: "Asia/Kolkata" // default UTC
}
```

- scheduled **before execution**
- uses logical schedule time
- skips missed slots
- never drifts

Cron scheduling is deterministic and restart‑safe.

---

## 7. Timezone handling

- Default timezone: **UTC**
- Timezone applies **only to cron jobs**
- Uses IANA timezone names (e.g. `Asia/Kolkata`)
- All stored dates are UTC `Date` objects

DST is handled automatically by the cron parser.

---

## 8. Crash recovery & resume on restart

If a worker crashes while holding a lock:

- job remains in `running`
- lock eventually expires

On scheduler startup:

```ts
recoverStaleJobs({ now, lockTimeoutMs });
```

Recovery:

- resets expired locks
- preserves `nextRunAt`
- prevents duplicate execution

---

## 9. MongoDB schema

Each job is stored as a single document:

```ts
{
  _id: ObjectId,
  name: string,
  data: any,
  status: "pending" | "running" | "completed" | "failed",
  attempts: number,
  nextRunAt: Date,
  lastRunAt?: Date,
  lastScheduledAt?: Date,
  lockedAt?: Date,
  lockedBy?: string,
  repeat?: { cron?: string; every?: number; timezone?: string },
  retry?: { maxAttempts: number; delay: number },
  lastError?: string,
  createdAt: Date,
  updatedAt: Date
}
```

---

## 10. MongoDB indexes (AUTOMATIC)

**As of v0.1.7**, indexes are created automatically when `MongoJobStore` is initialized. No manual setup required.

The library creates three indexes in background mode to avoid blocking:

### 1. Job polling index (Primary)

```js
{
  status: 1,
  nextRunAt: 1
}
```

Used by `findAndLockNext()` for atomic job locking. This is the most critical index for performance.

### 2. Deduplication index

```js
{
  dedupeKey: 1;
}
// unique, sparse
```

Ensures idempotent job creation when using `dedupeKey`.

### 3. Stale lock recovery index

```js
{
  lockedAt: 1;
}
// sparse
```

Used during startup to recover jobs with expired locks.

### Performance Impact

Without these indexes, performance degrades severely at scale:

- Query time grows from O(log n) to O(n)
- Lock contention increases
- Worker starvation occurs

The indexes are created with `{ background: true }` to avoid blocking writes during initial setup.

---

## 11. Sharding strategy (production)

### ❌ Do NOT shard on

- `nextRunAt`
- `status`
- `lockedAt`

These cause hotspots.

### ✅ Correct shard key

```js
sh.shardCollection("scheduler.scheduler_jobs", { _id: "hashed" });
```

Why:

- uniform distribution
- no hot shards
- safe scatter‑gather
- correct locking behavior

Scatter‑gather is acceptable here because the query is indexed and short‑lived.

---

## 12. Worker scaling guidelines

| Load       | Workers                   |
| ---------- | ------------------------- |
| < 10k jobs | 1–2                       |
| 100k jobs  | 3–5                       |
| 1M jobs    | 5–10                      |
| 10M+ jobs  | increase workers & shards |

Scaling workers is safer than aggressive polling.

---

## 13. Testing philosophy

### Unit tests

- logic only
- no Mongo

### Integration tests

- in‑memory store
- deterministic behavior

### Mongo tests

- real MongoDB
- locking & recovery

### Stress tests

- millions of jobs
- manual execution only

Retry correctness tests must run with **one worker**.
Concurrency tests must not assert exact counts.

---

## 14. Guarantees & non‑goals

### Guarantees

- at‑most‑once per scheduled run
- no permanent lock
- deterministic cron behavior
- safe recovery

### Non‑goals

- exactly‑once delivery
- strict FIFO ordering
- real‑time execution guarantees

These tradeoffs are intentional.

---

## 15. Final notes

This scheduler is designed for **serious backend systems**, not toy examples.

If you understand this document, you understand the system.
