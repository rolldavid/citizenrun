import type { Rule } from 'eslint';
import { report } from '../ast.ts';
import type { AstNode, Listener } from '../ast.ts';
import { repoRelative } from '../paths.ts';

const NATIVE_OR_WEB = /\.(native|web)\.[cm]?[jt]sx?$/;
const IOS_OR_ANDROID = /\.(ios|android)\.[cm]?[jt]sx?$/;
const PLATFORM_PREFIX = 'apps/mobile/src/platform/';
const MODULE_INDEX = /^apps\/mobile\/src\/platform\/[^/]+\/index\.tsx?$/;

/** Platform file suffixes exist only inside the platform modules (D-033). */
export const noPlatformSuffix: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Platform file suffixes are allowed only inside apps/mobile/src/platform.',
    },
    schema: [],
    messages: {
      nativeOrWeb:
        'A .native or .web file belongs in apps/mobile/src/platform; elsewhere feature code is shared by every platform.',
      iosOrAndroid:
        'Do not use an .ios or .android file: a platform module has one native and one web file.',
      moduleIndex:
        'A platform module has index.native and index.web files, not index.ts or index.tsx, so each platform type-checks its own file.',
    },
  },
  create(context) {
    const rel = repoRelative(context.filename);
    const listener: Listener = {
      Program(node: AstNode) {
        if (IOS_OR_ANDROID.test(rel)) {
          report(context, node, 'iosOrAndroid');
        } else if (NATIVE_OR_WEB.test(rel) && !rel.startsWith(PLATFORM_PREFIX)) {
          report(context, node, 'nativeOrWeb');
        } else if (MODULE_INDEX.test(rel)) {
          report(context, node, 'moduleIndex');
        }
      },
    };
    return listener;
  },
};
