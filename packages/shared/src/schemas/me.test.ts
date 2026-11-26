import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import * as me from './me.ts';
import {
  AccountDeletionViewSchema,
  CheckHandleQuerySchema,
  DataExportStatusSchema,
  ExportFileSchema,
  HandleCheckSchema,
  LocationResultSchema,
  LocationStateSchema,
  MeSchema,
  RecordAgeSignalBodySchema,
  RecordConsentBodySchema,
  SetIssuesBodySchema,
  SetLocationBodySchema,
  SkipOnboardingStepBodySchema,
  UpdateMeBodySchema,
} from './me.ts';

const USER_ID = '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60';

/** The dot paths of every key that may be left out, walking objects, arrays and nullable values. */
function optionalKeys(schema: z.core.$ZodType, path = ''): string[] {
  if (schema instanceof z.ZodNullable) {
    return optionalKeys(schema.unwrap(), path);
  }
  if (schema instanceof z.ZodArray) {
    return optionalKeys(schema.element, `${path}[]`);
  }
  if (schema instanceof z.ZodObject) {
    const found: string[] = [];
    for (const [key, field] of Object.entries(schema.shape)) {
      const fieldPath = path === '' ? key : `${path}.${key}`;
      if (z.safeParse(field, undefined).success) {
        found.push(fieldPath);
      }
      found.push(...optionalKeys(field, fieldPath));
    }
    return found;
  }
  return [];
}

function fieldIssues(result: z.ZodSafeParseResult<unknown>) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    params: 'params' in issue ? issue.params : undefined,
  }));
}

const NEW_USER_ME = {
  id: USER_ID,
  handle: null,
  name: null,
  bio: null,
  link: null,
  avatar: null,
  avatarPending: false,
  email: 'fixture@example.test',
  emailStatus: 'ok',
  signInMethods: ['email'],
  role: 'user',
  status: 'active',
  suspension: null,
  onboardingStep: 'photo',
  onboardedAt: null,
  createdAt: '2027-01-15T10:00:00.000Z',
  newAccountUntil: '2027-01-22T10:00:00.000Z',
  handleChangeAvailableAt: null,
  issues: [],
  locale: 'en',
  age: { method: 'self_declared', sourceTier: 'self', checkedAt: '2027-01-15T10:00:00.000Z' },
  consents: {
    terms: { agreedVersion: '2027-01-01', currentVersion: '2027-01-01' },
    contentPolicy: { agreedVersion: '2027-01-01', currentVersion: '2027-01-01' },
    privacyPolicy: { agreedVersion: '2027-01-01', currentVersion: '2027-01-01' },
    aiScreening: 'not_asked',
    needed: [],
  },
  session: {
    platform: 'ios',
    authenticatedAt: '2027-01-15T10:00:00.000Z',
    expiresAt: '2027-04-15T10:00:00.000Z',
    sensitiveActionsUntil: '2027-01-15T10:15:00.000Z',
  },
  location: {
    isSet: false,
    precision: null,
    districtCount: 0,
    bbox: null,
    placeName: null,
    officeCount: 0,
    needsConfirmation: false,
  },
};

function picks(count: number, starred = 0) {
  return Array.from({ length: count }, (_, i) => ({
    issueId: `issue-${String(i)}`,
    starred: i < starred,
  }));
}

describe('Me', () => {
  it('Me holds exactly its current keys', () => {
    expect(Object.keys(MeSchema.shape)).toEqual([
      'id',
      'handle',
      'name',
      'bio',
      'link',
      'avatar',
      'avatarPending',
      'email',
      'emailStatus',
      'signInMethods',
      'role',
      'status',
      'suspension',
      'onboardingStep',
      'onboardedAt',
      'createdAt',
      'newAccountUntil',
      'handleChangeAvailableAt',
      'issues',
      'locale',
      'age',
      'consents',
      'session',
      'location',
    ]);
  });

  it('Me holds location', () => {
    expect(Object.keys(LocationStateSchema.shape)).toEqual([
      'isSet',
      'precision',
      'districtCount',
      'bbox',
      'placeName',
      'officeCount',
      'needsConfirmation',
    ]);
    const located = {
      ...NEW_USER_ME,
      location: {
        isSet: true,
        precision: 'approx',
        districtCount: 5,
        bbox: [-40.05, 29.95, -39.95, 30.05],
        placeName: 'Fixture City',
        officeCount: 3,
        needsConfirmation: true,
      },
    };
    expect(MeSchema.parse(located)).toEqual(located);
    const withoutLocation: Record<string, unknown> = { ...NEW_USER_ME };
    delete withoutLocation['location'];
    expect(MeSchema.safeParse(withoutLocation).success).toBe(false);
    expect(
      MeSchema.safeParse({ ...located, location: { ...located.location, precision: 'rough' } })
        .success,
    ).toBe(false);
    expect(
      MeSchema.safeParse({ ...located, location: { ...located.location, bbox: [1, 2, 3] } })
        .success,
    ).toBe(false);
  });

  it("a new user's Me parses", () => {
    const result = MeSchema.safeParse(NEW_USER_ME);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(NEW_USER_ME);
  });

  it('a suspended Me carries its reason', () => {
    const suspended = {
      ...NEW_USER_ME,
      status: 'suspended',
      suspension: { reason: 'spam', since: '2027-02-01T00:00:00.000Z' },
    };
    expect(MeSchema.safeParse(suspended).success).toBe(true);
    expect(
      MeSchema.safeParse({
        ...suspended,
        suspension: { reason: 'rude', since: '2027-02-01T00:00:00.000Z' },
      }).success,
    ).toBe(false);
  });

  it('a Me with a key missing fails', () => {
    for (const missing of Object.keys(NEW_USER_ME)) {
      const partial = Object.fromEntries(
        Object.entries(NEW_USER_ME).filter(([key]) => key !== missing),
      );
      expect(MeSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('response keys are never optional', () => {
    for (const schema of [
      MeSchema,
      ExportFileSchema,
      HandleCheckSchema,
      DataExportStatusSchema,
      AccountDeletionViewSchema,
      LocationResultSchema,
    ]) {
      expect(optionalKeys(schema)).toEqual([]);
    }
    // The walk finds an optional key where one exists.
    expect(optionalKeys(UpdateMeBodySchema)).toContain('name');
  });
});

describe('ExportFile', () => {
  const OFFICE_ID = '0190a8a0-0000-7000-8000-000000000002';
  const AT = '2027-01-15T10:00:00.000Z';
  const EMPTY_FILE = {
    formatVersion: 1,
    generatedAt: '2027-01-15T10:00:00.000Z',
    account: {
      id: USER_ID,
      handle: null,
      name: null,
      bio: null,
      link: null,
      avatarUrl: null,
      email: null,
      locale: 'en',
      status: 'active',
      dmPolicy: 'everyone',
      tagPolicy: 'everyone',
      personalize: true,
      acceptsHelp: true,
      locationPrecision: null,
      createdAt: '2027-01-15T10:00:00.000Z',
      onboardedAt: null,
      age: null,
    },
    signInMethods: [],
    consents: [],
    issues: [],
    districts: [],
    follows: [],
    bookmarks: [],
    fieldReportsFiled: [],
  };

  it('ExportFile holds its sections', () => {
    expect(Object.keys(ExportFileSchema.shape)).toEqual([
      'formatVersion',
      'generatedAt',
      'account',
      'signInMethods',
      'consents',
      'issues',
      'districts',
      'follows',
      'bookmarks',
      'fieldReportsFiled',
    ]);
    expect(Object.keys(ExportFileSchema.shape.account.shape)).not.toContain('notificationSettings');
    expect(Object.keys(ExportFileSchema.shape.account.shape)).not.toContain('calendarTokenHash');
    const result = ExportFileSchema.safeParse(EMPTY_FILE);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(EMPTY_FILE);
  });

  it('holds the civic sections of a user', () => {
    const file = {
      ...EMPTY_FILE,
      districts: [{ id: OFFICE_ID, name: 'Fixture District One' }],
      follows: [{ targetType: 'office', targetId: OFFICE_ID, createdAt: AT }],
      bookmarks: [{ officeId: OFFICE_ID, slug: 'fixture-office-1', createdAt: AT }],
      fieldReportsFiled: [
        {
          officeId: OFFICE_ID,
          field: null,
          message: 'Fixture note',
          sourceUrl: 'https://example.test/fixture-report',
          status: 'open',
          createdAt: AT,
        },
      ],
    };
    expect(ExportFileSchema.parse(file)).toEqual(file);
    // Each key of the two sections is required, and nothing else is allowed in an entry.
    const withoutLink = {
      officeId: OFFICE_ID,
      field: null,
      message: 'Fixture note',
      status: 'open',
      createdAt: AT,
    };
    expect(ExportFileSchema.safeParse({ ...file, fieldReportsFiled: [withoutLink] }).success).toBe(
      false,
    );
    expect(
      ExportFileSchema.safeParse({
        ...file,
        bookmarks: [{ officeId: OFFICE_ID, slug: 'fixture-office-1', createdAt: AT, title: 'x' }],
      }).success,
    ).toBe(false);
    expect(ExportFileSchema.safeParse({ ...EMPTY_FILE, bookmarks: undefined }).success).toBe(false);
  });

  it('refuses another format version', () => {
    expect(ExportFileSchema.safeParse({ ...EMPTY_FILE, formatVersion: 2 }).success).toBe(false);
  });
});

describe('UpdateMeBody', () => {
  it('UpdateMeBody strips email and role', () => {
    const result = UpdateMeBodySchema.safeParse({
      name: 'Fixture Name',
      email: 'other@example.test',
      role: 'admin',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'Fixture Name' });
  });

  it('UpdateMeBody keeps null to clear', () => {
    const body = { name: null, bio: null, link: null, avatarUploadKey: null };
    expect(UpdateMeBodySchema.parse(body)).toEqual(body);
    expect(UpdateMeBodySchema.parse({})).toEqual({});
  });

  it('a 201-character name fails as too long', () => {
    const result = UpdateMeBodySchema.safeParse({ name: 'n'.repeat(201) });
    expect(fieldIssues(result)).toEqual([{ path: 'name', code: 'too_big', params: undefined }]);
    expect(UpdateMeBodySchema.safeParse({ name: 'n'.repeat(200) }).success).toBe(true);
  });

  it('lengths of bio, link and upload key are bounded as sent', () => {
    expect(UpdateMeBodySchema.safeParse({ bio: 'b'.repeat(400) }).success).toBe(true);
    expect(UpdateMeBodySchema.safeParse({ bio: 'b'.repeat(401) }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ link: `https://${'a'.repeat(193)}.test` }).success).toBe(
      true,
    );
    expect(UpdateMeBodySchema.safeParse({ link: 'l'.repeat(2049) }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ avatarUploadKey: '' }).success).toBe(false);
    expect(UpdateMeBodySchema.safeParse({ avatarUploadKey: 'k'.repeat(201) }).success).toBe(false);
  });

  it('only the English locale is accepted', () => {
    expect(UpdateMeBodySchema.safeParse({ locale: 'en' }).success).toBe(true);
    expect(UpdateMeBodySchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});

describe('SetIssuesBody', () => {
  it('2 items fail as too small', () => {
    expect(fieldIssues(SetIssuesBodySchema.safeParse({ issues: picks(2) }))).toEqual([
      { path: 'issues', code: 'too_small', params: undefined },
    ]);
  });

  it('11 items fail as too big', () => {
    expect(fieldIssues(SetIssuesBodySchema.safeParse({ issues: picks(11) }))).toEqual([
      { path: 'issues', code: 'too_big', params: undefined },
    ]);
  });

  it('a duplicate gives invalid_value at issues', () => {
    const issues = [...picks(3), { issueId: 'issue-0', starred: false }];
    expect(fieldIssues(SetIssuesBodySchema.safeParse({ issues }))).toEqual([
      { path: 'issues', code: 'custom', params: { code: 'invalid_value' } },
    ]);
  });

  it('4 stars give too_many at issues', () => {
    expect(fieldIssues(SetIssuesBodySchema.safeParse({ issues: picks(5, 4) }))).toEqual([
      { path: 'issues', code: 'custom', params: { code: 'too_many' } },
    ]);
  });

  it('3 and 10 items pass, with up to 3 stars', () => {
    expect(SetIssuesBodySchema.safeParse({ issues: picks(3, 3) }).success).toBe(true);
    expect(SetIssuesBodySchema.safeParse({ issues: picks(10) }).success).toBe(true);
  });

  it('an issue id must be kebab-case', () => {
    const issues = [...picks(2), { issueId: 'Bad_Id', starred: false }];
    expect(fieldIssues(SetIssuesBodySchema.safeParse({ issues }))).toEqual([
      { path: 'issues.2.issueId', code: 'invalid_format', params: undefined },
    ]);
  });
});

describe('RecordConsentBody', () => {
  it('RecordConsentBody refuses a withdrawn agreement', () => {
    for (const kind of ['terms', 'content_policy', 'privacy_policy']) {
      const result = RecordConsentBodySchema.safeParse({
        kind,
        version: '2027-01-01',
        granted: false,
      });
      expect(fieldIssues(result)).toEqual([
        { path: 'granted', code: 'custom', params: { code: 'not_allowed' } },
      ]);
    }
    expect(
      RecordConsentBodySchema.safeParse({
        kind: 'ai_screening',
        version: '2027-01-01',
        granted: false,
      }).success,
    ).toBe(true);
    expect(
      RecordConsentBodySchema.safeParse({ kind: 'terms', version: '2027-01-01', granted: true })
        .success,
    ).toBe(true);
  });

  it('a version is 1 to 32 characters', () => {
    expect(
      RecordConsentBodySchema.safeParse({ kind: 'terms', version: '', granted: true }).success,
    ).toBe(false);
    expect(
      RecordConsentBodySchema.safeParse({ kind: 'terms', version: 'v'.repeat(33), granted: true })
        .success,
    ).toBe(false);
  });
});

describe('RecordAgeSignalBody', () => {
  it('RecordAgeSignalBody refuses the self tier', () => {
    expect(
      RecordAgeSignalBodySchema.safeParse({ result: 'adult', sourceTier: 'self' }).success,
    ).toBe(false);
    for (const result of ['adult', 'under_18', 'under_13']) {
      expect(RecordAgeSignalBodySchema.safeParse({ result, sourceTier: 'declared' }).success).toBe(
        true,
      );
    }
  });
});

describe('handle and onboarding bodies', () => {
  it('CheckHandleQuery refuses 41 characters', () => {
    expect(CheckHandleQuerySchema.safeParse({ handle: 'h'.repeat(41) }).success).toBe(false);
    expect(CheckHandleQuerySchema.safeParse({ handle: 'h'.repeat(40) }).success).toBe(true);
    expect(CheckHandleQuerySchema.safeParse({ handle: '' }).success).toBe(false);
  });

  it('only the optional steps can be skipped', () => {
    expect(SkipOnboardingStepBodySchema.safeParse({ step: 'photo' }).success).toBe(true);
    expect(SkipOnboardingStepBodySchema.safeParse({ step: 'location' }).success).toBe(true);
    expect(SkipOnboardingStepBodySchema.safeParse({ step: 'handle' }).success).toBe(false);
  });
});

describe('SetLocationBody', () => {
  it('the location body takes a point or an address', () => {
    expect(
      SetLocationBodySchema.parse({ lat: 30.004321, lng: -39.995678, precision: 'exact' }),
    ).toEqual({
      lat: 30.004321,
      lng: -39.995678,
      precision: 'exact',
    });
    expect(SetLocationBodySchema.parse({ lat: -90, lng: 180, precision: 'approx' })).toEqual({
      lat: -90,
      lng: 180,
      precision: 'approx',
    });
    expect(SetLocationBodySchema.parse({ address: '  100 Fixture Way, Fixture City  ' })).toEqual({
      address: '100 Fixture Way, Fixture City',
    });

    expect(fieldIssues(SetLocationBodySchema.safeParse({}))).toEqual([
      { path: 'lat', code: 'custom', params: { code: 'required' } },
      { path: 'lng', code: 'custom', params: { code: 'required' } },
      { path: 'precision', code: 'custom', params: { code: 'required' } },
    ]);
    expect(fieldIssues(SetLocationBodySchema.safeParse({ address: 'ab' }))).toEqual([
      { path: 'address', code: 'too_small', params: undefined },
    ]);
    expect(fieldIssues(SetLocationBodySchema.safeParse({ address: 'a'.repeat(201) }))).toEqual([
      { path: 'address', code: 'too_big', params: undefined },
    ]);
    expect(
      fieldIssues(SetLocationBodySchema.safeParse({ lat: 91, lng: 0, precision: 'exact' })),
    ).toEqual([{ path: 'lat', code: 'too_big', params: undefined }]);
    expect(
      fieldIssues(SetLocationBodySchema.safeParse({ lat: 0, lng: -181, precision: 'exact' })),
    ).toEqual([{ path: 'lng', code: 'too_small', params: undefined }]);
    expect(fieldIssues(SetLocationBodySchema.safeParse({ address: 'x y z', lat: 1 }))).toEqual([
      { path: 'lat', code: 'custom', params: { code: 'not_allowed' } },
    ]);
    expect(
      fieldIssues(
        SetLocationBodySchema.safeParse({ address: 'x y z', lat: 1, lng: 1, precision: 'exact' }),
      ).map((issue) => issue.path),
    ).toEqual(['lat', 'lng', 'precision']);
    expect(
      fieldIssues(SetLocationBodySchema.safeParse({ lat: 1, lng: 1, precision: 'fast' })),
    ).toEqual([{ path: 'precision', code: 'invalid_value', params: undefined }]);
    expect(SetLocationBodySchema.safeParse({ lat: '1', lng: 1, precision: 'exact' }).success).toBe(
      false,
    );
  });

  it('a body key is never required by the schema', () => {
    expect(optionalKeys(SetLocationBodySchema).sort()).toEqual([
      'address',
      'lat',
      'lng',
      'precision',
    ]);
  });
});

describe('component ids', () => {
  it('component ids equal the type names', () => {
    const named = Object.entries(me).flatMap(([name, value]) =>
      name.endsWith('Schema') && value instanceof z.ZodType ? [{ name, schema: value }] : [],
    );
    expect(named.length).toBeGreaterThan(20);
    for (const { name, schema } of named) {
      expect(schema.meta()?.id).toBe(name.slice(0, -'Schema'.length));
    }
  });
});
