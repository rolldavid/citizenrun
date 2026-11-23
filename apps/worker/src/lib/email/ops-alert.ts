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

type OpsAlertSection = 'notifications:opsAlert';
type OpsAlertName = 'jobFailed' | 'dumpStale' | 'connectionsHigh' | 'costProjection';
type OpsAlertKey =
  | `${OpsAlertSection}.${OpsAlertName}.${'subject' | 'body'}`
  | 'notifications:email.footerOps'
  | 'common:notKnownYet';

/** The keys this file reads, with interpolation values known only at run time. */
type Translate = (key: OpsAlertKey, options: Interpolation) => string;

// One explicit pair of keys per kind, so the catalog check sees every key read.
function subjectAndBody(
  kind: OpsAlertKind,
  options: Interpolation,
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
        body: t('notifications:opsAlert.costProjection.body', options),
      };
    default:
      return assertNever(kind);
  }
}

function render(
  input: { kind: OpsAlertKind; values: OpsAlertValues; env: WorkerEnv['envLabel'] },
  t: Translate,
): RenderedEmail {
  const notKnownYet = t('common:notKnownYet', {});
  const values: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(input.values)) {
    values[name] = value ?? notKnownYet;
  }
  // `env` and the escaping option come last, so no value can replace them. The text body is plain
  // text and the layout escapes the HTML once, so i18next escapes nothing.
  const options: Interpolation = {
    ...values,
    env: input.env,
    interpolation: { escapeValue: false },
  };
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
