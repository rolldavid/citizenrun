import { describe, expect, it } from 'vitest';
import { run } from './exec.ts';

describe('run', () => {
  it('returns the exit code and output', async () => {
    const result = await run('node', [
      '-e',
      'process.stdout.write("a"); process.stderr.write("b"); process.exit(3)',
    ]);
    expect(result).toEqual({ code: 3, stdout: 'a', stderr: 'b' });
  });

  it('passes arguments without a shell', async () => {
    const result = await run('node', [
      '-e',
      'process.stdout.write(process.argv[1])',
      '$HOME; echo x',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('$HOME; echo x');
  });

  it('runs in the given folder with exactly the given environment', async () => {
    const result = await run(
      process.execPath,
      [
        '-e',
        'process.stdout.write(process.cwd() + "|" + String(process.env.RUN_MARK) + "|" + String(process.env.HOME))',
      ],
      { cwd: '/', env: { RUN_MARK: 'fixture-mark' } },
    );
    expect(result).toEqual({ code: 0, stdout: '/|fixture-mark|undefined', stderr: '' });
  });

  it('leaves stdout and stderr empty when output is inherited', async () => {
    const result = await run(process.execPath, ['-e', 'process.exit(0)'], { inherit: true });
    expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('rejects when the command does not exist', async () => {
    await expect(run('citizenrun-no-such-command-fixture', [])).rejects.toThrow();
  });
});
