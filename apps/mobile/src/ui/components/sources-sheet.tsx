import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { rule, space } from '@/ui/tokens';

import { ConfidenceBadge } from './confidence-badge';
import { Link } from './link';
import { Sheet } from './sheet';
import { Text } from './text';

export type SourcesSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  sources: readonly {
    id: string;
    /** What the source covers: "Pay". */
    covers: string;
    /** The source line, as its caller worded it. */
    line: string;
    confidence: 'high' | 'medium' | 'low';
    quote: string | null;
    url: string | null;
    domain: string | null;
  }[];
  /** "Confirm with your election office." */
  caution?: string;
  /** A photo's author and licence. */
  credit?: string;
  footer?: ReactNode;
  testID: string;
};

type Source = SourcesSheetProps['sources'][number];

const DETENTS = ['content', 'full'] as const;
// A sheet with a height of its own gives its content that room; a long list scrolls inside it.
const SCROLLER: ViewStyle = { flexGrow: 0, flexShrink: 1 };
const BLOCK: ViewStyle = { paddingVertical: space.x3 };
// The mark and the line share a row while both fit, and the line goes under the mark when not.
const PROOF: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: space.x2,
  rowGap: space.x1,
  marginTop: space.x1,
};
const LINE: ViewStyle = { flexShrink: 1 };
const PART: ViewStyle = { marginTop: space.x2 };
const CAUTION: ViewStyle = { marginTop: space.x6 };
const CREDIT: ViewStyle = { marginTop: space.x3 };
const FOOTER: ViewStyle = { marginTop: space.x6 };

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/** Throws for a source that is sure of itself and shows no link. Development only. */
function checkSources(sources: readonly Source[]): void {
  for (const source of sources) {
    if (source.confidence !== 'low' && source.url === null) {
      throw new Error('A high or medium confidence source always has its link.');
    }
  }
}

/**
 * C-SourcesSheet: every source behind a card or a section, in native text that scales. For each
 * source: what it covers, its confidence and its line as the caller worded it, its quote, and its
 * domain as a link that opens outside the app. Then the caution line, a photo's credit and the
 * caller's footer. It fetches nothing and never previews a source's page.
 */
export function SourcesSheet({
  open,
  onClose,
  title,
  sources,
  caution,
  credit,
  footer,
  testID,
}: SourcesSheetProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  if (__DEV__) {
    checkSources(sources);
  }
  return (
    <Sheet open={open} onClose={onClose} title={title} detents={DETENTS} testID={testID}>
      <ScrollView style={SCROLLER}>
        {sources.map((source, index) => (
          <View
            key={source.id}
            style={[
              BLOCK,
              index === 0
                ? null
                : { borderTopWidth: rule.hairline, borderTopColor: theme.color.ruleSoft },
            ]}
          >
            <Text role="label">{source.covers}</Text>
            <View style={PROOF}>
              <ConfidenceBadge kind="confidence" level={source.confidence} />
              <View style={LINE}>
                <Text role="mono" tone="secondary" selectable={true}>
                  {source.line}
                </Text>
              </View>
            </View>
            {source.quote === null ? null : (
              <View style={PART}>
                <Text role="caption" selectable={true}>
                  {t('ui.sources.quote', { quote: source.quote })}
                </Text>
              </View>
            )}
            {source.url === null || source.domain === null ? null : (
              <View style={PART}>
                <Link
                  href={source.url}
                  external={true}
                  label={source.domain}
                  testID={`${testID}-link-${source.id}`}
                >
                  <Text role="caption">{source.domain}</Text>
                </Link>
              </View>
            )}
          </View>
        ))}
        {caution === undefined ? null : (
          <View style={CAUTION}>
            <Text role="label">{caution}</Text>
          </View>
        )}
        {credit === undefined ? null : (
          <View style={CREDIT}>
            <Text role="mono" tone="secondary" selectable={true}>
              {credit}
            </Text>
          </View>
        )}
        {hasContent(footer) ? <View style={FOOTER}>{footer}</View> : null}
      </ScrollView>
    </Sheet>
  );
}
