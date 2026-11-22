import { noPlatformSuffix } from './no-platform-suffix.ts';
import { ruleTester, testable } from '../rule-tester.ts';

const CODE = 'export const value = 1;';

ruleTester().run('no-platform-suffix', testable(noPlatformSuffix), {
  valid: [
    { filename: 'apps/mobile/src/platform/haptics/index.web.ts', code: CODE },
    { filename: 'apps/mobile/src/platform/haptics/index.native.ts', code: CODE },
    { filename: 'apps/mobile/src/platform/haptics/types.ts', code: CODE },
    { filename: 'apps/mobile/src/ui/button.tsx', code: CODE },
    { filename: 'apps/mobile/src/platform/shared.ts', code: CODE },
    { filename: 'apps/mobile/src/platform/map/index.web.tsx', code: CODE },
    { filename: 'apps/mobile/src/features/office/index.ts', code: CODE },
  ],
  invalid: [
    {
      filename: 'apps/mobile/src/ui/button.web.tsx',
      code: CODE,
      errors: [{ messageId: 'nativeOrWeb' }],
    },
    {
      filename: 'apps/mobile/app/office/[slug].native.tsx',
      code: CODE,
      errors: [{ messageId: 'nativeOrWeb' }],
    },
    {
      filename: 'packages/cards/src/x.ios.ts',
      code: CODE,
      errors: [{ messageId: 'iosOrAndroid' }],
    },
    {
      filename: 'apps/mobile/src/platform/haptics/x.android.ts',
      code: CODE,
      errors: [{ messageId: 'iosOrAndroid' }],
    },
    {
      filename: 'apps/mobile/src/platform/haptics/index.ts',
      code: CODE,
      errors: [{ messageId: 'moduleIndex' }],
    },
    {
      filename: 'apps/mobile/src/platform/map/index.tsx',
      code: CODE,
      errors: [{ messageId: 'moduleIndex' }],
    },
  ],
});
