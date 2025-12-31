import { Job } from "./job";

export type SchedulerEventMap = {
  // lifecycle
  "scheduler:start": void;
  "scheduler:stop": void;
  "scheduler:error": Error;

  // job lifecycle
  "job:created": Job;
  "job:queued": Job;
  "job:start": Job;
  "job:success": Job;
  "job:fail": { job: Job; error: Error };
  "job:retry": Job;
  "job:complete": Job;
  "job:cancel": Job;

  // recovery
  "resume:start": void;
  "resume:jobRecovered": Job;
  "resume:complete": void;

  // worker
  "worker:start": string;
  "worker:stop": string;
  "worker:error": Error;
};
