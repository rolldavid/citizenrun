import { z } from 'zod';
import { ISSUES_MAX, ISSUES_MIN, STARRED_MAX } from '../constants/accounts.ts';
import { InstantSchema, MediaSchema } from './common.ts';

// Response schemas send every key, with null for a value not known (L-wire-format); request schemas drop
// unknown keys.

/** The onboarding steps in order; `done` once onboarding is finished. */
export const OnboardingStepSchema = z
  .enum(['photo', 'handle', 'issues', 'location', 'done'])
  .meta({ id: 'OnboardingStep' });

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

/** Why an account is suspended; the one definition of the enum. */
export const SuspendedReasonSchema = z
  .enum(['content_policy', 'spam', 'impersonation', 'copyright', 'under_18', 'legal', 'other'])
  .meta({ id: 'SuspendedReason' });

export type SuspendedReason = z.infer<typeof SuspendedReasonSchema>;

/** The kinds of consent a user records (L-age-consent). */
export const ConsentKindSchema = z
  .enum(['terms', 'content_policy', 'privacy_policy', 'ai_screening'])
  .meta({ id: 'ConsentKind' });

export type ConsentKind = z.infer<typeof ConsentKindSchema>;

/** One issue a user picked, and whether they starred it. */
export const UserIssueSchema = z
  .object({ issueId: z.string(), starred: z.boolean() })
  .meta({ id: 'UserIssue' });

export type UserIssue = z.infer<typeof UserIssueSchema>;

/** How an account's adult age was established; the result is always adult and is not sent (L-age-consent). */
export const AgeRecordSchema = z
  .object({
    method: z.enum(['store_signal', 'self_declared']),
    sourceTier: z.enum(['confirmed', 'declared', 'self']),
    checkedAt: InstantSchema,
  })
  .meta({ id: 'AgeRecord' });

export type AgeRecord = z.infer<typeof AgeRecordSchema>;

/** The version of one agreement the user last agreed to, beside the current one (L-age-consent). */
export const DocumentConsentSchema = z
  .object({ agreedVersion: z.string().nullable(), currentVersion: z.string() })
  .meta({ id: 'DocumentConsent' });

export type DocumentConsent = z.infer<typeof DocumentConsentSchema>;

/** The user's agreements, the AI-screening answer and the agreements to ask again (L-age-consent). */
export const ConsentStateSchema = z
  .object({
    terms: DocumentConsentSchema,
    contentPolicy: DocumentConsentSchema,
    privacyPolicy: DocumentConsentSchema,
    aiScreening: z.enum(['granted', 'declined', 'not_asked']),
    needed: z.array(z.enum(['terms', 'content_policy', 'privacy_policy'])),
  })
  .meta({ id: 'ConsentState' });

export type ConsentState = z.infer<typeof ConsentStateSchema>;

/** The session in use: its platform, sign-in time, expiry and the end of its sensitive-action window (L-session). */
export const SessionStateSchema = z
  .object({
    platform: z.enum(['ios', 'android', 'web']),
    authenticatedAt: InstantSchema,
    expiresAt: InstantSchema,
    sensitiveActionsUntil: InstantSchema,
  })
  .meta({ id: 'SessionState' });

export type SessionState = z.infer<typeof SessionStateSchema>;

/** The signed-in user's own view of their account; never sent for another user. */
export const MeSchema = z
  .object({
    id: z.uuid(),
    handle: z.string().nullable(),
    name: z.string().nullable(),
    bio: z.string().nullable(),
    link: z.string().nullable(),
    avatar: MediaSchema.nullable(),
    avatarPending: z.boolean(),
    email: z.string().nullable(),
    emailStatus: z.enum(['ok', 'bounced', 'complained', 'disabled']),
    signInMethods: z.array(z.enum(['email', 'apple', 'google'])),
    role: z.enum(['user', 'admin']),
    status: z.enum(['active', 'suspended']),
    suspension: z.object({ reason: SuspendedReasonSchema, since: InstantSchema }).nullable(),
    onboardingStep: OnboardingStepSchema,
    onboardedAt: InstantSchema.nullable(),
    createdAt: InstantSchema,
    newAccountUntil: InstantSchema,
    handleChangeAvailableAt: InstantSchema.nullable(),
    issues: z.array(UserIssueSchema),
    locale: z.string(),
    age: AgeRecordSchema.nullable(),
    consents: ConsentStateSchema,
    session: SessionStateSchema,
  })
  .meta({ id: 'Me' });

export type Me = z.infer<typeof MeSchema>;

/** Whether a handle can be taken, with the normalised handle and the reason it cannot (L-handle-service). */
export const HandleCheckSchema = z
  .object({
    handle: z.string(),
    available: z.boolean(),
    reason: z.enum(['invalid', 'reserved', 'taken']).nullable(),
  })
  .meta({ id: 'HandleCheck' });

export type HandleCheck = z.infer<typeof HandleCheckSchema>;

/** One data export request and its file's state (E-ME-04, E-ME-05). */
export const DataExportViewSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['queued', 'ready', 'failed', 'expired']),
    requestedAt: InstantSchema,
    readyAt: InstantSchema.nullable(),
    expiresAt: InstantSchema.nullable(),
  })
  .meta({ id: 'DataExportView' });

export type DataExportView = z.infer<typeof DataExportViewSchema>;

/** The newest export request and when another may be asked for (E-ME-05). */
export const DataExportStatusSchema = z
  .object({ export: DataExportViewSchema.nullable(), nextRequestAt: InstantSchema.nullable() })
  .meta({ id: 'DataExportStatus' });

export type DataExportStatus = z.infer<typeof DataExportStatusSchema>;

/** A short-lived signed link to the export file (E-ME-06). */
export const ExportDownloadSchema = z
  .object({ url: z.string(), expiresAt: InstantSchema })
  .meta({ id: 'ExportDownload' });

export type ExportDownload = z.infer<typeof ExportDownloadSchema>;

/** When the account's deletion was asked for and when it completes (L-account-deletion). */
export const AccountDeletionViewSchema = z
  .object({ deletionRequestedAt: InstantSchema, completesBy: InstantSchema })
  .meta({ id: 'AccountDeletionView' });

export type AccountDeletionView = z.infer<typeof AccountDeletionViewSchema>;

/**
 * The JSON file of a data export; every section is present and `[]` when it has no rows. The account
 * section never holds the calendar token hash, and sign-in methods never hold a subject, token or client id.
 */
export const ExportFileSchema = z
  .object({
    formatVersion: z.literal(1),
    generatedAt: InstantSchema,
    account: z.object({
      id: z.uuid(),
      handle: z.string().nullable(),
      name: z.string().nullable(),
      bio: z.string().nullable(),
      link: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      email: z.string().nullable(),
      locale: z.string(),
      status: z.string(),
      dmPolicy: z.string(),
      tagPolicy: z.string(),
      personalize: z.boolean(),
      acceptsHelp: z.boolean(),
      locationPrecision: z.string().nullable(),
      createdAt: InstantSchema,
      onboardedAt: InstantSchema.nullable(),
      age: z
        .object({
          method: z.string(),
          result: z.string(),
          sourceTier: z.string(),
          checkedAt: InstantSchema,
        })
        .nullable(),
    }),
    signInMethods: z.array(
      z.object({ provider: z.string(), email: z.string().nullable(), createdAt: InstantSchema }),
    ),
    consents: z.array(
      z.object({
        kind: z.string(),
        version: z.string(),
        granted: z.boolean(),
        platform: z.string(),
        createdAt: InstantSchema,
      }),
    ),
    issues: z.array(UserIssueSchema),
    districts: z.array(z.object({ id: z.uuid(), name: z.string() })),
    follows: z.array(
      z.object({ targetType: z.string(), targetId: z.uuid(), createdAt: InstantSchema }),
    ),
    bookmarks: z.array(
      z.strictObject({ officeId: z.uuid(), slug: z.string(), createdAt: InstantSchema }),
    ),
    fieldReportsFiled: z.array(
      z.strictObject({
        officeId: z.uuid(),
        field: z.string().nullable(),
        message: z.string().nullable(),
        sourceUrl: z.string().nullable(),
        status: z.string(),
        createdAt: InstantSchema,
      }),
    ),
  })
  .meta({ id: 'ExportFile' });

export type ExportFile = z.infer<typeof ExportFileSchema>;

/**
 * The body of `PATCH /v1/me` (E-ME-02): an omitted key leaves the value, `null` clears it. Lengths are as
 * sent; the profile text rules apply their own limits after normalising. `email`, `role` and every
 * other unknown key are dropped.
 */
export const UpdateMeBodySchema = z
  .object({
    name: z.string().max(200).nullable().optional(),
    bio: z.string().max(400).nullable().optional(),
    // Above the link rule's own limit, so an over-long link reaches that rule and answers invalid_format (E-ME-02).
    link: z.string().max(2048).nullable().optional(),
    avatarUploadKey: z.string().min(1).max(200).nullable().optional(),
    locale: z.literal('en').optional(),
  })
  .meta({ id: 'UpdateMeBody' });

export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;

/** The query of `GET /v1/handles/check` (E-ME-07): the handle as typed, before normalising. */
export const CheckHandleQuerySchema = z
  .object({ handle: z.string().min(1).max(40) })
  .meta({ id: 'CheckHandleQuery' });

export type CheckHandleQuery = z.infer<typeof CheckHandleQuerySchema>;

/** The body of `PUT /v1/me/handle` (E-ME-08): the handle as typed, before normalising. */
export const SetHandleBodySchema = z
  .object({ handle: z.string().min(1).max(40) })
  .meta({ id: 'SetHandleBody' });

export type SetHandleBody = z.infer<typeof SetHandleBodySchema>;

/** The body of `PUT /v1/me/issues` (E-ME-09): the whole set of picks, each issue once, with a few starred. */
export const SetIssuesBodySchema = z
  .object({
    issues: z
      .array(
        z.object({
          issueId: z
            .string()
            .min(1)
            .max(64)
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          starred: z.boolean(),
        }),
      )
      .min(ISSUES_MIN)
      .max(ISSUES_MAX),
  })
  .superRefine((body, ctx) => {
    const ids = new Set(body.issues.map((pick) => pick.issueId));
    if (ids.size !== body.issues.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['issues'],
        params: { code: 'invalid_value' },
        message: 'An issue is picked twice.',
      });
    }
    if (body.issues.filter((pick) => pick.starred).length > STARRED_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['issues'],
        params: { code: 'too_many' },
        message: 'Too many issues are starred.',
      });
    }
  })
  .meta({ id: 'SetIssuesBody' });

export type SetIssuesBody = z.infer<typeof SetIssuesBodySchema>;

/** The body of `POST /v1/me/onboarding/skip` (E-ME-10): one of the two optional steps. */
export const SkipOnboardingStepBodySchema = z
  .object({ step: z.enum(['photo', 'location']) })
  .meta({ id: 'SkipOnboardingStepBody' });

export type SkipOnboardingStepBody = z.infer<typeof SkipOnboardingStepBodySchema>;

const AGREEMENT_KINDS: ReadonlySet<ConsentKind> = new Set([
  'terms',
  'content_policy',
  'privacy_policy',
]);

/** The body of `POST /v1/me/consents` (E-ME-11); an agreement cannot be withdrawn, only AI screening can. */
export const RecordConsentBodySchema = z
  .object({
    kind: ConsentKindSchema,
    version: z.string().min(1).max(32),
    granted: z.boolean(),
  })
  .superRefine((body, ctx) => {
    if (!body.granted && AGREEMENT_KINDS.has(body.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['granted'],
        params: { code: 'not_allowed' },
        message: 'An agreement cannot be withdrawn.',
      });
    }
  })
  .meta({ id: 'RecordConsentBody' });

export type RecordConsentBody = z.infer<typeof RecordConsentBodySchema>;

/** The body of `POST /v1/me/age` (E-ME-12): the band a store age signal reported, never the raw signal. */
export const RecordAgeSignalBodySchema = z
  .object({
    result: z.enum(['adult', 'under_18', 'under_13']),
    sourceTier: z.enum(['confirmed', 'declared']),
  })
  .meta({ id: 'RecordAgeSignalBody' });

export type RecordAgeSignalBody = z.infer<typeof RecordAgeSignalBodySchema>;

/** The body of `POST /v1/me/export` (E-ME-04): empty. */
export const RequestExportBodySchema = z.object({}).meta({ id: 'RequestExportBody' });

export type RequestExportBody = z.infer<typeof RequestExportBodySchema>;
