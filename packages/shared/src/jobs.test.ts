import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { marker } from './testing/marker.ts';
import { JOB_NAMES, JOB_PAYLOADS } from './jobs.ts';
import type { JobName, JobPayload } from './jobs.ts';

// Payloads hold ids only (INV-37): every leaf of a payload schema is a uuid, an ISO date, an
// `HH:MM` time, an enum, a literal, a number or a boolean. Two named exceptions: `ops.dead`, a
// copy of the failed job's payload, and the `values` record of `ops.alert`.

type Leaf = { path: string; schema: z.core.$ZodType; isId: boolean };
type Walk = { leaves: Leaf[]; violations: string[] };

const TIME_OF_DAY = /^\d{2}:\d{2}$/.source;

const EXCEPTIONS: ReadonlySet<string> = new Set(['ops.dead', 'ops.alert.values']);

function isTimeOfDay(schema: z.ZodString): boolean {
  return (schema._zod.def.checks ?? []).some((check) => {
    const def = check._zod.def;
    return (
      def.check === 'string_format' &&
      'format' in def &&
      def.format === 'regex' &&
      'pattern' in def &&
      def.pattern instanceof RegExp &&
      def.pattern.source === TIME_OF_DAY
    );
  });
}

function walk(schema: z.core.$ZodType, path: string, out: Walk): void {
  if (EXCEPTIONS.has(path)) {
    return;
  }
  if (schema instanceof z.ZodObject) {
    for (const [key, value] of Object.entries(schema.shape)) {
      walk(value, `${path}.${key}`, out);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    walk(schema.element, `${path}[]`, out);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    schema.options.forEach((option, index) => {
      walk(option, `${path}|${String(index)}`, out);
    });
    return;
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    walk(schema.unwrap(), path, out);
    return;
  }
  if (schema instanceof z.ZodUUID) {
    out.leaves.push({ path, schema, isId: true });
    return;
  }
  if (
    schema instanceof z.ZodISODate ||
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodLiteral ||
    (schema instanceof z.ZodString && isTimeOfDay(schema))
  ) {
    out.leaves.push({ path, schema, isId: false });
    return;
  }
  if (schema instanceof z.ZodNumber || schema instanceof z.ZodBoolean) {
    return;
  }
  out.violations.push(path);
}

function walkSchema(name: string, schema: z.core.$ZodType): Walk {
  const out: Walk = { leaves: [], violations: [] };
  walk(schema, name, out);
  return out;
}

const SAMPLE_ID = '0195d2c4-7a10-7c3e-9a51-2f4c8b6d1e07';

const SAMPLE_PAYLOADS: { [N in JobName]: JobPayload<N> } = {
  'ops.dead': { exportId: SAMPLE_ID },
  'ops.alert': {
    kind: 'job_failed',
    values: { queue: 'cost.check', jobId: SAMPLE_ID, errorClass: 'TypeError' },
  },
  'ops.heartbeat': {},
  'backup.check': {},
  'db.connections-check': {},
  'cost.check': {},
  'notify.email': { template: 'signin_method_added', userId: SAMPLE_ID, provider: 'apple' },
};

const LONG = 'a'.repeat(65);

// Replaces the value at a dotted top-level path of `payload` (paths of this list are one key deep).
function withValueAt(payload: unknown, path: string, value: unknown): unknown {
  const key = path.split('.').slice(-1)[0] ?? '';
  return typeof payload === 'object' && payload !== null ? { ...payload, [key]: value } : payload;
}

describe('the job list', () => {
  it('every payload field is a uuid, an enum, a number, a boolean or an ISO date', () => {
    const violations = JOB_NAMES.flatMap((name) => walkSchema(name, JOB_PAYLOADS[name]).violations);
    expect(violations).toEqual([]);
  });

  it('reports a free string leaf with its job name and path', () => {
    const found = walkSchema(
      'fixture.job',
      z.object({ id: z.uuid(), nested: z.object({ note: z.string() }) }).strict(),
    );
    expect(found.violations).toEqual(['fixture.job.nested.note']);
  });

  it('no payload string is longer than 64 characters except ids', () => {
    const refusedAtLeaf: string[] = [];
    const refusedInPayload: string[] = [];
    const nonIdPaths: string[] = [];
    for (const name of JOB_NAMES) {
      for (const leaf of walkSchema(name, JOB_PAYLOADS[name]).leaves) {
        if (leaf.isId) {
          continue;
        }
        nonIdPaths.push(leaf.path);
        if (!z.safeParse(leaf.schema, LONG).success) {
          refusedAtLeaf.push(leaf.path);
        }
        const payload = withValueAt(SAMPLE_PAYLOADS[name], leaf.path, LONG);
        if (!JOB_PAYLOADS[name].safeParse(payload).success) {
          refusedInPayload.push(leaf.path);
        }
      }
    }
    expect(nonIdPaths).toContain('ops.alert.kind');
    expect(refusedAtLeaf).toEqual(nonIdPaths);
    expect(refusedInPayload).toEqual(nonIdPaths);
  });

  it('every job name has exactly one payload schema', () => {
    expect(Object.keys(JOB_PAYLOADS).sort()).toEqual([...JOB_NAMES].sort());
  });

  it('sample payloads parse and hold no marker', () => {
    expect(Object.keys(SAMPLE_PAYLOADS).sort()).toEqual([...JOB_NAMES].sort());
    for (const name of JOB_NAMES) {
      const parsed = JOB_PAYLOADS[name].safeParse(SAMPLE_PAYLOADS[name]);
      expect(parsed.success, name).toBe(true);
      expect(JSON.stringify(SAMPLE_PAYLOADS[name])).not.toContain(marker());
    }
  });

  it('ops.alert values refuse a bad key and a long string', () => {
    const alert = JOB_PAYLOADS['ops.alert'];
    expect(alert.safeParse({ kind: 'job_failed', values: { 'Bad-Key': 1 } }).success).toBe(false);
    expect(
      alert.safeParse({ kind: 'job_failed', values: { queue: 'x'.repeat(121) } }).success,
    ).toBe(false);
    expect(
      alert.safeParse({ kind: 'job_failed', values: { queue: 'x'.repeat(120) } }).success,
    ).toBe(true);
    expect(
      alert.safeParse({
        kind: 'job_failed',
        values: { queue: 'x', count: 3, ok: true, none: null },
      }).success,
    ).toBe(true);
  });

  it('ops.alert refuses an unknown kind and an extra key', () => {
    const alert = JOB_PAYLOADS['ops.alert'];
    expect(alert.safeParse({ kind: 'db_size_high', values: {} }).success).toBe(false);
    expect(alert.safeParse({ kind: 'job_failed', values: {}, extra: 1 }).success).toBe(false);
  });

  it('a signin_method_added payload parses', () => {
    const parsed = JOB_PAYLOADS['notify.email'].safeParse({
      template: 'signin_method_added',
      userId: SAMPLE_ID,
      provider: 'google',
    });
    expect(parsed.success).toBe(true);
    expect(
      JOB_PAYLOADS['notify.email'].safeParse({
        template: 'signin_method_added',
        userId: SAMPLE_ID,
        provider: 'github',
      }).success,
    ).toBe(false);
    expect(
      JOB_PAYLOADS['notify.email'].safeParse({
        template: 'signin_method_added',
        userId: 'not-a-uuid',
        provider: 'google',
      }).success,
    ).toBe(false);
  });

  it('an unknown email template is refused', () => {
    expect(
      JOB_PAYLOADS['notify.email'].safeParse({
        template: 'deadline_reminder',
        notificationId: SAMPLE_ID,
      }).success,
    ).toBe(false);
  });

  it('extra payload keys are refused', () => {
    expect(
      JOB_PAYLOADS['notify.email'].safeParse({
        ...SAMPLE_PAYLOADS['notify.email'],
        email: 'x@example.test',
      }).success,
    ).toBe(false);
  });

  it('empty payloads refuse extra keys', () => {
    expect(JOB_PAYLOADS['cost.check'].safeParse({ a: 1 }).success).toBe(false);
    for (const name of ['ops.heartbeat', 'backup.check', 'db.connections-check'] as const) {
      expect(JOB_PAYLOADS[name].safeParse({ a: 1 }).success, name).toBe(false);
      expect(JOB_PAYLOADS[name].safeParse({}).success, name).toBe(true);
    }
  });
});
