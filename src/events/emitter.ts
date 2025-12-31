import { TypedEventEmitter } from "./typed-emitter";
import { SchedulerEventMap } from "../types/events";

export class SchedulerEmitter extends TypedEventEmitter<SchedulerEventMap> {
  emitSafe<K extends keyof SchedulerEventMap>(
    event: K,
    payload: SchedulerEventMap[K]
  ): void {
    try {
      this.emitUnsafe(event, payload);
    } catch (err) {
      // never allow listener failure to crash core
      try {
        this.emitUnsafe("scheduler:error", err as Error);
      } catch {
        // absolute last guard
      }
    }
  }
}
