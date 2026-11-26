import { tokensOnly } from './tokens-only.ts';
import { ruleTester, testable } from '../rule-tester.ts';

const FEATURE = 'apps/mobile/src/features/x/a.tsx';
const TEMPLATE = 'packages/cards/src/templates/x.tsx';
const SHEET =
  'declare const StyleSheet: { create<T>(styles: T): T };\ndeclare const space: number[];\n';

ruleTester().run('tokens-only', testable(tokensOnly), {
  valid: [
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { padding: 0 } });`,
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { width: '50%' } });`,
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { color: 'transparent' } });`,
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { padding: (space[4] ?? 0) * 2 } });`,
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { flex: 1 } });`,
    },
    { filename: 'apps/mobile/src/ui/tokens.ts', code: "export const ink = { color: '#141412' };" },
    {
      filename: 'packages/shared/src/design/tokens.ts',
      code: "export const ink = { color: '#141412' };",
    },
    { filename: FEATURE, code: 'export const pageSize = { count: 12 };' },
    {
      filename: 'apps/mobile/src/platform/auth/provider-art.ts',
      code: "export const appleBlack = { color: '#000000' };",
    },
    { filename: 'apps/api/src/a.ts', code: "export const ink = { color: '#141412' };" },
    {
      filename: 'apps/mobile/src/features/x/a.test.tsx',
      code: "export const ink = { color: '#141412' };",
    },
  ],
  invalid: [
    {
      filename: 'apps/mobile/src/platform/auth/index.native.tsx',
      code: "export const appleBlack = { color: '#000000' };",
      errors: [{ messageId: 'color' }],
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { color: '#141412' } });`,
      errors: [{ messageId: 'color' }],
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { backgroundColor: 'rgb(0,0,0)' } });`,
      errors: [{ messageId: 'color' }],
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { borderColor: 'red' } });`,
      errors: [{ messageId: 'color' }],
    },
    {
      filename: FEATURE,
      code: `${SHEET}export const s = StyleSheet.create({ box: { padding: 12 } });`,
      errors: [{ messageId: 'size' }],
    },
    {
      filename: FEATURE,
      code: 'declare const View: (props: object) => null;\ndeclare const wide: boolean;\nexport const a = <View style={{ marginTop: wide ? 8 : -4 }} />;',
      errors: [{ messageId: 'size' }],
    },
    {
      filename: FEATURE,
      code: 'declare function withTiming(v: number, o: object): number;\nexport const v = withTiming(1, { duration: 200 });',
      errors: [{ messageId: 'motion' }],
    },
    {
      filename: FEATURE,
      code: "import { Easing } from 'react-native-reanimated';\nexport { Easing };",
      errors: [{ messageId: 'easing' }],
    },
    {
      filename: TEMPLATE,
      code: 'declare const Label: (props: object) => null;\nexport const a = <Label fontSize={40} />;',
      errors: [{ messageId: 'canvas' }],
    },
    {
      filename: FEATURE,
      code: "export const fade = { transitionDuration: '300ms' };",
      errors: [{ messageId: 'motion' }],
    },
  ],
});
