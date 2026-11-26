import { createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';

/** A debug-level pipeline logger whose lines are kept, raw and parsed, for a test to read. */
export function captureLogger(): {
  log: Logger;
  lines: { raw: string; parsed: Record<string, unknown> }[];
} {
  const lines: { raw: string; parsed: Record<string, unknown> }[] = [];
  const log = createLogger({
    service: 'pipeline',
    level: 'debug',
    sink: (raw) => {
      lines.push({ raw, parsed: JSON.parse(raw) as Record<string, unknown> });
    },
  });
  return { log, lines };
}
