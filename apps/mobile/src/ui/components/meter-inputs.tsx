import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { rule, space } from '@/ui/tokens';

import { SourceLink } from './source-link';
import type { SourceLinkProps } from './source-link';
import { Tag } from './tag';
import { Text } from './text';

export type MeterInputsProps = {
  inputs: readonly {
    id: string;
    /** What the input says, as one sentence; null when nobody knows it. */
    sentence: string | null;
    /** What an unknown input is called: "Margin last time". */
    unknownLabel: string;
    /** The source line of the sentence; null when its proof has no source address. */
    source: string | null;
  }[];
  /** The source row that closes the panel. */
  sourceLink?: SourceLinkProps;
  testID?: string;
};

const PANEL: ViewStyle = { flexDirection: 'row' };
const EDGE: ViewStyle = { width: rule.panel };
const BLOCKS: ViewStyle = { flex: 1, minWidth: 0, marginLeft: space.x3, gap: space.x3 };
const SOURCE: ViewStyle = { marginTop: space.x1 };
// The label, then the tag at the end of its line; the tag goes under a label too long to share it.
const UNKNOWN: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  columnGap: space.x2,
  rowGap: space.x1,
};
const UNKNOWN_LABEL: ViewStyle = { flexShrink: 1 };

/**
 * C-MeterInputs: what a score was worked out from, under an open page meter. A rule down the left
 * edge, then one block for each input: its sentence and, under it, its source. An input nobody
 * knows says so with the unknown tag, at full contrast. The panel appears with a cut.
 */
export function MeterInputs({ inputs, sourceLink, testID }: MeterInputsProps): JSX.Element {
  const theme = useTheme();
  return (
    <View style={PANEL} testID={testID}>
      <View style={[EDGE, { backgroundColor: theme.color.rule }]} />
      <View style={BLOCKS}>
        {inputs.map((input) =>
          input.sentence === null ? (
            <View key={input.id} style={UNKNOWN}>
              <View style={UNKNOWN_LABEL}>
                <Text role="body">{input.unknownLabel}</Text>
              </View>
              <Tag variant="unknown" />
            </View>
          ) : (
            <View key={input.id}>
              <Text role="body">{input.sentence}</Text>
              {/* An input whose proof has no source address shows its sentence alone. */}
              {input.source === null ? null : (
                <View style={SOURCE}>
                  <Text role="mono" tone="secondary" selectable={true}>
                    {input.source}
                  </Text>
                </View>
              )}
            </View>
          ),
        )}
        {sourceLink === undefined ? null : <SourceLink {...sourceLink} />}
      </View>
    </View>
  );
}
