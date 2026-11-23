import { describe, expect, it, vi } from 'vitest';
import { HarnessRefusedError, harnessSettings } from './settings.ts';

function settingsFor(databaseUrl: string): ReturnType<typeof harnessSettings> {
  vi.stubEnv('TEST_DATABASE_URL', databaseUrl);
  return harnessSettings();
}

describe('harnessSettings', () => {
  it('accepts a local database URL', () => {
    expect(settingsFor('postgres://u:p@127.0.0.1:55432/postgres').databaseUrl).toBe(
      'postgres://u:p@127.0.0.1:55432/postgres',
    );
    expect(settingsFor('postgresql://u:p@localhost/postgres').databaseUrl).toBe(
      'postgresql://u:p@localhost/postgres',
    );
  });

  it('refuses a host that is not local or CI', () => {
    expect(() => settingsFor('postgres://u:p@db.example.test/postgres')).toThrow(
      HarnessRefusedError,
    );
  });

  it('refuses a query parameter that replaces the host', () => {
    expect(() => settingsFor('postgres://u:p@localhost/postgres?host=db.example.test')).toThrow(
      HarnessRefusedError,
    );
    expect(() => settingsFor('postgres://u:p@localhost/postgres?hostaddr=192.0.2.1')).toThrow(
      HarnessRefusedError,
    );
  });

  it('refuses a query parameter that replaces the port', () => {
    expect(() => settingsFor('postgres://u:p@localhost:5432/postgres?port=6543')).toThrow(
      HarnessRefusedError,
    );
  });

  it('refuses a socket URL', () => {
    expect(() => settingsFor('socket://u:p@localhost/var/run/postgresql?db=postgres')).toThrow(
      HarnessRefusedError,
    );
  });
});
