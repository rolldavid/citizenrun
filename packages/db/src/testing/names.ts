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

const STAMPED = /^os_(?:tpl|t)_([0-9]{12})_/;
const LAST_USED = /^last used ([0-9]{12})$/;

// The instant of a `yyyymmddhhmm` stamp, or null when a field is out of range.
function stampDate(digits: string): Date | null {
  const [year, month, day, hour, minute] = [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
  ].map(Number);
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
  // Date.UTC rolls an out-of-range field over; a stamp whose fields do not survive is not a stamp.
  return stampOf(at) === digits ? at : null;
}

/** The time stamped into a template or worker database name, or null for any other name. */
export function parseStamp(name: string): Date | null {
  const digits = STAMPED.exec(name)?.[1];
  return digits === undefined ? null : stampDate(digits);
}

/** The comment a run writes on the template it uses, so other runs age it by its last use. */
export function lastUsedComment(stamp: string): string {
  return `last used ${stamp}`;
}

/** The time in a template's last-used comment, or null for no comment or any other comment. */
export function parseLastUsed(comment: string | null): Date | null {
  const digits = comment === null ? undefined : LAST_USED.exec(comment)?.[1];
  return digits === undefined ? null : stampDate(digits);
}
