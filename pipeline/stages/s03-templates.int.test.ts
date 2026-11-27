import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StateRules } from '@citizenrun/rules';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bucketKeys } from '../lib/bucket.ts';
import type { DataBucket } from '../lib/bucket.ts';
import { StageFailedSchema, readStageRows, runStage } from '../lib/runner.ts';
import type { Fetcher } from '../lib/fetch/types.ts';
import { citedNodes } from '../templates/cited.ts';
import { fakeFetcher, fixtureContext } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import type { FakeAnswer } from '../templates/__fixtures__/zz-fake-fetcher.ts';
import { ZZ_RULES } from '../templates/__fixtures__/zz-rules.ts';
import { QuoteRowSchema, TemplateOutputSchema, readTemplateOutput } from '../templates/output.ts';
import { getTestBucket, resetStorage, testRunId } from '../testing/setup.ts';
import { S03_FILES, checkTemplates, makeS03Templates } from './s03-templates.ts';
import type { S03Deps } from './s03-templates.ts';
import { repoRoot } from './shared/repo.ts';
import { loadReferenceIds } from './shared/reference.ts';

const FIXTURES = join(import.meta.dirname, '..', 'templates', '__fixtures__');
const CODE_URL = 'https://example.test/zz/code';

let dir: string;
let statutes: string;

beforeEach(async () => {
  await resetStorage();
  dir = await mkdtemp(join(tmpdir(), 's03-templates-'));
  await copyFile(join(FIXTURES, 'zz-template.yaml'), join(dir, 'zz.yaml'));
  statutes = await readFile(join(FIXTURES, 'zz-statutes.html'), 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deps(
  rulesFor: (state: string) => StateRules | null = (st) => (st === 'ZZ' ? ZZ_RULES : null),
): S03Deps {
  return { templatesDir: dir, rulesFor, loadReference: () => loadReferenceIds(repoRoot()) };
}

function context(bucket: DataBucket, fetcher: Fetcher, now = '2026-11-21T20:00:00.000Z') {
  return fixtureContext({ bucket, fetcher, now: new Date(now), runId: testRunId() });
}

function statutePage(): Record<string, FakeAnswer> {
  return { [CODE_URL]: { body: statutes, contentType: 'text/html; charset=utf-8' } };
}

describe('stage 3', () => {
  it('writes the template and quote files with every quote grounded', async () => {
    const { bucket } = await getTestBucket('data');
    const fetcher = fakeFetcher(bucket, statutePage());
    const ctx = context(bucket, fetcher);
    const result = await runStage(makeS03Templates(deps()), ctx, 'all', { dryRun: false });
    expect(result.exitCode).toBe(0);
    expect(fetcher.requests).toHaveLength(1);
    expect(fetcher.requests[0]).toMatchObject({ url: CODE_URL, class: 'crawl', state: 'ZZ' });

    const output = await readTemplateOutput(ctx, 'ZZ');
    expect(output).not.toBeNull();
    expect(TemplateOutputSchema.parse(output)).toEqual(output);
    if (output === null) {
      return;
    }
    expect(output.checked_at).toBe('2026-11-21T20:00:00.000Z');
    const nodes = citedNodes(output.template);
    expect(nodes.length).toBeGreaterThan(30);
    for (const { path } of nodes) {
      expect(output.grounded[path]).toMatchObject({
        grounded: true,
        reason: 'grounded',
        checked_at: output.checked_at,
      });
    }
    expect(Object.keys(output.grounded)).toHaveLength(nodes.length);

    const rows = [];
    for await (const row of readStageRows(
      bucket,
      's03-templates',
      'ZZ',
      S03_FILES.quotes,
      QuoteRowSchema,
    )) {
      rows.push(row);
    }
    expect(rows).toHaveLength(nodes.length);
    expect(rows.map((row) => row.path)).toEqual(
      nodes.map((n) => n.path).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
    );
    expect(rows.every((row) => row.grounded && !('quote' in row))).toBe(true);
  });

  it('a refused fetch on a later run carries the earlier grounding', async () => {
    const { bucket } = await getTestBucket('data');
    await runStage(
      makeS03Templates(deps()),
      context(bucket, fakeFetcher(bucket, statutePage())),
      ['ZZ'],
      { dryRun: false },
    );
    const refused = fakeFetcher(bucket, {
      [CODE_URL]: { kind: 'disallowed', reason: 'daily_cap' },
    });
    const later = context(bucket, refused, '2026-11-24T15:00:00.000Z');
    expect(
      (await runStage(makeS03Templates(deps()), later, ['ZZ'], { dryRun: false })).exitCode,
    ).toBe(0);
    const output = await readTemplateOutput(later, 'ZZ');
    const marks = Object.values(output?.grounded ?? {});
    expect(marks.length).toBeGreaterThan(30);
    expect(
      marks.every(
        (m) => m.grounded && m.reason === 'carried' && m.checked_at === '2026-11-21T20:00:00.000Z',
      ),
    ).toBe(true);
    expect(output?.checked_at).toBe('2026-11-24T15:00:00.000Z');
  });

  it('an invalid template fails template_valid and keeps the last good output', async () => {
    const { bucket } = await getTestBucket('data');
    const first = context(bucket, fakeFetcher(bucket, statutePage()));
    await runStage(makeS03Templates(deps()), first, ['ZZ'], { dryRun: false });
    const before = await readTemplateOutput(first, 'ZZ');
    expect(before).not.toBeNull();

    const text = await readFile(join(dir, 'zz.yaml'), 'utf8');
    await writeFile(
      join(dir, 'zz.yaml'),
      text.replace('power: zoning-land-use', 'power: no-such-power'),
    );
    const second = context(bucket, fakeFetcher(bucket, statutePage()), '2026-11-22T20:00:00.000Z');
    const result = await runStage(makeS03Templates(deps()), second, ['ZZ'], { dryRun: false });
    expect(result.exitCode).toBe(1);
    expect(result.summaries[0]?.failedChecks).toEqual(['template_valid']);
    const failed = await bucket.getJson(
      bucketKeys.stageFailed('s03-templates', 'ZZ', second.runId),
      StageFailedSchema,
    );
    expect(failed?.checks).toEqual([
      {
        name: 'template_valid',
        passed: false,
        detail: 'errors=1 paths=government_types.0.offices.0.powers.0.power',
      },
    ]);
    expect(await readTemplateOutput(second, 'ZZ')).toEqual(before);
  });

  it('templates without a registered module fail', async () => {
    const { bucket } = await getTestBucket('data');
    const ctx = context(bucket, fakeFetcher(bucket, statutePage()));
    const result = await runStage(makeS03Templates(deps(() => null)), ctx, ['ZZ'], {
      dryRun: false,
    });
    expect(result.summaries[0]?.failedChecks).toEqual(['template_valid']);
    const failed = await bucket.getJson(
      bucketKeys.stageFailed('s03-templates', 'ZZ', ctx.runId),
      StageFailedSchema,
    );
    expect(failed?.checks[0]?.detail).toBe('errors=1 paths=rules_module');
    expect(await readTemplateOutput(ctx, 'ZZ')).toBeNull();
  });

  it('checkTemplates reports a misnamed file', async () => {
    await copyFile(join(FIXTURES, 'zz-template.yaml'), join(dir, 'zz-old.yaml'));
    // In byte order of the file names: `zz-old.yaml` sorts before `zz.yaml`.
    expect(await checkTemplates(deps())).toEqual([
      {
        state: 'zz-old',
        ok: false,
        errors: [{ path: 'file', message: 'a template file is named <st>.yaml' }],
      },
      { state: 'ZZ', ok: true, errors: [] },
    ]);
  });
});
