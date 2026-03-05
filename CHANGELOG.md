# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-03-05

### Added

- **`lastScheduledAt` support in `ScheduleOptions`** — Allows consumer code to pass through the last scheduled time when creating a job. Used as the base for calculating the next cron/interval run.
- **`nextRunAt` alias in `ScheduleOptions`** — Alias for `runAt`. If both are provided, `runAt` takes precedence.

### Changed

- `ScheduleOptions`: added optional `nextRunAt` and `lastScheduledAt` fields
- `Scheduler.schedule()`: uses `options.nextRunAt` as fallback for `runAt`, passes `lastScheduledAt` to the job document

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
