import { redact } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogService = 'api' | 'worker' | 'pipeline';
export type LogFields = Readonly<Record<string, unknown>>;
export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
};

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

const REQUIRED_KEYS = new Set(['time', 'level', 'service', 'event']);

function redactedFields(fields: LogFields): Record<string, unknown> {
  const redacted = redact(fields);
  const out: Record<string, unknown> = {};
  if (redacted !== null && typeof redacted === 'object') {
    for (const [key, value] of Object.entries(redacted)) {
      if (!REQUIRED_KEYS.has(key)) {
        out[key] = value;
      }
    }
  }
  return out;
}

function defaultSink(line: string): void {
  console.log(line);
}

/**
 * A logger writing one JSON object per line: `time` (ISO UTC), `level`, `service` and `event` first,
 * then the bound and call fields, each passed through `redact()`. Calls below `level` write nothing.
 */
export function createLogger(options: {
  service: LogService;
  level: LogLevel;
  sink?: (line: string) => void;
  now?: () => Date;
}): Logger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_RANK[options.level];

  const make = (bound: LogFields): Logger => {
    const write = (level: LogLevel, event: string, fields: LogFields | undefined): void => {
      if (LEVEL_RANK[level] < threshold) {
        return;
      }
      const line = {
        time: now().toISOString(),
        level,
        service: options.service,
        event,
        ...redactedFields(bound),
        ...(fields === undefined ? {} : redactedFields(fields)),
      };
      sink(JSON.stringify(line));
    };
    return {
      debug: (event, fields) => {
        write('debug', event, fields);
      },
      info: (event, fields) => {
        write('info', event, fields);
      },
      warn: (event, fields) => {
        write('warn', event, fields);
      },
      error: (event, fields) => {
        write('error', event, fields);
      },
      child: (fields) => make({ ...bound, ...fields }),
    };
  };

  return make({});
}
