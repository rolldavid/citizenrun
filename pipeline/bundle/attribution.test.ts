import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BRAND, BundleManifestSchema, SOURCE_CREDITS } from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { loadSources } from '../lib/data-files.ts';
import type { BoundarySource, SourceEntry } from '../lib/data-files.ts';
import { repoRoot } from '../lib/paths.ts';
import { TIMEZONE_DATASET } from '../lib/timezones.ts';
import { emptyRows } from './assemble.ts';
import {
  PHOTO_SENTENCE,
  renderBundleAttribution,
  renderRootAttribution,
  sourceCredits,
  usedHosts,
  usedRegisterDatasets,
} from './attribution.ts';
import { district, jurisdiction } from './testing/rows.ts';

function manifest(datasets: BundleManifest['datasets']): BundleManifest {
  return BundleManifestSchema.parse({
    format: 'citizenrun-bundle',
    kind: 'full',
    version: '20261126T120000Z-full',
    schema_version: 1,
    schema_revision: 0,
    created_at: '2026-11-26T12:00:00.000Z',
    git_sha: '0'.repeat(40),
    geometry_version: '20261126T120000Z-geometry',
    tiger_vintage: null,
    states: ['ZZ'],
    files: [],
    assets: [],
    datasets,
    checks: [],
    filing_sources: [],
    two_source_fields: 0,
    coverage_path: null,
    attribution_path: 'ATTRIBUTION.md',
  });
}

describe('attribution', () => {
  it("sourceCredits returns one entry per dataset and photo source of data/sources.yaml, in the file's order", async () => {
    const sources = await loadSources();
    const credited = sources.filter(
      (entry) => (entry.kind === 'dataset' || entry.kind === 'photo_source') && !entry.forbidden,
    );
    const credits = sourceCredits();
    expect(credits).toHaveLength(credited.length);
    credited.forEach((entry, i) => {
      expect(credits[i]).toEqual({
        name: entry.attribution ?? entry.publisher,
        url: `${new URL(entry.url).origin}/`,
      });
    });
    expect(sourceCredits(sources)).toEqual(credits);
  });

  it("every credit name appears in the bundle's ATTRIBUTION.md", async () => {
    const sources = await loadSources();
    const datasets: BundleManifest['datasets'] = {};
    for (const entry of sources.filter((e) => e.kind === 'dataset')) {
      datasets[entry.id] = { edition: '2026', downloaded_on: '2026-11-26', source_url: entry.url };
    }
    const text = renderBundleAttribution(manifest(datasets), sources, new Set());
    for (const credit of sourceCredits(sources)) {
      expect(text).toContain(credit.name);
    }
    expect(text.startsWith('# Data attribution\n')).toBe(true);
    expect(text).toContain(
      `${BRAND.displayName} data bundle 20261126T120000Z-full, built 2026-11-26.`,
    );
    expect(text).toContain('Creative Commons Attribution 4.0 International licence (CC BY 4.0)');
    expect(text).toContain('## State and local sources\n\nNone in this bundle.');
    expect(text).toMatch(
      /- U\.S\. Census Bureau\. TIGER\/Line Shapefiles 2026, edition 2026, downloaded 2026-11-26\. Licence: LicenseRef-PD-USGov\. Source: https:/,
    );
  });

  it("every credit name appears in the sample bundle's ATTRIBUTION.md", async () => {
    const text = await readFile(
      join(repoRoot(), 'packages', 'db', 'src', 'seed', 'sample-bundle', 'full', 'ATTRIBUTION.md'),
      'utf8',
    );
    for (const credit of sourceCredits()) {
      expect(text).toContain(credit.name);
    }
  });

  it("a jurisdiction's zone credits the time-zone register's dataset, which no manifest names", async () => {
    const sources = await loadSources();
    const register = sources.find((entry) => entry.id === TIMEZONE_DATASET);
    if (register === undefined) throw new Error(`${TIMEZONE_DATASET} is not in data/sources.yaml`);
    expect(register.kind).toBe('dataset');
    const zoned = {
      ...emptyRows(),
      jurisdictions: [jurisdiction('state:ZZ', { timezone: 'America/New_York' })],
    };
    expect([...usedRegisterDatasets(zoned)]).toEqual([TIMEZONE_DATASET]);
    const text = renderBundleAttribution(
      manifest({}),
      sources,
      new Set(),
      usedRegisterDatasets(zoned),
    );
    expect(text).toContain(
      `- ${register.attribution ?? register.publisher}. ${register.name}. Licence: ${register.licence_spdx ?? 'no licence stated'}. Source: ${register.url}`,
    );
    const unzoned = { ...emptyRows(), jurisdictions: [jurisdiction('state:ZZ')] };
    expect(usedRegisterDatasets(unzoned).size).toBe(0);
    expect(
      renderBundleAttribution(manifest({}), sources, new Set(), usedRegisterDatasets(unzoned)),
    ).not.toContain(register.name);
  });

  it('the root ATTRIBUTION.md matches data/sources.yaml', async () => {
    const committed = await readFile(join(repoRoot(), 'ATTRIBUTION.md'), 'utf8');
    expect(committed).toBe(renderRootAttribution(await loadSources()));
  });

  it('SOURCE_CREDITS matches sourceCredits()', () => {
    expect(SOURCE_CREDITS).toEqual(sourceCredits());
  });

  it('data/LICENSE holds the CC BY 4.0 legal code', async () => {
    const text = await readFile(join(repoRoot(), 'data', 'LICENSE'), 'utf8');
    expect(text).toContain('Attribution 4.0 International');
    expect(text).toContain('Creative Commons Attribution 4.0 International Public License');
    expect(text).not.toContain('\r');
  });

  it('the attribution names the photo licence rule', async () => {
    const text = renderBundleAttribution(manifest({}), await loadSources(), new Set());
    expect(text).toContain(PHOTO_SENTENCE);
    expect(PHOTO_SENTENCE).toBe(
      "Photos and other third-party media are outside the data licence and keep their own licences; each photo's author, licence and source are given with it.",
    );
  });

  it("a ward layer is credited through its host's crawl_host entry", async () => {
    const layer: BoundarySource = {
      key: 'zz-fixture-wards',
      place_geoid: '9900100',
      url: 'https://gis.example.test/wards/FeatureServer/0',
      publisher: 'Fixture City',
      licence_text: 'Public domain',
      retrieved_on: '2026-11-26',
      label_field: 'DISTRICT',
      format: 'geojson',
    };
    const host: SourceEntry = {
      id: 'zz-fixture-gis',
      kind: 'crawl_host',
      name: 'Fixture City GIS server',
      publisher: 'Fixture City',
      url: 'https://gis.example.test/',
      terms_url: null,
      terms_read_on: null,
      basis: 'A fixture.',
      licence_spdx: null,
      attribution: 'Fixture City GIS',
      robots_checked_on: null,
      ci_status: 'unknown',
      notes: null,
      forbidden: false,
      results_host: false,
    };
    const sources = [...(await loadSources()), host];
    const withWard = { ...emptyRows(), districts: [district('ward:9900100:district-2')] };
    const hosts = usedHosts(withWard, [layer]);
    expect(hosts.has('gis.example.test')).toBe(true);
    const text = renderBundleAttribution(manifest({}), sources, hosts);
    expect(text).toContain(
      '- Fixture City GIS. Fixture City GIS server. Source: https://gis.example.test/',
    );
    const without = usedHosts({ ...emptyRows(), districts: [district('tiger:place:9900100')] }, [
      layer,
    ]);
    expect(without.has('gis.example.test')).toBe(false);
    expect(renderBundleAttribution(manifest({}), sources, without)).not.toContain(
      'Fixture City GIS',
    );
  });
});
