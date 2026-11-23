import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCli } from './fake-cli.ts';
import type { FakeCli } from './fake-cli.ts';

type Spawned = { code: number; stdout: string; stderr: string };

function runTool(
  fake: FakeCli,
  tool: 'railway' | 'gh',
  args: readonly string[],
  stdin?: string,
): Promise<Spawned> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tool, args, {
      env: fake.env({ PATH: process.env.PATH }),
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

const created: FakeCli[] = [];

async function fakeWith(tables: Parameters<typeof createFakeCli>[0]): Promise<FakeCli> {
  const fake = await createFakeCli(tables);
  created.push(fake);
  return fake;
}

afterEach(async () => {
  for (const fake of created.splice(0)) {
    await fake.cleanup();
  }
});

describe('createFakeCli', () => {
  it('answers a scripted command', async () => {
    const fake = await fakeWith({ railway: [{ args: ['whoami'], stdout: 'fixture-user' }] });
    const result = await runTool(fake, 'railway', ['whoami']);
    expect(result).toEqual({ code: 0, stdout: 'fixture-user', stderr: '' });
  });

  it('an unscripted command exits 97 and is recorded unmatched', async () => {
    const fake = await fakeWith({ railway: [{ args: ['whoami'], stdout: 'fixture-user' }] });
    const result = await runTool(fake, 'gh', ['auth', 'status']);
    expect(result.code).toBe(97);
    expect(result.stderr).toBe('fake-cli: unscripted gh auth status\n');
    expect(fake.calls()).toEqual([
      { tool: 'gh', args: ['auth', 'status'], exitCode: 97, matched: false, stdinBytes: 0 },
    ]);
  });

  it('regex arguments match', async () => {
    const fake = await fakeWith({
      railway: [
        { args: ['variable', 'list', '--service', /^(api|worker)$/], stdout: '{}', exitCode: 3 },
      ],
    });
    expect((await runTool(fake, 'railway', ['variable', 'list', '--service', 'worker'])).code).toBe(
      3,
    );
    expect((await runTool(fake, 'railway', ['variable', 'list', '--service', 'admin'])).code).toBe(
      97,
    );
    expect(
      (await runTool(fake, 'railway', ['variable', 'list', '--service', 'worker', '--json'])).code,
    ).toBe(97);
  });

  it('calls are recorded in order with standard input byte counts', async () => {
    const fake = await fakeWith({
      railway: [{ args: [/.*/] }, { args: ['variable', 'set', 'KEY', '--stdin'] }],
      gh: [{ args: ['secret', 'set', 'NAME'] }],
    });
    await runTool(fake, 'railway', ['--version']);
    await runTool(fake, 'railway', ['variable', 'set', 'KEY', '--stdin'], 'fixture-value');
    await runTool(fake, 'gh', ['secret', 'set', 'NAME'], 'ab');
    const calls = fake.calls();
    expect(calls.map((call) => [call.tool, call.args.join(' '), call.stdinBytes])).toEqual([
      ['railway', '--version', 0],
      ['railway', 'variable set KEY --stdin', 13],
      ['gh', 'secret set NAME', 2],
    ]);
    expect(calls.every((call) => call.matched && call.exitCode === 0)).toBe(true);
  });

  it('captured standard input is recorded only when the rule asks', async () => {
    const fake = await fakeWith({
      railway: [{ args: ['ssh', 'capture'], captureStdin: true }, { args: ['ssh', 'plain'] }],
    });
    await runTool(fake, 'railway', ['ssh', 'capture'], 'select 1;');
    await runTool(fake, 'railway', ['ssh', 'plain'], 'select 2;');
    const [captured, plain] = fake.calls();
    expect(captured?.stdin).toBe('select 1;');
    expect(plain).toBeDefined();
    expect(plain !== undefined && 'stdin' in plain).toBe(false);
    expect(plain?.stdinBytes).toBe(9);
  });

  it('env() puts the shim folder first on PATH', async () => {
    const fake = await fakeWith({});
    const env = fake.env({
      PATH: '/usr/bin:/bin',
      RAILWAY_API_TOKEN: 'fixture-token',
      GONE: undefined,
    });
    expect(env.PATH).toBe(`${fake.binDir}:/usr/bin:/bin`);
    expect(env.RAILWAY_API_TOKEN).toBe('fixture-token');
    expect('GONE' in env).toBe(false);
  });

  it('cleanup removes the folder', async () => {
    const fake = await createFakeCli({});
    expect(existsSync(fake.binDir)).toBe(true);
    await fake.cleanup();
    expect(existsSync(fake.binDir)).toBe(false);
  });
});
