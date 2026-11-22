/** The four bucket kinds a test may use. */
export type BucketKind = 'media' | 'data' | 'backups' | 'legal';

/** The template database for one migration hash: `os_tpl_<stamp>_<hash>`. */
export function templateName(stamp: string, hash: string): string {
  return `os_tpl_${stamp}_${hash}`;
}

/** One test worker's database: `os_t_<stamp>_<runId>_<slot>`. */
export function workerDatabaseName(stamp: string, runId: string, slot: string): string {
  return `os_t_${stamp}_${runId}_${slot}`;
}

/** One test worker's bucket of one kind: `t-<runId>-<slot>-<kind>`. */
export function bucketName(runId: string, slot: string, kind: BucketKind): string {
  return `t-${runId}-${slot}-${kind}`;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** The minute of `now` in UTC as `yyyymmddhhmm`. */
export function stampOf(now: Date): string {
  return (
    pad(now.getUTCFullYear(), 4) +
    pad(now.getUTCMonth() + 1, 2) +
    pad(now.getUTCDate(), 2) +
    pad(now.getUTCHours(), 2) +
    pad(now.getUTCMinutes(), 2)
  );
}

const STAMPED = /^os_(?:tpl|t)_([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})_/;

/** The time stamped into a template or worker database name, or null for any other name. */
export function parseStamp(name: string): Date | null {
  const match = STAMPED.exec(name);
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute));
  // Date.UTC rolls an out-of-range field over; a name whose fields do not survive is not a stamp.
  return stampOf(at) === match.slice(1).join('') ? at : null;
}
