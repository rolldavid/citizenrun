import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Button } from '@/ui/components/button';
import { SectionHeader } from '@/ui/components/section-header';
import { SourceLink } from '@/ui/components/source-link';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentPageSources } from './present-office';

const REPORT: ViewStyle = { alignItems: 'flex-start', marginTop: space.x4 };

/**
 * Block 14: every source of the page, each row opening them all, and for a signed-in person the
 * way to report a mistake. A report is a write, so its button waits for a connection.
 */
export function OfficeSources({
  data,
  t,
  ctx,
  stale,
}: OfficeBlockProps & { stale: boolean }): JSX.Element {
  const page = useOfficeSheets();
  const sources = presentPageSources(data.office, t, ctx);
  const title = t('office:sources.title');
  return (
    <View>
      <SectionHeader label={t('office:section.sources')} />
      {sources.map((source, index) => (
        <SourceLink
          key={source.id}
          confidence={source.confidence}
          text={source.line}
          onPress={() => {
            page.openSources(title, sources);
          }}
          testID={`${OFFICE_TEST_IDS.sourcesOpen}-${String(index + 1)}`}
        />
      ))}
      {data.fieldReport === null ? null : (
        <View style={REPORT}>
          <Button
            variant="secondary"
            label={stale ? t('common:states.offlineAction') : t('office:report.open')}
            disabled={stale}
            onPress={page.openReport}
            testID={OFFICE_TEST_IDS.reportOpen}
          />
        </View>
      )}
    </View>
  );
}
