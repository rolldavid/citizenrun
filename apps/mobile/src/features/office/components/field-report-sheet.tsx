import { FIELD_REPORT_FIELDS, LIMITS } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { OfficeFieldReport } from '@/features/office/view-models/office.types';
import { Button } from '@/ui/components/button';
import { Notice } from '@/ui/components/notice';
import { RadioGroup } from '@/ui/components/radio-group';
import { Sheet } from '@/ui/components/sheet';
import { Text } from '@/ui/components/text';
import { TextField } from '@/ui/components/text-field';
import { space } from '@/ui/tokens';

import { OFFICE_TEST_IDS } from './office-test-ids';
import { errorSentence, reportFieldLabel } from './present-office';
import { useSheetScroll } from './sheet-scroll';

export type FieldReportSheetProps = {
  open: boolean;
  /** Closes the sheet; the caller puts the report's state back. */
  onClose: () => void;
  fieldReport: OfficeFieldReport;
  /** True while the page is shown without a connection: a report cannot be sent. */
  stale: boolean;
  t: TFunction;
};

/** The choice that names no field: the report is about the office as a whole. */
const WHOLE_OFFICE = 'whole';

const DETENTS = ['content', 'full'] as const;
const FORM: ViewStyle = { gap: space.x4, paddingTop: space.x2 };
const SENT: ViewStyle = { alignItems: 'flex-start', gap: space.x4, paddingTop: space.x2 };

/** What was typed, with the space round it dropped; null when nothing is left. */
function typed(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The field report: which value is wrong, what it should say and where that is written. The note
 * and the link live in this component alone and are dropped when the sheet closes; one of the two
 * is enough to send.
 */
export function FieldReportSheet({
  open,
  onClose,
  fieldReport,
  stale,
  t,
}: FieldReportSheetProps): JSX.Element {
  const scroller = useSheetScroll();
  const [choice, setChoice] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');

  const options = useMemo(
    () => [
      { value: WHOLE_OFFICE, label: t('office:report.wholeOffice') },
      ...FIELD_REPORT_FIELDS.map((field) => ({ value: field, label: reportFieldLabel(field, t) })),
    ],
    [t],
  );

  const close = (): void => {
    setChoice(null);
    setMessage('');
    setLink('');
    onClose();
  };

  const note = typed(message);
  const sourceUrl = typed(link);
  const empty = note === null && sourceUrl === null;
  const sending = fieldReport.status === 'sending';
  const failed = fieldReport.status === 'error';
  const linkRefused = failed && fieldReport.errorCode === 'link_invalid';

  const send = (): void => {
    fieldReport.onSubmit({
      field: FIELD_REPORT_FIELDS.find((field) => field === choice) ?? null,
      message: note,
      sourceUrl,
    });
  };

  let sendLabel = t('office:report.send');
  if (stale) {
    sendLabel = t('common:states.offlineAction');
  } else if (empty) {
    sendLabel = t('office:report.needOne');
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('office:report.title')}
      detents={DETENTS}
      testID={OFFICE_TEST_IDS.reportSheet}
    >
      {fieldReport.status === 'sent' ? (
        <View style={SENT}>
          <Text role="body">{t('office:report.sent')}</Text>
          <Button
            variant="secondary"
            label={t('office:report.close')}
            onPress={close}
            testID={OFFICE_TEST_IDS.reportClose}
          />
        </View>
      ) : (
        <ScrollView style={scroller} keyboardShouldPersistTaps="handled">
          <View style={FORM}>
            <RadioGroup
              label={t('office:report.field')}
              value={choice}
              options={options}
              onChange={setChoice}
              testID={OFFICE_TEST_IDS.reportField}
            />
            <TextField
              kind="multiline"
              label={t('office:report.message')}
              value={message}
              onChangeText={setMessage}
              maxLength={LIMITS.reportNoteChars}
              showCount={true}
              disabled={sending}
              testID={OFFICE_TEST_IDS.reportMessage}
            />
            <TextField
              kind="url"
              label={t('office:report.source')}
              value={link}
              onChangeText={setLink}
              disabled={sending}
              {...(linkRefused
                ? { status: 'error' as const, statusText: t('errors:link_invalid') }
                : {})}
              testID={OFFICE_TEST_IDS.reportLink}
            />
            {failed && !linkRefused ? (
              <Notice kind="error" text={errorSentence(fieldReport.errorCode, t)} />
            ) : null}
            <Button
              variant="primary"
              label={sendLabel}
              disabled={empty || stale}
              busy={sending}
              fullWidth={true}
              onPress={send}
              testID={OFFICE_TEST_IDS.reportSend}
            />
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}
