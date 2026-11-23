import { createLogger } from '@citizenrun/shared';
import { createS3Client } from '@citizenrun/shared/storage';
import { pgDumpVersion, runDump, verifyDump } from './dump.ts';
import { BackupEnvError, loadBackupEnvFromProcess } from './env.ts';
import type { BackupEnv } from './env.ts';
import { readDatabaseFacts } from './facts.ts';
import { runBackup } from './run.ts';

// The backup cron's entry (OPS-backup-job). Railway never stops a cron run, so every path ends in
// process.exit: 0 on success, 1 on failure, 2 on the job's own time limit (D-144).

const WORK_DIR = '/tmp/backup';
const BACKSTOP_GRACE_SECONDS = 30;

async function flushStdout(): Promise<void> {
  // Standard output on Railway is a pipe, and process.exit can cut off a line still being written.
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => {
      resolve();
    });
  });
}

async function main(): Promise<number> {
  let env: BackupEnv;
  try {
    env = loadBackupEnvFromProcess();
  } catch (error) {
    const log = createLogger({ service: 'worker', level: 'info' });
    if (error instanceof BackupEnvError) {
      log.error('backup.failed', { reason: 'config', variables: error.variables });
    } else {
      log.error('backup.failed', { reason: 'config' });
    }
    return 1;
  }

  const log = createLogger({ service: 'worker', level: env.logLevel });
  const s3 = createS3Client({
    endpoint: env.backups.endpoint,
    region: env.backups.region,
    accessKeyId: env.backups.accessKeyId,
    secretAccessKey: env.backups.secretAccessKey,
    forcePathStyle: env.forcePathStyle,
  });
  // Ends the process if cleanup hangs after the job's own timer fired.
  setTimeout(
    () => {
      process.exit(2);
    },
    (env.timeoutSeconds + BACKSTOP_GRACE_SECONDS) * 1000,
  ).unref();
  try {
    return await runBackup({
      env,
      s3,
      log,
      now: () => new Date(),
      workDir: WORK_DIR,
      runDump,
      verifyDump,
      pgDumpVersion,
      readDatabaseFacts,
    });
  } finally {
    s3.destroy();
  }
}

const code = await main();
await flushStdout();
process.exit(code);
