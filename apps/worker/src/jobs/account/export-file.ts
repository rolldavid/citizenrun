import {
  authIdentities,
  bookmarks,
  districts,
  fieldReports,
  follows,
  issues,
  offices,
  userConsents,
  userDistricts,
  userIssues,
  users,
} from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { ExportFileSchema } from '@citizenrun/shared';
import type { ExportFile } from '@citizenrun/shared';
import { mediaUrl } from '@citizenrun/shared/storage';
import { asc, eq } from 'drizzle-orm';
import type { Bucket } from '../../lib/storage.ts';

/** The export's user is gone; the job's retry finds its export row gone with it. */
export class ExportUserMissingError extends Error {
  override readonly name = 'ExportUserMissingError';

  constructor() {
    super('The user of the export does not exist.');
  }
}

const FORMAT_VERSION = 1;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

// The account section: every exported column as stored; never the calendar token hash or
// the notification settings, whose shape arrives later.
async function accountOf(
  db: Db,
  media: Bucket,
  userId: string,
  now: Date,
): Promise<ExportFile['account']> {
  const [user] = await db
    .select({
      id: users.id,
      handle: users.handle,
      name: users.name,
      bio: users.bio,
      link: users.link,
      avatarKey: users.avatarKey,
      email: users.email,
      locale: users.locale,
      status: users.status,
      dmPolicy: users.dmPolicy,
      tagPolicy: users.tagPolicy,
      personalize: users.personalize,
      acceptsHelp: users.acceptsHelp,
      locationPrecision: users.locationPrecision,
      createdAt: users.createdAt,
      onboardedAt: users.onboardedAt,
      ageMethod: users.ageMethod,
      ageResult: users.ageResult,
      ageSourceTier: users.ageSourceTier,
      ageCheckedAt: users.ageCheckedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (user === undefined) {
    throw new ExportUserMissingError();
  }
  // users_age_record_check keeps the four age columns all null or all set.
  const age =
    user.ageMethod === null ||
    user.ageResult === null ||
    user.ageSourceTier === null ||
    user.ageCheckedAt === null
      ? null
      : {
          method: user.ageMethod,
          result: user.ageResult,
          sourceTier: user.ageSourceTier,
          checkedAt: user.ageCheckedAt.toISOString(),
        };
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    bio: user.bio,
    link: user.link,
    // Media URLs are made when the file is built (D-249).
    avatarUrl:
      user.avatarKey === null
        ? null
        : await mediaUrl(media.client, media.bucket, user.avatarKey, now),
    email: user.email,
    locale: user.locale,
    status: user.status,
    dmPolicy: user.dmPolicy,
    tagPolicy: user.tagPolicy,
    personalize: user.personalize,
    acceptsHelp: user.acceptsHelp,
    locationPrecision: user.locationPrecision,
    createdAt: user.createdAt.toISOString(),
    onboardedAt: isoOrNull(user.onboardedAt),
    age,
  };
}

/** Reads the user's exported rows and returns them parsed with ExportFileSchema. */
export async function buildExportFile(
  db: Db,
  media: Bucket,
  userId: string,
  now: Date,
): Promise<ExportFile> {
  const account = await accountOf(db, media, userId, now);

  // index: auth_identities_user. Never the subject, the refresh token or the client id.
  const methods = await db
    .select({
      provider: authIdentities.provider,
      email: authIdentities.email,
      createdAt: authIdentities.createdAt,
    })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId))
    .orderBy(asc(authIdentities.createdAt), asc(authIdentities.provider));

  // index: user_consents_user
  const consents = await db
    .select({
      kind: userConsents.kind,
      version: userConsents.version,
      granted: userConsents.granted,
      platform: userConsents.platform,
      createdAt: userConsents.createdAt,
    })
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(asc(userConsents.id));

  // index: user_issues_pkey
  const picks = await db
    .select({ issueId: userIssues.issueId, starred: userIssues.starred })
    .from(userIssues)
    .innerJoin(issues, eq(issues.id, userIssues.issueId))
    .where(eq(userIssues.userId, userId))
    .orderBy(asc(issues.sort));

  // index: user_districts_pkey. A retired district stays: the row is still the user's.
  const places = await db
    .select({ id: districts.id, name: districts.name })
    .from(userDistricts)
    .innerJoin(districts, eq(districts.id, userDistricts.districtId))
    .where(eq(userDistricts.userId, userId))
    .orderBy(asc(districts.name), asc(districts.id));

  // index: follows_follower
  const followed = await db
    .select({
      targetType: follows.targetType,
      targetId: follows.targetId,
      createdAt: follows.createdAt,
    })
    .from(follows)
    .where(eq(follows.followerId, userId))
    .orderBy(asc(follows.createdAt), asc(follows.targetType), asc(follows.targetId));

  // index: bookmarks_user. A retired office stays: the row is still the user's.
  const saved = await db
    .select({ officeId: bookmarks.officeId, slug: offices.slug, createdAt: bookmarks.createdAt })
    .from(bookmarks)
    .innerJoin(offices, eq(offices.id, bookmarks.officeId))
    .where(eq(bookmarks.userId, userId))
    .orderBy(asc(bookmarks.createdAt), asc(bookmarks.officeId));

  // index: field_reports_user
  const reports = await db
    .select({
      officeId: fieldReports.officeId,
      field: fieldReports.field,
      message: fieldReports.message,
      sourceUrl: fieldReports.sourceUrl,
      status: fieldReports.status,
      createdAt: fieldReports.createdAt,
    })
    .from(fieldReports)
    .where(eq(fieldReports.userId, userId))
    .orderBy(asc(fieldReports.id));

  const file: ExportFile = {
    formatVersion: FORMAT_VERSION,
    generatedAt: now.toISOString(),
    account,
    signInMethods: methods.map((method) => ({
      provider: method.provider,
      email: method.email,
      createdAt: method.createdAt.toISOString(),
    })),
    consents: consents.map((consent) => ({
      kind: consent.kind,
      version: consent.version,
      granted: consent.granted,
      platform: consent.platform,
      createdAt: consent.createdAt.toISOString(),
    })),
    issues: picks.map((pick) => ({ issueId: pick.issueId, starred: pick.starred })),
    districts: places.map((place) => ({ id: place.id, name: place.name })),
    follows: followed.map((follow) => ({
      targetType: follow.targetType,
      targetId: follow.targetId,
      createdAt: follow.createdAt.toISOString(),
    })),
    bookmarks: saved.map((bookmark) => ({
      officeId: bookmark.officeId,
      slug: bookmark.slug,
      createdAt: bookmark.createdAt.toISOString(),
    })),
    fieldReportsFiled: reports.map((report) => ({
      officeId: report.officeId,
      field: report.field,
      message: report.message,
      sourceUrl: report.sourceUrl,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    })),
  };
  // A parse failure is a defect: thrown, retried and then dead-lettered.
  return ExportFileSchema.parse(file);
}
