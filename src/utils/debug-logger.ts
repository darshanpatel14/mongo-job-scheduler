/**
 * Debug Logger for mongo-job-scheduler
 *
 * Provides structured debug logging that can be enabled via configuration.
 * Zero dependencies - uses console.log by default but accepts custom loggers.
 */

export interface DebugConfig {
  /** Enable debug logging (default: false) */
  enabled?: boolean;

  /** Prefix for all log messages (default: "[mongo-job-scheduler]") */
  prefix?: string;

  /** Custom logger function (default: console.log) */
  logger?: (message: string, ...args: unknown[]) => void;
}

export type LogCategory =
  | "scheduler"
  | "worker"
  | "store"
  | "heartbeat"
  | "retry"
  | "lock";

export class DebugLogger {
  private readonly enabled: boolean;
  private readonly prefix: string;
  private readonly logger: (message: string, ...args: unknown[]) => void;

  constructor(config: DebugConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.prefix = config.prefix ?? "[mongo-job-scheduler]";
    this.logger = config.logger ?? console.log;
  }

  /**
   * Log a debug message with category and optional data
   */
  log(category: LogCategory, message: string, data?: object): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `${this.prefix} [${timestamp}] [${category}] ${message}`;

    if (data && Object.keys(data).length > 0) {
      this.logger(formattedMessage, data);
    } else {
      this.logger(formattedMessage);
    }
  }

  /**
   * Create a child logger with a specific category prefix
   */
  child(category: LogCategory): CategoryLogger {
    return new CategoryLogger(this, category);
  }

  /**
   * Check if debug logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Category-specific logger for convenience
 */
export class CategoryLogger {
  constructor(
    private readonly parent: DebugLogger,
    private readonly category: LogCategory,
  ) {}

  log(message: string, data?: object): void {
    this.parent.log(this.category, message, data);
  }

  isEnabled(): boolean {
    return this.parent.isEnabled();
  }
}

/**
 * Create a no-op logger that doesn't log anything
 */
export function createNoOpLogger(): DebugLogger {
  return new DebugLogger({ enabled: false });
}

/**
 * Create a debug logger from various input types
 */
export function createDebugLogger(config?: boolean | DebugConfig): DebugLogger {
  if (typeof config === "boolean") {
    return new DebugLogger({ enabled: config });
  }
  return new DebugLogger(config);
}
