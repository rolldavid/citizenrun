import { assertNever } from '@citizenrun/shared';
import type { OpsAlertKind, createI18n } from '@citizenrun/shared';
import type { WorkerEnv } from '../../env.ts';
import { renderLayout } from './layout.ts';

/** The translate function of an instance made by createI18n(). */
export type TFunction = ReturnType<typeof createI18n>['t'];

/** One email ready to send: its subject, its plain-text body and its HTML body. */
export type RenderedEmail = { subject: string; text: string; html: string };

/** The values an ops alert interpolates, as its payload holds them. */
export type OpsAlertValues = Readonly<Record<string, string | number | boolean | null>>;

type Interpolation = Readonly<Record<string, unknown>>;

/** What an alert's text interpolates: its values, then `env`. */
type AlertReplace = Readonly<Record<string, string | number | boolean>>;
type AlertOptions = { replace: AlertReplace; interpolation: { escapeValue: false } };

// The values go in `replace`, so a value named like an i18next option (count, lng, context,
// defaultValue, keySeparator, ...) is only ever text. The text body is plain text and the layout
// escapes the HTML once, so i18next escapes nothing.
function alertOptions(replace: AlertReplace): AlertOptions {
  return { replace, interpolation: { escapeValue: false } };
}

type OpsAlertSection = 'notifications:opsAlert';
type OpsAlertName = 'jobFailed' | 'dumpStale' | 'connectionsHigh' | 'costProjection';
type CostLineBody =
  'bodyStorage' | 'bodyUploadGrowth' | 'bodyEmailMonth' | 'bodyEmailDay' | 'bodySigninCeiling';
type OpsAlertKey =
  | `${OpsAlertSection}.${OpsAlertName}.${'subject' | 'body'}`
  | `${OpsAlertSection}.costProjection.${CostLineBody}`
  | 'notifications:email.footerOps'
  | 'common:notKnownYet';

/** The keys this file reads, with interpolation values known only at run time. */
type Translate = (key: OpsAlertKey, options: Interpolation) => string;

// One explicit pair of keys per kind, so the catalog check sees every key read.
function subjectAndBody(
  kind: OpsAlertKind,
  options: AlertOptions,
  t: Translate,
): { subject: string; body: string } {
  switch (kind) {
    case 'job_failed':
      return {
        subject: t('notifications:opsAlert.jobFailed.subject', options),
        body: t('notifications:opsAlert.jobFailed.body', options),
      };
    case 'dump_stale':
      return {
        subject: t('notifications:opsAlert.dumpStale.subject', options),
        body: t('notifications:opsAlert.dumpStale.body', options),
      };
    case 'connections_high':
      return {
        subject: t('notifications:opsAlert.connectionsHigh.subject', options),
        body: t('notifications:opsAlert.connectionsHigh.body', options),
      };
    case 'cost_projection':
      return {
        subject: t('notifications:opsAlert.costProjection.subject', options),
        body: costLineBody(options.replace, t),
      };
    default:
      return assertNever(kind);
  }
}

// Bytes in one gigabyte, as the storage provider bills it; the cost lines' own constant.
const BYTES_PER_GB = 1_000_000_000; // OPS-cost-thresholds

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true });
const GIGABYTES = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: true });

type NumberFormat = (value: number) => string;

const count: NumberFormat = (value) => WHOLE.format(value);
const gigabytes: NumberFormat = (bytes) => GIGABYTES.format(bytes / BYTES_PER_GB);
// US dollars from integer cents: whole dollars when the amount is whole, else two decimals.
const dollars: NumberFormat = (cents) => {
  const whole = Math.round(cents);
  const digits = whole % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(whole / 100);
};

// The line's numbers in the units its body names; a value that is not a number is kept as it is.
function inUnits(
  replace: AlertReplace,
  formats: { value: NumberFormat; projected: NumberFormat; threshold: NumberFormat },
): AlertOptions {
  const converted: Record<string, string | number | boolean> = { ...replace };
  for (const name of ['value', 'projected', 'threshold'] as const) {
    const number = replace[name];
    if (typeof number === 'number') {
      converted[name] = formats[name](number);
    }
  }
  return alertOptions(converted);
}

/**
 * A cost line's body, with each number in its unit (D-852): `storage` in gigabytes and dollars a
 * month, `upload_growth` in gigabytes, the email lines in emails. A line with no body of its own
 * reads the numbers as they were sent.
 */
function costLineBody(replace: AlertReplace, t: Translate): string {
  const line = replace['line'];
  switch (typeof line === 'string' ? line : '') {
    case 'storage':
      return t(
        'notifications:opsAlert.costProjection.bodyStorage',
        inUnits(replace, { value: gigabytes, projected: dollars, threshold: dollars }),
      );
    case 'upload_growth':
      return t(
        'notifications:opsAlert.costProjection.bodyUploadGrowth',
        inUnits(replace, { value: gigabytes, projected: gigabytes, threshold: gigabytes }),
      );
    case 'email_month':
      return t(
        'notifications:opsAlert.costProjection.bodyEmailMonth',
        inUnits(replace, { value: count, projected: count, threshold: count }),
      );
    case 'email_day':
      return t(
        'notifications:opsAlert.costProjection.bodyEmailDay',
        inUnits(replace, { value: count, projected: count, threshold: count }),
      );
    case 'signin_ceiling':
      return t(
        'notifications:opsAlert.costProjection.bodySigninCeiling',
        inUnits(replace, { value: count, projected: count, threshold: count }),
      );
    default:
      return t('notifications:opsAlert.costProjection.body', alertOptions(replace));
  }
}

function render(
  input: { kind: OpsAlertKind; values: OpsAlertValues; env: WorkerEnv['envLabel'] },
  t: Translate,
): RenderedEmail {
  const notKnownYet = t('common:notKnownYet', {});
  const values: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(input.values)) {
    // `appName` and `env` are the alert's own, never a payload's.
    if (name !== 'appName' && name !== 'env') {
      values[name] = value ?? notKnownYet;
    }
  }
  const options = alertOptions({ ...values, env: input.env });
  const { subject, body } = subjectAndBody(input.kind, options, t);
  const footer = t('notifications:email.footerOps', { env: input.env });
  return {
    subject,
    text: `${body}\n\n${footer}\n`,
    html: renderLayout({ title: subject, heading: subject, paragraphs: [body], footer }),
  };
}

/**
 * The operators' email for one ops alert, in English: a null value reads "not known yet", the
 * subject starts with the product name and `env`, and the footer names the environment. The text
 * body is plain; the HTML escapes every value once, in the layout. No unsubscribe line.
 */
export function renderOpsAlert(
  input: { kind: OpsAlertKind; values: OpsAlertValues; env: WorkerEnv['envLabel'] },
  t: TFunction,
): RenderedEmail {
  return render(input, t as Translate); // values are named at run time; typed keys need them all
}
