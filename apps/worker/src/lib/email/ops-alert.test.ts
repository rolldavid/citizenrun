import { BRAND, EMAIL_STYLES, createI18n } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
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
});
