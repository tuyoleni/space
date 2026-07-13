/**
 * Structured logging (spec 29.3: "Logs must use levels, correlation IDs,
 * and redaction"). No I/O of its own — `LogSink` is injected, matching
 * every other privileged-but-pure module in this codebase
 * (`GitExecutor`/`GhExecutor`/`ModelProvider`/...), so this is unit-
 * testable without touching a real file and so `apps/desktop` can point
 * it at a real rotating file sink without this package knowing anything
 * about `node:fs`.
 *
 * Redaction happens here, not left to callers to remember: every
 * message and every string value in `context` passes through
 * `redactSecretPatterns` (the same pattern-matching defence-in-depth
 * `@space/workspace-runner`'s `RedactionRegistry` module documents)
 * before a `LogEntry` is ever handed to the sink. A caller that already
 * redacted (e.g. github-handlers.ts's `RedactionRegistry.redact`) simply
 * gets a no-op second pass; a caller that forgot is still covered.
 */
import { redactSecretPatterns } from '@space/workspace-runner';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  /** Ties together every log line produced while handling one request/operation/IPC call — spec 29.3's "correlation IDs". Null for logging that happens outside any single traceable unit of work (e.g. app startup). */
  readonly correlationId: string | null;
  readonly message: string;
  /** Structured context — every string value is redacted the same as `message`; never put a raw secret, token, or full file path here (spec 29.2's exclusions apply to logs too, not just telemetry). */
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  /** Returns a new `Logger` that stamps every entry with `correlationId` — the request/operation/IPC-call boundary this codebase already threads an id through (e.g. an `operationId`), reused here rather than inventing a second id scheme. */
  withCorrelationId(correlationId: string): Logger;
}

export interface CreateLoggerOptions {
  readonly sink: LogSink;
  /** Entries below this level are dropped before ever reaching the sink (and before redaction, which is free to skip). Defaults to 'info' — 'debug' is opt-in, matching the common "quiet by default" convention. */
  readonly minLevel?: LogLevel;
  readonly now?: () => string;
}

function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    redacted[key] = typeof value === 'string' ? redactSecretPatterns(value) : value;
  }
  return redacted;
}

/** Builds a `Logger` bound to `options.sink` — the one place `LogEntry`s are constructed, redacted, and level-filtered. */
export function createLogger(options: CreateLoggerOptions): Logger {
  const minLevel = options.minLevel ?? 'info';
  const now = options.now ?? (() => new Date().toISOString());

  function build(correlationId: string | null): Logger {
    function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
      if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minLevel]) {
        return;
      }
      const entry: LogEntry = {
        timestamp: now(),
        level,
        correlationId,
        message: redactSecretPatterns(message),
        ...(context ? { context: redactContext(context) } : {}),
      };
      options.sink.write(entry);
    }

    return {
      debug: (message, context) => log('debug', message, context),
      info: (message, context) => log('info', message, context),
      warn: (message, context) => log('warn', message, context),
      error: (message, context) => log('error', message, context),
      withCorrelationId: (correlationIdArg) => build(correlationIdArg),
    };
  }

  return build(null);
}
