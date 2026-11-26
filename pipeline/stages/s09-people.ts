// Stage 9 (PIPE-people-photos): officeholders with licence-checked photos, statewide holders,
// every person's aliases and, under `US`, the national given-name aliases.
import { BPersonSchema } from '@citizenrun/shared';
import type { BPerson, PhotoRecord } from '@citizenrun/shared';
import { bucketKeys } from '../lib/bucket.ts';
import { loadParties, loadSources } from '../lib/data-files.ts';
import type { RunContext, StageModule, StageResult } from '../lib/runner.ts';
import { DatasetUnavailableError, datasetEntry } from '../sources/dataset.ts';
import { NICKNAMES_DATASET, NicknamesUnpinnedError, loadNicknames } from '../sources/nicknames.ts';
import { OPENSTATES_PEOPLE_DATASET, loadExecutives } from '../sources/openstates-executive.ts';
import type { ExecutivePerson } from '../sources/openstates-executive.ts';
import { WikidataQueryError, currentHolders } from '../sources/wikidata.ts';
import type { WikidataHolder } from '../sources/wikidata.ts';
import { readTemplateOutput } from '../templates/output.ts';
import { buildHolders, executiveRoleOf, statewideOffices } from './people/holders.ts';
import { ASSET_PREFIX, photosDetail, resolvePhotos } from './people/photos.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from './shared/office-ref.ts';
import { PERSON_SOURCES_FILE, PersonSourceRowSchema } from './shared/person-source.ts';
import { StageFileInvalid, listStageStates, loadStageRows } from './shared/stage-io.ts';

export const S09_FILES = {
  people: 'people',
  personAliases: 'person_aliases',
  officeholders: 'officeholders',
  assets: 'assets',
  givenNameAliases: 'given_name_aliases',
} as const;

const NICKNAMES_UNPINNED = 'nicknames_unpinned';
const DATASET_UNAVAILABLE = 'dataset_unavailable';
const WIKIDATA_SOURCE_URL = 'https://query.wikidata.org/';

export type S09Deps = {
  /** The api.data.gov key (OI-datagov-key), from the run's environment; null skips step 2. */
  readonly fecApiKey: (ctx: RunContext) => string | null;
  /** The `nicknames` entry's pinned `names.csv` URL. */
  readonly nicknamesUrl: () => Promise<string>;
};

/** One `assets.ndjson.gz` row: a photo file the output's people use. */
export type AssetRow = {
  path: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  content_type: 'image/jpeg';
};

function failed(name: string, detail: string): StageResult {
  return { files: [], checks: [{ name, passed: false, detail }], datasets: {} };
}

async function runNational(
  ctx: RunContext,
  deps: S09Deps,
  opts: Parameters<StageModule['run']>[2],
): Promise<StageResult> {
  let loaded;
  try {
    loaded = await loadNicknames(ctx, await deps.nicknamesUrl());
  } catch (error) {
    if (error instanceof NicknamesUnpinnedError) {
      return failed(NICKNAMES_UNPINNED, 'the nicknames url names no 40-hex commit');
    }
    if (error instanceof DatasetUnavailableError) {
      return failed(`${DATASET_UNAVAILABLE}:${error.dataset}`, error.reason);
    }
    throw error;
  }
  const file = await opts.out.writeRows(S09_FILES.givenNameAliases, loaded.rows);
  return {
    files: [file],
    checks: [
      { name: NICKNAMES_UNPINNED, passed: true, detail: `commit=${loaded.commit}` },
      {
        name: 'given_name_aliases',
        passed: true,
        detail: `rows=${String(loaded.rows.length)} dropped=${String(loaded.dropped)}`,
      },
    ],
    datasets: { [NICKNAMES_DATASET]: datasetEntry(ctx, NICKNAMES_DATASET, loaded.commit) },
  };
}

async function previousPhotos(
  ctx: RunContext,
  state: string,
): Promise<ReadonlyMap<string, PhotoRecord>> {
  let rows: readonly BPerson[] | null;
  try {
    rows = await loadStageRows(ctx, 's09-people', state, S09_FILES.people, BPersonSchema);
  } catch (error) {
    if (error instanceof StageFileInvalid) {
      ctx.log.warn('people.previous_unreadable', { state });
      return new Map();
    }
    throw error;
  }
  const photos = new Map<string, PhotoRecord>();
  for (const person of rows ?? []) {
    if (person.photo !== null) {
      photos.set(person.source_key, person.photo);
    }
  }
  return photos;
}

async function assetRows(ctx: RunContext, people: readonly BPerson[]): Promise<AssetRow[]> {
  const rows = new Map<string, AssetRow>();
  for (const person of people) {
    const photo = person.photo;
    if (photo === null || !photo.asset.startsWith(ASSET_PREFIX)) {
      continue;
    }
    const sha256 = photo.asset.slice(ASSET_PREFIX.length, -'.jpg'.length);
    const key = bucketKeys.asset('photos', sha256, 'jpg');
    if (rows.has(key)) {
      continue;
    }
    const head = await ctx.bucket.head(key);
    if (head === null) {
      // A previous photo whose file is gone is not listed; the bundle writer's integrity check sees it.
      ctx.log.warn('people.asset_missing', { objectKey: key });
      continue;
    }
    rows.set(key, {
      path: key,
      sha256,
      bytes: head.size,
      width: photo.width,
      height: photo.height,
      content_type: 'image/jpeg',
    });
  }
  return [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function runState(
  ctx: RunContext,
  deps: S09Deps,
  state: string,
  opts: Parameters<StageModule['run']>[2],
): Promise<StageResult> {
  const knownPeople = (await loadStageRows(ctx, 's02-known', state, 'people', BPersonSchema)) ?? [];
  const knownSources =
    (await loadStageRows(ctx, 's02-known', state, PERSON_SOURCES_FILE, PersonSourceRowSchema)) ??
    [];
  const coopPeople = (await loadStageRows(ctx, 's02-coops', state, 'people', BPersonSchema)) ?? [];
  const template = await readTemplateOutput(ctx, state);
  const officeRefs =
    (await loadStageRows(ctx, 's04-expand', state, OFFICE_REFS_FILE, OfficeRefRowSchema)) ?? [];
  const offices = statewideOffices(state, template, officeRefs);
  const datasets: Record<string, StageResult['datasets'][string]> = {};

  // The executive files are read only when the state has an office they hold.
  let executives: readonly ExecutivePerson[] = [];
  if (offices.some(({ entry }) => executiveRoleOf(entry) !== null)) {
    try {
      const loaded = await loadExecutives(ctx);
      executives = loaded.people.filter((person) => person.state === state);
      datasets[OPENSTATES_PEOPLE_DATASET] = {
        ...datasetEntry(ctx, OPENSTATES_PEOPLE_DATASET, loaded.edition),
        edition: loaded.commit,
      };
    } catch (error) {
      if (error instanceof DatasetUnavailableError) {
        return failed(`${DATASET_UNAVAILABLE}:${error.dataset}`, error.reason);
      }
      throw error;
    }
  }

  const wikidata = new Map<string, readonly WikidataHolder[]>();
  let wikidataFailed = 0;
  for (const { entry } of offices) {
    if (executiveRoleOf(entry) !== null || entry.wikidata_position === null) {
      continue;
    }
    try {
      wikidata.set(entry.key, await currentHolders(ctx, entry.wikidata_position));
    } catch (error) {
      if (error instanceof WikidataQueryError) {
        wikidataFailed += 1;
        ctx.log.warn('people.wikidata_failed', { state, reason: error.reason });
        continue;
      }
      throw error;
    }
  }
  if (wikidata.size > 0) {
    datasets.wikidata = {
      edition: ctx.today,
      downloaded_on: ctx.today,
      source_url: WIKIDATA_SOURCE_URL,
    };
  }

  const built = buildHolders({
    state,
    today: ctx.today,
    now: ctx.now,
    knownPeople,
    knownSources,
    coopPeople,
    template,
    officeRefs,
    executives,
    wikidata,
    parties: await loadParties(),
  });
  const outcomes = await resolvePhotos(
    ctx,
    built.candidates,
    await previousPhotos(ctx, state),
    deps.fecApiKey(ctx),
  );
  const photoOf = new Map(outcomes.map((outcome) => [outcome.personKey, outcome.photo]));
  const people = built.people.map((person) =>
    BPersonSchema.parse({ ...person, photo: photoOf.get(person.source_key) ?? null }),
  );
  const assets = await assetRows(ctx, people);

  const files = [
    await opts.out.writeRows(S09_FILES.people, people),
    await opts.out.writeRows(S09_FILES.personAliases, built.aliases),
    await opts.out.writeRows(S09_FILES.officeholders, built.officeholders),
    await opts.out.writeRows(S09_FILES.assets, assets),
  ];
  const count = (name: string) => String(built.counts[name] ?? 0);
  return {
    files,
    checks: [
      { name: 'photos', passed: true, detail: photosDetail(outcomes) },
      {
        name: 'holders',
        passed: true,
        detail:
          `statewide=${count('statewide')} wikidata_ambiguous=${count('wikidata_ambiguous')} ` +
          `executives=${count('executives')} executive_ambiguous=${count('executive_ambiguous')} ` +
          `wikidata=${count('wikidata')} wikidata_failed=${String(wikidataFailed)}`,
      },
    ],
    datasets,
  };
}

/** Stage 9 with its key and its nicknames URL given. */
export function makeS09People(deps: S09Deps): StageModule {
  return {
    id: 's09-people',
    milestone: 2,
    blockingChecks: [NICKNAMES_UNPINNED, DATASET_UNAVAILABLE],
    async states(ctx) {
      const found = new Set([
        ...(await listStageStates(ctx, 's02-known')),
        ...(await listStageStates(ctx, 's02-coops')),
      ]);
      found.delete('US');
      return [...[...found].sort(), 'US'];
    },
    run(ctx, state, opts) {
      return state === 'US' ? runNational(ctx, deps, opts) : runState(ctx, deps, state, opts);
    },
  };
}

class NicknamesEntryMissingError extends Error {
  override readonly name = 'NicknamesEntryMissingError';

  constructor() {
    super('data/sources.yaml has no nicknames entry');
  }
}

/** Stage 9 with the run's FEC_API_KEY (read by loadEnv) and the registered nicknames URL. */
export const s09People: StageModule = makeS09People({
  fecApiKey: (ctx) => ctx.env.FEC_API_KEY,
  async nicknamesUrl() {
    const entry = (await loadSources()).find((source) => source.id === NICKNAMES_DATASET);
    if (entry === undefined) {
      throw new NicknamesEntryMissingError();
    }
    return entry.url;
  },
});
