import { spawn } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Runs a command with an argument array and no shell, and resolves with its exit code and output.
 * With `inherit` the child writes to this terminal and `stdout` and `stderr` are empty strings.
 * A child ended by a signal resolves with code 1.
 */
export function run(
  command: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    inherit?: boolean;
  },
): Promise<RunResult> {
  const inherit = options?.inherit === true;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options?.env === undefined ? {} : { env: options.env }),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}
