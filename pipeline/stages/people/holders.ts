// The pure core of stage 9's holders (PIPE-people-photos): stage 2's people re-emitted, the
// statewide holders of a template's statewide offices (D-315) from the Open States executive files
// and Wikidata, every person's aliases, and the photo candidates.
import {
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  parseName,
  personSlug,
} from '@citizenrun/shared';
import type { BOfficeholder, BPerson, BPersonAlias } from '@citizenrun/shared';
import type { PartiesFile } from '../../lib/data-files.ts';
import { normaliseParty } from '../../lib/party.ts';
import { executiveOfficeType, isCurrentRole } from '../../sources/openstates-executive.ts';
import type { ExecutiveOfficeType, ExecutivePerson } from '../../sources/openstates-executive.ts';
import type { WikidataHolder } from '../../sources/wikidata.ts';
import { wikipediaTitle } from '../../sources/wikimedia.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import type { OfficeEntry } from '../../templates/schema.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import type { PersonSourceRow } from '../shared/person-source.ts';
import type { PhotoCandidate } from './photos.ts';

export type PeopleInput = {
  readonly state: string;
  readonly today: string;
  readonly now: Date;
  readonly knownPeople: readonly BPerson[]; // stage-out/s02-known/<ST>/
  readonly knownSources: readonly PersonSourceRow[];
  readonly coopPeople: readonly BPerson[]; // stage-out/s02-coops/<ST>/
  readonly template: TemplateOutput | null; // stage-out/s03-templates/<ST>/
  readonly officeRefs: readonly OfficeRefRow[]; // stage-out/s04-expand/<ST>/
  readonly executives: readonly ExecutivePerson[]; // already filtered to the state's folder
  readonly wikidata: ReadonlyMap<string, readonly WikidataHolder[]>; // by template entry key
  readonly parties: PartiesFile; // data/parties.yaml, for normaliseParty
};

export type HoldersOutput = {
  readonly people: readonly BPerson[];
  readonly aliases: readonly BPersonAlias[];
  readonly officeholders: readonly BOfficeholder[];
  readonly candidates: readonly PhotoCandidate[];
  readonly counts: Record<string, number>;
};

const LIEUTENANT_GOVERNOR = /lieutenant governor/i;

/** The executive role a statewide entry is held by, or null for an entry Open States does not list. */
export function executiveRoleOf(
  entry: Pick<OfficeEntry, 'office_type' | 'title'>,
): ExecutiveOfficeType | null {
  switch (entry.office_type) {
    case 'governor':
    case 'secretary-of-state':
    case 'attorney-general':
      return entry.office_type;
    case 'statewide-executive-other':
      return LIEUTENANT_GOVERNOR.test(entry.title) ? 'lieutenant_governor' : null;
    default:
      return null;
  }
}

/** A statewide entry and the stage 4 office it made. */
export type StatewideOffice = { readonly entry: OfficeEntry; readonly ref: OfficeRefRow };

/** The template's statewide entries that stage 4's `office_refs` holds an office for. */
export function statewideOffices(
  state: string,
  template: TemplateOutput | null,
  officeRefs: readonly OfficeRefRow[],
): readonly StatewideOffice[] {
  if (template === null) {
    return [];
  }
  const out: StatewideOffice[] = [];
  for (const entry of template.template.statewide) {
    const ref = officeRefs.find(
      (row) =>
        row.origin === 's04-expand' &&
        row.jurisdiction_key === `state:${state}` &&
        row.template_key === entry.key,
    );
    if (ref !== undefined) {
      out.push({ entry, ref });
    }
  }
  return out;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

const nullIfBlank = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim() === '' ? null : value.trim();

function newPerson(opts: {
  key: string;
  name: string;
  first: string | null;
  middle: string | null;
  last: string | null;
  suffix: string | null;
  party: string | null;
  dataset: string;
}): BPerson {
  return BPersonSchema.parse({
    source_key: opts.key,
    slug: personSlug(opts.name, opts.key),
    name: opts.name,
    first_name: opts.first,
    middle_name: opts.middle,
    last_name: opts.last,
    suffix: opts.suffix,
    party: opts.party,
    photo: null,
    website: null,
    roster_only: false,
    origin: { created_by: 'bundle', key: opts.key, datasets: [opts.dataset] },
  });
}

function executivePerson(person: ExecutivePerson, parties: PartiesFile): BPerson {
  const key = `openstates:${person.id}`;
  const parsed = parseName(person.name, 'first_last');
  return newPerson({
    key,
    name: person.name,
    first: person.givenName ?? parsed.first,
    middle: person.givenName === null && person.familyName === null ? parsed.middle : null,
    last: person.familyName ?? parsed.last,
    suffix: person.familyName === null ? parsed.suffix : null,
    party: person.party === null ? null : normaliseParty(person.party, parties),
    dataset: 'openstates-people',
  });
}

function wikidataPerson(holder: WikidataHolder): BPerson {
  const parts = parseName(holder.label, 'first_last');
  return newPerson({
    key: `wikidata:${holder.personQid}`,
    name: holder.label,
    first: parts.first,
    middle: parts.middle,
    last: parts.last,
    suffix: parts.suffix,
    party: null,
    dataset: 'wikidata',
  });
}

function titlesOf(urls: readonly string[]): string[] {
  const titles: string[] = [];
  for (const url of urls) {
    const title = wikipediaTitle(url);
    if (title !== null && !titles.includes(title)) {
      titles.push(title);
    }
  }
  return titles;
}

function officeholder(ref: OfficeRefRow, personKey: string): BOfficeholder {
  return BOfficeholderSchema.parse({
    source_key: `${ref.slug}|${personKey}|`,
    office_key: ref.slug,
    person_key: personKey,
    seat_label: null,
    since: null,
    until: null,
    seat_up_next: null,
    term_limited: null,
    not_running: null,
    cash_on_hand_cents: null,
    cash_as_of: null,
    cash_source_url: null,
  });
}

/**
 * Stage 9's people, aliases, statewide officeholders and photo candidates for one state. Stage 2's
 * people are re-emitted unchanged (their officeholders stay stage 2's); a statewide office with
 * more holders than seats gets none (never a guess); co-op directors get no photo candidate.
 */
export function buildHolders(input: PeopleInput): HoldersOutput {
  const counts: Record<string, number> = {
    statewide: 0,
    executives: 0,
    executive_ambiguous: 0,
    wikidata: 0,
    wikidata_ambiguous: 0,
  };
  const people = new Map<string, BPerson>();
  for (const person of [...input.knownPeople, ...input.coopPeople]) {
    if (!people.has(person.source_key)) {
      people.set(person.source_key, person);
    }
  }
  const sources = new Map(input.knownSources.map((row) => [row.person_key, row]));
  const candidates = new Map<string, { bioguide: string | null; titles: string[] }>();
  for (const person of input.knownPeople) {
    const row = sources.get(person.source_key);
    candidates.set(person.source_key, {
      bioguide: row?.bioguide ?? null,
      titles: titlesOf(row?.wikipedia_urls ?? []),
    });
  }
  const addCandidateTitles = (key: string, titles: readonly string[]) => {
    const known = candidates.get(key);
    if (known === undefined) {
      candidates.set(key, { bioguide: null, titles: [...titles] });
      return;
    }
    for (const title of titles) {
      if (!known.titles.includes(title)) {
        known.titles.push(title);
      }
    }
  };

  const officeholders = new Map<string, BOfficeholder>();
  for (const { entry, ref } of statewideOffices(input.state, input.template, input.officeRefs)) {
    const role = executiveRoleOf(entry);
    const held: { person: BPerson; titles: readonly string[] }[] = [];
    if (role !== null) {
      const holders = input.executives.filter((person) =>
        person.roles.some(
          (r) => executiveOfficeType(r.type) === role && isCurrentRole(r, input.today),
        ),
      );
      if (holders.length > ref.seats) {
        counts.executive_ambiguous = (counts.executive_ambiguous ?? 0) + 1;
        continue;
      }
      for (const person of holders) {
        held.push({
          person: executivePerson(person, input.parties),
          titles: titlesOf([...person.links, ...person.sources]),
        });
      }
      counts.executives = (counts.executives ?? 0) + holders.length;
    } else if (entry.wikidata_position !== null) {
      const holders = input.wikidata.get(entry.key);
      if (holders === undefined) {
        continue;
      }
      if (holders.length > ref.seats) {
        counts.wikidata_ambiguous = (counts.wikidata_ambiguous ?? 0) + 1;
        continue;
      }
      for (const holder of holders) {
        held.push({
          person: wikidataPerson(holder),
          titles: holder.enwikiTitle === null ? [] : [holder.enwikiTitle],
        });
      }
      counts.wikidata = (counts.wikidata ?? 0) + holders.length;
    }
    for (const { person, titles } of held) {
      if (!people.has(person.source_key)) {
        people.set(person.source_key, person);
      }
      addCandidateTitles(person.source_key, titles);
      const row = officeholder(ref, person.source_key);
      if (!officeholders.has(row.source_key)) {
        officeholders.set(row.source_key, row);
        counts.statewide = (counts.statewide ?? 0) + 1;
      }
    }
  }

  const aliases = new Map<string, BPersonAlias>();
  for (const person of people.values()) {
    const values = [
      person.name,
      person.first_name !== null && person.last_name !== null
        ? `${person.first_name} ${person.last_name}`
        : null,
      sources.get(person.source_key)?.nickname_alias ?? null,
    ];
    for (const value of values) {
      const alias = nullIfBlank(value)?.replace(/\s+/g, ' ');
      if (alias === undefined) {
        continue;
      }
      const sourceKey = `${person.source_key}|${alias}`;
      if (!aliases.has(sourceKey)) {
        aliases.set(
          sourceKey,
          BPersonAliasSchema.parse({ source_key: sourceKey, person_key: person.source_key, alias }),
        );
      }
    }
  }

  const sortBy = <T extends { source_key: string }>(rows: Iterable<T>): T[] =>
    [...rows].sort((a, b) => byteOrder(a.source_key, b.source_key));
  return {
    people: sortBy(people.values()),
    aliases: sortBy(aliases.values()),
    officeholders: sortBy(officeholders.values()),
    candidates: [...candidates]
      .sort(([a], [b]) => byteOrder(a, b))
      .map(([personKey, { bioguide, titles }]) => ({
        personKey,
        bioguide,
        wikipediaTitles: titles,
      })),
    counts,
  };
}
