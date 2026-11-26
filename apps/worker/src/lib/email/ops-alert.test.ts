import { BRAND, EMAIL_STYLES, createI18n } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { BYTES_PER_GB, COST_LINES } from '../../jobs/ops/cost-lines.ts';
import { renderOpsAlert } from './ops-alert.ts';

const { t } = createI18n();

const ENTITIES: Readonly<Record<string, string>> = {
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

// Reverses escapeHtml, so an attribute value compares with the text it was made from.
function decode(text: string): string {
  return text.replace(/&(?:quot|#39|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

function styleValues(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map((match) => decode(match[1] ?? ''));
}

const JOB_FAILED = {
  kind: 'job_failed',
  values: {
    queue: 'backup.check',
    jobId: '0195d2c4-0000-7000-8000-000000000001',
    errorClass: 'TypeError',
  },
  env: 'staging',
} as const;

describe('renderOpsAlert', () => {
  it('every style attribute is an EMAIL_STYLES member', () => {
    const { html } = renderOpsAlert(JOB_FAILED, t);
    const styles = styleValues(html);
    const members: string[] = Object.values(EMAIL_STYLES);
    expect(styles.length).toBeGreaterThan(0);
    for (const value of styles) {
      expect(members).toContain(value);
    }
    // Every element the layout draws carries its style: body, container, heading, paragraph,
    // rule and footer.
    expect(new Set(styles)).toEqual(
      new Set([
        EMAIL_STYLES.body,
        EMAIL_STYLES.container,
        EMAIL_STYLES.heading,
        EMAIL_STYLES.paragraph,
        EMAIL_STYLES.rule,
        EMAIL_STYLES.footer,
      ]),
    );
    // A style attribute that a quote inside it ended early would leave stray text behind.
    expect(html.match(/ style=/g)?.length).toBe(html.match(/style="[^"]*"/g)?.length);
  });

  it('values are escaped in the html and plain in the text', () => {
    const rendered = renderOpsAlert(
      { ...JOB_FAILED, values: { ...JOB_FAILED.values, queue: '<b>x</b>' } },
      t,
    );
    expect(rendered.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(rendered.html).not.toContain('<b>');
    expect(rendered.text).toContain('Job 0195d2c4-0000-7000-8000-000000000001 on <b>x</b> failed');
    expect(rendered.subject).toBe(
      `[${BRAND.displayName} staging] A job failed three times: <b>x</b>`,
    );
  });

  it('the html holds no img, no a and no remote url', () => {
    const { html } = renderOpsAlert(JOB_FAILED, t);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toMatch(/https?:/i);
    expect(html).not.toMatch(/\bsrc=|\bhref=|url\(/i);
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
  });

  it('the footer names the environment', () => {
    const footer = `Operational alert for the ${BRAND.displayName} staging environment.`;
    const rendered = renderOpsAlert(JOB_FAILED, t);
    expect(rendered.text).toBe(
      'Job 0195d2c4-0000-7000-8000-000000000001 on backup.check failed three times with ' +
        'TypeError. Further failures of this queue within the hour are not emailed.' +
        `\n\n${footer}\n`,
    );
    expect(rendered.html).toContain(`>${footer}</p>`);
  });

  it('a count renders without plural keys', () => {
    const rendered = renderOpsAlert(
      { kind: 'connections_high', values: { count: 80, max: 100 }, env: 'ci' },
      t,
    );
    expect(rendered.subject).toBe(`[${BRAND.displayName} ci] Database connections at 80`);
    expect(rendered.text.startsWith('80 of 100 database connections are in use.')).toBe(true);
  });

  it('a null value reads not known yet', () => {
    const rendered = renderOpsAlert(
      { kind: 'dump_stale', values: { hoursSinceNewest: null }, env: 'ci' },
      t,
    );
    expect(rendered.text).toContain('Age in hours: not known yet.');
  });

  it('a value cannot replace the environment', () => {
    const rendered = renderOpsAlert(
      { kind: 'dump_stale', values: { hoursSinceNewest: 2, env: 'production' }, env: 'ci' },
      t,
    );
    expect(rendered.subject).toBe(`[${BRAND.displayName} ci] No recent database backup`);
  });

  it('a value named like an i18next option is only text', () => {
    const plain = renderOpsAlert(JOB_FAILED, t);
    for (const name of [
      'count',
      'lng',
      'context',
      'defaultValue',
      'keySeparator',
      'nsSeparator',
      'ns',
      'returnObjects',
      'appName',
    ]) {
      const rendered = renderOpsAlert(
        { ...JOB_FAILED, values: { ...JOB_FAILED.values, [name]: '#' } },
        t,
      );
      expect({ name, ...rendered }).toEqual({ name, ...plain });
    }
  });

  it('a value cannot replace the product name', () => {
    const rendered = renderOpsAlert(
      { kind: 'dump_stale', values: { hoursSinceNewest: 2, appName: 'Other' }, env: 'ci' },
      t,
    );
    expect(rendered.subject).toBe(`[${BRAND.displayName} ci] No recent database backup`);
  });

  it('the storage line reads gigabytes and dollars a month', () => {
    const rendered = renderOpsAlert(
      {
        kind: 'cost_projection',
        values: { line: 'storage', value: 700_000_000_000, projected: 1050, threshold: 1000 },
        env: 'staging',
      },
      t,
    );
    expect(rendered.subject).toBe(
      `[${BRAND.displayName} staging] Cost projection over threshold: storage`,
    );
    expect(rendered.text.split('\n')[0]).toBe(
      'The buckets hold 700 GB, projected to cost $10.50 a month, over the threshold of $10 a month.',
    );
  });

  it('each cost line reads its numbers in its units', () => {
    const body = (values: Record<string, string | number>): string =>
      renderOpsAlert({ kind: 'cost_projection', values, env: 'ci' }, t).text.split('\n')[0] ?? '';
    expect(body({ line: 'storage', value: BYTES_PER_GB, projected: 2, threshold: 1000 })).toBe(
      'The buckets hold 1 GB, projected to cost $0.02 a month, over the threshold of $10 a month.',
    );
    expect(
      body({
        line: 'upload_growth',
        value: 3_333_333_334,
        projected: 100_000_000_020,
        threshold: 100_000_000_000,
      }),
    ).toBe(
      'Uploads in the last 24 hours came to 3.33 GB, projected at 100 GB a month, over the ' +
        'threshold of 100 GB a month.',
    );
    expect(body({ line: 'email_month', value: 800, projected: 2400, threshold: 2400 })).toBe(
      '800 emails were sent so far this month (UTC), projected at 2,400 for the month, at or ' +
        'over the threshold of 2,400 emails a month.',
    );
    expect(body({ line: 'email_day', value: 80, projected: 80, threshold: 80 })).toBe(
      '80 emails were sent yesterday (UTC), at or over the threshold of 80 emails a day.',
    );
    expect(body({ line: 'signin_ceiling', value: 1000, projected: 1000, threshold: 1000 })).toBe(
      '1,000 sign-in code emails were sent in one UTC day, at or over the threshold of 1,000 a day.',
    );
  });

  it('every cost line has a body with its units', () => {
    // The job's lines, and the API's same-day sign-in alert.
    const lines = [...COST_LINES.map((line) => line.line), 'signin_ceiling'];
    for (const line of lines) {
      const { text } = renderOpsAlert(
        {
          kind: 'cost_projection',
          values: { line, value: 1, projected: 1, threshold: 1 },
          env: 'ci',
        },
        t,
      );
      expect({ line, generic: text.startsWith(`${line} is at `) }).toEqual({
        line,
        generic: false,
      });
    }
  });

  it('a line with no body of its own reads the numbers as sent', () => {
    const rendered = renderOpsAlert(
      {
        kind: 'cost_projection',
        values: { line: 'other', value: 5, projected: 7, threshold: 6 },
        env: 'ci',
      },
      t,
    );
    expect(rendered.text.split('\n')[0]).toBe(
      'other is at 5 and projected at 7, over its threshold of 6.',
    );
  });

  it('renders the bundle alerts', () => {
    const bundleId = '0195d2c4-0000-7000-8000-000000000002';
    const version = '20270115T060000Z-full';
    const cases = [
      { kind: 'bundle_stale', values: { hoursSince: 49 }, shows: '49' },
      { kind: 'bundle_rejected', values: { bundleId, version, gate: 'checksums' }, shows: version },
      { kind: 'bundle_held', values: { bundleId, version }, shows: version },
    ] as const;
    for (const { kind, values, shows } of cases) {
      const rendered = renderOpsAlert({ kind, values, env: 'staging' }, t);
      expect(rendered.subject.startsWith(`[${BRAND.displayName} staging] `), kind).toBe(true);
      expect(rendered.subject, kind).toContain(shows);
      for (const part of [rendered.subject, rendered.text, rendered.html]) {
        expect(part, kind).not.toContain('{{');
        expect(part, kind).not.toContain('opsAlert');
      }
    }
    expect(
      renderOpsAlert({ kind: 'bundle_stale', values: { hoursSince: 49 }, env: 'staging' }, t).text,
    ).toContain('No full data bundle has loaded for 49 hours.');
    expect(
      renderOpsAlert(
        { kind: 'bundle_rejected', values: { bundleId, version, gate: 'checksums' }, env: 'ci' },
        t,
      ).text,
    ).toContain(`Bundle ${version} failed the gate checksums. The last good data stays loaded.`);
    expect(
      renderOpsAlert({ kind: 'bundle_held', values: { bundleId, version }, env: 'ci' }, t).subject,
    ).toBe(`[${BRAND.displayName} ci] Bundle ${version} waits for approval`);
  });
});
