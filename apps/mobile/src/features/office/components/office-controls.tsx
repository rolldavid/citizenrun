import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { IssueTile } from '@/ui/components/issue-tile';
import { ListRow, RowNameContext } from '@/ui/components/list-row';
import { SectionHeader } from '@/ui/components/section-header';
import { Tag } from '@/ui/components/tag';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { presentControls } from './present-office';
import type { PowerRow } from './present-office';

// The relevance words at the left of their line, the issues' tiles at its right.
const RELEVANCE_LINE: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: space.x3,
  marginTop: space.x1,
};
const WORDS: ViewStyle = { flexShrink: 1 };
const TILES: ViewStyle = { flexDirection: 'row', gap: space.x1, marginLeft: 'auto' };
const DESCRIPTION: ViewStyle = { marginTop: space.x1 };
const NONE: ViewStyle = { alignItems: 'flex-start', gap: space.x2, paddingVertical: space.x3 };

/** What a power's row says as one target: its name, how far the office decides it, and what it is. */
function nameOf(row: PowerRow): string {
  return [row.title, row.relevance, ...row.tiles.map((tile) => tile.label), row.description]
    .filter((part): part is string => part !== null && part !== '')
    .join('. ');
}

function Power({ row }: { row: PowerRow }): JSX.Element {
  return (
    <RowNameContext.Provider value={nameOf(row)}>
      <ListRow
        title={row.title}
        subtitle={
          <>
            <View style={RELEVANCE_LINE}>
              {row.relevance === null ? null : (
                <View style={WORDS}>
                  <Text role="caption" tone="secondary">
                    {row.relevance}
                  </Text>
                </View>
              )}
              {row.tiles.length === 0 ? null : (
                <View style={TILES}>
                  {row.tiles.map((tile) => (
                    // The row fills under a pointer, and a tile on a filled ground keeps its keyline.
                    <IssueTile
                      key={tile.issueId}
                      issueId={tile.issueId}
                      label={tile.label}
                      keyline={true}
                    />
                  ))}
                </View>
              )}
            </View>
            {row.description === '' ? null : (
              <View style={DESCRIPTION}>
                <Text role="caption" tone="secondary">
                  {row.description}
                </Text>
              </View>
            )}
          </>
        }
        onPress={row.onPress}
        testID={row.testID}
      />
    </RowNameContext.Provider>
  );
}

/**
 * Block 6: each power of the office as a row that opens its source. No drawing and no colour but
 * the issues' tiles.
 */
export function OfficeControls({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const page = useOfficeSheets();
  const controls = presentControls(data.office, data.issues, t, ctx, page);
  return (
    <View>
      <SectionHeader label={t('office:section.controls')} />
      {controls.none === null ? (
        controls.rows.map(({ key, ...row }) => <Power key={key} row={{ key, ...row }} />)
      ) : (
        <View style={NONE}>
          <Text role="body">{controls.none}</Text>
          <Tag variant="unknown" />
        </View>
      )}
    </View>
  );
}
