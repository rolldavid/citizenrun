import { assertNever } from '@citizenrun/shared';
import { useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion, useFade, useSheetRise } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useShortcutBlocker } from '@/ui/shortcuts';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import { DialogFrame, usePresence } from './dialog';
import { useOverlay } from './overlay-registry';
import { Pressable } from './pressable';
import { Text } from './text';
import { ToastOutlet } from './toast';

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

// The window, with the sheet at its bottom edge. The frame comes first, so focus starts inside it.
const ROOT: ViewStyle = { flex: 1, justifyContent: 'flex-end' };
// The scrim is laid as a row, so the press target inside it is as tall as the window.
const SCRIM: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: z.scrim,
  flexDirection: 'row',
  overflow: 'hidden',
};
const FRAME: ViewStyle = {
  zIndex: z.overlay,
  borderTopWidth: rule.hairline,
  borderRadius: radius.none,
};
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
// A sheet with a height of its own gives its content the room between its title and its footer.
const CONTENT_FILLS: ViewStyle = { flex: 1 };
const FOOTER: ViewStyle = { marginTop: space.x4 };
const DIALOG_FOOTER: ViewStyle = { marginTop: space.x6 };
/** The clear height over a sheet in which a toast stands above it, not on it. */
const TOAST_ROOM = size.listRowMin * 3;

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/** The height the sheet rests at, inside the window less its top inset. */
function heightOf(detent: Detent): ViewStyle {
  switch (detent) {
    case 'content':
      return { maxHeight: '100%' };
    case 'half':
      return { height: '50%' };
    case 'full':
      return { height: '100%' };
    default:
      return assertNever(detent);
  }
}

type CompactSheetProps = Omit<SheetProps, 'detents' | 'dismissible'> & {
  detents: readonly Detent[];
  dismissible: boolean;
};

/**
 * The compact form (D-035, D-843): a frame of `surface` with a hairline of `rule` on its top edge,
 * as wide as the window and standing on its bottom edge, over the flat scrim. It rests at its first
 * detent. Its content keeps clear of the side and bottom insets; the rule and the grabber belong to
 * the frame and are centered on it.
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
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const titleId = useId();
  const { mounted, shown } = usePresence(open, motion.duration.sheet);
  const [frameHeight, setFrameHeight] = useState(0);
  const [outletTop, setOutletTop] = useState(0);
  const rise = useSheetRise(shown);
  const fade = useFade(shown);
  useShortcutBlocker(open);

  const detent = detents[0] ?? 'content';
  const fills = detent !== 'content';
  // A toast stands over the sheet's top edge where the window has the room, so it covers nothing
  // of a short sheet; on a tall one it rises from the line above the footer.
  const clear = layout.height - insets.top - frameHeight;
  const toastLift = frameHeight > 0 && clear >= TOAST_ROOM ? outletTop : 0;
  const bar = <View style={[GRABBER, { backgroundColor: theme.color.text }]} />;

  return (
    <Modal
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      navigationBarTranslucent={true}
      visible={mounted}
      onRequestClose={() => {
        if (dismissible) onClose();
      }}
    >
      <View style={[ROOT, { paddingTop: insets.top }]}>
        <Animated.View
          role="dialog"
          aria-modal={true}
          aria-labelledby={title === undefined ? undefined : titleId}
          accessibilityViewIsModal={true}
          testID={testID}
          onLayout={(event: LayoutChangeEvent) => {
            setFrameHeight(event.nativeEvent.layout.height);
          }}
          style={[
            FRAME,
            heightOf(detent),
            {
              backgroundColor: theme.color.surface,
              borderTopColor: theme.color.rule,
              paddingLeft: layout.gutter + insets.left,
              paddingRight: layout.gutter + insets.right,
              paddingBottom: space.x6 + insets.bottom,
            },
            rise,
          ]}
        >
          {/* Centered on the frame, which is as wide as the window, not on the safe area. */}
          <View style={[GRABBER_ROW, { marginLeft: -insets.left, marginRight: -insets.right }]}>
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
          {fills ? <View style={CONTENT_FILLS}>{children}</View> : children}
          <View
            onLayout={(event: LayoutChangeEvent) => {
              setOutletTop(event.nativeEvent.layout.y);
            }}
          >
            <ToastOutlet place="sheet" active={open} lift={toastLift} />
          </View>
          {hasContent(footer) ? <View style={FOOTER}>{footer}</View> : null}
        </Animated.View>
        <Animated.View style={[SCRIM, { backgroundColor: theme.color.scrim }, fade]}>
          {dismissible ? (
            <Pressable
              role="button"
              label={t('ui.close')}
              feedback="none"
              testID={`${testID}-scrim`}
              onPress={onClose}
            >
              <View style={{ width: layout.width }} />
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
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
