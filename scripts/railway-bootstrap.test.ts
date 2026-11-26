import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { CORSRule } from '@aws-sdk/client-s3';
import { BRAND } from '@citizenrun/shared';
import type * as Shared from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaCorsRules } from './lib/cors.ts';
import { repoRoot } from './lib/repo-root.ts';
import {
  createPrompt,
  fillRoleMarkers,
  OWNER_VALUE_TARGETS,
  parseInputsFile,
  runBootstrap,
  scramKeys,
  scramVerifier,
  SEALED,
  stripRolePasswords,
} from './railway-bootstrap.ts';
import type { BootstrapIo, BucketCredentials } from './railway-bootstrap.ts';
import { createFakeCli } from './testing/fake-cli.ts';
import type { FakeCall, FakeCli, FakeRule } from './testing/fake-cli.ts';

// The brand's hosts are null until the owner gives the domain (OI-domain); the tests give fixture
// hosts through getters, so a case can set one back to null.
const hosts = vi.hoisted(() => {
  const state: Record<
    'domain' | 'stagingHost' | 'stagingAdminHost' | 'productionHost' | 'productionAdminHost',
    string | null
  > = {
    domain: 'example.test',
    stagingHost: 'staging.example.test',
    stagingAdminHost: 'admin.staging.example.test',
    productionHost: 'example.test',
    productionAdminHost: 'admin.example.test',
  };
  return state;
});

vi.mock('@citizenrun/shared', async (importOriginal) => {
  const real = await importOriginal<typeof Shared>();
  const { variants } = real.BRAND;
  return {
    ...real,
    BRAND: {
      ...real.BRAND,
      get domain() {
        return hosts.domain;
      },
      variants: {
        development: variants.development,
        staging: {
          ...variants.staging,
          get host() {
            return hosts.stagingHost;
          },
          get adminHost() {
            return hosts.stagingAdminHost;
          },
        },
        production: {
          ...variants.production,
          get host() {
            return hosts.productionHost;
          },
          get adminHost() {
            return hosts.productionAdminHost;
          },
        },
      },
    },
  };
});

type Env = 'staging' | 'production';
type Service = 'postgres' | 'api' | 'worker' | 'backup' | 'admin';

const PROJECT_ID = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b';
const NEW_PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const WORKSPACE_TOKEN = 'fixture-railway-workspace-token';
const RESEND_KEY = 're_fixture_staging_resend';
const ADMIN_ADDRESS = 'admin-one@example.test';
const MAIL_HOST = 'mail.example.test';
const PROJECT_TOKEN = 'fixture-project-token-1234';
const DETERMINISTIC = Buffer.alloc(32, 0xab);
const APPLE_TEAM = 'fixture-team';
const APPLE_KEY = 'fixture-key';
const WEB_CLIENT = 'fixture-web-client';
const IOS_CLIENT = 'fixture-ios-client';
const REVIEW_ADDRESS = 'review-fixture@example.test';
const REVIEW_CODE = '246810';
const PREVIOUS_SECRET = 'cd'.repeat(32);
const GEO_KEY = 'fixture-geo-key';
const DATAGOV_KEY = 'fixture-datagov-key';
const DATA_KEY_ID = 'fixture-data-key-id';
const DATA_SECRET = 'fixture-data-secret';
const DATA_CREDENTIALS = {
  BUCKET: 'fixture-data-bucket',
  ENDPOINT: 'https://storage.example.test',
  REGION: 'auto',
  ACCESS_KEY_ID: DATA_KEY_ID,
  SECRET_ACCESS_KEY: DATA_SECRET,
};
const ROLES_SQL = readFileSync(join(repoRoot(), 'packages', 'db', 'sql', 'roles.sql'), 'utf8');
const PSQL = ['psql', '-U', 'citizenrun', '-d', 'citizenrun', '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
const SUCCESS = '[{"status":"SUCCESS","createdAt":"2026-11-01T00:00:00Z"}]';
const SSH_POSTGRES = ['ssh', '--service', 'postgres', '--environment', 'staging', '--'];
const SETTINGS_READ = [...SSH_POSTGRES, ...PSQL, '-A', '-t'];
const PG_ISREADY = [...SSH_POSTGRES, 'pg_isready', '-U', 'citizenrun', '-d', 'citizenrun'];
const REDEPLOY_POSTGRES = 'railway redeploy --service postgres --environment staging --yes';
const BOOTSTRAP = 'pnpm exec tsx scripts/railway-bootstrap.ts --env staging';
const APPLY = 'railway config apply --environment staging --yes';

/** `railway status --project <id> --environment <env> --json` with that many services in it. */
function statusWithServices(env: Env, services: number): string {
  const edges = Array.from({ length: services }, (_, index) => ({
    node: { id: `instance-${String(index)}` },
  }));
  return JSON.stringify({
    id: PROJECT_ID,
    name: BRAND.slug,
    environments: { edges: [{ node: { name: env, serviceInstances: { edges } } }] },
  });
}

function statusRule(env: Env, services: number, once = false): FakeRule {
  return {
    args: ['status', '--project', PROJECT_ID, '--environment', env, '--json'],
    stdout: statusWithServices(env, services),
    once,
  };
}

function envHosts(env: Env): { api: string | null; admin: string | null } {
  return env === 'staging'
    ? { api: hosts.stagingHost, admin: hosts.stagingAdminHost }
    : { api: hosts.productionHost, admin: hosts.productionAdminHost };
}

function domainList(service: 'api' | 'admin', env: Env = 'staging'): string[] {
  return ['domain', 'list', '--service', service, '--environment', env, '--json'];
}

function domainCreate(host: string, service: 'api' | 'admin', env: Env = 'staging'): string[] {
  return ['domain', host, '--service', service, '--port', '8080', '--environment', env, '--json'];
}

/** `railway domain list --json` showing the service's custom domain, as on a later run. */
function domainListRules(env: Env): FakeRule[] {
  return (['api', 'admin'] as const).map((service) => {
    const host = envHosts(env)[service];
    return {
      args: domainList(service, env),
      stdout: JSON.stringify({
        serviceDomains: [],
        customDomains:
          host === null ? [] : [{ id: `fixture-${service}`, domain: host, targetPort: 8080 }],
      }),
    };
  });
}

// The database's deployments around a redeploy: the old one alone before it and once after it
// (the list lags the redeploy), then the new one building, then the new one up.
function redeployedDatabase(): FakeRule[] {
  const list = [
    'deployment',
    'list',
    '--service',
    'postgres',
    '--environment',
    'staging',
    '--json',
  ];
  const old = { id: 'dep-old', status: 'SUCCESS', createdAt: '2026-11-01T00:00:00Z' };
  const fresh = { id: 'dep-new', createdAt: '2026-11-02T00:00:00Z' };
  return [
    { args: list, stdout: JSON.stringify([old]), once: true },
    { args: list, stdout: JSON.stringify([old]), once: true },
    { args: list, stdout: JSON.stringify([{ ...fresh, status: 'BUILDING' }, old]), once: true },
    { args: list, stdout: JSON.stringify([{ ...fresh, status: 'SUCCESS' }, old]) },
  ];
}
const ALL_KEYS_LISTED: Partial<Record<Service, Record<string, string | null>>> = {
  postgres: {
    POSTGRES_PASSWORD: null,
    API_DB_PASSWORD: null,
    WORKER_DB_PASSWORD: null,
    BACKUP_DB_PASSWORD: null,
    ADMIN_DB_PASSWORD: null,
  },
  api: { APP_SECRET: null },
  worker: { APP_SECRET: null },
  admin: { APP_SECRET: null },
};

let keyFolder = '';
let publicKey4096 = '';
let publicKey2048 = '';
let appleKeyFile = '';
let appleKeyText = '';
let rsaPrivateKeyFile = '';
let p384KeyFile = '';

/** The three Apple keys and the two Google keys of the inputs file, with fixture values. */
function signInInputs(): Record<string, string> {
  return {
    APPLE_TEAM_ID: APPLE_TEAM,
    APPLE_KEY_ID: APPLE_KEY,
    APPLE_PRIVATE_KEY_FILE: appleKeyFile,
    GOOGLE_CLIENT_IDS: `${WEB_CLIENT},${IOS_CLIENT}`,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB_CLIENT,
  };
}

/** The base64 body of the Apple key file: the part a leak would show. */
function appleKeyBody(): string {
  return appleKeyText
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('-----'))
    .join('');
}

beforeAll(async () => {
  keyFolder = await mkdtemp(join(tmpdir(), 'bootstrap-keys-'));
  const pem = (bits: number): string =>
    generateKeyPairSync('rsa', { modulusLength: bits }).publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string; // spki with format pem is a string
  publicKey4096 = join(keyFolder, 'backup-fixture-4096.pub.pem');
  publicKey2048 = join(keyFolder, 'backup-fixture-2048.pub.pem');
  await writeFile(publicKey4096, pem(4096));
  await writeFile(publicKey2048, pem(2048));
  const pkcs8 = (key: ReturnType<typeof generateKeyPairSync>['privateKey']): string =>
    key.export({ type: 'pkcs8', format: 'pem' }) as string; // pkcs8 with format pem is a string
  appleKeyText = pkcs8(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey);
  appleKeyFile = join(keyFolder, 'AuthKey_fixture.p8');
  await writeFile(appleKeyFile, appleKeyText);
  rsaPrivateKeyFile = join(keyFolder, 'rsa-fixture.p8');
  await writeFile(
    rsaPrivateKeyFile,
    pkcs8(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
  );
  p384KeyFile = join(keyFolder, 'p384-fixture.p8');
  await writeFile(
    p384KeyFile,
    pkcs8(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey),
  );
}, 60_000);

afterAll(async () => {
  await rm(keyFolder, { recursive: true, force: true });
});

const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  hosts.domain = 'example.test';
  hosts.stagingHost = 'staging.example.test';
  hosts.stagingAdminHost = 'admin.staging.example.test';
  hosts.productionHost = 'example.test';
  hosts.productionAdminHost = 'admin.example.test';
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function tempFolder(prefix: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

type CaseOptions = {
  env?: Env;
  /** Overrides of the default inputs file; null leaves a key out. */
  inputs?: Readonly<Record<string, string | null>>;
  /** Rules tried before the defaults. */
  railway?: readonly FakeRule[];
  gh?: readonly FakeRule[];
  lists?: Partial<Record<Service, Record<string, string | null>>>;
  deployments?: Partial<Record<Service, string>>;
  apiHistory?: string;
  environments?: string;
  secretList?: string;
  ioEnv?: Readonly<Record<string, string | undefined>>;
  prompt?: BootstrapIo['prompt'];
  deterministic?: boolean;
  corsReadBack?: CORSRule[];
  home?: string;
  /** What `https://<host>/readyz` answers; by default 200 with db ok. */
  readyz?: { status: number; body: string };
};

type CaseResult = {
  code: number;
  lines: string[];
  output: string;
  calls: FakeCall[];
  home: string;
  s3Credentials: BucketCredentials[];
  corsPuts: CORSRule[][];
  fetched: string[];
  prompts: { question: string; hidden: boolean }[];
};

function inputsFile(overrides: Readonly<Record<string, string | null>> = {}): string {
  const values: Record<string, string | null> = {
    RAILWAY_PROJECT_ID: PROJECT_ID,
    MAIL_HOST,
    ADMIN_EMAILS: ADMIN_ADDRESS,
    RESEND_API_KEY: RESEND_KEY,
    BACKUP_PUBLIC_KEY_FILE: publicKey4096,
    ...overrides,
  };
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

type UsageStatusOptions = {
  usageLimit?: { softLimit: number; hardLimit: number | null; isOverLimit: boolean } | null;
  hardLimitCents?: number | null;
};

/** The JSON `railway usage limit status --json` prints at the pinned version. */
function usageStatus(options: UsageStatusOptions = {}): string {
  return JSON.stringify({
    action: 'status',
    workspace: { id: 'fixture-workspace', name: 'fixture' },
    customer: null,
    workspaceUsage: {
      currentUsageDollars: 3.5,
      usageLimit:
        options.usageLimit === undefined
          ? { softLimit: 80, hardLimit: 110, isOverLimit: false }
          : options.usageLimit,
    },
    agentUsage: {
      totalUsedCents: 0,
      hardLimitCents: options.hardLimitCents === undefined ? 0 : options.hardLimitCents,
      softLimitCents: null,
    },
  });
}

function defaultRules(env: Env, options: CaseOptions): { railway: FakeRule[]; gh: FakeRule[] } {
  const listRules: FakeRule[] = (['postgres', 'api', 'worker', 'backup', 'admin'] as const).map(
    (service) => ({
      args: ['variable', 'list', '--service', service, '--environment', env, '--json'],
      stdout: JSON.stringify(options.lists?.[service] ?? {}),
    }),
  );
  const deploymentRules: FakeRule[] = (
    ['postgres', 'api', 'worker', 'backup', 'admin'] as const
  ).map((service) => ({
    args: ['deployment', 'list', '--service', service, '--environment', env, '--json'],
    stdout: options.deployments?.[service] ?? SUCCESS,
  }));
  const ssh = ['ssh', '--service', 'postgres', '--environment', env, '--'];
  const tokenSecret = env === 'staging' ? 'RAILWAY_TOKEN_STAGING' : 'RAILWAY_TOKEN_PRODUCTION';
  const readyVariable = env === 'staging' ? 'RAILWAY_STAGING_READY' : 'RAILWAY_PRODUCTION_READY';
  return {
    railway: [
      ...(options.railway ?? []),
      { args: ['--version'], stdout: 'railway 5.74.0\n' },
      { args: ['whoami'], stdout: 'fixture-user\n' },
      {
        args: ['init', '--name', BRAND.slug, '--json'],
        stdout: JSON.stringify({ id: NEW_PROJECT_ID, name: BRAND.slug }),
      },
      { args: ['link', '--project', PROJECT_ID, '--environment', env] },
      { args: ['link', '--project', PROJECT_ID] },
      {
        args: ['environment', 'list', '--json'],
        stdout: options.environments ?? '[{"name":"production"},{"name":"staging"}]',
      },
      { args: ['environment', 'new', env] },
      { args: ['environment', 'delete', 'production', '--yes'] },
      { args: ['config', 'apply', '--environment', env, '--yes'] },
      statusRule(env, 5),
      ...domainListRules(env),
      ...listRules,
      {
        args: [
          'variable',
          'set',
          /^[A-Z][A-Z0-9_]*$/,
          '--stdin',
          '--service',
          /^[a-z]+$/,
          '--environment',
          env,
          '--skip-deploys',
        ],
        captureStdin: true,
      },
      {
        args: [
          'deployment',
          'list',
          '--service',
          'api',
          '--environment',
          env,
          '--json',
          '--limit',
          '1000',
        ],
        stdout: options.apiHistory ?? '[]',
      },
      ...deploymentRules,
      { args: [...ssh, 'pg_isready', '-U', 'citizenrun', '-d', 'citizenrun'] },
      { args: [...ssh, ...PSQL], captureStdin: true },
      { args: [...ssh, ...PSQL, '-A', '-t'], stdout: '512MB|100|POSTGIS="3.7.0"\n' },
      { args: ['redeploy', '--service', /^[a-z]+$/, '--environment', env, '--yes'] },
      {
        args: ['bucket', 'credentials', '-b', 'media', '-e', env, '--json'],
        stdout: JSON.stringify({
          BUCKET: 'fixture-media-bucket',
          ENDPOINT: 'https://storage.example.test',
          REGION: 'auto',
          ACCESS_KEY_ID: 'fixture-access-key',
          SECRET_ACCESS_KEY: 'fixture-secret-key',
        }),
      },
      {
        args: ['bucket', 'credentials', '-b', 'data', '-e', env, '--json'],
        stdout: JSON.stringify(DATA_CREDENTIALS),
      },
      { args: ['usage', 'limit', 'set', '--target', 'workspace', '--soft', '80', '--hard', '110'] },
      { args: ['usage', 'limit', 'set', '--target', 'agent', '--hard', '0'] },
      { args: ['usage', 'limit', 'status', '--json'], stdout: usageStatus() },
    ],
    gh: [
      ...(options.gh ?? []),
      { args: ['auth', 'status'] },
      {
        args: ['secret', 'list', '--env', env, '--json', 'name'],
        stdout: options.secretList ?? '[]',
      },
      { args: ['secret', 'set', tokenSecret, '--env', env], captureStdin: true },
      { args: ['variable', 'set', readyVariable, '--body', 'true'] },
      {
        args: ['variable', 'set', /^DATA_(BUCKET|ENDPOINT|REGION)$/, '--env', env],
        captureStdin: true,
      },
      {
        args: ['secret', 'set', /^DATA_(ACCESS_KEY_ID|SECRET_ACCESS_KEY)$/, '--env', env],
        captureStdin: true,
      },
      { args: ['secret', 'set', 'FEC_API_KEY', '--env', env], captureStdin: true },
    ],
  };
}

async function runCase(argv: readonly string[], options: CaseOptions = {}): Promise<CaseResult> {
  const env = options.env ?? (argv.includes('production') ? 'production' : 'staging');
  const fake: FakeCli = await createFakeCli(defaultRules(env, options));
  cleanups.push(() => fake.cleanup());
  const root = await tempFolder('bootstrap-root-');
  await mkdir(join(root, 'packages', 'db', 'sql'), { recursive: true });
  await cp(
    join(repoRoot(), 'packages', 'db', 'sql', 'roles.sql'),
    join(root, 'packages', 'db', 'sql', 'roles.sql'),
  );
  await writeFile(join(root, `.env.railway.${env}`), inputsFile(options.inputs));
  const home = options.home ?? (await tempFolder('bootstrap-home-'));
  const lines: string[] = [];
  const s3Credentials: BucketCredentials[] = [];
  const corsPuts: CORSRule[][] = [];
  const fetched: string[] = [];
  const prompts: { question: string; hidden: boolean }[] = [];
  const prompt = options.prompt ?? (() => Promise.resolve(null));
  const io: BootstrapIo = {
    repoRoot: root,
    home,
    env: fake.env(options.ioEnv ?? { PATH: process.env.PATH, RAILWAY_API_TOKEN: WORKSPACE_TOKEN }),
    out: (line) => {
      lines.push(line);
    },
    prompt: (question, promptOptions) => {
      prompts.push({ question, hidden: promptOptions.hidden });
      return prompt(question, promptOptions);
    },
    ...(options.deterministic === true
      ? { randomBytes: (size: number) => Buffer.alloc(size, 0xab) }
      : {}),
    createS3: (credentials) => {
      s3Credentials.push(credentials);
      const client = createS3Client({ ...credentials, forcePathStyle: false });
      // The client's overloads include a callback form; the stub answers the promise form only.
      const sender = client as unknown as { send: (command: unknown) => Promise<unknown> };
      vi.spyOn(sender, 'send').mockImplementation((command: unknown) => {
        if (command instanceof PutBucketCorsCommand) {
          corsPuts.push(command.input.CORSConfiguration?.CORSRules ?? []);
          return Promise.resolve({});
        }
        if (command instanceof GetBucketCorsCommand) {
          return Promise.resolve({ CORSRules: options.corsReadBack ?? corsPuts.at(-1) ?? [] });
        }
        return Promise.reject(new Error('unexpected command'));
      });
      return client;
    },
    fetch: (input) => {
      fetched.push(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const answer = options.readyz ?? {
        status: 200,
        body: JSON.stringify({ db: 'ok', schema: 'ok' }),
      };
      return Promise.resolve(new Response(answer.body, { status: answer.status }));
    },
    sleep: () => Promise.resolve(),
  };
  const code = await runBootstrap(argv, io);
  return {
    code,
    lines,
    output: lines.join('\n'),
    calls: fake.calls(),
    home,
    s3Credentials,
    corsPuts,
    fetched,
    prompts,
  };
}

function joined(call: FakeCall): string {
  return `${call.tool} ${call.args.join(' ')}`;
}

function variableSets(calls: readonly FakeCall[], key?: string): FakeCall[] {
  return calls.filter(
    (call) =>
      call.tool === 'railway' &&
      call.args[0] === 'variable' &&
      call.args[1] === 'set' &&
      (key === undefined || call.args[2] === key),
  );
}

function serviceOf(call: FakeCall): string | undefined {
  return call.args[call.args.indexOf('--service') + 1];
}

function rolesSqlCall(calls: readonly FakeCall[]): FakeCall | undefined {
  return calls.find(
    (call) => call.args[0] === 'ssh' && call.args.at(-1) === '-q' && call.stdin !== undefined,
  );
}

function secretsFile(home: string, env: Env = 'staging'): string {
  return join(home, '.config', BRAND.slug, `secrets-${env}.json`);
}

describe('pure helpers', () => {
  it('the SCRAM verifier matches the RFC 7677 test vector', () => {
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const { storedKey, serverKey } = scramKeys('pencil', salt, 4096);
    expect(storedKey.toString('base64')).toBe('WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=');
    expect(serverKey.toString('base64')).toBe('wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=');
    expect(scramVerifier('pencil', salt)).toBe(
      'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=',
    );
  });

  it('a verifier uses 16 random salt bytes', () => {
    const first = scramVerifier('x');
    const second = scramVerifier('x');
    expect(first).not.toBe(second);
    for (const verifier of [first, second]) {
      const salt = /^SCRAM-SHA-256\$4096:([^$]+)\$/.exec(verifier)?.[1] ?? '';
      expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    }
  });

  it('marker replacement fills the four markers', () => {
    const verifiers = {
      api: scramVerifier('fixture-api'),
      worker: scramVerifier('fixture-worker'),
      backup: scramVerifier('fixture-backup'),
      admin: scramVerifier('fixture-admin'),
    };
    const sql = fillRoleMarkers(ROLES_SQL, verifiers);
    expect(sql).not.toContain('{{');
    for (const verifier of Object.values(verifiers)) {
      expect(sql.split(verifier)).toHaveLength(2);
    }
    expect(sql).toContain(`alter role app_admin login`);
  });

  it('marker replacement refuses a value containing a quote', () => {
    const bad = "SCRAM-SHA-256$4096:fixture'";
    const call = (): string =>
      fillRoleMarkers(ROLES_SQL, {
        api: bad,
        worker: scramVerifier('w'),
        backup: scramVerifier('b'),
        admin: scramVerifier('a'),
      });
    expect(call).toThrow('{{API_VERIFIER}}');
    try {
      call();
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(bad);
    }
  });

  it('marker replacement refuses a backslash, a line break or a marker in a value', () => {
    for (const bad of ['fixture\\x', 'fixture\nx', 'fixture{{x']) {
      expect(() =>
        fillRoleMarkers(ROLES_SQL, {
          api: scramVerifier('a'),
          worker: bad,
          backup: scramVerifier('b'),
          admin: scramVerifier('c'),
        }),
      ).toThrow('{{WORKER_VERIFIER}}');
    }
  });

  it('marker replacement refuses SQL missing a marker', () => {
    const sql = ROLES_SQL.replace(" password '{{BACKUP_VERIFIER}}'", '');
    expect(() =>
      fillRoleMarkers(sql, {
        api: scramVerifier('a'),
        worker: scramVerifier('w'),
        backup: scramVerifier('b'),
        admin: scramVerifier('c'),
      }),
    ).toThrow('{{BACKUP_VERIFIER}}');
  });

  it("stripping keeps the role's other attributes", () => {
    const sql = stripRolePasswords(ROLES_SQL, ['worker']);
    const line = sql.split('\n').find((text) => text.startsWith('alter role app_worker login'));
    expect(line).toBe(
      'alter role app_worker login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;',
    );
    expect(sql).toContain('{{API_VERIFIER}}');
    expect(sql).toContain('{{BACKUP_VERIFIER}}');
    expect(sql).toContain('{{ADMIN_VERIFIER}}');
    expect(sql).not.toContain('{{WORKER_VERIFIER}}');
  });
});

describe('the inputs file', () => {
  it('the inputs file parses the keys this version sets', () => {
    const parsed = parseInputsFile(
      [
        '# owner inputs for staging',
        `RAILWAY_PROJECT_ID=${PROJECT_ID}`,
        `MAIL_HOST=${MAIL_HOST}`,
        '',
        `ADMIN_EMAILS="${ADMIN_ADDRESS}"`,
        `RESEND_API_KEY=${RESEND_KEY}`,
        `BACKUP_PUBLIC_KEY_FILE='~/keys/backup-staging.pub.pem'`,
      ].join('\n'),
    );
    expect(parsed).toEqual({
      RAILWAY_PROJECT_ID: PROJECT_ID,
      MAIL_HOST,
      ADMIN_EMAILS: ADMIN_ADDRESS,
      RESEND_API_KEY: RESEND_KEY,
      BACKUP_PUBLIC_KEY_FILE: '~/keys/backup-staging.pub.pem',
    });
  });

  it('the inputs file refuses an unknown key and names it', () => {
    const call = (): unknown => parseInputsFile(`ADMIN_EMAIL=${ADMIN_ADDRESS}`);
    expect(call).toThrow('ADMIN_EMAIL');
    try {
      call();
    } catch (error) {
      expect(error instanceof Error ? error.message : '@').not.toContain('@');
    }
    // A swapped line and a wrapped value: the text before `=` is not shaped like a key.
    for (const text of [
      `${RESEND_KEY}=RESEND_API_KEY`,
      `RESEND_API_KEY=${RESEND_KEY}\nZmFrZS1rZXktdGFpbA=`,
    ]) {
      expect(() => parseInputsFile(text)).toThrow(/^inputs file line \d+ has an unknown key$/);
      try {
        parseInputsFile(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : RESEND_KEY;
        expect(message).not.toContain(RESEND_KEY);
        expect(message).not.toContain('ZmFrZS1rZXktdGFpbA');
      }
    }
  });

  it('the review sign-in pair comes together with a six-digit code', () => {
    const emails = 'REVIEW_SIGNIN_EMAILS=reviewer@example.test';
    expect(() => parseInputsFile(emails)).toThrow(/REVIEW_SIGNIN_EMAILS.*REVIEW_SIGNIN_CODE/);
    expect(() => parseInputsFile(`${emails}\nREVIEW_SIGNIN_CODE=12345`)).toThrow(
      'REVIEW_SIGNIN_CODE',
    );
    expect(() => parseInputsFile(`${emails}\nREVIEW_SIGNIN_CODE=1234567`)).toThrow(
      'REVIEW_SIGNIN_CODE',
    );
    expect(parseInputsFile(`${emails}\nREVIEW_SIGNIN_CODE=123456`)).toEqual({
      REVIEW_SIGNIN_EMAILS: 'reviewer@example.test',
      REVIEW_SIGNIN_CODE: '123456',
    });
  });

  it('an empty project id counts as absent', () => {
    expect(parseInputsFile(`RAILWAY_PROJECT_ID=\nMAIL_HOST=${MAIL_HOST}`)).toEqual({ MAIL_HOST });
    expect(parseInputsFile('RAILWAY_PROJECT_ID=""')).toEqual({});
    expect(() => parseInputsFile(`RAILWAY_PROJECT_ID=\nRAILWAY_PROJECT_ID=${PROJECT_ID}`)).toThrow(
      'RAILWAY_PROJECT_ID is given twice',
    );
  });

  it('formats are checked and errors never carry the value', () => {
    for (const line of [
      'RAILWAY_PROJECT_ID=fixture-not-a-uuid',
      'MAIL_HOST=Mail.Example.Test',
      'MAIL_HOST=localhost',
      'ADMIN_EMAILS=fixture-no-at-sign',
      'RESEND_API_KEY=re_fixture with-space',
      'APP_SECRET_PREVIOUS=fixture-short',
    ]) {
      const [key, value] = line.split('=') as [string, string];
      let message = '';
      try {
        parseInputsFile(line);
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).toContain(key);
      expect(message).not.toContain(value);
    }
  });
});

describe('preflight', { timeout: 30_000 }, () => {
  it('refuses to start when both Railway tokens are set', async () => {
    const result = await runCase(['--env', 'staging'], {
      ioEnv: {
        PATH: process.env.PATH,
        RAILWAY_API_TOKEN: WORKSPACE_TOKEN,
        RAILWAY_TOKEN: 'fixture-railway-project-token',
      },
    });
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.output).toContain('preflight fail');
    expect(result.output).not.toContain(WORKSPACE_TOKEN);
  });

  it('preflight refuses another CLI version', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [{ args: ['--version'], stdout: 'railway 5.73.0\n' }],
    });
    expect(result.code).toBe(1);
    expect(
      result.lines.some((line) => line.startsWith('preflight fail') && line.includes('5.74.0')),
    ).toBe(true);
    expect(result.output).not.toContain('report');
  });

  it('preflight refuses a backup key that is not RSA 4096', async () => {
    const result = await runCase(['--env', 'staging'], {
      inputs: { BACKUP_PUBLIC_KEY_FILE: publicKey2048 },
    });
    expect(result.code).toBe(1);
    expect(
      result.lines.some(
        (line) =>
          line.startsWith('preflight fail') &&
          line.includes('BACKUP_PUBLIC_KEY_FILE (OI-backup-key)'),
      ),
    ).toBe(true);
  });

  it('a null host stops preflight naming the key and its owner input', async () => {
    hosts.stagingHost = null;
    const result = await runCase(['--env', 'staging']);
    expect(result.code).toBe(1);
    expect(
      result.lines.some(
        (line) =>
          line.startsWith('preflight fail') &&
          line.includes('variants.staging.host') &&
          line.includes('OI-domain'),
      ),
    ).toBe(true);
    expect(result.calls.some((call) => call.args[0] === 'link')).toBe(false);
  });

  it('a missing workspace token stops a real run but not a dry run', async () => {
    const real = await runCase(['--env', 'staging', '--only', 'preflight'], {
      ioEnv: { PATH: process.env.PATH },
    });
    expect(real.code).toBe(1);
    expect(real.output).toContain('RAILWAY_API_TOKEN');
    const dry = await runCase(['--env', 'staging', '--only', 'preflight', '--dry-run'], {
      ioEnv: { PATH: process.env.PATH },
    });
    expect(dry.code).toBe(0);
  });

  it('a failing whoami with a token set says the token may be workspace-scoped', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'preflight'], {
      railway: [{ args: ['whoami'], stderr: 'Unauthorized\n', exitCode: 1 }],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'preflight fail railway whoami: exit 1 (OI-railway); RAILWAY_API_TOKEN may be a workspace or project token: use an account token created with "No workspace"',
    );
    expect(result.output).not.toContain(WORKSPACE_TOKEN);
  });

  it('usage errors exit 2', async () => {
    for (const argv of [
      [],
      ['--env', 'staging', '--only', 'nothing'],
      // FEC_API_KEY is copied to GitHub, never held on Railway, so it has nothing to rotate.
      ['--env', 'staging', '--rotate', 'FEC_API_KEY'],
    ]) {
      const result = await runCase(argv);
      expect(result.code).toBe(2);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatch(/^usage: /);
      expect(result.calls).toEqual([]);
    }
  });
});

describe('environment', { timeout: 30_000 }, () => {
  it('the first run creates the project and stops', async () => {
    const result = await runCase(['--env', 'staging'], { inputs: { RAILWAY_PROJECT_ID: null } });
    expect(result.code).toBe(0);
    expect(result.calls.map(joined)).toContain(`railway init --name ${BRAND.slug} --json`);
    expect(result.output).toContain(`RAILWAY_PROJECT_ID=${NEW_PROJECT_ID}`);
    expect(result.output).toContain('.env.railway.staging');
    const later = result.lines.filter(
      (line) => !line.startsWith('preflight ') && !line.startsWith('environment '),
    );
    expect(later).toEqual([]);
    expect(result.calls.some((call) => call.args[0] === 'link' || call.args[0] === 'config')).toBe(
      false,
    );
  });

  it('an empty project id line is a first run, not an invalid inputs file', async () => {
    const result = await runCase(['--env', 'staging'], { inputs: { RAILWAY_PROJECT_ID: '' } });
    expect(result.code).toBe(0);
    expect(result.output).not.toContain('RAILWAY_PROJECT_ID is not valid');
    expect(result.calls.map(joined)).toContain(`railway init --name ${BRAND.slug} --json`);
    expect(result.output).toContain(`RAILWAY_PROJECT_ID=${NEW_PROJECT_ID}`);
  });

  it('the first run passes RAILWAY_WORKSPACE to init as --workspace', async () => {
    const result = await runCase(['--env', 'staging'], {
      inputs: { RAILWAY_PROJECT_ID: null, RAILWAY_WORKSPACE: 'fixture-workspace' },
      railway: [
        {
          args: ['init', '--name', BRAND.slug, '--workspace', 'fixture-workspace', '--json'],
          stdout: JSON.stringify({ id: NEW_PROJECT_ID, name: BRAND.slug }),
        },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.calls.map(joined)).toContain(
      `railway init --name ${BRAND.slug} --workspace fixture-workspace --json`,
    );
    expect(result.output).toContain(`RAILWAY_PROJECT_ID=${NEW_PROJECT_ID}`);
  });

  it('init refused for want of a workspace names RAILWAY_WORKSPACE', async () => {
    const result = await runCase(['--env', 'staging'], {
      inputs: { RAILWAY_PROJECT_ID: null },
      railway: [
        {
          args: ['init', '--name', BRAND.slug, '--json'],
          stderr: '--workspace required in non-interactive mode (multiple workspaces available)\n',
          exitCode: 1,
        },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'environment fail railway init: exit 1: the account has more than one workspace; set RAILWAY_WORKSPACE in the inputs file',
    );
  });

  it('a dry run says the environment was not created', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment', '--dry-run'], {
      environments: '[{"name":"production","serviceInstances":[]}]',
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('environment ok dry-run: staging not created');
    expect(result.lines).toContain(
      'environment ok dry-run: the empty default environment production not deleted',
    );
    expect(result.lines).not.toContain('environment ok created staging');
  });

  it('no environment is created without the four required inputs', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment'], {
      inputs: { RESEND_API_KEY: null },
      environments: '[{"name":"production"}]',
    });
    expect(result.code).toBe(1);
    expect(
      result.lines.some(
        (line) =>
          line.startsWith('environment fail') && line.includes('RESEND_API_KEY (OI-resend)'),
      ),
    ).toBe(true);
    expect(result.calls.some((call) => joined(call).startsWith('railway environment new'))).toBe(
      false,
    );
  });

  it('the default production is deleted only by the run that creates staging', async () => {
    const creating = await runCase(['--env', 'staging', '--only', 'environment'], {
      environments: '[{"name":"production","serviceInstances":[]}]',
    });
    expect(creating.code).toBe(0);
    const order = creating.calls.map(joined);
    const created = order.indexOf('railway environment new staging');
    const deleted = order.indexOf('railway environment delete production --yes');
    expect(created).toBeGreaterThan(-1);
    expect(deleted).toBeGreaterThan(created);
    expect(order.filter((call) => call.includes('environment delete'))).toHaveLength(1);

    const existing = await runCase(['--env', 'staging', '--only', 'environment'], {
      environments: '[{"name":"production","serviceInstances":[]},{"name":"staging"}]',
    });
    expect(existing.code).toBe(0);
    expect(existing.calls.some((call) => /environment (new|delete)/.test(joined(call)))).toBe(
      false,
    );
  });

  it('production is left as an owner check when nothing tells whether it holds a service', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment'], {
      environments: '[{"name":"production"}]',
      railway: [
        {
          args: ['status', '--project', PROJECT_ID, '--environment', 'production', '--json'],
          stdout: '{}',
        },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(
      'environment owner-check delete the empty default environment production',
    );
    expect(result.calls.some((call) => joined(call).includes('environment delete'))).toBe(false);
  });

  it('a project with two environments is linked by environment name', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment'], {
      railway: [{ args: ['link', '--project', PROJECT_ID], exitCode: 1 }],
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('environment ok staging exists');
    const calls = result.calls.map(joined);
    expect(calls).toContain(`railway link --project ${PROJECT_ID} --environment staging`);
    expect(calls).not.toContain(`railway link --project ${PROJECT_ID}`);
  });

  it('a first run falls back to the plain link while the project holds one environment', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment'], {
      environments: '[{"name":"production"}]',
      railway: [
        { args: ['link', '--project', PROJECT_ID, '--environment', 'staging'], exitCode: 1 },
      ],
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    const byName = calls.indexOf(`railway link --project ${PROJECT_ID} --environment staging`);
    const plain = calls.indexOf(`railway link --project ${PROJECT_ID}`);
    expect(byName).toBeGreaterThan(-1);
    expect(plain).toBeGreaterThan(byName);
    expect(calls).toContain('railway environment new staging');
  });

  it('a link that fails in both forms stops the step', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'environment'], {
      environments: '[{"name":"production"}]',
      railway: [
        { args: ['link', '--project', PROJECT_ID, '--environment', 'staging'], exitCode: 1 },
        { args: ['link', '--project', PROJECT_ID], exitCode: 3 },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('environment fail railway link: exit 3 (OI-railway)');
    expect(result.calls.some((call) => joined(call).startsWith('railway environment new'))).toBe(
      false,
    );
    expect(result.calls.some((call) => joined(call).startsWith('railway environment list'))).toBe(
      false,
    );
  });

  it('a production run never deletes an environment', async () => {
    const result = await runCase(['--env', 'production', '--only', 'environment'], {
      environments: '[{"name":"staging","serviceInstances":[]}]',
    });
    expect(result.code).toBe(0);
    expect(result.calls.map(joined)).toContain('railway environment new production');
    expect(result.calls.some((call) => joined(call).includes('environment delete'))).toBe(false);
  });
});

describe('a full run', { timeout: 60_000 }, () => {
  it('a later key is accepted and skipped with its owner-input id', async () => {
    const result = await runCase(['--env', 'staging'], {
      inputs: { RESEND_WEBHOOK_SECRET: 'fixture-webhook-secret' },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(
      'skip RESEND_WEBHOOK_SECRET (OI-resend-webhook): not set by this version of the bootstrap',
    );
    expect(variableSets(result.calls, 'RESEND_WEBHOOK_SECRET')).toEqual([]);
    expect(result.output).not.toContain('fixture-webhook-secret');
  });

  it('the dry run prints no generated value and runs no mutating command', async () => {
    const result = await runCase(['--env', 'staging', '--dry-run'], {
      deterministic: true,
      secretList: '[{"name":"RAILWAY_TOKEN_STAGING"}]',
      inputs: {
        ...signInInputs(),
        REVIEW_SIGNIN_EMAILS: REVIEW_ADDRESS,
        REVIEW_SIGNIN_CODE: REVIEW_CODE,
        APP_SECRET_PREVIOUS: PREVIOUS_SECRET,
        GEO_API_KEY: GEO_KEY,
        FEC_API_KEY: DATAGOV_KEY,
      },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('<redacted>');
    // A dry run shows no data credential: each copy is printed with its value redacted.
    for (const line of [
      'dry-run gh variable set DATA_BUCKET --env staging (stdin <redacted>)',
      'dry-run gh variable set DATA_ENDPOINT --env staging (stdin <redacted>)',
      'dry-run gh variable set DATA_REGION --env staging (stdin <redacted>)',
      'dry-run gh secret set DATA_ACCESS_KEY_ID --env staging (stdin <redacted>)',
      'dry-run gh secret set DATA_SECRET_ACCESS_KEY --env staging (stdin <redacted>)',
      'dry-run gh secret set FEC_API_KEY --env staging (stdin <redacted>)',
      'dry-run railway variable set GEO_API_KEY --stdin --service api --environment staging --skip-deploys (stdin <redacted>)',
    ]) {
      expect(result.lines).toContain(line);
    }
    expect(result.lines).toContain('report github data values not set');
    for (const service of ['api', 'worker']) {
      expect(result.lines).toContain(
        `dry-run railway variable set APPLE_PRIVATE_KEY --stdin --service ${service} --environment staging --skip-deploys (stdin <redacted>)`,
      );
    }
    for (const secret of [
      DETERMINISTIC.toString('base64url'),
      DETERMINISTIC.toString('hex'),
      RESEND_KEY,
      ADMIN_ADDRESS,
      WORKSPACE_TOKEN,
      APPLE_TEAM,
      APPLE_KEY,
      appleKeyBody(),
      'PRIVATE KEY',
      WEB_CLIENT,
      IOS_CLIENT,
      REVIEW_ADDRESS,
      REVIEW_CODE,
      PREVIOUS_SECRET,
      GEO_KEY,
      DATAGOV_KEY,
      DATA_KEY_ID,
      DATA_SECRET,
      DATA_CREDENTIALS.BUCKET,
    ]) {
      expect(result.output).not.toContain(secret);
    }
    const forbidden = [
      /^railway init/,
      /^railway environment new/,
      /^railway environment delete/,
      /^railway config apply/,
      /^railway variable set/,
      /^railway ssh/,
      /^railway redeploy/,
      /^railway usage limit set/,
      /^gh secret set/,
      /^gh variable set/,
    ];
    for (const call of result.calls) {
      for (const pattern of forbidden) {
        expect(joined(call)).not.toMatch(pattern);
      }
    }
    expect(existsSync(secretsFile(result.home))).toBe(false);
    expect(existsSync(join(result.home, '.config'))).toBe(false);
    expect(result.corsPuts).toEqual([]);
    expect(result.fetched).toEqual([]);
    expect(result.prompts).toEqual([]);
    for (const step of [
      'preflight',
      'environment',
      'apply',
      'generate-secrets',
      'seal',
      'owner-values',
      'database',
      'bucket-cors',
      'usage-limits',
      'service-config-fallbacks',
      'volume-backups',
      'tokens',
      'redeploy',
      'report',
    ]) {
      expect(result.lines.some((line) => line.startsWith(`${step} `))).toBe(true);
    }
  });

  it('with no owner present the owner steps become owner checks', async () => {
    const result = await runCase(['--env', 'staging']);
    expect(result.code).toBe(0);
    // The values step 4 generates; the owner values are set by step 6, after the seal step.
    const generated = SEALED.filter(
      (row) => row.service === 'postgres' || row.key === 'APP_SECRET',
    ).map((row) => `seal owner-check seal ${row.service}/${row.key}`);
    expect(generated).toHaveLength(8);
    for (const line of generated) {
      expect(result.lines).toContain(line);
    }
    // The inputs file gives no sign-in, review or rotation value, so none is left to seal.
    expect(
      result.lines.filter((line) => /^(seal|owner-values) owner-check seal /.test(line)),
    ).toHaveLength(11);
    // The Resend key is set by the step after the seal step, which leaves it to seal.
    for (const service of ['api', 'worker', 'admin']) {
      expect(result.lines).toContain(`owner-values owner-check seal ${service}/RESEND_API_KEY`);
    }
    expect(result.lines).toContain('volume-backups owner-check volume backups for staging');
    expect(result.lines).toContain('tokens owner-check project token github-actions-staging');
    expect(result.lines).toContain('redeploy ok api and worker deployed; /readyz answers db ok');
    expect(result.lines).toContain('report owner-check volume backups for staging');
    expect(result.lines).toContain('report cors verified');
    expect(result.lines).toContain('report limits verified');
    expect(result.lines).toContain('report ready-variable not set');
    expect(result.calls.map(joined)).toContain('railway usage limit status --json');
  });

  it('the database step pipes verifiers, never passwords', async () => {
    const result = await runCase(['--env', 'staging']);
    expect(result.code).toBe(0);
    const recorded = JSON.parse(readFileSync(secretsFile(result.home), 'utf8')) as Record<
      string,
      string
    >; // written by the bootstrap as a flat object of strings
    const sql = rolesSqlCall(result.calls)?.stdin ?? '';
    expect(sql.match(/SCRAM-SHA-256\$4096:/g)).toHaveLength(4);
    expect(sql).not.toContain('{{');
    for (const key of [
      'API_DB_PASSWORD',
      'WORKER_DB_PASSWORD',
      'BACKUP_DB_PASSWORD',
      'ADMIN_DB_PASSWORD',
      'POSTGRES_PASSWORD',
      'APP_SECRET',
    ]) {
      const value = recorded[key];
      expect(value).toBeDefined();
      expect(sql).not.toContain(value ?? 'missing');
      expect(result.output).not.toContain(value ?? 'missing');
    }
    expect(result.output).toContain('database ok postgis_full_version');
    expect(result.output).toContain('database ok max_connections 100');
  });
});

describe('generate-secrets', { timeout: 30_000 }, () => {
  it('secrets are generated once and recorded with mode 0600', async () => {
    const first = await runCase(['--env', 'staging', '--only', 'generate-secrets']);
    expect(first.code).toBe(0);
    const sets = variableSets(first.calls);
    expect(
      sets
        .filter((call) => serviceOf(call) === 'postgres')
        .map((call) => call.args[2])
        .sort(),
    ).toEqual([
      'ADMIN_DB_PASSWORD',
      'API_DB_PASSWORD',
      'BACKUP_DB_PASSWORD',
      'POSTGRES_PASSWORD',
      'WORKER_DB_PASSWORD',
    ]);
    const appSecret = variableSets(first.calls, 'APP_SECRET');
    expect(appSecret.map(serviceOf)).toEqual(['api', 'worker', 'admin']);
    expect(new Set(appSecret.map((call) => call.stdinBytes))).toEqual(new Set([64]));
    expect(new Set(appSecret.map((call) => call.stdin)).size).toBe(1);
    for (const call of sets) {
      expect(call.args).toContain('--skip-deploys');
      expect(call.args.join(' ')).not.toContain(call.stdin ?? 'missing');
    }
    const path = secretsFile(first.home);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(first.home, '.config', BRAND.slug)).mode & 0o777).toBe(0o700);
    const recorded = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>; // flat strings
    expect(Object.keys(recorded).sort()).toEqual([
      'ADMIN_DB_PASSWORD',
      'API_DB_PASSWORD',
      'APP_SECRET',
      'BACKUP_DB_PASSWORD',
      'POSTGRES_PASSWORD',
      'WORKER_DB_PASSWORD',
    ]);
    expect(recorded.APP_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const second = await runCase(['--env', 'staging', '--only', 'generate-secrets'], {
      home: first.home,
      lists: ALL_KEYS_LISTED,
    });
    expect(second.code).toBe(0);
    expect(variableSets(second.calls)).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(recorded);
  });

  it('deterministic bytes give the documented encodings', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'generate-secrets'], {
      deterministic: true,
    });
    expect(result.code).toBe(0);
    expect(variableSets(result.calls, 'API_DB_PASSWORD')[0]?.stdin).toBe(
      DETERMINISTIC.toString('base64url'),
    );
    expect(variableSets(result.calls, 'APP_SECRET')[0]?.stdin).toBe(DETERMINISTIC.toString('hex'));
    expect(result.output).not.toContain(DETERMINISTIC.toString('hex'));
  });

  it('secrets are not generated after the api has deployed', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'generate-secrets'], {
      lists: { ...ALL_KEYS_LISTED, api: {} },
      apiHistory: '[{"status":"FAILED"},{"status":"SUCCESS"}]',
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'generate-secrets fail APP_SECRET is not listed on api but api has deployed; refusing to generate (RB-infra)',
    );
    expect(variableSets(result.calls)).toEqual([]);
  });

  it('APP_SECRET on some of the three services and not another is refused', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'generate-secrets'], {
      lists: { ...ALL_KEYS_LISTED, api: {} },
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'generate-secrets fail APP_SECRET is on worker and admin but not on api: set it from the password manager (RB-infra)',
    );
    expect(variableSets(result.calls)).toEqual([]);
  });

  it('--rotate APP_SECRET refuses while APP_SECRET_PREVIOUS is absent', async () => {
    const result = await runCase(
      ['--env', 'staging', '--rotate', 'APP_SECRET', '--only', 'generate-secrets'],
      { lists: ALL_KEYS_LISTED },
    );
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'generate-secrets fail --rotate APP_SECRET needs APP_SECRET_PREVIOUS on api, worker and admin',
    );
    expect(variableSets(result.calls)).toEqual([]);
  });

  it('--rotate APP_SECRET sets one new value on the three once the previous one is kept', async () => {
    const previous = { APP_SECRET: null, APP_SECRET_PREVIOUS: null };
    const result = await runCase(
      ['--env', 'staging', '--rotate', 'APP_SECRET', '--only', 'generate-secrets'],
      { lists: { ...ALL_KEYS_LISTED, api: previous, worker: previous, admin: previous } },
    );
    expect(result.code).toBe(0);
    const sets = variableSets(result.calls);
    expect(sets.map((call) => `${call.args[2] ?? ''} ${serviceOf(call) ?? ''}`)).toEqual([
      'APP_SECRET api',
      'APP_SECRET worker',
      'APP_SECRET admin',
    ]);
  });
});

describe('seal, owner values and database', { timeout: 30_000 }, () => {
  it('--only seal runs preflight and the seal step only', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'seal'], {
      lists: ALL_KEYS_LISTED,
    });
    expect(result.code).toBe(0);
    expect(result.calls.map(joined)).toEqual([
      'railway --version',
      'railway whoami',
      'gh auth status',
      'railway variable list --service postgres --environment staging --json',
      'railway variable list --service api --environment staging --json',
      'railway variable list --service worker --environment staging --json',
      'railway variable list --service admin --environment staging --json',
    ]);
    expect(result.lines.filter((line) => line.startsWith('seal owner-check'))).toHaveLength(8);
    expect(result.lines.some((line) => line.startsWith('report'))).toBe(false);
  });

  it('a confirmed seal is checked against the values the CLI still returns', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'seal'], {
      lists: {
        postgres: ALL_KEYS_LISTED.postgres ?? {},
        api: { APP_SECRET: null, RESEND_API_KEY: RESEND_KEY },
        worker: { APP_SECRET: null, RESEND_API_KEY: null },
        admin: { APP_SECRET: null, RESEND_API_KEY: null },
      },
      prompt: () => Promise.resolve('y'),
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('seal owner-check seal api/RESEND_API_KEY');
    expect(result.lines).toContain('seal ok sealed worker/RESEND_API_KEY');
    expect(result.lines).toContain('seal ok sealed postgres/POSTGRES_PASSWORD');
    expect(result.output).not.toContain(RESEND_KEY);
  });

  it('a later seal run compares with the generated-secrets file and checks what it cannot compare', async () => {
    const home = await tempFolder('bootstrap-home-');
    await mkdir(join(home, '.config', BRAND.slug), { recursive: true });
    await writeFile(
      secretsFile(home),
      JSON.stringify({ POSTGRES_PASSWORD: 'fixture-pg-password' }),
    );
    const result = await runCase(['--env', 'staging', '--only', 'seal'], {
      home,
      lists: {
        postgres: {
          ...(ALL_KEYS_LISTED.postgres ?? {}),
          POSTGRES_PASSWORD: 'fixture-pg-password',
          API_DB_PASSWORD: 'fixture-unknown-value',
        },
        api: { APP_SECRET: null },
        worker: { APP_SECRET: null },
        admin: { APP_SECRET: null },
      },
      prompt: () => Promise.resolve('y'),
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('seal owner-check seal postgres/POSTGRES_PASSWORD');
    expect(result.lines).toContain('seal owner-check seal postgres/API_DB_PASSWORD');
    expect(result.lines).toContain('seal ok sealed postgres/WORKER_DB_PASSWORD');
    expect(result.output).not.toContain('fixture-pg-password');
    expect(result.output).not.toContain('fixture-unknown-value');
  });

  it('a missing optional key skips its step with its owner-input id', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: { BACKUP_PUBLIC_KEY_FILE: null },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('skip BACKUP_PUBLIC_KEY (OI-backup-key)');
    expect(variableSets(result.calls, 'BACKUP_PUBLIC_KEY')).toEqual([]);
    // The sender is composed from MAIL_HOST, so it waits on that key's input alone.
    const noHost = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: { MAIL_HOST: null },
    });
    expect(noHost.code).toBe(0);
    expect(noHost.lines).toContain('owner-values skip EMAIL_FROM (OI-domain)');
    expect(variableSets(noHost.calls, 'EMAIL_FROM')).toEqual([]);
  });

  it('owner values compose EMAIL_FROM from the staging display name', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values']);
    expect(result.code).toBe(0);
    const sets = variableSets(result.calls, 'EMAIL_FROM');
    expect(sets.map(serviceOf)).toEqual(['api', 'worker', 'admin']);
    for (const call of sets) {
      expect(call.stdin).toBe(`${BRAND.variants.staging.displayName} <login@${MAIL_HOST}>`);
    }
  });

  it('owner values set the Resend key and the admin addresses on api, worker and admin', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values']);
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    for (const key of ['RESEND_API_KEY', 'ADMIN_EMAILS']) {
      for (const service of ['api', 'worker', 'admin']) {
        expect(calls).toContain(
          `railway variable set ${key} --stdin --service ${service} --environment staging --skip-deploys`,
        );
      }
    }
    for (const call of variableSets(result.calls, 'RESEND_API_KEY')) {
      expect(call.stdin).toBe(RESEND_KEY);
    }
    for (const call of variableSets(result.calls, 'ADMIN_EMAILS')) {
      expect(call.stdin).toBe(ADMIN_ADDRESS);
    }
    const placed = variableSets(result.calls).map(
      (call) => `${call.args[2] ?? ''} ${serviceOf(call) ?? ''}`,
    );
    for (const entry of placed) {
      expect(entry).toMatch(
        /^((RESEND_API_KEY|EMAIL_FROM|ADMIN_EMAILS) (api|worker|admin)|BACKUP_PUBLIC_KEY backup)$/,
      );
    }
    expect(placed).toContain('BACKUP_PUBLIC_KEY backup');
    const backupKey = variableSets(result.calls, 'BACKUP_PUBLIC_KEY')[0]?.stdin ?? '';
    expect(backupKey).toBe(readFileSync(publicKey4096, 'utf8'));
    expect(result.output).not.toContain(RESEND_KEY);
    expect(result.output).not.toContain(ADMIN_ADDRESS);
  });

  it('an equal value is skipped and a sealed one is replaced only with --rotate', async () => {
    const lists = {
      api: {
        RESEND_API_KEY: null,
        ADMIN_EMAILS: ADMIN_ADDRESS,
        EMAIL_FROM: 'fixture-old-sender',
      },
    };
    const kept = await runCase(['--env', 'staging', '--only', 'owner-values'], { lists });
    expect(kept.code).toBe(0);
    const keptOnApi = variableSets(kept.calls)
      .filter((call) => serviceOf(call) === 'api')
      .map((call) => call.args[2]);
    expect(keptOnApi).toEqual(['EMAIL_FROM']);
    expect(kept.output).toContain('owner-values skip ADMIN_EMAILS unchanged on api');

    const rotated = await runCase(
      ['--env', 'staging', '--only', 'owner-values', '--rotate', 'RESEND_API_KEY'],
      { lists },
    );
    expect(rotated.code).toBe(0);
    expect(variableSets(rotated.calls, 'RESEND_API_KEY').map(serviceOf)).toEqual([
      'api',
      'worker',
      'admin',
    ]);
  });

  it('a re-run keeps role passwords it does not know', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'database']);
    expect(result.code).toBe(0);
    const sql = rolesSqlCall(result.calls)?.stdin ?? '';
    expect(sql).toContain('alter role app_api login');
    expect(sql).not.toContain("password '");
    expect(sql).not.toContain('{{');
    expect(
      result.lines.filter((line) => line.startsWith('database ok password kept for')),
    ).toHaveLength(4);
    // A database that answers is never redeployed by the step's start (D-840).
    expect(result.calls.some((call) => call.args[0] === 'redeploy')).toBe(false);
  });

  it('a role password from the generated-secrets file gives that role a verifier', async () => {
    const home = await tempFolder('bootstrap-home-');
    await mkdir(join(home, '.config', BRAND.slug), { recursive: true });
    await writeFile(
      secretsFile(home),
      JSON.stringify({ API_DB_PASSWORD: 'fixture-api-db-password' }),
    );
    const result = await runCase(['--env', 'staging', '--only', 'database'], { home });
    expect(result.code).toBe(0);
    const sql = rolesSqlCall(result.calls)?.stdin ?? '';
    expect(sql.match(/SCRAM-SHA-256\$4096:/g)).toHaveLength(1);
    expect(sql).not.toContain('fixture-api-db-password');
    expect(result.lines.filter((line) => line.startsWith('database ok password kept for'))).toEqual(
      [
        'database ok password kept for app_worker',
        'database ok password kept for app_backup',
        'database ok password kept for app_admin',
      ],
    );
  });

  it('a shared_buffers value other than 512MB redeploys the database once', async () => {
    const result = await runCase(
      ['--env', 'staging', '--only', 'database', '--db-service', 'postgres'],
      {
        railway: [
          ...redeployedDatabase(),
          { args: SETTINGS_READ, stdout: `128MB|100|POSTGIS="3.7.0"\n` },
        ],
      },
    );
    expect(result.code).toBe(1);
    expect(result.calls.map(joined)).toContain(
      'railway redeploy --service postgres --environment staging --yes',
    );
    expect(result.output).toContain(
      'database fail shared_buffers is 128MB after the redeploy, not 512MB',
    );
  });

  it('after the redeploy the settings are read only once the new deployment is up', async () => {
    const result = await runCase(
      ['--env', 'staging', '--only', 'database', '--db-service', 'postgres'],
      {
        railway: [
          ...redeployedDatabase(),
          // The instance still being replaced answers 128MB; the new one answers 512MB.
          { args: SETTINGS_READ, stdout: `128MB|100|POSTGIS="3.7.0"\n`, once: true },
        ],
      },
    );
    expect(result.code).toBe(0);
    expect(result.lines).toContain('database ok shared_buffers 512MB');
    const calls = result.calls.map(joined);
    const redeployAt = calls.indexOf(
      'railway redeploy --service postgres --environment staging --yes',
    );
    const after = calls.slice(redeployAt + 1);
    const deploymentList =
      'railway deployment list --service postgres --environment staging --json';
    expect(after.slice(0, 3)).toEqual([deploymentList, deploymentList, deploymentList]);
    expect(after[3]).toMatch(/ pg_isready /);
    expect(after[4]).toMatch(/ -A -t$/);
  });

  it('a missing SSH key stops the database step at once and names it', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'database'], {
      railway: [
        {
          args: [...SSH_POSTGRES, 'pg_isready', '-U', 'citizenrun', '-d', 'citizenrun'],
          stderr: 'No registered SSH keys found. Register one with: railway ssh keys add\n',
          exitCode: 1,
        },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'database fail railway ssh has no registered SSH key: run pnpm exec railway ssh keys add in your terminal (RB-infra)',
    );
    expect(result.calls.filter((call) => call.args.includes('pg_isready'))).toHaveLength(1);
  });

  it('a database that does not answer on a new environment is redeployed before roles.sql', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [{ args: PG_ISREADY, exitCode: 1, once: true }, ...redeployedDatabase()],
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    expect(calls.filter((call) => call === REDEPLOY_POSTGRES)).toHaveLength(1);
    const setPassword = calls.findIndex((call) =>
      call.startsWith('railway variable set POSTGRES_PASSWORD '),
    );
    const firstProbe = calls.findIndex((call) => call.includes(' pg_isready '));
    const redeployAt = calls.indexOf(REDEPLOY_POSTGRES);
    const answered = calls.findIndex(
      (call, index) => index > redeployAt && call.includes(' pg_isready '),
    );
    const roles = result.calls.findIndex(
      (call) => call.args[0] === 'ssh' && call.args.at(-1) === '-q' && call.stdin !== undefined,
    );
    expect(setPassword).toBeGreaterThan(-1);
    expect(setPassword).toBeLessThan(firstProbe);
    expect(firstProbe).toBeLessThan(redeployAt);
    // The new deployment is polled until it is up before the database is asked again.
    expect(calls.slice(redeployAt + 1, answered)).toEqual([
      'railway deployment list --service postgres --environment staging --json',
      'railway deployment list --service postgres --environment staging --json',
      'railway deployment list --service postgres --environment staging --json',
    ]);
    expect(answered).toBeLessThan(roles);
    expect(result.lines).toContain(
      'database ok postgres did not answer; redeployed with its variables, and it answers',
    );
  });

  it('a database that does not answer once api has deployed is not redeployed', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'database'], {
      railway: [{ args: PG_ISREADY, exitCode: 1 }],
      apiHistory: SUCCESS,
    });
    expect(result.code).toBe(1);
    expect(result.calls.some((call) => call.args[0] === 'redeploy')).toBe(false);
    expect(result.lines).toContain(
      'database fail pg_isready on postgres did not answer after 30 tries',
    );
    expect(result.lines.at(-1)).toBe(
      `next api has deployed, so the step does not redeploy postgres: read pnpm exec railway logs --service postgres --environment staging; then run: ${BOOTSTRAP} --only database`,
    );
  });

  it('a refused database redeploy says to wait for the running deployment', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'database'], {
      railway: [
        { args: PG_ISREADY, exitCode: 1 },
        {
          args: ['redeploy', '--service', 'postgres', '--environment', 'staging', '--yes'],
          stderr: 'The latest deployment for service postgres cannot be redeployed\n',
          exitCode: 1,
        },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('database fail redeploy postgres: exit 1');
    expect(result.lines.at(-1)).toBe(
      `next wait until pnpm exec railway deployment list --service postgres --environment staging shows no postgres deployment building or deploying (the CLI refuses a redeploy until then); then run: ${BOOTSTRAP} --only database`,
    );
    expect(result.output).not.toContain('cannot be redeployed');
  });
});

describe('buckets, tokens, redeploy and report', { timeout: 30_000 }, () => {
  it('bucket CORS uses the staging origins and is verified', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'bucket-cors']);
    expect(result.code).toBe(0);
    expect(result.corsPuts).toEqual([
      mediaCorsRules([
        'https://staging.example.test',
        'https://admin.staging.example.test',
        'http://localhost:8081',
      ]).CORSRules,
    ]);
    expect(result.s3Credentials).toEqual([
      {
        bucket: 'fixture-media-bucket',
        endpoint: 'https://storage.example.test',
        region: 'auto',
        accessKeyId: 'fixture-access-key',
        secretAccessKey: 'fixture-secret-key',
      },
    ]);
    expect(result.lines).toContain('bucket-cors ok media CORS set and verified');
    expect(result.output).not.toContain('fixture-secret-key');

    const mismatch = await runCase(['--env', 'staging', '--only', 'bucket-cors'], {
      corsReadBack: mediaCorsRules(['https://staging.example.test']).CORSRules,
    });
    expect(mismatch.code).toBe(1);
    expect(mismatch.lines.some((line) => line.startsWith('bucket-cors fail'))).toBe(true);
  });

  it('bucket credentials in camel case are accepted', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'bucket-cors'], {
      railway: [
        {
          args: ['bucket', 'credentials', '-b', 'media', '-e', 'staging', '--json'],
          stdout: JSON.stringify({
            bucketName: 'fixture-media-bucket',
            endpoint: 'https://storage.example.test',
            region: 'auto',
            accessKeyId: 'fixture-access-key',
            secretAccessKey: 'fixture-secret-key',
          }),
        },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.s3Credentials[0]?.bucket).toBe('fixture-media-bucket');
  });

  it('production CORS holds the site and the admin host', async () => {
    const result = await runCase(['--env', 'production', '--only', 'bucket-cors']);
    expect(result.code).toBe(0);
    expect(result.corsPuts).toEqual([
      mediaCorsRules(['https://example.test', 'https://admin.example.test']).CORSRules,
    ]);
  });

  it('the token is passed on standard input and never printed', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'tokens'], {
      prompt: () => Promise.resolve(PROJECT_TOKEN),
    });
    expect(result.code).toBe(0);
    const set = result.calls.find(
      (call) => joined(call) === 'gh secret set RAILWAY_TOKEN_STAGING --env staging',
    );
    expect(set?.stdin).toBe(PROJECT_TOKEN);
    expect(set?.args).not.toContain(PROJECT_TOKEN);
    expect(result.output).not.toContain(PROJECT_TOKEN);
    expect(result.prompts).toEqual([
      {
        question:
          'Create a project token named github-actions-staging scoped to staging (Project settings, Tokens) and paste it (empty to leave it for later):',
        hidden: true,
      },
    ]);
  });

  it('the ready variable is set only when the token secret exists', async () => {
    const without = await runCase(['--env', 'staging', '--only', 'redeploy']);
    expect(without.code).toBe(0);
    expect(without.calls.some((call) => call.tool === 'gh' && call.args[0] === 'variable')).toBe(
      false,
    );
    expect(without.output).toContain(
      'redeploy owner-check RAILWAY_STAGING_READY waits for the project token',
    );

    const withToken = await runCase(['--env', 'staging', '--only', 'redeploy'], {
      secretList: '[{"name":"RAILWAY_TOKEN_STAGING"}]',
    });
    expect(withToken.code).toBe(0);
    expect(withToken.calls.map(joined)).toContain(
      'gh variable set RAILWAY_STAGING_READY --body true',
    );
  });

  it('the redeploy step never touches admin', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'redeploy']);
    expect(result.code).toBe(0);
    const redeploys = result.calls.filter((call) => call.args[0] === 'redeploy');
    expect(redeploys.map(serviceOf)).toEqual(['api', 'worker']);
    expect(
      result.calls.some((call) => call.args.includes('redeploy') && call.args.includes('admin')),
    ).toBe(false);
    expect(result.fetched).toEqual(['https://staging.example.test/readyz']);
  });

  it('a failed deployment fails the redeploy step', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'redeploy'], {
      deployments: { worker: '[{"status":"CRASHED","createdAt":"2026-11-02T00:00:00Z"}]' },
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('redeploy fail worker deployment CRASHED');
  });

  it('the report names the admin service', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'report'], {
      deployments: { admin: '[]' },
      inputs: { RESEND_API_KEY: null },
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('report service admin none');
    for (const service of ['postgres', 'api', 'worker', 'backup']) {
      expect(result.lines).toContain(`report service ${service} SUCCESS`);
    }
    expect(result.lines).toContain('report environment staging');
    expect(result.lines).toContain('report absent RESEND_API_KEY (OI-resend)');
    expect(result.lines).toContain('report cors not verified');
    expect(result.calls.some((call) => call.args[0] === 'redeploy')).toBe(false);
  });

  it('a step that fails stops the run, and the report still prints', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [{ args: ['config', 'apply', '--environment', 'staging', '--yes'], exitCode: 1 }],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('apply fail config apply: exit 1');
    expect(result.lines.some((line) => line.startsWith('generate-secrets'))).toBe(false);
    expect(result.lines).toContain('report environment staging');
  });

  it('usage limits that do not show the three values fail', async () => {
    const differing: UsageStatusOptions[] = [
      { hardLimitCents: null },
      { hardLimitCents: 500 },
      { usageLimit: null },
      { usageLimit: { softLimit: 80, hardLimit: null, isOverLimit: false } },
    ];
    for (const options of differing) {
      const stdout = usageStatus(options);
      const result = await runCase(['--env', 'staging', '--only', 'usage-limits'], {
        railway: [{ args: ['usage', 'limit', 'status', '--json'], stdout }],
      });
      expect(result.code).toBe(1);
      expect(result.lines).toContain(
        'usage-limits fail usage limit status does not show 80, 110 and the agent limit 0',
      );
      expect(result.output).not.toContain(stdout);
    }
  });

  it('usage limit status that is not the expected JSON is unexpected output', async () => {
    const text =
      'Usage limits\nWorkspace: fixture\n\nWorkspace\n  Soft limit:  $80.00\n  Hard limit:  $110.00\n' +
      '\nAgent\n  Soft limit:  not set\n  Hard limit:  $0.00 (blocked)\n';
    const answers: FakeRule[] = [
      { args: ['usage', 'limit', 'status', '--json'], stdout: text },
      { args: ['usage', 'limit', 'status', '--json'], stdout: '{"action":"status"}' },
      { args: ['usage', 'limit', 'status', '--json'], stdout: usageStatus(), exitCode: 1 },
    ];
    for (const answer of answers) {
      const result = await runCase(['--env', 'staging', '--only', 'usage-limits'], {
        railway: [answer],
      });
      expect(result.code).toBe(1);
      expect(result.lines).toContain('usage-limits fail usage limit status: unexpected output');
      expect(result.output).not.toContain('Hard limit');
      expect(result.lines.some((line) => line.includes('limits verified'))).toBe(false);
    }
  });
});

describe('apply', { timeout: 30_000 }, () => {
  it('a first apply that creates the services is followed by a second apply', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [statusRule('staging', 0, true)],
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    expect(calls.filter((call) => call === APPLY)).toHaveLength(2);
    const firstApply = calls.indexOf(APPLY);
    const counts = calls
      .map((call, index) => (call.startsWith('railway status') ? index : -1))
      .filter((index) => index !== -1);
    expect(counts).toHaveLength(2);
    expect(counts[0]).toBeLessThan(firstApply);
    expect(counts[1]).toBeGreaterThan(firstApply);
    expect(calls.lastIndexOf(APPLY)).toBeGreaterThan(counts[1] ?? Infinity);
    expect(result.lines).toContain(
      'apply ok config applied twice: the first apply created 5 service(s)',
    );
  });

  it('the second apply comes before the steps that follow in a full run', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [statusRule('staging', 0, true)],
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    const firstSet = calls.findIndex((call) => call.startsWith('railway variable set'));
    expect(calls.filter((call) => call === APPLY)).toHaveLength(2);
    expect(calls.lastIndexOf(APPLY)).toBeLessThan(firstSet);
  });

  it('an apply that creates no service runs once', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply']);
    expect(result.code).toBe(0);
    expect(result.calls.map(joined).filter((call) => call === APPLY)).toHaveLength(1);
    expect(result.lines).toContain('apply ok config applied');
  });

  it('an apply whose service count cannot be read runs twice', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        {
          args: ['status', '--project', PROJECT_ID, '--environment', 'staging', '--json'],
          exitCode: 1,
        },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.calls.map(joined).filter((call) => call === APPLY)).toHaveLength(2);
    expect(result.lines).toContain(
      'apply ok config applied twice: the service count could not be read',
    );
  });

  it('a second apply that fails fails the step', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        statusRule('staging', 0, true),
        { args: ['config', 'apply', '--environment', 'staging', '--yes'], once: true },
        { args: ['config', 'apply', '--environment', 'staging', '--yes'], exitCode: 4 },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('apply fail config apply (second): exit 4');
  });
});

describe('custom domains', { timeout: 30_000 }, () => {
  const API_HOST = 'staging.example.test';
  const ADMIN_HOST = 'admin.staging.example.test';
  const NO_DOMAINS = JSON.stringify({ serviceDomains: [], customDomains: [] });
  // The fields of the CLI's customDomainCreate query; the type comes back as the enum name.
  const created = (host: string, label: string): string =>
    JSON.stringify({
      id: 'fixture-domain',
      domain: host,
      targetPort: 8080,
      status: {
        dnsRecords: [
          {
            hostlabel: label,
            fqdn: host,
            recordType: 'DNS_RECORD_TYPE_CNAME',
            requiredValue: 'fixture1.up.railway.app',
            currentValue: '',
            status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
            zone: 'example.test',
            purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE',
          },
          {
            hostlabel: `_railway-verify.${label}`,
            fqdn: `_railway-verify.${host}`,
            recordType: 'DNS_RECORD_TYPE_TXT',
            requiredValue: 'railway-verify=0123abcd',
            currentValue: '',
            status: 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
            zone: 'example.test',
            purpose: 'DNS_RECORD_PURPOSE_VERIFICATION',
          },
        ],
      },
    });

  it('a domain the list does not show is added and its DNS records printed', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        { args: domainList('api'), stdout: NO_DOMAINS },
        { args: domainList('admin'), stdout: '[]' },
        { args: domainCreate(API_HOST, 'api'), stdout: created(API_HOST, 'staging') },
        { args: domainCreate(ADMIN_HOST, 'admin'), stdout: created(ADMIN_HOST, 'admin.staging') },
      ],
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    expect(calls).toContain(`railway ${domainCreate(API_HOST, 'api').join(' ')}`);
    expect(calls).toContain(`railway ${domainCreate(ADMIN_HOST, 'admin').join(' ')}`);
    expect(calls.indexOf(APPLY)).toBeLessThan(
      calls.indexOf(`railway ${domainList('api').join(' ')}`),
    );
    expect(result.lines).toEqual(
      expect.arrayContaining([
        `apply ok domain ${API_HOST} added`,
        'apply owner-check dns CNAME staging fixture1.up.railway.app',
        'apply owner-check dns TXT _railway-verify.staging railway-verify=0123abcd',
        `apply ok domain ${ADMIN_HOST} added`,
        'apply owner-check dns CNAME admin.staging fixture1.up.railway.app',
        'apply owner-check dns TXT _railway-verify.admin.staging railway-verify=0123abcd',
      ]),
    );
  });

  it('records printed as the CLI table are read, and unreadable ones name domain status', async () => {
    const table = [
      `Created custom domain ${API_HOST}`,
      'DNS records:',
      'Type                    Name                     Value',
      'DNS_RECORD_TYPE_CNAME   staging                  fixture2.up.railway.app',
      'TXT                     _railway-verify.staging  railway-verify=4567ef',
    ].join('\n');
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        {
          args: domainList('api'),
          stdout: `No domains found for service api in environment staging\n`,
        },
        { args: domainList('admin'), stdout: NO_DOMAINS },
        { args: domainCreate(API_HOST, 'api'), stdout: table },
        { args: domainCreate(ADMIN_HOST, 'admin'), stdout: '{"id":"fixture-domain"}' },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(
      expect.arrayContaining([
        'apply owner-check dns CNAME staging fixture2.up.railway.app',
        'apply owner-check dns TXT _railway-verify.staging railway-verify=4567ef',
        `apply ok domain ${ADMIN_HOST} added`,
        `apply owner-check dns ${ADMIN_HOST}: read the records with railway domain status ${ADMIN_HOST} --service admin --environment staging`,
      ]),
    );
  });

  it('a domain the list shows is not added again', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        {
          args: domainList('admin'),
          stdout: JSON.stringify([{ domain: `https://${ADMIN_HOST}/`, type: 'custom' }]),
        },
      ],
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain(`apply ok domain ${API_HOST} exists`);
    expect(result.lines).toContain(`apply ok domain ${ADMIN_HOST} exists`);
    expect(result.calls.some((call) => call.args[0] === 'domain' && call.args[1] !== 'list')).toBe(
      false,
    );
    expect(result.lines.some((line) => line.includes('owner-check dns'))).toBe(false);
  });

  it('a domain that cannot be added fails the step', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [
        { args: domainList('api'), stdout: NO_DOMAINS },
        { args: domainCreate(API_HOST, 'api'), exitCode: 1 },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(`apply fail domain ${API_HOST} --service api: exit 1`);
    expect(result.calls.map(joined)).not.toContain(`railway ${domainList('admin').join(' ')}`);
  });

  it('a list that cannot be read fails the step and adds nothing', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply'], {
      railway: [{ args: domainList('api'), stdout: 'fixture: not json' }],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('apply fail domain list --service api: unexpected output');
    expect(result.calls.some((call) => call.args[0] === 'domain' && call.args[1] !== 'list')).toBe(
      false,
    );
  });

  it('a dry run prints the domains it would add and runs nothing mutating', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'apply', '--dry-run']);
    expect(result.code).toBe(0);
    expect(result.calls.some((call) => call.args[0] === 'domain')).toBe(false);
    expect(result.lines).toContain(`dry-run railway ${domainCreate(API_HOST, 'api').join(' ')}`);
    expect(result.lines).toContain(
      `dry-run railway ${domainCreate(ADMIN_HOST, 'admin').join(' ')}`,
    );
    expect(result.lines).toContain(
      `apply ok dry-run: domain ${API_HOST} not added; it is added when railway domain list does not show it`,
    );
  });
});

describe('prompts on standard input', { timeout: 60_000 }, () => {
  it('a prompt answers a line, then null once its input has ended, every time', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const prompt = createPrompt(input, output);
    const first = prompt('Done? [y/N]', { hidden: false });
    input.end('y\n');
    expect(await first).toBe('y');
    expect(await prompt('Again?', { hidden: false })).toBeNull();
    expect(await prompt('And again?', { hidden: true })).toBeNull();
  });

  // The script's own prompt, in a child process whose standard input is /dev/null: the second
  // prompt meets an input that ended at the first, and must answer empty instead of hanging.
  it('a prompt after the end of standard input answers empty', async () => {
    const fake = await createFakeCli(defaultRules('staging', {}));
    cleanups.push(() => fake.cleanup());
    const root = await tempFolder('bootstrap-root-');
    const home = await tempFolder('bootstrap-home-');
    const driver = join(root, 'driver.mjs');
    await writeFile(
      driver,
      [
        `const { runBootstrap } = await import(${JSON.stringify(pathToFileURL(join(repoRoot(), 'scripts', 'railway-bootstrap.ts')).href)});`,
        `const io = { repoRoot: ${JSON.stringify(root)}, home: ${JSON.stringify(home)}, env: process.env, out: (line) => console.log(line) };`,
        "for (const step of ['volume-backups', 'tokens']) {",
        "  console.log('exit ' + String(await runBootstrap(['--env', 'staging', '--only', step], io)));",
        '}',
      ].join('\n'),
    );
    const child = await new Promise<{ code: number | null; stdout: string }>((resolveChild) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', driver],
        {
          cwd: repoRoot(),
          env: fake.env({ PATH: process.env.PATH, HOME: home, RAILWAY_API_TOKEN: WORKSPACE_TOKEN }),
          timeout: 50_000,
        },
        (error, stdout) => {
          resolveChild({
            code: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
            stdout,
          });
        },
      ).stdin?.end();
    });
    expect(child.stdout).toContain('volume-backups owner-check volume backups for staging');
    expect(child.stdout).toContain('tokens owner-check project token github-actions-staging');
    expect(child.code).toBe(0);
  });
});

describe('the next command', { timeout: 60_000 }, () => {
  it('a failed step in a full run names the full command again', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [{ args: ['config', 'apply', '--environment', 'staging', '--yes'], exitCode: 1 }],
    });
    expect(result.code).toBe(1);
    expect(result.lines.at(-1)).toBe(
      `next run the command the fail line names by hand to read its message, and fix the cause; then run: ${BOOTSTRAP}`,
    );
  });

  it('a failed preflight names the same command', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'seal'], {
      railway: [{ args: ['--version'], stdout: 'railway 5.73.0\n' }],
    });
    expect(result.code).toBe(1);
    expect(result.lines.at(-1)).toBe(
      `next fix what each preflight line names; then run: ${BOOTSTRAP} --only seal`,
    );
  });

  it('a redeploy refused during a build says to wait, then run --only redeploy', async () => {
    const result = await runCase(['--env', 'staging'], {
      railway: [
        {
          args: ['redeploy', '--service', 'api', '--environment', 'staging', '--yes'],
          stderr: 'The latest deployment for service api cannot be redeployed\n',
          exitCode: 1,
        },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('redeploy fail redeploy api: exit 1');
    expect(result.lines.at(-1)).toBe(
      `next wait until pnpm exec railway deployment list --service api --environment staging shows no api deployment building or deploying (the CLI refuses a redeploy until then); then run: ${BOOTSTRAP} --only redeploy`,
    );
    expect(result.output).not.toContain('cannot be redeployed');
  });

  it('a /readyz that does not answer names the DNS record, then --only redeploy', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'redeploy'], {
      readyz: { status: 404, body: 'not found' },
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'redeploy fail /readyz on staging does not answer 200 with db ok',
    );
    expect(result.lines.at(-1)).toBe(
      `next check that staging.example.test resolves to the CNAME target Railway shows for the api domain and that Railway shows its certificate (RB-infra item 15); then run: ${BOOTSTRAP} --only redeploy`,
    );
  });

  it('a project token set with --only tokens is followed by --only redeploy', async () => {
    const set = await runCase(['--env', 'staging', '--only', 'tokens'], {
      prompt: () => Promise.resolve(PROJECT_TOKEN),
    });
    expect(set.code).toBe(0);
    expect(set.lines.at(-1)).toBe(
      `next run: ${BOOTSTRAP} --only redeploy (step 13 sets RAILWAY_STAGING_READY)`,
    );

    const left = await runCase(['--env', 'staging']);
    expect(left.code).toBe(0);
    expect(left.lines.at(-1)).toBe(
      `next when the owner has made the project token github-actions-staging, run: ${BOOTSTRAP} --only tokens, then: ${BOOTSTRAP} --only redeploy`,
    );
  });
});

describe('sign-in, review and rotation values', { timeout: 30_000 }, () => {
  it('the targets table matches the variable table', () => {
    expect(
      OWNER_VALUE_TARGETS.map((row) => ({
        variable: row.variable,
        services: [...row.services],
        source: row.source,
        from: row.from,
        sealed: row.sealed,
        ownerInputs: [...row.ownerInputs],
      })),
    ).toEqual([
      {
        variable: 'RESEND_API_KEY',
        services: ['api', 'worker', 'admin'],
        source: 'RESEND_API_KEY',
        from: 'value',
        sealed: true,
        ownerInputs: ['OI-resend'],
      },
      {
        variable: 'EMAIL_FROM',
        services: ['api', 'worker', 'admin'],
        source: 'MAIL_HOST',
        from: 'composed',
        sealed: false,
        ownerInputs: ['OI-resend', 'OI-domain'],
      },
      {
        variable: 'ADMIN_EMAILS',
        services: ['api', 'worker', 'admin'],
        source: 'ADMIN_EMAILS',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-admin-emails'],
      },
      {
        variable: 'BACKUP_PUBLIC_KEY',
        services: ['backup'],
        source: 'BACKUP_PUBLIC_KEY_FILE',
        from: 'file',
        sealed: false,
        ownerInputs: ['OI-backup-key'],
      },
      {
        variable: 'APPLE_TEAM_ID',
        services: ['api', 'worker'],
        source: 'APPLE_TEAM_ID',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-apple-identifiers'],
      },
      {
        variable: 'APPLE_KEY_ID',
        services: ['api', 'worker'],
        source: 'APPLE_KEY_ID',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-apple-identifiers'],
      },
      {
        variable: 'APPLE_PRIVATE_KEY',
        services: ['api', 'worker'],
        source: 'APPLE_PRIVATE_KEY_FILE',
        from: 'file',
        sealed: true,
        ownerInputs: ['OI-apple-identifiers'],
      },
      {
        variable: 'GOOGLE_CLIENT_IDS',
        services: ['api'],
        source: 'GOOGLE_CLIENT_IDS',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-google-oauth'],
      },
      {
        variable: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
        services: ['api'],
        source: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-google-oauth'],
      },
      {
        variable: 'REVIEW_SIGNIN_EMAILS',
        services: ['api'],
        source: 'REVIEW_SIGNIN_EMAILS',
        from: 'value',
        sealed: false,
        ownerInputs: ['OI-store-submission'],
      },
      {
        variable: 'REVIEW_SIGNIN_CODE',
        services: ['api'],
        source: 'REVIEW_SIGNIN_CODE',
        from: 'value',
        sealed: true,
        ownerInputs: ['OI-store-submission'],
      },
      {
        variable: 'APP_SECRET_PREVIOUS',
        services: ['api', 'worker', 'admin'],
        source: 'APP_SECRET_PREVIOUS',
        from: 'value',
        sealed: true,
        ownerInputs: [],
      },
      {
        variable: 'GEO_API_KEY',
        services: ['api'],
        source: 'GEO_API_KEY',
        from: 'value',
        sealed: true,
        ownerInputs: ['OI-geoapify'],
      },
    ]);
  });

  it('sets the sign-in values on the services that read them', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: signInInputs(),
    });
    expect(result.code).toBe(0);
    const calls = result.calls.map(joined);
    const set = (key: string, service: string): string =>
      `railway variable set ${key} --stdin --service ${service} --environment staging --skip-deploys`;
    for (const key of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY']) {
      expect(variableSets(result.calls, key).map(serviceOf), key).toEqual(['api', 'worker']);
      expect(calls).toContain(set(key, 'api'));
      expect(calls).toContain(set(key, 'worker'));
    }
    for (const key of ['GOOGLE_CLIENT_IDS', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']) {
      expect(variableSets(result.calls, key).map(serviceOf), key).toEqual(['api']);
    }
    for (const key of ['RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAILS']) {
      expect(variableSets(result.calls, key).map(serviceOf), key).toEqual([
        'api',
        'worker',
        'admin',
      ]);
    }
    const stdinOf = (key: string): (string | undefined)[] =>
      variableSets(result.calls, key).map((call) => call.stdin);
    expect(stdinOf('APPLE_TEAM_ID')).toEqual([APPLE_TEAM, APPLE_TEAM]);
    expect(stdinOf('APPLE_KEY_ID')).toEqual([APPLE_KEY, APPLE_KEY]);
    expect(stdinOf('APPLE_PRIVATE_KEY')).toEqual([appleKeyText, appleKeyText]);
    expect(stdinOf('GOOGLE_CLIENT_IDS')).toEqual([`${WEB_CLIENT},${IOS_CLIENT}`]);
    expect(stdinOf('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')).toEqual([WEB_CLIENT]);
    for (const service of ['api', 'worker']) {
      expect(result.lines).toContain(`owner-values owner-check seal ${service}/APPLE_PRIVATE_KEY`);
    }
    // Every value travels on standard input: no recorded argument and no printed line holds one.
    const values = [
      APPLE_TEAM,
      APPLE_KEY,
      appleKeyBody(),
      'PRIVATE KEY',
      WEB_CLIENT,
      IOS_CLIENT,
      RESEND_KEY,
      ADMIN_ADDRESS,
    ];
    for (const call of result.calls) {
      for (const value of values) {
        expect(call.args.join(' '), value).not.toContain(value);
      }
    }
    for (const value of values) {
      expect(result.output).not.toContain(value);
    }
  });

  it('skips each missing input by its id', async () => {
    const staging = await runCase(['--env', 'staging', '--only', 'owner-values']);
    expect(staging.code).toBe(0);
    for (const line of [
      'owner-values skip APPLE_TEAM_ID (OI-apple-identifiers)',
      'owner-values skip APPLE_KEY_ID (OI-apple-identifiers)',
      'owner-values skip APPLE_PRIVATE_KEY (OI-apple-identifiers)',
      'owner-values skip GOOGLE_CLIENT_IDS (OI-google-oauth)',
      'owner-values skip EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (OI-google-oauth)',
      // Staging's pair is the perf account's, which is not an owner input.
      'owner-values skip REVIEW_SIGNIN_EMAILS (the perf account, not an owner input on staging)',
      'owner-values skip REVIEW_SIGNIN_CODE (the perf account, not an owner input on staging)',
      'owner-values skip APP_SECRET_PREVIOUS (rotation only)',
    ]) {
      expect(staging.lines).toContain(line);
    }
    for (const key of [
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'GOOGLE_CLIENT_IDS',
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
      'REVIEW_SIGNIN_EMAILS',
      'REVIEW_SIGNIN_CODE',
      'APP_SECRET_PREVIOUS',
    ]) {
      expect(variableSets(staging.calls, key), key).toEqual([]);
    }

    const production = await runCase(['--env', 'production', '--only', 'owner-values'], {
      inputs: signInInputs(),
    });
    expect(production.code).toBe(0);
    expect(production.lines).toContain(
      'owner-values skip REVIEW_SIGNIN_EMAILS (OI-store-submission)',
    );
    expect(production.lines).toContain(
      'owner-values skip REVIEW_SIGNIN_CODE (OI-store-submission)',
    );
    expect(variableSets(production.calls, 'REVIEW_SIGNIN_EMAILS')).toEqual([]);
    expect(variableSets(production.calls, 'APPLE_TEAM_ID').map(serviceOf)).toEqual([
      'api',
      'worker',
    ]);

    const report = await runCase(['--env', 'staging', '--only', 'report']);
    expect(report.code).toBe(0);
    for (const line of [
      'report absent APPLE_TEAM_ID (OI-apple-developer)',
      'report absent APPLE_KEY_ID (OI-apple-identifiers)',
      'report absent APPLE_PRIVATE_KEY_FILE (OI-apple-identifiers)',
      'report absent GOOGLE_CLIENT_IDS (OI-google-oauth)',
      'report absent EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (OI-google-oauth)',
      'report absent REVIEW_SIGNIN_EMAILS (the perf account, not an owner input on staging)',
    ]) {
      expect(report.lines).toContain(line);
    }
    // A value given only for a rotation is not an owner input, so its absence is not reported.
    expect(report.output).not.toContain('APP_SECRET_PREVIOUS');
  });

  it('refuses a partial Apple set', async () => {
    for (const keys of [
      ['APPLE_TEAM_ID'],
      ['APPLE_TEAM_ID', 'APPLE_KEY_ID'],
      ['APPLE_PRIVATE_KEY_FILE'],
    ]) {
      const text = keys.map((key) => `${key}=${signInInputs()[key] ?? ''}`).join('\n');
      expect(() => parseInputsFile(text), keys.join()).toThrow('OI-apple-identifiers');
      try {
        parseInputsFile(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : APPLE_TEAM;
        expect(message).not.toContain(APPLE_TEAM);
        expect(message).not.toContain(APPLE_KEY);
      }
    }
    const result = await runCase(['--env', 'staging'], {
      inputs: { APPLE_TEAM_ID: APPLE_TEAM },
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'preflight fail inputs file: APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY_FILE must be given together (OI-apple-identifiers)',
    );
    expect(variableSets(result.calls)).toEqual([]);
  });

  it('refuses an Apple key that is not P-256', async () => {
    for (const file of [
      rsaPrivateKeyFile,
      p384KeyFile,
      publicKey4096,
      join(keyFolder, 'none.p8'),
    ]) {
      const result = await runCase(['--env', 'staging'], {
        inputs: { ...signInInputs(), APPLE_PRIVATE_KEY_FILE: file },
      });
      expect(result.code, file).toBe(1);
      expect(result.lines, file).toContain(
        'preflight fail APPLE_PRIVATE_KEY_FILE (OI-apple-identifiers) is not a P-256 EC private key file',
      );
      expect(
        result.calls.some((call) => call.args[0] === 'link'),
        file,
      ).toBe(false);
      expect(variableSets(result.calls), file).toEqual([]);
    }
    const accepted = await runCase(['--env', 'staging', '--only', 'preflight'], {
      inputs: signInInputs(),
    });
    expect(accepted.code).toBe(0);
    expect(accepted.lines).toContain('preflight ok ready for staging');
  });

  it('refuses a web client id missing from the list', () => {
    const problems = [
      [`GOOGLE_CLIENT_IDS=${IOS_CLIENT}`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${WEB_CLIENT}`],
      [`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${WEB_CLIENT}`],
    ];
    for (const lines of problems) {
      expect(() => parseInputsFile(lines.join('\n'))).toThrow(
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must be one of GOOGLE_CLIENT_IDS',
      );
    }
    // The list is ids joined by commas, with no empty id and no space.
    for (const list of [
      `${WEB_CLIENT}, ${IOS_CLIENT}`,
      `${WEB_CLIENT},,${IOS_CLIENT}`,
      `${WEB_CLIENT},`,
      `,${WEB_CLIENT}`,
    ]) {
      let message = '';
      try {
        parseInputsFile(`GOOGLE_CLIENT_IDS=${list}`);
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message, list).toBe('inputs file: GOOGLE_CLIENT_IDS is not valid');
    }
    expect(
      parseInputsFile(
        `GOOGLE_CLIENT_IDS=${IOS_CLIENT},${WEB_CLIENT}\nEXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=${WEB_CLIENT}`,
      ),
    ).toEqual({
      GOOGLE_CLIENT_IDS: `${IOS_CLIENT},${WEB_CLIENT}`,
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB_CLIENT,
    });
    expect(parseInputsFile(`GOOGLE_CLIENT_IDS=${IOS_CLIENT}`)).toEqual({
      GOOGLE_CLIENT_IDS: IOS_CLIENT,
    });
  });

  it('the previous secret is 64 lower-case hex characters', () => {
    expect(parseInputsFile(`APP_SECRET_PREVIOUS=${PREVIOUS_SECRET}`)).toEqual({
      APP_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    for (const value of [
      PREVIOUS_SECRET.toUpperCase(),
      PREVIOUS_SECRET.slice(2),
      `${PREVIOUS_SECRET}ab`,
    ]) {
      let message = '';
      try {
        parseInputsFile(`APP_SECRET_PREVIOUS=${value}`);
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).toBe('inputs file: APP_SECRET_PREVIOUS is not valid');
    }
  });

  it('seals the new secrets', async () => {
    const expected = [
      'postgres/POSTGRES_PASSWORD',
      'postgres/API_DB_PASSWORD',
      'postgres/WORKER_DB_PASSWORD',
      'postgres/BACKUP_DB_PASSWORD',
      'postgres/ADMIN_DB_PASSWORD',
      'api/APP_SECRET',
      'worker/APP_SECRET',
      'admin/APP_SECRET',
      'api/RESEND_API_KEY',
      'worker/RESEND_API_KEY',
      'admin/RESEND_API_KEY',
      'api/APPLE_PRIVATE_KEY',
      'worker/APPLE_PRIVATE_KEY',
      'api/REVIEW_SIGNIN_CODE',
      'api/APP_SECRET_PREVIOUS',
      'worker/APP_SECRET_PREVIOUS',
      'admin/APP_SECRET_PREVIOUS',
      'api/GEO_API_KEY',
    ];
    expect(SEALED.map((row) => `${row.service}/${row.key}`)).toEqual(expected);

    // Set in the run by step 6, after the seal step: each is left to seal.
    const set = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: {
        ...signInInputs(),
        REVIEW_SIGNIN_EMAILS: REVIEW_ADDRESS,
        REVIEW_SIGNIN_CODE: REVIEW_CODE,
        APP_SECRET_PREVIOUS: PREVIOUS_SECRET,
        GEO_API_KEY: GEO_KEY,
      },
    });
    expect(set.code).toBe(0);
    expect(
      set.lines.filter((line) => line.startsWith('owner-values owner-check seal ')).sort(),
    ).toEqual(
      expected
        .filter((entry) => !entry.startsWith('postgres/') && !entry.endsWith('/APP_SECRET'))
        .map((entry) => `owner-values owner-check seal ${entry}`)
        .sort(),
    );
    expect(variableSets(set.calls, 'REVIEW_SIGNIN_EMAILS').map((call) => call.stdin)).toEqual([
      REVIEW_ADDRESS,
    ]);
    expect(variableSets(set.calls, 'APP_SECRET_PREVIOUS').map(serviceOf)).toEqual([
      'api',
      'worker',
      'admin',
    ]);
    for (const value of [REVIEW_ADDRESS, REVIEW_CODE, PREVIOUS_SECRET, GEO_KEY]) {
      expect(set.output).not.toContain(value);
      for (const call of set.calls) {
        expect(call.args.join(' ')).not.toContain(value);
      }
    }

    // A later `--only seal` asks for every sealed variable Railway lists, the new ones included.
    const listed = {
      postgres: ALL_KEYS_LISTED.postgres ?? {},
      api: {
        APP_SECRET: null,
        RESEND_API_KEY: null,
        APPLE_PRIVATE_KEY: null,
        REVIEW_SIGNIN_CODE: null,
        APP_SECRET_PREVIOUS: null,
        GEO_API_KEY: null,
      },
      worker: {
        APP_SECRET: null,
        RESEND_API_KEY: null,
        APPLE_PRIVATE_KEY: null,
        APP_SECRET_PREVIOUS: null,
      },
      admin: { APP_SECRET: null, RESEND_API_KEY: null, APP_SECRET_PREVIOUS: null },
    };
    const open = await runCase(['--env', 'staging', '--only', 'seal'], { lists: listed });
    expect(open.code).toBe(0);
    expect(open.lines.filter((line) => line.startsWith('seal owner-check seal '))).toEqual(
      expected.map((entry) => `seal owner-check seal ${entry}`),
    );

    // Without the review pair or a rotation on Railway, nothing of theirs is asked for.
    const without = await runCase(['--env', 'staging', '--only', 'seal'], {
      lists: {
        ...listed,
        api: { APP_SECRET: null, RESEND_API_KEY: null, APPLE_PRIVATE_KEY: null },
        worker: { APP_SECRET: null, RESEND_API_KEY: null, APPLE_PRIVATE_KEY: null },
        admin: { APP_SECRET: null, RESEND_API_KEY: null },
      },
    });
    expect(without.output).not.toContain('REVIEW_SIGNIN_CODE');
    expect(without.output).not.toContain('APP_SECRET_PREVIOUS');
    expect(without.output).not.toContain('GEO_API_KEY');
    expect(without.lines).toContain('seal owner-check seal worker/APPLE_PRIVATE_KEY');

    // A confirmed seal compares what Railway still returns with the key file's text.
    const confirmed = await runCase(['--env', 'staging', '--only', 'seal'], {
      inputs: signInInputs(),
      lists: {
        ...listed,
        api: { APP_SECRET: null, APPLE_PRIVATE_KEY: appleKeyText },
        worker: { APP_SECRET: null, APPLE_PRIVATE_KEY: null },
        admin: { APP_SECRET: null },
      },
      prompt: () => Promise.resolve('y'),
    });
    expect(confirmed.code).toBe(0);
    expect(confirmed.lines).toContain('seal owner-check seal api/APPLE_PRIVATE_KEY');
    expect(confirmed.lines).toContain('seal ok sealed worker/APPLE_PRIVATE_KEY');
    expect(confirmed.output).not.toContain(appleKeyBody());
  });

  it('a sealed Apple key is replaced only with --rotate APPLE_PRIVATE_KEY', async () => {
    const lists = { api: { APPLE_PRIVATE_KEY: null }, worker: { APPLE_PRIVATE_KEY: null } };
    const kept = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: signInInputs(),
      lists,
    });
    expect(kept.code).toBe(0);
    expect(variableSets(kept.calls, 'APPLE_PRIVATE_KEY')).toEqual([]);
    expect(kept.lines).toContain(
      'owner-values skip APPLE_PRIVATE_KEY on api is kept; pass --rotate APPLE_PRIVATE_KEY to replace it',
    );
    // The two ids are plain values: a different one is replaced without --rotate.
    expect(variableSets(kept.calls, 'APPLE_TEAM_ID').map(serviceOf)).toEqual(['api', 'worker']);

    const rotated = await runCase(
      ['--env', 'staging', '--only', 'owner-values', '--rotate', 'APPLE_PRIVATE_KEY'],
      { inputs: signInInputs(), lists },
    );
    expect(rotated.code).toBe(0);
    expect(variableSets(rotated.calls, 'APPLE_PRIVATE_KEY').map(serviceOf)).toEqual([
      'api',
      'worker',
    ]);

    // Once set, the previous secret stays: a second rotation needs a decision.
    const refused = await runCase(['--env', 'staging', '--rotate', 'APP_SECRET_PREVIOUS']);
    expect(refused.code).toBe(2);
    expect(refused.calls).toEqual([]);
  });
});

describe('data bucket and FEC key values', { timeout: 30_000 }, () => {
  const ghCalls = (
    calls: readonly FakeCall[],
    kind: 'variable' | 'secret',
    name: string,
  ): FakeCall[] =>
    calls.filter(
      (call) =>
        call.tool === 'gh' &&
        call.args[0] === kind &&
        call.args[1] === 'set' &&
        call.args[2] === name,
    );

  it('sets the geocoding key on the api, sealed', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: { GEO_API_KEY: GEO_KEY },
    });
    expect(result.code).toBe(0);
    const sets = variableSets(result.calls, 'GEO_API_KEY');
    expect(sets.map(joined)).toEqual([
      'railway variable set GEO_API_KEY --stdin --service api --environment staging --skip-deploys',
    ]);
    expect(sets[0]?.stdin).toBe(GEO_KEY);
    expect(result.lines).toContain('owner-values ok set GEO_API_KEY on api');
    expect(result.lines).toContain('owner-values owner-check seal api/GEO_API_KEY');
    expect(result.output).not.toContain(GEO_KEY);
    for (const call of result.calls) {
      expect(call.args.join(' ')).not.toContain(GEO_KEY);
    }

    // Step 5 asks for it to be sealed once it is set.
    expect(SEALED).toContainEqual({ service: 'api', key: 'GEO_API_KEY' });
    expect(SEALED.filter((row) => row.key === 'GEO_API_KEY')).toHaveLength(1);
    const seal = await runCase(['--env', 'staging', '--only', 'seal'], {
      lists: { ...ALL_KEYS_LISTED, api: { APP_SECRET: null, GEO_API_KEY: null } },
    });
    expect(seal.code).toBe(0);
    expect(seal.lines).toContain('seal owner-check seal api/GEO_API_KEY');
    expect(seal.lines.find((line) => line.startsWith('seal variables '))).toContain(
      'api/GEO_API_KEY',
    );
  });

  it('replaces a sealed geocoding key only with --rotate GEO_API_KEY', async () => {
    const lists = { api: { GEO_API_KEY: null } };
    const kept = await runCase(['--env', 'staging', '--only', 'owner-values'], {
      inputs: { GEO_API_KEY: GEO_KEY },
      lists,
    });
    expect(kept.code).toBe(0);
    expect(kept.lines).toContain(
      'owner-values skip GEO_API_KEY on api is kept; pass --rotate GEO_API_KEY to replace it',
    );
    expect(variableSets(kept.calls, 'GEO_API_KEY')).toEqual([]);

    const rotated = await runCase(
      ['--env', 'staging', '--only', 'owner-values', '--rotate', 'GEO_API_KEY'],
      { inputs: { GEO_API_KEY: GEO_KEY }, lists },
    );
    expect(rotated.code).toBe(0);
    expect(variableSets(rotated.calls, 'GEO_API_KEY').map(serviceOf)).toEqual(['api']);
  });

  it('skips the geocoding key by its id when absent', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'owner-values']);
    expect(result.code).toBe(0);
    expect(result.lines).toContain('owner-values skip GEO_API_KEY (OI-geoapify)');
    expect(variableSets(result.calls, 'GEO_API_KEY')).toEqual([]);
    const report = await runCase(['--env', 'staging', '--only', 'report']);
    expect(report.lines).toContain('report absent GEO_API_KEY (OI-geoapify)');
    expect(report.lines).toContain('report absent FEC_API_KEY (OI-datagov-key)');
  });

  it('copies the staging data values to GitHub on standard input', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'tokens']);
    expect(result.code).toBe(0);
    expect(result.calls.map(joined)).toContain(
      'railway bucket credentials -b data -e staging --json',
    );
    const copies = [
      ['variable', 'DATA_BUCKET', DATA_CREDENTIALS.BUCKET],
      ['variable', 'DATA_ENDPOINT', DATA_CREDENTIALS.ENDPOINT],
      ['variable', 'DATA_REGION', DATA_CREDENTIALS.REGION],
      ['secret', 'DATA_ACCESS_KEY_ID', DATA_KEY_ID],
      ['secret', 'DATA_SECRET_ACCESS_KEY', DATA_SECRET],
    ] as const;
    for (const [kind, name, value] of copies) {
      const calls = ghCalls(result.calls, kind, name);
      expect(calls.map(joined), name).toEqual([`gh ${kind} set ${name} --env staging`]);
      expect(calls[0]?.stdinBytes, name).toBeGreaterThan(0);
      expect(calls[0]?.stdin, name).toBe(value);
    }
    for (const call of result.calls) {
      for (const value of [DATA_KEY_ID, DATA_SECRET, DATA_CREDENTIALS.BUCKET]) {
        expect(call.args.join(' '), value).not.toContain(value);
      }
    }
    for (const value of [DATA_KEY_ID, DATA_SECRET]) {
      expect(result.output).not.toContain(value);
    }
    expect(result.lines).toContain(
      'tokens ok DATA_BUCKET, DATA_ENDPOINT, DATA_REGION, DATA_ACCESS_KEY_ID, DATA_SECRET_ACCESS_KEY set in the GitHub Environment staging',
    );
    // The project token is still the owner's; the copies run without it.
    expect(result.lines).toContain('tokens owner-check project token github-actions-staging');

    const full = await runCase(['--env', 'staging']);
    expect(full.code).toBe(0);
    expect(full.lines).toContain('report github data values set');
  });

  it('a data bucket that cannot be read fails the step and copies nothing', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'tokens'], {
      railway: [
        { args: ['bucket', 'credentials', '-b', 'data', '-e', 'staging', '--json'], exitCode: 1 },
      ],
    });
    expect(result.code).toBe(1);
    expect(result.lines).toContain('tokens fail bucket credentials -b data: exit 1');
    expect(result.calls.some((call) => call.tool === 'gh' && call.args.includes('set'))).toBe(
      false,
    );
  });

  it('copies the datagov key to the staging secret only', async () => {
    const result = await runCase(['--env', 'staging'], { inputs: { FEC_API_KEY: DATAGOV_KEY } });
    expect(result.code).toBe(0);
    const calls = ghCalls(result.calls, 'secret', 'FEC_API_KEY');
    expect(calls.map(joined)).toEqual(['gh secret set FEC_API_KEY --env staging']);
    expect(calls[0]?.stdin).toBe(DATAGOV_KEY);
    expect(variableSets(result.calls, 'FEC_API_KEY')).toEqual([]);
    expect(result.lines).toContain('tokens ok FEC_API_KEY set in the GitHub Environment staging');
    expect(result.output).not.toContain(DATAGOV_KEY);
    for (const call of result.calls) {
      expect(call.args.join(' ')).not.toContain(DATAGOV_KEY);
    }
  });

  it('skips the datagov key by its id when absent', async () => {
    const result = await runCase(['--env', 'staging', '--only', 'tokens']);
    expect(result.code).toBe(0);
    expect(result.lines).toContain('tokens skip FEC_API_KEY (OI-datagov-key)');
    expect(ghCalls(result.calls, 'secret', 'FEC_API_KEY')).toEqual([]);
  });

  it('production gets no data copies in this version', async () => {
    const result = await runCase(['--env', 'production', '--only', 'tokens'], {
      inputs: { FEC_API_KEY: DATAGOV_KEY },
    });
    expect(result.code).toBe(0);
    expect(result.lines).toContain('tokens skip data bucket copies on production (milestone 10)');
    expect(
      result.calls.some(
        (call) =>
          call.args[0] === 'bucket' &&
          call.args.includes('credentials') &&
          call.args.includes('data'),
      ),
    ).toBe(false);
    expect(
      result.calls.some((call) => call.tool === 'gh' && call.args[2]?.startsWith('DATA_')),
    ).toBe(false);
    expect(ghCalls(result.calls, 'secret', 'FEC_API_KEY')).toEqual([]);
  });
});
