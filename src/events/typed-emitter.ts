import { EventEmitter } from "events";

export type EventMap = Record<string, any>;

export class TypedEventEmitter<T extends EventMap> {
  private emitter = new EventEmitter();

  on<K extends keyof T>(event: K, listener: (payload: T[K]) => void): this {
    this.emitter.on(event as string, listener);
    return this;
  }

  once<K extends keyof T>(event: K, listener: (payload: T[K]) => void): this {
    this.emitter.once(event as string, listener);
    return this;
  }

  off<K extends keyof T>(event: K, listener: (payload: T[K]) => void): this {
    this.emitter.off(event as string, listener);
    return this;
  }

  protected emitUnsafe<K extends keyof T>(event: K, payload: T[K]): void {
    this.emitter.emit(event as string, payload);
  }
}
