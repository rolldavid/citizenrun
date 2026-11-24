import { BottomSheet, RNHostView } from '@expo/ui';
import { useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useShortcutBlocker } from '@/ui/shortcuts';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { DialogFrame } from './dialog';
import { useOverlay } from './overlay-registry';
import { Pressable } from './pressable';
import { Text } from './text';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  detents?: readonly ('content' | 'half' | 'full')[];
  dismissible?: boolean;
  footer?: ReactNode;
  testID: string;
  children: ReactNode;
};

type Detent = NonNullable<SheetProps['detents']>[number];

const CONTENT_ONLY: readonly Detent[] = ['content'];

const FRAME: ViewStyle = {
  borderTopWidth: rule.hairline,
  borderRadius: radius.none,
  paddingBottom: space.x6,
};
// A sheet with a height of its own is filled by its frame; one sized to its content is not.
const FRAME_FILLS: ViewStyle = { ...FRAME, flex: 1 };
const GRABBER_ROW: ViewStyle = {
  alignItems: 'center',
  paddingTop: space.x2,
  paddingBottom: space.x3,
};
const GRABBER: ViewStyle = {
  width: size.sheetGrabber.width,
  height: size.sheetGrabber.height,
  borderRadius: radius.none,
};
const GRABBER_DRAWN = { width: size.sheetGrabber.width, height: size.sheetGrabber.height };
const TITLE: ViewStyle = { marginBottom: space.x2 };
const FOOTER: ViewStyle = { marginTop: space.x4 };
const DIALOG_FOOTER: ViewStyle = { marginTop: space.x6 };

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/** The heights the library's sheet rests at; none when the sheet takes the height of its content. */
function snapPointsOf(detents: readonly Detent[]): ('half' | 'full')[] {
  const points: ('half' | 'full')[] = [];
  for (const detent of detents) {
    if (detent !== 'content') points.push(detent);
  }
  return points;
}

type CompactSheetProps = Omit<SheetProps, 'detents' | 'dismissible'> & {
  detents: readonly Detent[];
  dismissible: boolean;
};

/**
 * The compact form (D-035): the platform's own sheet, holding a frame of `surface` with a hairline
 * of `rule` on its top edge. The platform draws the scrim, moves the sheet and keeps the content
 * clear of the bottom inset.
 */
function CompactSheet({
  open,
  onClose,
  title,
  detents,
  dismissible,
  footer,
  testID,
  children,
}: CompactSheetProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const { t } = useTranslation('common');
  const titleId = useId();
  // The platform lets a person drag any sheet away. One that is not dismissible is shown again.
  const [showing, setShowing] = useState(0);
  useShortcutBlocker(open);

  const snapPoints = snapPointsOf(detents);
  const fitsContent = snapPoints.length === 0;
  const bar = <View style={[GRABBER, { backgroundColor: theme.color.text }]} />;

  return (
    <BottomSheet
      key={showing}
      isPresented={open}
      onDismiss={() => {
        if (dismissible) {
          onClose();
        } else {
          setShowing((count) => count + 1);
        }
      }}
      showDragIndicator={false}
      contentPadding={0}
      containerColor={theme.color.surface}
      scrimColor={theme.color.scrim}
      shouldDismissOnBackPress={dismissible}
      shouldDismissOnClickOutside={dismissible}
      {...(fitsContent ? {} : { snapPoints })}
    >
      <RNHostView matchContents={fitsContent ? { vertical: true } : false}>
        <View
          role="dialog"
          aria-modal={true}
          aria-labelledby={title === undefined ? undefined : titleId}
          accessibilityViewIsModal={true}
          testID={testID}
          style={[
            fitsContent ? FRAME : FRAME_FILLS,
            {
              backgroundColor: theme.color.surface,
              borderTopColor: theme.color.rule,
              paddingHorizontal: layout.gutter,
            },
          ]}
        >
          <View style={GRABBER_ROW}>
            {dismissible ? (
              <Pressable
                role="button"
                label={t('ui.sheet.close')}
                testID={`${testID}-grabber`}
                drawn={GRABBER_DRAWN}
                radius={radius.none}
                onPress={onClose}
              >
                {bar}
              </Pressable>
            ) : (
              bar
            )}
          </View>
          {title === undefined ? null : (
            <View nativeID={titleId} style={TITLE}>
              <Text role="title" heading={2}>
                {title}
              </Text>
            </View>
          )}
          {children}
          {hasContent(footer) ? <View style={FOOTER}>{footer}</View> : null}
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

/**
 * C-Sheet: a panel laid over the screen from the bottom on a phone, and the same content in a
 * centered dialog frame at medium and expanded. One sheet is open at a time. A sheet without a
 * title draws no heading: its caller gives the first child one.
 */
export function Sheet({
  open,
  onClose,
  title,
  detents = CONTENT_ONLY,
  dismissible = true,
  footer,
  testID,
  children,
}: SheetProps): JSX.Element {
  const { breakpoint } = useBreakpoint();
  useOverlay('sheet', open, onClose);

  if (breakpoint === 'compact') {
    return (
      <CompactSheet
        open={open}
        onClose={onClose}
        detents={detents}
        dismissible={dismissible}
        testID={testID}
        {...(title === undefined ? {} : { title })}
        {...(footer === undefined ? {} : { footer })}
      >
        {children}
      </CompactSheet>
    );
  }
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      size="sm"
      title={title ?? null}
      dismissible={dismissible}
      testID={testID}
    >
      {children}
      {hasContent(footer) ? <View style={DIALOG_FOOTER}>{footer}</View> : null}
    </DialogFrame>
  );
}
