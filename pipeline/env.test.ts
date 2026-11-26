import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvError, PipelineEnvSchema, loadEnv } from './env.ts';
import { captureLogger } from './testing/capture-log.ts';

const BASE: Readonly<Record<string, string>> = {
  DATA_BUCKET: 'fixture-bucket',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture-access-id',
  DATA_SECRET_ACCESS_KEY: 'fixture-secret-value',
};

function readExample(): Record<string, string> {
  const text = readFileSync(join(import.meta.dirname, '.env.example'), 'utf8');
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) {
      continue;
    }
    const equals = line.indexOf('=');
    values[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return values;
}

function missingLines(lines: readonly { raw: string; parsed: Record<string, unknown> }[]) {
  return lines.filter((line) => line.parsed.event === 'env.input_missing');
}

describe('loadEnv', () => {
  it('the schema has no DATABASE_URL', () => {
    const names = Object.keys(PipelineEnvSchema.shape);
    expect(names).toContain('DATA_BUCKET');
    expect(names.filter((name) => /DATABASE|MEDIA_|BACKUPS_|LEGAL_/.test(name))).toEqual([]);
  });

  it('parses the local example', () => {
    const { log } = captureLogger();
    const env = loadEnv(readExample(), log);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.DATA_BUCKET).toBe('data');
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.FEC_API_KEY).toBeNull();
  });

  it('FEC_API_KEY unset is null and logged once', () => {
    const { log, lines } = captureLogger();
    const env = loadEnv(BASE, log);
    expect(env.FEC_API_KEY).toBeNull();
    const missing = missingLines(lines);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.parsed).toMatchObject({
      level: 'warn',
      variable: 'FEC_API_KEY',
      ownerInput: 'OI-datagov-key',
    });
    for (const value of Object.values(BASE)) {
      expect(missing[0]?.raw).not.toContain(value);
    }
  });

  it('FEC_API_KEY set turns the path on', () => {
    const { log, lines } = captureLogger();
    const env = loadEnv({ ...BASE, FEC_API_KEY: 'fixture-fec-key' }, log);
    expect(env.FEC_API_KEY).toBe('fixture-fec-key');
    expect(missingLines(lines)).toEqual([]);
    expect(lines.map((line) => line.raw).join('\n')).not.toContain('fixture-fec-key');
  });

  it('empty FEC_API_KEY counts as unset', () => {
    const { log, lines } = captureLogger();
    expect(loadEnv({ ...BASE, FEC_API_KEY: '' }, log).FEC_API_KEY).toBeNull();
    expect(missingLines(lines)).toHaveLength(1);
  });

  it('a missing DATA_BUCKET fails naming it', () => {
    const { log } = captureLogger();
    const source = { ...BASE, DATA_BUCKET: undefined };
    const attempt = (): unknown => loadEnv(source, log);
    expect(attempt).toThrow(EnvError);
    let message = '';
    try {
      attempt();
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('DATA_BUCKET');
    for (const value of Object.values(BASE)) {
      expect(message).not.toContain(value);
    }
  });

  it('a bad endpoint fails naming it and never its value', () => {
    const { log } = captureLogger();
    expect(() => loadEnv({ ...BASE, DATA_ENDPOINT: 'ftp://fixture-host' }, log)).toThrow(
      /DATA_ENDPOINT/,
    );
    expect(() => loadEnv({ ...BASE, PIPELINE_RUN_ID: 'has spaces' }, log)).toThrow(
      /PIPELINE_RUN_ID/,
    );
  });

  it('CI=true sets isCi', () => {
    const { log } = captureLogger();
    expect(loadEnv({ ...BASE, CI: 'true' }, log).isCi).toBe(true);
    expect(loadEnv({ ...BASE, CI: '1' }, log).isCi).toBe(false);
    expect(loadEnv(BASE, log).isCi).toBe(false);
  });

  it('defaults', () => {
    const { log } = captureLogger();
    const env = loadEnv(BASE, log);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.PIPELINE_RUN_ID).toBeNull();
    expect(Object.isFrozen(env)).toBe(true);
  });
});
