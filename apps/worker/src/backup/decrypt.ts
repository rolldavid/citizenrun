import { lstat, readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { decryptFile, EnvelopeError } from './envelope.ts';

// Restores a dump envelope on the owner's machine (OPS-backup-envelope). Never bundled into a
// service. Prints one line on standard error and never the key's text or path.

const USAGE = 'usage: decrypt.ts --in <file.dump.enc> --out <file.dump> --key <private-key.pem>';
const IO_ERROR_CODE = /^E[A-Z]{1,20}$/;

function line(text: string): void {
  process.stderr.write(`${text}\n`);
}

function parse(): { input: string; output: string; key: string } | null {
  try {
    const { values } = parseArgs({
      strict: true,
      allowPositionals: false,
      options: {
        in: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
      },
    });
    if (values.in === undefined || values.out === undefined || values.key === undefined) {
      return null;
    }
    return { input: values.in, output: values.out, key: values.key };
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

// A static line for a failure: the envelope's own message, or the system error code of an I/O
// failure, whose message would name a path.
function failureLine(error: unknown): string {
  if (error instanceof EnvelopeError) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = error.code;
    if (typeof code === 'string' && IO_ERROR_CODE.test(code)) {
      return `i/o error ${code}`;
    }
  }
  return 'decryption failed';
}

async function main(): Promise<number> {
  const args = parse();
  if (args === null) {
    line(USAGE);
    return 2;
  }
  try {
    if (await exists(args.output)) {
      line('output exists');
      return 1;
    }
    const privateKeyPem = await readFile(args.key, 'utf8');
    await decryptFile(args.input, args.output, privateKeyPem);
    const { size } = await stat(args.output);
    line(`decrypted ${String(size)} bytes`);
    return 0;
  } catch (error) {
    line(failureLine(error));
    return 1;
  }
}

process.exitCode = await main();
