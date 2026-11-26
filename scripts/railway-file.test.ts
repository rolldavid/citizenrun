import { createRailwayContext, project } from 'railway/iac';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Brand from '../packages/shared/src/brand.ts';
import program from '../.railway/railway.ts';

const REGION = 'us-east4-eqdc4a';
const SERVICES = ['postgres', 'api', 'worker', 'backup', 'admin'] as const;
const ENVIRONMENTS = ['staging', 'production'] as const;

type Env = (typeof ENVIRONMENTS)[number];
type FixtureVariant = {
  displayName: string;
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
  host: string | null;
  adminHost: string | null;
  appleServicesId: string | null;
};

// The file is never evaluated against the real brand: its hosts change only in activations. The
// fixture is read through getters, so a case can change a value before it calls the file.
const fixture = vi.hoisted(() => {
  const variant = (suffix: string, host: string): FixtureVariant => ({
    displayName: `Fixture${suffix}`,
    scheme: `fixture${suffix.toLowerCase()}`,
    iosBundleId: `test.fixture.app${suffix === '' ? '' : `.${suffix.toLowerCase()}`}`,
    androidPackage: `test.fixture.app${suffix === '' ? '' : `.${suffix.toLowerCase()}`}`,
    host,
    adminHost: `admin.${host}`,
    appleServicesId: null,
  });
  const fresh = (): Record<'development' | 'staging' | 'production', FixtureVariant> => ({
    development: { ...variant('Dev', 'dev.example.test'), host: null, adminHost: null },
    staging: variant('Staging', 'staging.example.test'),
    production: variant('', 'example.test'),
  });
  return { variants: fresh(), fresh };
});

vi.mock('../packages/shared/src/brand.ts', async (importOriginal) => {
  const real = await importOriginal<typeof Brand>();
  return {
    ...real,
    BRAND: {
      ...real.BRAND,
      slug: 'fixture',
      github: { repository: 'fixture/repo' },
      get variants() {
        return fixture.variants;
      },
    },
    goHost: (name: 'staging' | 'production') => `go.${fixture.variants[name].host ?? ''}`,
  };
});

type Variable =
  | { type: 'literal'; value: string }
  | { type: 'preserve' }
  | { type: 'reference'; resource: string; output: string };

type Node = {
  type: string;
  name: string;
  source?: unknown;
  deploy?: Record<string, unknown>;
  variables?: Record<string, Variable>;
  config?: Record<string, unknown>;
  networking?: { customDomains?: Record<string, unknown> };
  volumeAttachments?: Record<string, { volumeConfig?: Record<string, unknown> }>;
};

async function nodes(env: Env = 'staging'): Promise<Node[]> {
  const definition = await program(createRailwayContext({ environment: env }), project);
  return definition.resources as unknown as Node[]; // the SDK's resource union, read as plain data
}

function serviceNode(list: readonly Node[], name: string): Node {
  const node = list.find((item) => item.type === 'service' && item.name === name);
  if (node === undefined) throw new Error(`no service ${name}`);
  return node;
}

async function envOf(service: string, env: Env = 'staging'): Promise<Record<string, Variable>> {
  return serviceNode(await nodes(env), service).variables ?? {};
}

const PRESERVE = { type: 'preserve' };
const MEDIA = [
  'MEDIA_BUCKET',
  'MEDIA_ENDPOINT',
  'MEDIA_REGION',
  'MEDIA_ACCESS_KEY_ID',
  'MEDIA_SECRET_ACCESS_KEY',
];
const DATA = [
  'DATA_BUCKET',
  'DATA_ENDPOINT',
  'DATA_REGION',
  'DATA_ACCESS_KEY_ID',
  'DATA_SECRET_ACCESS_KEY',
];

function literal(value: string): Variable {
  return { type: 'literal', value };
}

beforeEach(() => {
  fixture.variants = fixture.fresh();
});

describe('.railway/railway.ts', () => {
  it('declares each service region as the key of its replica count, never as deploy.region', async () => {
    const list = await nodes();
    expect(list.filter((item) => item.type === 'service').map((item) => item.name)).toEqual([
      ...SERVICES,
    ]);
    for (const name of SERVICES) {
      const deploy = serviceNode(list, name).deploy ?? {};
      expect(deploy, name).not.toHaveProperty('region');
      expect(deploy.multiRegionConfig, name).toEqual({ [REGION]: { numReplicas: 1 } });
    }
  });

  it('keeps the volume and bucket regions', async () => {
    const list = await nodes();
    const postgres = serviceNode(list, 'postgres');
    expect(postgres.volumeAttachments?.pgdata?.volumeConfig).toEqual({
      region: REGION,
      sizeMB: 50000,
    });
    const buckets = list.filter((item) => item.type === 'bucket');
    expect(buckets.map((item) => item.name)).toEqual(['media', 'data', 'backups']);
    for (const bucket of buckets) {
      expect(bucket.config, bucket.name).toEqual({ region: 'iad' });
    }
  });

  // Spike 11 found the header (D-848), so the line is written with it on api and admin.
  it('no client address header without its spike result', async () => {
    for (const env of ENVIRONMENTS) {
      const list = await nodes(env);
      for (const name of SERVICES) {
        const variable = serviceNode(list, name).variables?.CLIENT_IP_HEADER;
        if (name === 'api' || name === 'admin') {
          expect(variable, `${env} ${name}`).toEqual(literal('x-real-ip'));
        } else {
          expect(variable, `${env} ${name}`).toBeUndefined();
        }
      }
    }
  });

  // The five media references on api, worker and admin; the worker's environment check refuses
  // to start without them.
  it('gives api, worker and admin the five media bucket references, and backup none', async () => {
    const list = await nodes();
    for (const name of SERVICES) {
      const declared = Object.keys(serviceNode(list, name).variables ?? {}).filter((key) =>
        key.startsWith('MEDIA_'),
      );
      if (name === 'api' || name === 'worker' || name === 'admin') {
        expect(declared.sort(), name).toEqual([...MEDIA].sort());
      } else {
        expect(declared, name).toEqual([]);
      }
    }
  });

  // `config apply` refuses a custom domain it has not seen; the bootstrap adds them (D-849).
  it('declares no custom domain on any service', async () => {
    for (const env of ENVIRONMENTS) {
      for (const node of (await nodes(env)).filter((item) => item.type === 'service')) {
        expect(node.networking?.customDomains, `${env} ${node.name}`).toBeUndefined();
        expect(node, `${env} ${node.name}`).not.toHaveProperty('domains');
      }
    }
  });

  it('the api serves the site and the admin service the admin host', async () => {
    const hosts = {
      staging: { site: 'staging.example.test', admin: 'admin.staging.example.test' },
      production: { site: 'example.test', admin: 'admin.example.test' },
    };
    for (const env of ENVIRONMENTS) {
      const api = await envOf('api', env);
      const admin = await envOf('admin', env);
      expect(api.PUBLIC_URL, env).toEqual(literal(`https://${hosts[env].site}`));
      expect(api, env).not.toHaveProperty('ADMIN_URL');
      expect(admin.PUBLIC_URL, env).toEqual(literal(`https://${hosts[env].site}`));
      expect(admin.ADMIN_URL, env).toEqual(literal(`https://${hosts[env].admin}`));
    }
  });

  it('the api holds the sign-in and mail variables', async () => {
    const api = await envOf('api');
    for (const key of [
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'GOOGLE_CLIENT_IDS',
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
      'ADMIN_EMAILS',
      'APP_SECRET_PREVIOUS',
      'REVIEW_SIGNIN_EMAILS',
      'REVIEW_SIGNIN_CODE',
    ]) {
      expect(api[key], key).toEqual(PRESERVE);
    }
    expect(api.APPLE_BUNDLE_ID).toEqual(literal('test.fixture.app.staging'));
    // The whole set, in the order the variables are declared: each name once, nothing else.
    expect(Object.keys(api)).toEqual([
      'APP_ENV',
      'PORT',
      'LOG_LEVEL',
      'DATABASE_URL',
      'PUBLIC_URL',
      'ENABLE_DEV_ROUTES',
      ...MEDIA,
      'APP_SECRET',
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'ADMIN_EMAILS',
      'CLIENT_IP_HEADER',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
      'APPLE_BUNDLE_ID',
      'GOOGLE_CLIENT_IDS',
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
      'APP_SECRET_PREVIOUS',
      'REVIEW_SIGNIN_EMAILS',
      'REVIEW_SIGNIN_CODE',
      'GEO_API_KEY',
    ]);
  });

  it('the admin service holds its variables and the previous secret', async () => {
    for (const env of ENVIRONMENTS) {
      const admin = serviceNode(await nodes(env), 'admin');
      const variables = admin.variables ?? {};
      expect(Object.keys(variables), env).toEqual([
        'APP_ENV',
        'PORT',
        'LOG_LEVEL',
        'DATABASE_URL',
        'PUBLIC_URL',
        'ADMIN_URL',
        ...MEDIA,
        'APP_SECRET',
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'ADMIN_EMAILS',
        'CLIENT_IP_HEADER',
        'APP_SECRET_PREVIOUS',
      ]);
      expect(variables.APP_SECRET_PREVIOUS, env).toEqual(PRESERVE);
      expect(variables, env).not.toHaveProperty('CLAIMS_EMAIL');
      // Deployed from the admin repository with `railway up`, never by a push of this one (D-801).
      expect(admin.source, env).toBeUndefined();
      expect(admin, env).not.toHaveProperty('kind', 'github');
    }
  });

  it('the Services ID appears only once the brand has one', async () => {
    for (const env of ENVIRONMENTS) {
      const without = await envOf('api', env);
      expect(without, env).not.toHaveProperty('APPLE_SERVICES_ID');
      expect(without, env).not.toHaveProperty('EXPO_PUBLIC_APPLE_SERVICES_ID');

      fixture.variants[env].appleServicesId = 'fixture.services.id';
      const withId = await envOf('api', env);
      expect(withId.APPLE_SERVICES_ID, env).toEqual(literal('fixture.services.id'));
      // APPLE_WEB_SIGN_IN is false in both environments until D-100 spike 13 passes (D-574).
      expect(withId, env).not.toHaveProperty('EXPO_PUBLIC_APPLE_SERVICES_ID');
      for (const service of ['worker', 'admin']) {
        const other = await envOf(service, env);
        expect(other, `${env} ${service}`).not.toHaveProperty('APPLE_SERVICES_ID');
        expect(other, `${env} ${service}`).not.toHaveProperty('EXPO_PUBLIC_APPLE_SERVICES_ID');
      }
    }
  });

  it('the worker holds the media bucket, the revoke keys and the email quotas', async () => {
    for (const env of ENVIRONMENTS) {
      const worker = await envOf('worker', env);
      for (const key of MEDIA) {
        expect(worker[key], `${env} ${key}`).toEqual({
          type: 'reference',
          resource: 'bucket.media',
          output: key.slice('MEDIA_'.length),
        });
      }
      for (const key of [
        'APPLE_TEAM_ID',
        'APPLE_KEY_ID',
        'APPLE_PRIVATE_KEY',
        'APP_SECRET_PREVIOUS',
      ]) {
        expect(worker[key], `${env} ${key}`).toEqual(PRESERVE);
      }
      expect(worker.EMAIL_MONTHLY_QUOTA, env).toEqual(literal('3000'));
      expect(worker.EMAIL_DAILY_QUOTA, env).toEqual(literal('100'));
      for (const key of ['APPLE_BUNDLE_ID', 'APPLE_SERVICES_ID', 'GOOGLE_CLIENT_IDS']) {
        expect(worker, `${env} ${key}`).not.toHaveProperty(key);
      }
      expect(Object.keys(worker), env).toEqual([
        'APP_ENV',
        'LOG_LEVEL',
        'DATABASE_URL',
        'PUBLIC_URL',
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'ADMIN_EMAILS',
        'BACKUPS_BUCKET',
        'BACKUPS_ENDPOINT',
        'BACKUPS_REGION',
        'BACKUPS_ACCESS_KEY_ID',
        'BACKUPS_SECRET_ACCESS_KEY',
        'APP_SECRET',
        ...MEDIA,
        'APPLE_TEAM_ID',
        'APPLE_KEY_ID',
        'APPLE_PRIVATE_KEY',
        'APP_SECRET_PREVIOUS',
        'EMAIL_MONTHLY_QUOTA',
        'EMAIL_DAILY_QUOTA',
        ...DATA,
      ]);
    }
  });

  it('the api holds the geocoding key and no provider', async () => {
    for (const env of ENVIRONMENTS) {
      const api = await envOf('api', env);
      expect(api.GEO_API_KEY, env).toEqual(PRESERVE);
      // GEO_PROVIDER arrives with the key, in the owner input's activation.
      expect(api, env).not.toHaveProperty('GEO_PROVIDER');
      expect(
        Object.keys(api).filter((key) => key.startsWith('DATA_')),
        env,
      ).toEqual([]);
      for (const service of ['worker', 'admin', 'backup']) {
        const other = await envOf(service, env);
        expect(other, `${env} ${service}`).not.toHaveProperty('GEO_API_KEY');
        expect(other, `${env} ${service}`).not.toHaveProperty('GEO_PROVIDER');
      }
    }
  });

  it('the worker holds the data bucket', async () => {
    for (const env of ENVIRONMENTS) {
      const worker = await envOf('worker', env);
      for (const key of DATA) {
        expect(worker[key], `${env} ${key}`).toEqual({
          type: 'reference',
          resource: 'bucket.data',
          output: key.slice('DATA_'.length),
        });
      }
      // Only the worker holds the data bucket (D-133).
      for (const service of ['api', 'admin', 'backup']) {
        const other = Object.keys(await envOf(service, env)).filter((key) =>
          key.startsWith('DATA_'),
        );
        expect(other, `${env} ${service}`).toEqual([]);
      }
      // The caps take their defaults; staging's lower daily cap is a later change.
      for (const service of ['api', 'worker']) {
        const variables = await envOf(service, env);
        expect(variables, `${env} ${service}`).not.toHaveProperty('GEO_DAILY_CAP');
        expect(variables, `${env} ${service}`).not.toHaveProperty('GEO_MONTHLY_CAP');
      }
    }
  });

  it('no secret is a literal', async () => {
    const secretName = /KEY|SECRET|PASSWORD|TOKEN|PRIVATE|CODE/;
    let checked = 0;
    for (const env of ENVIRONMENTS) {
      fixture.variants[env].appleServicesId = 'fixture.services.id';
      for (const node of (await nodes(env)).filter((item) => item.type === 'service')) {
        for (const [name, variable] of Object.entries(node.variables ?? {})) {
          if (!secretName.test(name)) continue;
          checked += 1;
          const allowed =
            variable.type === 'preserve' ||
            variable.type === 'reference' ||
            /\$\{\{[^}]+\}\}/.test(variable.value);
          expect(allowed, `${env} ${node.name} ${name}`).toBe(true);
        }
      }
    }
    // The pattern names the new keys too, so the check cannot pass on an empty set.
    expect(checked).toBeGreaterThan(40);
  });

  it('production carries the same names', async () => {
    for (const service of ['api', 'worker', 'admin']) {
      const staging = Object.keys(await envOf(service, 'staging')).filter(
        (key) => key !== 'ENABLE_DEV_ROUTES',
      );
      const production = Object.keys(await envOf(service, 'production'));
      expect(production.sort(), service).toEqual(staging.sort());
    }
    expect(await envOf('api', 'staging')).toHaveProperty('ENABLE_DEV_ROUTES');
    expect(await envOf('api', 'production')).not.toHaveProperty('ENABLE_DEV_ROUTES');
    expect((await envOf('api', 'production')).APPLE_BUNDLE_ID).toEqual(literal('test.fixture.app'));
  });

  it('throws while the brand has no host', async () => {
    fixture.variants.staging.host = null;
    await expect(nodes('staging')).rejects.toThrow('variants.staging.host is not set');
  });

  it('throws while the brand has no admin host', async () => {
    fixture.variants.staging.adminHost = null;
    await expect(nodes('staging')).rejects.toThrow('variants.staging.adminHost is not set');
  });
});
