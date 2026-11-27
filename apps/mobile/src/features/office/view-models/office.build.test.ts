import type { CandidacyView, OfficeDetail } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import type { FieldReportState } from '../data/use-field-report';

import { buildOffice } from './office.build';
import type { OfficeBuildInput } from './office.build';
import { officeCandidates, officeReady } from './office.fixtures';

function officeOf(vm: typeof officeReady): OfficeDetail {
  if (vm.status !== 'ready') throw new Error('expected a ready fixture');
  return vm.data.office;
}

const OFFICE = officeOf(officeReady);
const WITH_CANDIDATES = officeOf(officeCandidates);
const [FIRST_CANDIDACY, SECOND_CANDIDACY] = WITH_CANDIDATES.candidates as [
  CandidacyView,
  CandidacyView,
];

const noop = (): void => undefined;

const REPORT: FieldReportState = { status: 'idle', errorCode: null, submit: noop, reset: noop };

function input(overrides: Partial<OfficeBuildInput> = {}): OfficeBuildInput {
  return {
    office: OFFICE,
    issues: [],
    signedIn: true,
    allCandidates: null,
    candidatesComplete: false,
    fieldReport: REPORT,
    callbacks: {
      onToggleFollow: noop,
      onToggleBookmark: noop,
      onShowAll: noop,
      onSelectIssue: noop,
      onOpenSource: noop,
      onRefresh: noop,
    },
    ...overrides,
  };
}

describe('buildOffice', () => {
  it('run is hidden', () => {
    const built = buildOffice(input({ office: { ...OFFICE, placeholder: true } }));
    expect(built.actions.runState).toBe('hidden');
    expect(built.actions.runUnavailable).toBeNull();
  });

  it('viewer flags pass through', () => {
    const built = buildOffice(
      input({ office: { ...OFFICE, viewer: { ...OFFICE.viewer, following: true } } }),
    );
    expect(built.actions.following).toBe(true);
    expect(built.actions.bookmarked).toBe(false);
  });

  it('single-issue mode', () => {
    const onSelectIssue = (_id: string): void => undefined;
    const single = buildOffice(
      input({
        office: { ...OFFICE, impactMode: 'single_issue', impactIssueId: 'x' },
        callbacks: { ...input().callbacks, onSelectIssue },
      }),
    );
    expect(single.singleIssue?.issueId).toBe('x');
    expect(single.singleIssue?.onSelect).toBe(onSelectIssue);
    expect(buildOffice(input({ office: { ...OFFICE, impactMode: 'personal' } })).singleIssue).toBe(
      null,
    );
  });

  it('roster-only people have no link', () => {
    const rosterHolder = {
      ...OFFICE.officeholders[0],
      person: { ...FIRST_CANDIDACY.person, slug: 'roster-holder', rosterOnly: true },
    } as OfficeDetail['officeholders'][number];
    const linkedHolder = OFFICE.officeholders[0] as OfficeDetail['officeholders'][number];
    const rosterCandidacy: CandidacyView = {
      ...SECOND_CANDIDACY,
      person: { ...SECOND_CANDIDACY.person, rosterOnly: true },
    };
    const built = buildOffice(
      input({
        office: {
          ...WITH_CANDIDATES,
          officeholders: [rosterHolder, linkedHolder],
          candidates: [FIRST_CANDIDACY, rosterCandidacy],
        },
      }),
    );
    expect(built.officeholders.map((each) => each.entry.href)).toEqual([null, '/c/carol-wynn']);
    expect(built.candidates.entries.map((each) => each.entry.href)).toEqual([
      '/c/luis-marrero',
      null,
    ]);
    expect(built.officeholders[1]?.holder).toBe(linkedHolder);
    expect(built.officeholders.every((each) => each.entry.onToggleFollow === null)).toBe(true);
  });

  it('show all', () => {
    const onShowAll = (): void => undefined;
    const callbacks = { ...input().callbacks, onShowAll };
    const oneSent = buildOffice(
      input({
        office: { ...WITH_CANDIDATES, candidates: [FIRST_CANDIDACY], candidatesCount: 3 },
        callbacks,
      }),
    );
    expect(oneSent.candidates.total).toBe(3);
    expect(oneSent.candidates.entries).toHaveLength(1);
    expect(oneSent.candidates.onShowAll).toBe(onShowAll);

    const third: CandidacyView = { ...FIRST_CANDIDACY, id: '01890000-0000-7000-8000-000000000123' };
    const all = buildOffice(
      input({
        office: { ...WITH_CANDIDATES, candidates: [FIRST_CANDIDACY], candidatesCount: 3 },
        allCandidates: [SECOND_CANDIDACY, FIRST_CANDIDACY, third],
        candidatesComplete: true,
        callbacks,
      }),
    );
    expect(all.candidates.onShowAll).toBeNull();
    expect(all.candidates.entries.map((each) => each.candidacy)).toEqual([
      SECOND_CANDIDACY,
      FIRST_CANDIDACY,
      third,
    ]);
  });

  it('no field report when signed out', () => {
    expect(buildOffice(input({ signedIn: false })).fieldReport).toBeNull();
    const signedIn = buildOffice(input({ fieldReport: { ...REPORT, status: 'sent' } }));
    expect(signedIn.fieldReport).toEqual({
      status: 'sent',
      errorCode: null,
      onSubmit: REPORT.submit,
      onReset: REPORT.reset,
    });
  });

  it('nothing added to the office', () => {
    const given = input();
    expect(buildOffice(given).office).toBe(given.office);
  });

  it('the map row has no tap', () => {
    expect(buildOffice(input()).mapRow.onOpen).toBeNull();
  });
});
