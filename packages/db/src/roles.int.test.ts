import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrator.ts';
import { getTestDatabaseUrl } from './testing/index.ts';
import { stampOf } from './testing/names.ts';

// OPS-db-roles and OPS-db-settings (CTL-36): roles.sql applied with fixed test verifiers to a
// database of this file's own. Roles are server-wide, so the file serializes on an advisory lock.

const ROLES_SQL = readFileSync(new URL('../sql/roles.sql', import.meta.url), 'utf8');
const MIGRATIONS_DIR = new URL('../migrations', import.meta.url);

const MARKERS = {
  '{{API_VERIFIER}}': 'roles-test-api-0001',
  '{{WORKER_VERIFIER}}': 'roles-test-worker-0001',
  '{{BACKUP_VERIFIER}}': 'roles-test-backup-0001',
  '{{ADMIN_VERIFIER}}': 'roles-test-admin-0001',
} as const;

const PASSWORDS = {
  app_api: MARKERS['{{API_VERIFIER}}'],
  app_worker: MARKERS['{{WORKER_VERIFIER}}'],
  app_backup: MARKERS['{{BACKUP_VERIFIER}}'],
  app_admin: MARKERS['{{ADMIN_VERIFIER}}'],
} as const;

type LoginRole = keyof typeof PASSWORDS;

const ROLE_NAMES = ['app_admin', 'app_api', 'app_backup', 'app_owner', 'app_worker'];
const LOCK_KEY = "hashtext('os_test_roles')";
const LOCK_RETRY_MS = 250;
const LOCK_WAIT_MS = 45_000;
const READ_ONLY_TRANSACTION = '25006';

/** A SCRAM-SHA-256 verifier for `password` with a random salt (RFC 7677, 4096 iterations). */
function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** roles.sql with its markers filled and without the server-wide `alter system` statements. */
function filledScript(): string {
  let text = ROLES_SQL;
  for (const [marker, password] of Object.entries(MARKERS)) {
    const verifier = scramVerifier(password);
    // A function, so the `$` signs of the verifier are not read as replacement patterns.
    text = text.replace(marker, () => verifier);
  }
  return text
    .split('\n')
    .filter((line) => !line.startsWith('alter system') && line !== 'select pg_reload_conf();')
    .join('\n');
}

function urlFor(base: string, database: string, role?: LoginRole): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (role !== undefined) {
    url.username = role;
    url.password = PASSWORDS[role];
  }
  return url.href;
}

async function connect(url: string): Promise<pg.Client> {
  // No session options: the role's own settings are what the cases read.
  const client = new pg.Client({ connectionString: url, application_name: 'os-test-roles' });
  client.on('error', () => undefined);
  await client.connect();
  return client;
}

const SCRIPT = filledScript();

// A role keeps its settings, memberships and password from an earlier run on the same server, so
// they are cleared before the script runs: a line removed from roles.sql then fails a case.
const CLEAR_ROLES = `
do $$
declare
  membership record;
  role_name text;
begin
  for membership in
    select g.rolname as granted, m.rolname as member
    from pg_auth_members a
    join pg_roles g on g.oid = a.roleid
    join pg_roles m on m.oid = a.member
    where m.rolname in ('app_api', 'app_worker', 'app_backup', 'app_admin')
  loop
    execute format('revoke %I from %I', membership.granted, membership.member);
  end loop;
  foreach role_name in array array['app_api', 'app_worker', 'app_backup', 'app_admin'] loop
    if to_regrole(role_name) is not null then
      execute format('alter role %I reset all', role_name);
      execute format('alter role %I password null', role_name);
    end if;
  end loop;
end
$$;`;
let adminUrl = '';
let databaseName = '';
let lockClient: pg.Client | null = null;
let migration: { applied: number } | { error: unknown } = { error: 'not run' };

async function asSuperuser<T>(body: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect(urlFor(adminUrl, databaseName));
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function asRole<T>(role: LoginRole, body: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect(urlFor(adminUrl, databaseName, role));
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function one<T extends Record<string, unknown>>(client: pg.Client, text: string): Promise<T> {
  const row = (await client.query<T>(text)).rows[0];
  if (row === undefined) {
    throw new Error('The query returned no row');
  }
  return row;
}

async function roleAttributes(): Promise<Record<string, unknown>[]> {
  return asSuperuser(async (client) => {
    const result = await client.query(
      `select rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb from pg_roles
       where rolname = any($1::text[]) order by rolname`,
      [ROLE_NAMES],
    );
    return result.rows as Record<string, unknown>[];
  });
}

async function takeLock(client: pg.Client): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const row = await one<{ locked: boolean }>(
      client,
      `select pg_try_advisory_lock(${LOCK_KEY}) as locked`,
    );
    if (row.locked) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('Another run held the roles test lock for too long.');
    }
    await sleep(LOCK_RETRY_MS);
  }
}

beforeAll(async () => {
  adminUrl = urlFor(getTestDatabaseUrl(), 'postgres');
  lockClient = await connect(adminUrl);
  await takeLock(lockClient);
  databaseName = `os_t_${stampOf(new Date())}_roles${randomBytes(3).toString('hex')}`;
  await lockClient.query(
    `create database ${lockClient.escapeIdentifier(databaseName)} template template0`,
  );
  await asSuperuser(async (client) => {
    await client.query(CLEAR_ROLES);
    await client.query(SCRIPT);
  });
  migration = await runMigrations(urlFor(adminUrl, databaseName, 'app_api')).then(
    (result) => ({ applied: result.applied }),
    (error: unknown) => ({ error }),
  );
});

afterAll(async () => {
  if (lockClient === null) {
    return;
  }
  try {
    if (databaseName !== '') {
      await lockClient.query(
        `drop database if exists ${lockClient.escapeIdentifier(databaseName)} with (force)`,
      );
    }
    await lockClient.query(`select pg_advisory_unlock(${LOCK_KEY})`);
  } finally {
    await lockClient.end();
  }
});

describe('roles.sql', () => {
  it('the api role is not a superuser and acts as app_owner', async () => {
    const row = await asRole('app_api', (client) =>
      one<{ session: string; current: string; super: boolean }>(
        client,
        `select session_user::text as session, current_user::text as current,
          (select rolsuper from pg_roles where rolname = session_user) as super`,
      ),
    );
    expect(row).toEqual({ session: 'app_api', current: 'app_owner', super: false });
  });

  it('the api role has a 2-second statement timeout', async () => {
    const row = await asRole('app_api', (client) =>
      one<{ statement_timeout: string }>(client, 'show statement_timeout'),
    );
    expect(row.statement_timeout).toBe('2s');
  });

  it('the admin role is not a superuser, acts as app_owner and has a 2-second statement timeout', async () => {
    await asRole('app_admin', async (client) => {
      const row = await one<{ session: string; current: string; super: boolean }>(
        client,
        `select session_user::text as session, current_user::text as current,
          (select rolsuper from pg_roles where rolname = session_user) as super`,
      );
      expect(row).toEqual({ session: 'app_admin', current: 'app_owner', super: false });
      const timeout = await one<{ statement_timeout: string }>(client, 'show statement_timeout');
      expect(timeout.statement_timeout).toBe('2s');
      // It writes the application's tables (D-801); the row is rolled back.
      await client.query('begin');
      try {
        const inserted = await client.query(
          "insert into worker_heartbeats (worker) values ('roles-test-admin')",
        );
        expect(inserted.rowCount).toBe(1);
      } finally {
        await client.query('rollback');
      }
    });
  });

  it('the worker role has no statement timeout and reads activity', async () => {
    await asRole('app_worker', async (client) => {
      const who = await one<{ current: string }>(client, 'select current_user::text as current');
      expect(who.current).toBe('app_owner');
      const timeout = await one<{ statement_timeout: string }>(client, 'show statement_timeout');
      expect(timeout.statement_timeout).toBe('0');
      const monitor = await one<{ member: boolean }>(
        client,
        "select pg_has_role('app_worker', 'pg_monitor', 'member') as member",
      );
      expect(monitor.member).toBe(true);
      const COUNT =
        "select count(*)::int as n from pg_stat_activity where backend_type = 'client backend'";
      const asOwner = await one<{ n: number }>(client, COUNT);
      expect(asOwner.n).toBe(0);
      await client.query('begin');
      try {
        await client.query('set local role none');
        const asWorker = await one<{ n: number }>(client, COUNT);
        expect(asWorker.n).toBeGreaterThanOrEqual(1);
      } finally {
        await client.query('rollback');
      }
    });
  });

  it('migrations run by the api role create objects owned by app_owner', async () => {
    const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    ).length;
    expect(migration).toEqual({ applied: folders });
    const { tables, schemas } = await asSuperuser(async (client) => ({
      tables: (
        await client.query<{ owner: string }>(
          `select distinct pg_get_userbyid(c.relowner)::text as owner
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'drizzle', 'pgboss') and c.relkind in ('r', 'p')
             and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
               and d.objid = c.oid and d.deptype = 'e')`,
        )
      ).rows,
      schemas: (
        await client.query<{ name: string; owner: string }>(
          `select nspname::text as name, pg_get_userbyid(nspowner)::text as owner from pg_namespace
           where nspname in ('public', 'drizzle', 'pgboss') order by nspname`,
        )
      ).rows,
    }));
    expect(tables).toEqual([{ owner: 'app_owner' }]);
    expect(schemas).toEqual([
      { name: 'drizzle', owner: 'app_owner' },
      { name: 'pgboss', owner: 'app_owner' },
      { name: 'public', owner: 'app_owner' },
    ]);
  });

  it('the backup role can read and cannot write', async () => {
    await asRole('app_backup', async (client) => {
      const count = await one<{ n: number }>(
        client,
        'select count(*)::int as n from worker_heartbeats',
      );
      expect(count.n).toBeGreaterThanOrEqual(0);
      await expect(
        client.query('insert into worker_heartbeats default values'),
      ).rejects.toMatchObject({ code: READ_ONLY_TRANSACTION });
      const readOnly = await one<{ default_transaction_read_only: string }>(
        client,
        'show default_transaction_read_only',
      );
      expect(readOnly.default_transaction_read_only).toBe('on');
    });
  });

  it('the extensions exist', async () => {
    const names = await asSuperuser(async (client) =>
      (await client.query<{ extname: string }>('select extname::text from pg_extension')).rows.map(
        (row) => row.extname,
      ),
    );
    expect(names).toEqual(expect.arrayContaining(['postgis', 'pg_trgm', 'citext', 'unaccent']));
  });

  it('the script is idempotent', async () => {
    const before = await roleAttributes();
    expect(before).toEqual([
      ...['app_admin', 'app_api', 'app_backup'].map((rolname) => ({
        rolname,
        rolsuper: false,
        rolcanlogin: true,
        rolcreaterole: false,
        rolcreatedb: false,
      })),
      {
        rolname: 'app_owner',
        rolsuper: false,
        rolcanlogin: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
      {
        rolname: 'app_worker',
        rolsuper: false,
        rolcanlogin: true,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
    await expect(asSuperuser((client) => client.query(SCRIPT))).resolves.toBeDefined();
    expect(await roleAttributes()).toEqual(before);
  });

  it('the file holds markers and no secret', () => {
    for (const marker of Object.keys(MARKERS)) {
      expect(ROLES_SQL.split(marker)).toHaveLength(2);
    }
    expect(ROLES_SQL).not.toContain('SCRAM-SHA-256$');
    const passwords = [...ROLES_SQL.matchAll(/password '([^']*)'/g)].map((match) => match[1]);
    expect(passwords.sort()).toEqual(Object.keys(MARKERS).sort());
    expect(ROLES_SQL).not.toMatch(/password '(?!\{\{(?:API|WORKER|BACKUP|ADMIN)_VERIFIER\}\}')/);
  });
});
