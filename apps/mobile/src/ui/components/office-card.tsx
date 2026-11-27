import type { JSX, ReactElement } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { space } from '@/ui/tokens';

import { ActionRow } from './action-row';
import type { ActionRowProps } from './action-row';
import { CardShell } from './card-shell';
import { DeadlineLine } from './deadline-line';
import { Meter } from './meter';
import type { MeterProps } from './meter';
import { OfficeTile } from './office-tile';
import { SourceLink } from './source-link';
import type { SourceLinkProps } from './source-link';
import { Text } from './text';

export type OfficeCardProps = {
  /** The office type's illustration id, the reason the card is shown, and the issue match under it. */
  header: { illustration: string | null; reason: string; match: string | null };
  /** The office's canvas, built by the caller. */
  canvas: ReactElement;
  altText: string;
  /** The office page. */
  href: string;
  actions: Extract<ActionRowProps, { kind: 'office' }>;
  ease: Omit<MeterProps, 'form' | 'testID'> | null;
  impact: Omit<MeterProps, 'form' | 'testID'> | null;
  /** The closing line, with the caution sentence. */
  closingLine: string;
  /** Null when neither the fee nor the cost is known and nothing can be said. */
  costLine: string | null;
  source: Omit<SourceLinkProps, 'testID'>;
  onOpenMenu: (() => void) | null;
  itemKey: string;
  testID: string;
};

type MeterInput = NonNullable<OfficeCardProps['ease']>;

// Two equal columns, under the two fact columns of the canvas.
const METERS: ViewStyle = { flexDirection: 'row', columnGap: space.x4 };
const METER: ViewStyle = { flex: 1, minWidth: 0 };

/** The two meters of the row; null when the card has none. Scores arrive for both together. */
function metersOf(
  ease: MeterInput | null,
  impact: MeterInput | null,
): { ease: MeterInput; impact: MeterInput } | null {
  if (ease !== null && impact !== null) {
    return { ease, impact };
  }
  if (__DEV__ && (ease !== null || impact !== null)) {
    throw new Error('A meter row needs both meters.');
  }
  return null;
}

/**
 * C-OfficeCard: an office in the feed, in a sheet or under a share. One C-CardShell with the
 * office's canvas, the office action row and the meta rows: the two meters, the closing line, the
 * cost line and the source row, which is always there. The header says why the office is shown and
 * never names it: the canvas does.
 */
export function OfficeCard({
  header,
  canvas,
  altText,
  href,
  actions,
  ease,
  impact,
  closingLine,
  costLine,
  source,
  onOpenMenu,
  itemKey,
  testID,
}: OfficeCardProps): JSX.Element {
  const meters = metersOf(ease, impact);
  return (
    <CardShell
      header={{
        leading: <OfficeTile illustration={header.illustration} size="md" />,
        title: header.reason,
        subtitle:
          header.match === null ? null : (
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {header.match}
            </Text>
          ),
        onOpenMenu,
      }}
      box={{ kind: 'canvas', canvas, altText }}
      href={href}
      actions={<ActionRow {...actions} />}
      meta={
        <>
          {meters === null ? null : (
            <View style={METERS}>
              <View style={METER}>
                <Meter
                  {...meters.ease}
                  form="feed"
                  itemKey={meters.ease.itemKey ?? `${itemKey}-ease`}
                  testID={`${testID}-ease`}
                />
              </View>
              <View style={METER}>
                <Meter
                  {...meters.impact}
                  form="feed"
                  itemKey={meters.impact.itemKey ?? `${itemKey}-impact`}
                  testID={`${testID}-impact`}
                />
              </View>
            </View>
          )}
          <DeadlineLine variant="card" text={closingLine} testID={`${testID}-closing`} />
          {costLine === null ? null : (
            <Text role="caption" testID={`${testID}-cost`}>
              {costLine}
            </Text>
          )}
          <SourceLink {...source} testID={`${testID}-source`} />
        </>
      }
      testID={testID}
    />
  );
}
