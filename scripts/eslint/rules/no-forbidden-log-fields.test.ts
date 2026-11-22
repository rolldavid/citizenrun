import { noForbiddenLogFields } from './no-forbidden-log-fields.ts';
import { ruleTester, testable } from '../rule-tester.ts';

const FILE = 'apps/api/src/services/x.ts';
const HEAD =
  'type Log = Record<string, (...args: unknown[]) => void>;\ndeclare const logger: Log;\ndeclare const log: Log;\n';

ruleTester().run('no-forbidden-log-fields', testable(noForbiddenLogFields), {
  valid: [
    {
      filename: FILE,
      code: `${HEAD}declare const errorCode: string;\nlogger.info('x', { errorCode });`,
    },
    { filename: FILE, code: `${HEAD}declare const route: string;\nlogger.info('x', { route });` },
    { filename: FILE, code: `${HEAD}logger.info('x', { state: 'NC' });` },
    { filename: FILE, code: `${HEAD}declare const err: Error;\nlogger.error('x', { err });` },
    {
      filename: FILE,
      code: `${HEAD}declare const foo: Log;\ndeclare const email: string;\nfoo.info({ email });`,
    },
    {
      filename: 'apps/mobile/app/index.tsx',
      code: `${HEAD}declare const email: string;\nlogger.info('x', { email });`,
    },
    { filename: FILE, code: `${HEAD}declare const id: string;\nlogger.info(\`job \${id}\`);` },
  ],
  invalid: [
    {
      filename: FILE,
      code: `${HEAD}declare const email: string;\nlogger.info('x', { email });`,
      errors: [{ messageId: 'field' }],
    },
    {
      filename: FILE,
      code: `${HEAD}declare const t: string;\nlog.warn('x', { user: { token: t } });`,
      errors: [{ messageId: 'field' }],
    },
    {
      filename: FILE,
      code: `${HEAD}declare const req: object;\nlogger.error('x', req);`,
      errors: [{ messageId: 'whole' }],
    },
    {
      filename: 'scripts/x.ts',
      code: 'declare const user: { email: string };\nconsole.log(`signed in ${user.email}`);',
      errors: [{ messageId: 'interpolated' }],
    },
    {
      filename: FILE,
      code: `${HEAD}declare const body: object;\nlogger.info('x', { ...body });`,
      errors: [{ messageId: 'whole' }],
    },
    {
      filename: FILE,
      code: `${HEAD}declare const s: string;\nlogger.info('x', { Session_Token: s });`,
      errors: [{ messageId: 'field' }],
    },
    {
      filename: 'packages/db/src/x.ts',
      code: `${HEAD}declare const deps: { logger: Log };\ndeclare const address: string;\ndeps.logger.warn('lookup ' + address);`,
      errors: [{ messageId: 'interpolated' }],
    },
  ],
});
