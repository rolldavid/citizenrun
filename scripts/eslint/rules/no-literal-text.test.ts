import { noLiteralText } from './no-literal-text.ts';
import { ruleTester, testable } from '../rule-tester.ts';

const FEATURE = 'apps/mobile/src/features/x/a.tsx';
const HEAD =
  'declare const Text: (props: object) => null;\ndeclare const t: (key: string) => string;\n';

ruleTester().run('no-literal-text', testable(noLiteralText), {
  valid: [
    { filename: FEATURE, code: `${HEAD}export const a = <Text>{t('common:about')}</Text>;` },
    { filename: FEATURE, code: `${HEAD}export const a = <Text testID="office.run-button" />;` },
    { filename: FEATURE, code: `${HEAD}export const a = <Text>{'·'}</Text>;` },
    { filename: FEATURE, code: "export function fail(): never { throw new Error('bad state'); }" },
    {
      filename: 'apps/mobile/app/dev/gallery.tsx',
      code: `${HEAD}export const a = <Text>Hello</Text>;`,
    },
    {
      filename: 'apps/mobile/src/features/x/a.test.tsx',
      code: `${HEAD}export const a = <Text>Hello</Text>;`,
    },
    { filename: 'apps/api/src/a.tsx', code: `${HEAD}export const a = <Text>Hello</Text>;` },
    {
      filename: FEATURE,
      code: `${HEAD}export const a = <Text accessibilityLabel={t('common:about')} />;`,
    },
    {
      filename: FEATURE,
      code: "export const style = { name: 'office', variant: 'primary', key: 'k' };",
    },
    { filename: FEATURE, code: "export function routeName() { return 'office'; }" },
  ],
  invalid: [
    {
      filename: FEATURE,
      code: `${HEAD}export const a = <Text>Hello</Text>;`,
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: `${HEAD}declare const open: boolean;\nexport const a = <Text>{open ? 'Hide' : 'Show'}</Text>;`,
      errors: [{ messageId: 'literalText' }, { messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: `${HEAD}export const a = <Text accessibilityLabel="Close" />;`,
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: `${HEAD}export const a = <Text placeholder={'Search'} />;`,
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: "export function altText() { return 'An office'; }",
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: 'packages/cards/src/templates/x.tsx',
      code: `${HEAD}export const a = <Text>Pays a year</Text>;`,
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: 'export const toast = { message: `Saved` };',
      errors: [{ messageId: 'literalText' }],
    },
    {
      filename: FEATURE,
      code: "export const buttonLabel = (): string => 'Run';",
      errors: [{ messageId: 'literalText' }],
    },
  ],
});
