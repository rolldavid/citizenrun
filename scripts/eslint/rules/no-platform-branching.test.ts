import { noPlatformBranching } from './no-platform-branching.ts';
import { ruleTester, testable } from '../rule-tester.ts';

const FEATURE = 'apps/mobile/src/features/x/a.ts';
const UI = 'apps/mobile/src/ui/a.ts';
const PLATFORM = 'apps/mobile/src/platform/haptics/index.web.ts';
const IMPORT = "import { Platform } from 'react-native';";

ruleTester().run('no-platform-branching', testable(noPlatformBranching), {
  valid: [
    { filename: PLATFORM, code: IMPORT },
    { filename: PLATFORM, code: `${IMPORT}\nexport const isIos = Platform.OS === 'ios';` },
    { filename: PLATFORM, code: `${IMPORT}\nexport const pick = Platform.select({});` },
    { filename: PLATFORM, code: 'export const os = process.env.EXPO_OS;' },
    { filename: PLATFORM, code: "export const hasWindow = typeof window !== 'undefined';" },
    {
      filename: FEATURE,
      code: 'declare function useBreakpoint(): string;\nexport const size = useBreakpoint();',
    },
    { filename: FEATURE, code: "const Platform = { OS: 'x' };\nexport const os = Platform.OS;" },
    { filename: FEATURE, code: "import { View } from 'react-native';\nexport { View };" },
    { filename: FEATURE, code: 'export const mode = process.env.NODE_ENV;' },
    {
      filename: FEATURE,
      code: "export const kind = typeof value === 'string';\ndeclare const value: unknown;",
    },
  ],
  invalid: [
    { filename: FEATURE, code: IMPORT, errors: [{ messageId: 'platformImport' }] },
    {
      filename: FEATURE,
      code: `${IMPORT}\nexport const isIos = Platform.OS === 'ios';`,
      errors: [{ messageId: 'platformImport' }, { messageId: 'platformAccess' }],
    },
    {
      filename: FEATURE,
      code: `${IMPORT}\nexport const pick = Platform.select({});`,
      errors: [{ messageId: 'platformImport' }, { messageId: 'platformAccess' }],
    },
    {
      filename: FEATURE,
      code: "import { Platform as P } from 'react-native-web';\nexport const v = P.Version;",
      errors: [{ messageId: 'platformImport' }, { messageId: 'platformAccess' }],
    },
    {
      filename: FEATURE,
      code: "import * as RN from 'react-native';\nexport const os = RN.Platform.OS;",
      errors: [{ messageId: 'platformAccess' }],
    },
    {
      filename: FEATURE,
      code: 'export const os = process.env.EXPO_OS;',
      errors: [{ messageId: 'expoOs' }],
    },
    {
      filename: UI,
      code: "export const hasWindow = typeof window !== 'undefined';",
      errors: [{ messageId: 'typeofGlobal' }],
    },
    {
      filename: 'packages/cards/src/x.ts',
      code: "export const hasDocument = typeof document === 'object';",
      errors: [{ messageId: 'typeofGlobal' }],
    },
    {
      filename: 'apps/mobile/app/index.tsx',
      code: "export const hasNavigator = typeof navigator !== 'undefined';",
      errors: [{ messageId: 'typeofGlobal' }],
    },
  ],
});
