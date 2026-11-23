// Checks every workflow under .github/workflows/ and every composite action under .github/actions/
// against the rules for a public repository's CI (CTL-25; D-114, D-115):
//   pnpm exec tsx scripts/check-workflows.ts
// Prints one line per violation and exits 1, or prints the number of files checked and exits 0.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { repoRoot } from './lib/repo-root.ts';

export type Violation = { file: string; rule: string; message: string };

type YamlMap = Record<string, unknown>;

const RUNNER = 'ubuntu-24.04';
const SHA_PIN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[^@\s]+)?@[0-9a-f]{40}$/;
const DOCKER_PIN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
const VERSION_COMMENT = /#\s*v\d+(\.\d+)*\b/;
const RAW_USES = /^\s*(?:-\s+)?uses:\s*(['"]?)([^'"\s#]+)\1\s*(#.*)?$/;
const SECRET_REFERENCE = /\bsecrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[)/g;

/** Job permission keys a job may raise, with the values each may take. */
const JOB_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  contents: ['read'],
  'pull-requests': ['read', 'write'],
  actions: ['read', 'write'],
};

function isMap(value: unknown): value is YamlMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses YAML 1.2, so the key `on` stays a string. */
function parseYaml(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? (error.message.split('\n')[0] ?? '') : '' };
  }
}

/** The minutes, 0 to 59, a cron minute field fires at, sorted. Throws on a field it cannot read. */
export function cronMinutes(field: string): number[] {
  const minutes = new Set<number>();
  const number = (text: string): number => {
    if (!/^\d{1,2}$/.test(text)) {
      throw new Error(`cron minute field "${field}" is not readable`);
    }
    const value = Number(text);
    if (value > 59) {
      throw new Error(`cron minute field "${field}" names minute ${text}`);
    }
    return value;
  };
  for (const part of field.split(',')) {
    const [range = '', stepText, extra] = part.split('/');
    if (extra !== undefined) {
      throw new Error(`cron minute field "${field}" is not readable`);
    }
    const step = stepText === undefined ? 1 : number(stepText);
    if (step === 0) {
      throw new Error(`cron minute field "${field}" has a step of 0`);
    }
    let start: number;
    let end: number;
    if (range === '*') {
      start = 0;
      end = 59;
    } else if (range.includes('-')) {
      const [from = '', to = ''] = range.split('-');
      start = number(from);
      end = number(to);
      if (start > end) {
        throw new Error(`cron minute field "${field}" has a reversed range`);
      }
    } else {
      start = number(range);
      end = stepText === undefined ? start : 59;
    }
    for (let minute = start; minute <= end; minute += step) {
      minutes.add(minute);
    }
  }
  return [...minutes].sort((a, b) => a - b);
}

/** The trigger names of a workflow's `on`, in any of its three forms. */
function triggerNames(on: unknown): string[] {
  if (typeof on === 'string') {
    return [on];
  }
  if (Array.isArray(on)) {
    return on.filter((entry): entry is string => typeof entry === 'string');
  }
  if (isMap(on)) {
    return Object.keys(on);
  }
  return [];
}

/** Every `uses:` value of a list of steps. */
function stepUses(steps: unknown): string[] {
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps.flatMap((step) => (isMap(step) && typeof step.uses === 'string' ? [step.uses] : []));
}

/** Pin violations for the given `uses:` values, with the version comment read from the raw text. */
function pinViolations(file: string, text: string, uses: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  const rawLines = text.split('\n').flatMap((line) => {
    const match = RAW_USES.exec(line);
    return match === null ? [] : [{ value: match[2] ?? '', comment: match[3] ?? '' }];
  });
  for (const value of new Set(uses)) {
    if (value.startsWith('./')) {
      continue;
    }
    if (value.startsWith('docker://')) {
      if (!DOCKER_PIN.test(value)) {
        violations.push({ file, rule: 'pin', message: `${value} is not pinned by sha256 digest` });
      }
      continue;
    }
    if (!SHA_PIN.test(value)) {
      violations.push({ file, rule: 'pin', message: `${value} is not pinned to a commit SHA` });
      continue;
    }
    const lines = rawLines.filter((line) => line.value === value);
    if (lines.length === 0 || lines.some((line) => !VERSION_COMMENT.test(line.comment))) {
      violations.push({ file, rule: 'pin', message: `${value} has no "# v<version>" comment` });
    }
  }
  return violations;
}

/** The secret names a job's text references (`secrets[...]` counts as `[`). */
function secretNames(job: unknown): string[] {
  const text = JSON.stringify(job);
  return [...text.matchAll(SECRET_REFERENCE)].map((match) => match[1] ?? '[');
}

function checkJob(file: string, id: string, job: unknown, isCi: boolean): Violation[] {
  const violations: Violation[] = [];
  const add = (rule: string, message: string): void => {
    violations.push({ file, rule, message: `job ${id}: ${message}` });
  };
  if (!isMap(job)) {
    add('parse', 'is not a map');
    return violations;
  }
  if (job['runs-on'] !== RUNNER) {
    add('runner', `runs-on must be exactly ${RUNNER}`);
  }
  const timeout = job['timeout-minutes'];
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0) {
    add('timeout', 'timeout-minutes must be a positive integer');
  }
  const permissions = job.permissions;
  if (permissions !== undefined) {
    if (!isMap(permissions)) {
      add('job-permissions', 'permissions must be a map of contents, pull-requests or actions');
    } else {
      for (const [key, value] of Object.entries(permissions)) {
        const allowed = JOB_PERMISSIONS[key];
        if (allowed === undefined || typeof value !== 'string' || !allowed.includes(value)) {
          add('job-permissions', `permission ${key}: ${String(value)} is not allowed`);
        }
      }
    }
  }
  const secrets = secretNames(job);
  const environment = job.environment;
  if (
    secrets.some((name) => name !== 'GITHUB_TOKEN') &&
    (environment === undefined || environment === null || environment === '')
  ) {
    add('secrets', 'references a secret but declares no environment');
  }
  if (isCi && secrets.length > 0) {
    add('ci-secrets', 'ci.yml may use no secret');
  }
  return violations;
}

function checkSchedule(file: string, workflow: YamlMap, on: YamlMap): Violation[] {
  const violations: Violation[] = [];
  const add = (message: string): void => {
    violations.push({ file, rule: 'schedule', message });
  };
  if (!('workflow_dispatch' in on)) {
    add('a scheduled workflow also needs workflow_dispatch');
  }
  if ('push' in on) {
    add('a scheduled workflow has no push trigger');
  }
  const schedule = on.schedule;
  const entries = Array.isArray(schedule) ? schedule : [];
  if (entries.length === 0) {
    add('schedule must be a list of cron entries');
  }
  for (const entry of entries) {
    const cron = isMap(entry) ? entry.cron : undefined;
    if (typeof cron !== 'string') {
      add('every schedule entry needs a cron string');
      continue;
    }
    const minuteField = cron.trim().split(/\s+/)[0] ?? '';
    try {
      if (cronMinutes(minuteField).includes(0)) {
        add(`cron "${cron}" can fire at minute 0`);
      }
    } catch (error) {
      add(error instanceof Error ? error.message : `cron "${cron}" is not readable`);
    }
  }
  const concurrency = workflow.concurrency;
  if (!isMap(concurrency) || concurrency.group !== workflow.name) {
    add(`concurrency.group must be the workflow's name (${String(workflow.name)})`);
  }
  if (!isMap(concurrency) || concurrency['cancel-in-progress'] !== false) {
    add('concurrency.cancel-in-progress must be false');
  }
  return violations;
}

/** Every rule a workflow file breaks. */
export function checkWorkflowText(file: string, text: string): Violation[] {
  const parsed = parseYaml(text);
  if (!parsed.ok) {
    return [{ file, rule: 'parse', message: `does not parse: ${parsed.error}` }];
  }
  const workflow = parsed.value;
  if (!isMap(workflow)) {
    return [{ file, rule: 'parse', message: 'is not a map' }];
  }
  const missing = ['name', 'on', 'jobs'].filter((key) => workflow[key] === undefined);
  if (missing.length > 0 || !isMap(workflow.jobs)) {
    return [
      {
        file,
        rule: 'parse',
        message: missing.length > 0 ? `lacks ${missing.join(', ')}` : 'jobs is not a map',
      },
    ];
  }
  const violations: Violation[] = [];
  const permissions = workflow.permissions;
  if (
    !isMap(permissions) ||
    Object.keys(permissions).length !== 1 ||
    permissions.contents !== 'read'
  ) {
    violations.push({
      file,
      rule: 'permissions',
      message: 'top-level permissions must be exactly { contents: read }',
    });
  }
  const triggers = triggerNames(workflow.on);
  if (triggers.includes('pull_request_target')) {
    violations.push({ file, rule: 'trigger', message: 'pull_request_target is not allowed' });
  }
  if (triggers.includes('schedule')) {
    const on = isMap(workflow.on) ? workflow.on : {};
    violations.push(...checkSchedule(file, workflow, on));
  }
  const isCi = basename(file) === 'ci.yml';
  const uses: string[] = [];
  for (const [id, job] of Object.entries(workflow.jobs)) {
    violations.push(...checkJob(file, id, job, isCi));
    if (isMap(job)) {
      uses.push(...stepUses(job.steps));
      if (typeof job.uses === 'string') {
        uses.push(job.uses);
      }
    }
  }
  violations.push(...pinViolations(file, text, uses));
  return violations;
}

/** Every rule a composite action file breaks. */
export function checkActionText(file: string, text: string): Violation[] {
  const parsed = parseYaml(text);
  if (!parsed.ok) {
    return [{ file, rule: 'parse', message: `does not parse: ${parsed.error}` }];
  }
  const action = parsed.value;
  if (!isMap(action) || !isMap(action.runs)) {
    return [{ file, rule: 'parse', message: 'lacks runs' }];
  }
  return pinViolations(file, text, stepUses(action.runs.steps));
}

/** Repository-relative paths of every workflow file and every action.yml under .github/actions. */
export function workflowFiles(root: string): { workflows: string[]; actions: string[] } {
  const list = (dir: string): string[] => {
    try {
      return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
        .map((name) => join(dir, name))
        .sort();
    } catch {
      return [];
    }
  };
  const workflows = list('.github/workflows').filter(
    (path) => /\.ya?ml$/.test(path) && relative('.github/workflows', path) === basename(path),
  );
  const actions = list('.github/actions').filter((path) => /(^|\/)action\.ya?ml$/.test(path));
  return { workflows, actions };
}

function main(): number {
  const root = repoRoot();
  const { workflows, actions } = workflowFiles(root);
  const violations = [
    ...workflows.flatMap((file) => checkWorkflowText(file, readFileSync(join(root, file), 'utf8'))),
    ...actions.flatMap((file) => checkActionText(file, readFileSync(join(root, file), 'utf8'))),
  ];
  for (const { file, rule, message: detail } of violations) {
    console.log(`${file}: ${rule} ${detail}`);
  }
  if (violations.length > 0) {
    return 1;
  }
  console.log(`check-workflows: ${String(workflows.length + actions.length)} files ok`);
  return 0;
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
