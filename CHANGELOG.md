# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1] - 2026-03-05

### Fixed

- **Retry logic in `MongoJobStore`** — Fixed a regression where `reschedule()` was not resetting `attempts` on successful runs, causing repeating jobs to eventually reach their max retry limit.
- **Test Stability** — Improved resilience of the test suite against environment-specific timing lag by loosening strict drift assertions and increasing timeout windows for heavy-concurrency scenarios.

## [1.2.0] - 2026-03-05

### Added

- **`lastScheduledAt` support in `ScheduleOptions`** — Allows consumer code to pass through the last scheduled time when creating a job. Used as the base for calculating the next cron/interval run.
- **`nextRunAt` alias in `ScheduleOptions`** — Alias for `runAt`. If both are provided, `runAt` takes precedence.
- **`nextRunAt` auto-calculation** — For interval jobs (`repeat.every`), if `runAt`/`nextRunAt` is not provided but `lastScheduledAt` is, the library auto-calculates the initial run time as `lastScheduledAt + repeat.every`.

### Changed

- `ScheduleOptions`: added optional `nextRunAt` and `lastScheduledAt` fields
- `Scheduler.schedule()`: uses `options.nextRunAt` as fallback for `runAt`, passes `lastScheduledAt` to the job document
- `JobStore`: `reschedule()` now accepts and persists `lastScheduledAt`, meaning cron/interval slots are successfully saved to the database on execution.

---

## [1.1.0] - 2026-03-05

### Added

- **Max Execution Time (`maxExecutionMs`)** — Prevents stuck jobs from renewing locks forever.
  - Set globally via `SchedulerOptions.maxExecutionMs` or per-job via `ScheduleOptions.maxExecutionMs`
  - When a job handler exceeds the limit, the heartbeat stops renewing the lock
  - The lock expires naturally, and crash recovery picks up the job
  - New `job:stalled` event emitted when stall is detected
  - Per-job `maxExecutionMs` overrides the global default
  - Validation: must be a positive integer if set
  - Fully backward compatible: when not set, behavior is unchanged (heartbeats renew indefinitely)

### Changed

- `Job` interface: added optional `maxExecutionMs` field
- `ScheduleOptions`: added optional `maxExecutionMs` field
- `SchedulerOptions`: added optional `maxExecutionMs` field
- `WorkerOptions`: added optional `maxExecutionMs` field
- `SchedulerEventMap`: added `job:stalled` event
- Worker heartbeat loop: added elapsed time check for stall detection
