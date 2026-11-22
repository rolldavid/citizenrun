/** One line a logger wrote: the exact JSON string, and its parsed object. */
export type CapturedLine = { raw: string; parsed: Record<string, unknown> };

const lines: CapturedLine[] = [];

function parse(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value));
    }
  } catch {
    // A line that is not a JSON object is kept raw, so the privacy scan still reads it.
  }
  return {};
}

const capture = {
  sink: (raw: string): void => {
    lines.push({ raw, parsed: parse(raw) });
  },
  lines,
  clear: (): void => {
    lines.length = 0;
  },
};

/**
 * The one log capture of this test file: pass `sink` to `createLogger`, read `lines`. Every call
 * returns the same capture. Nothing here ever prints a captured line (D-116).
 */
export function captureLogs(): {
  sink: (line: string) => void;
  lines: CapturedLine[];
  clear(): void;
} {
  return capture;
}
