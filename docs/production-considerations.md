# Production Considerations

This document covers important deployment and operational considerations for `mongo-job-scheduler` in production environments.

## Clock Synchronization (Required)

### NTP Requirement

All nodes running the scheduler **must** have synchronized system clocks via NTP.

```bash
# Verify NTP synchronization
timedatectl status
# or
ntpq -p
```

**Why it matters:**

The scheduler uses timestamps for:

- Lock acquisition (`lockUntil`)
- Lock expiry detection
- Job scheduling (`nextRunAt`)

Clock skew > 2 seconds between nodes can cause:

- Premature lock expiry
- Delayed lock expiry
- Unexpected job recovery

**Recommendation:** Configure NTP with sub-second accuracy. Most cloud providers (AWS, GCP, Azure) provide NTP servers optimized for their infrastructure.

---

## CPU-Bound Jobs

### Event Loop Blocking

If your job handler blocks the event loop (pure CPU work without `await`), the heartbeat mechanism cannot renew the lock.

**Example of blocking code:**

```javascript
// ❌ Blocks event loop - heartbeat can't run
handler: async (job) => {
  let result = 0;
  for (let i = 0; i < 1e10; i++) {
    result += Math.sqrt(i);
  }
};
```

**What happens:**

1. Heartbeat timer is scheduled but can't execute
2. Lock expires (`lockUntil` passes)
3. Another worker may recover the job
4. Both workers may execute (original continues despite lost lock)

**Mitigation strategies:**

1. **Break up CPU work with `setImmediate`:**

```javascript
handler: async (job) => {
  for (let i = 0; i < chunks; i++) {
    await processChunk(i);
    await new Promise((resolve) => setImmediate(resolve)); // Yield to event loop
  }
};
```

2. **Use worker threads for CPU-bound tasks:**

```javascript
import { Worker } from "worker_threads";

handler: async (job) => {
  await runInWorkerThread(job.data);
};
```

3. **Increase lock timeout for known long jobs:**

```javascript
new Scheduler({
  lockTimeoutMs: 10 * 60 * 1000, // 10 minutes
  // ...
});
```

### Built-in Protection: Ownership Verification

Even if a CPU-bound job blocks the event loop and another worker reclaims the job, the scheduler has **built-in protection**:

- `markCompleted()` verifies ownership atomically before completion
- If ownership was lost (lock stolen), a `JobOwnershipError` is thrown
- The job will only be completed by the legitimate lock owner

This prevents duplicate completions when:

1. Original worker's lock expires during CPU-bound work
2. Another worker recovers and processes the job
3. Original worker finishes and tries to mark complete → **safely rejected**

---

## MongoDB Connection

### Connection Configuration

For production deployments, configure the MongoDB connection with appropriate settings:

```javascript
const client = new MongoClient(MONGO_URI, {
  // Connection pool
  maxPoolSize: 50,
  minPoolSize: 10,

  // Timeouts
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,

  // Retry
  retryWrites: true,
  retryReads: true,

  // Write concern for durability
  writeConcern: {
    w: "majority",
    wtimeout: 5000,
  },
});
```

### Failover Behavior

During MongoDB primary election or network glitches:

1. Operations may temporarily fail
2. The MongoDB driver handles retries automatically
3. The scheduler is stateless - it resumes polling after connection recovery
4. Jobs in `running` state with expired locks will be recovered

**No manual intervention required** - the scheduler is designed to handle transient failures.

---

## Cron Jobs and Restarts

### Missed Executions

When the scheduler restarts after being down, cron jobs **do not backfill** missed executions.

**Example:**

```
Cron: "0 * * * *" (every hour at :00)
Server down: 10:00 AM to 2:30 PM

What happens at restart:
- 10:00 job was due → runs once
- 11:00, 12:00, 1:00, 2:00 → skipped
- Next scheduled: 3:00 PM
```

**This is intentional behavior** to prevent:

- Thundering herd after outages
- Resource exhaustion from backfill storms
- Unexpected side effects from delayed execution

### If You Need Backfill

For jobs that must run for every scheduled slot:

1. Track execution history in your database
2. On startup, query for missed slots
3. Schedule catch-up jobs manually

---

## Concurrency Limits

### Global vs Per-Node

Concurrency limits are **global across all nodes**. The scheduler uses MongoDB to coordinate.

```javascript
// This limits to 5 concurrent 'email-send' jobs
// across ALL scheduler instances
await scheduler.schedule({
  name: "email-send",
  data: { to: "user@example.com" },
  concurrency: 5,
});
```

### Under High Contention

When many workers compete for concurrency-limited jobs:

1. Each worker checks current running count
2. If under limit, attempts to acquire lock
3. After acquiring, verifies count again (double-check)
4. If over limit, releases lock and retries

This may cause brief periods where fewer than the limit are running, but **never more**.

---

## Memory Considerations

### Long-Running Schedulers

The scheduler is designed for long-running processes:

- No growing internal state
- Workers are created/destroyed cleanly
- Event listeners are properly managed

**Recommended monitoring:**

```javascript
setInterval(() => {
  const usage = process.memoryUsage();
  console.log(`Heap: ${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}, 60000);
```

### Known Safe Patterns

- ✅ Heartbeat loops clean up on stop
- ✅ Worker arrays are cleared on stop
- ✅ No unbounded caches or maps
- ✅ Event emitter doesn't accumulate listeners

---

## Graceful Shutdown

### Kubernetes / Container Orchestration

The scheduler supports graceful shutdown for container environments:

```javascript
const scheduler = new Scheduler({
  /* ... */
});
await scheduler.start();

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down gracefully...");

  await scheduler.stop({
    graceful: true,
    timeoutMs: 30000, // Max wait for in-flight jobs
  });

  console.log("Scheduler stopped");
  process.exit(0);
});
```

**Behavior:**

1. `SIGTERM` received
2. Scheduler stops accepting new jobs
3. In-flight jobs complete (up to timeout)
4. Clean exit

**Pod configuration example:**

```yaml
spec:
  terminationGracePeriodSeconds: 60
```

---

## Index Optimization

### Required Indexes

The scheduler creates these indexes automatically:

```javascript
// Primary query index
{ status: 1, priority: 1, nextRunAt: 1 }

// Deduplication (unique, sparse)
{ dedupeKey: 1 }

// Concurrency counting
{ name: 1, status: 1 }
```

### Verifying Index Usage

```javascript
// Check query plan
db.scheduler_jobs
  .find({
    status: "pending",
    nextRunAt: { $lte: new Date() },
  })
  .sort({ priority: 1, nextRunAt: 1 })
  .explain("executionStats");
```

Look for `IXSCAN` (index scan) rather than `COLLSCAN` (collection scan).

---

## Observability

### Events for Monitoring

```javascript
scheduler.on("job:start", (job) => {
  metrics.jobsStarted.inc({ name: job.name });
});

scheduler.on("job:complete", (job) => {
  metrics.jobsCompleted.inc({ name: job.name });
});

scheduler.on("job:fail", ({ job, error }) => {
  metrics.jobsFailed.inc({ name: job.name });
  logger.error("Job failed", { jobId: job._id, error: error.message });
});

scheduler.on("job:retry", (job) => {
  metrics.jobsRetried.inc({ name: job.name });
});
```

### Recommended Alerts

1. **High failure rate**: `job:fail` events > threshold
2. **Queue depth**: pending jobs growing faster than processed
3. **Stuck jobs**: `status: running` with `lockUntil` in the past
4. **Memory growth**: heap usage trending upward

---

## Security

### Query Safety

The scheduler does not interpolate user input into MongoDB queries. Job names and data are always treated as values, never as operators.

### Access Control

Limit scheduler database access to:

- Read/write on `scheduler_jobs` collection
- Index creation permissions (or create indexes manually)

No admin privileges required.
