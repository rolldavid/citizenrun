import type { CardContext } from '@citizenrun/cards';
import type { TFunction } from '@citizenrun/shared';
import { createContext, useContext, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { OfficeReadyData } from '@/features/office/view-models/office.types';
import { Button } from '@/ui/components/button';
import { SourcesSheet } from '@/ui/components/sources-sheet';
import type { SourceEntry } from '@/ui/present';

import { FieldReportSheet } from './field-report-sheet';
import { OFFICE_TEST_IDS } from './office-test-ids';
import type { OfficeBlockId, OfficePageActions } from './present-office';
import { TracksSheet } from './tracks-sheet';

/** What every block of the page is drawn from. */
export type OfficeBlockProps = { data: OfficeReadyData; t: TFunction; ctx: CardContext };

export type OfficeSheetsProps = {
  /** The ready state of the page. */
  vm: { data: OfficeReadyData; stale: boolean };
  t: TFunction;
  ctx: CardContext;
  /** Moves the page to one of its blocks; the screen owns the scroll area. */
  onScrollToBlock: (id: OfficeBlockId) => void;
  children: ReactNode;
};

type Shown = { title: string; sources: readonly SourceEntry[] };

const NOTHING_SHOWN: Shown = { title: '', sources: [] };

const SheetsContext = createContext<OfficePageActions | null>(null);

/** What a block can open or move on the page. Only under `OfficeSheets`. */
export function useOfficeSheets(): OfficePageActions {
  const actions = useContext(SheetsContext);
  if (actions === null) {
    throw new Error('A block of the office page is drawn inside OfficeSheets');
  }
  return actions;
}

/**
 * The three sheets of the office page and the way to them: the sources of a value or a section,
 * the filing steps, and the field report. One is open at a time, and opening a second takes the
 * place of the first.
 */
export function OfficeSheets({
  vm,
  t,
  ctx,
  onScrollToBlock,
  children,
}: OfficeSheetsProps): JSX.Element {
  const [open, setOpen] = useState<'sources' | 'steps' | 'report' | null>(null);
  // Kept after the sheet closes, so its words stay while it leaves.
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const { office, fieldReport } = vm.data;

  const actions = useMemo<OfficePageActions>(
    () => ({
      openSources: (title, sources) => {
        setShown({ title, sources });
        setOpen('sources');
      },
      openSteps: () => {
        setOpen('steps');
      },
      openReport: () => {
        setOpen('report');
      },
      scrollToBlock: onScrollToBlock,
    }),
    [onScrollToBlock],
  );

  const close = (): void => {
    setOpen(null);
  };

  return (
    <SheetsContext.Provider value={actions}>
      {children}
      <SourcesSheet
        open={open === 'sources'}
        onClose={close}
        title={shown.title}
        sources={shown.sources}
        caution={t('common:confirmBeforeFiling')}
        {...(fieldReport === null
          ? {}
          : {
              footer: (
                <Button
                  variant="secondary"
                  label={vm.stale ? t('common:states.offlineAction') : t('office:report.open')}
                  disabled={vm.stale}
                  onPress={actions.openReport}
                  testID={`${OFFICE_TEST_IDS.sourcesSheet}-report`}
                />
              ),
            })}
        testID={OFFICE_TEST_IDS.sourcesSheet}
      />
      <TracksSheet
        open={open === 'steps'}
        onClose={close}
        election={office.nextElectionDetail}
        t={t}
        ctx={ctx}
        onOpenSources={actions.openSources}
      />
      {fieldReport === null ? null : (
        <FieldReportSheet
          open={open === 'report'}
          onClose={() => {
            close();
            // The answer of one report is not shown over the next.
            fieldReport.onReset();
          }}
          fieldReport={fieldReport}
          stale={vm.stale}
          t={t}
        />
      )}
    </SheetsContext.Provider>
  );
}
