import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import type { CORSRule } from '@aws-sdk/client-s3';
import { BRAND } from '@citizenrun/shared';
import type * as Shared from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaCorsRules } from './lib/cors.ts';
import { repoRoot } from './lib/repo-root.ts';
import {
  fillRoleMarkers,
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
const ROLES_SQL = readFileSync(join(repoRoot(), 'packages', 'db', 'sql', 'roles.sql'), 'utf8');
const PSQL = ['psql', '-U', 'citizenrun', '-d', 'citizenrun', '-v', 'ON_ERROR_STOP=1', '-X', '-q'];
const SUCCESS = '[{"status":"SUCCESS","createdAt":"2026-11-01T00:00:00Z"}]';
const SSH_POSTGRES = ['ssh', '--service', 'postgres', '--environment', 'staging', '--'];
const SETTINGS_READ = [...SSH_POSTGRES, ...PSQL, '-A', '-t'];
const PG_ISREADY = [...SSH_POSTGRES, 'pg_isready', '-U', 'citizenrun', '-d', 'citizenrun'];
const REDEPLOY_POSTGRES = 'railway redeploy --service postgres --environment staging --yes';
const BOOTSTRAP = 'pnpm exec tsx scripts/railway-bootstrap.ts --env staging';

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
      ['--env', 'staging', '--rotate', 'GEO_API_KEY'],
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
      inputs: { GEO_API_KEY: 'fixture-geo-key' },
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain(
      'skip GEO_API_KEY (OI-geoapify): not set by this version of the bootstrap',
    );
    expect(variableSets(result.calls, 'GEO_API_KEY')).toEqual([]);
    expect(result.output).not.toContain('fixture-geo-key');
  });

  it('the dry run prints no generated value and runs no mutating command', async () => {
    const result = await runCase(['--env', 'staging', '--dry-run'], {
      deterministic: true,
      secretList: '[{"name":"RAILWAY_TOKEN_STAGING"}]',
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('<redacted>');
    for (const secret of [
      DETERMINISTIC.toString('base64url'),
      DETERMINISTIC.toString('hex'),
      RESEND_KEY,
      ADMIN_ADDRESS,
      WORKSPACE_TOKEN,
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
    const generated = SEALED.filter((row) => row.key !== 'RESEND_API_KEY').map(
      (row) => `seal owner-check seal ${row.service}/${row.key}`,
    );
    for (const line of generated) {
      expect(result.lines).toContain(line);
    }
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
