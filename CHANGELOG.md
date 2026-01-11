# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-01-11

### Added

- **Ownership verification for `markCompleted()`**: Prevents duplicate job completion when CPU-bound work blocks the event loop and lock expires
  - `markCompleted()` now atomically verifies worker ownership before completion
  - New `JobOwnershipError` thrown when attempting to complete a job you no longer own
  - Protects against race conditions in multi-worker deployments

### Changed

- `markCompleted(jobId, workerId)` signature now requires `workerId` parameter
- `InMemoryJobStore` and `MongoJobStore` both implement ownership verification

### Documentation

- Updated `docs/production-considerations.md` with ownership verification safeguards under CPU-Bound Jobs section

---

## [1.0.0] - 2026-01-10

### Added

- Production-grade MongoDB-backed job scheduler
- Retry support with exponential backoff
- Cron and interval repeat scheduling
- Timezone support for cron jobs
- Crash recovery via lock expiry and heartbeat
- Concurrency limits (global across nodes)
- Priority-based scheduling
- Bulk job creation
- Job deduplication via `dedupeKey`
- Graceful shutdown support
- Event-driven architecture (`job:start`, `job:complete`, `job:fail`, `job:retry`, etc.)
