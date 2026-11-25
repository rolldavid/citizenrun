import { useEffect, useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, useFade } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useShortcutBlocker } from '@/ui/shortcuts';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import { Button } from './button';
import { useOverlay } from './overlay-registry';
import { Pressable } from './pressable';
import { Text } from './text';
import { ToastOutlet } from './toast';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'lg';
  title: string;
  body?: string;
  actions?: readonly {
    label: string;
    variant: 'primary' | 'destructive' | 'secondary' | 'quiet';
    onPress: () => void;
    busy?: boolean;
    disabled?: boolean;
    testID: string;
  }[];
  dismissible?: boolean;
  testID: string;
  children?: ReactNode;
};

/** C-Dialog's props with a title that may be absent: a sheet in its dialog form has none of its own. */
export type DialogFrameProps = Omit<DialogProps, 'title'> & { title: string | null };

type DialogAction = NonNullable<DialogProps['actions']>[number];

const NO_ACTIONS: readonly DialogAction[] = [];

const ROOT: ViewStyle = { flex: 1, alignItems: 'center', justifyContent: 'center' };
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
  width: '100%',
  borderWidth: rule.hairline,
  borderRadius: radius.none,
};
const FRAME_SM: ViewStyle = { ...FRAME, maxWidth: size.dialogMax, padding: space.x6 };
// Its children own their padding, and what is too tall for the frame is theirs to scroll.
const FRAME_LG: ViewStyle = {
  ...FRAME,
  maxWidth: size.profileColumn,
  maxHeight: '90%',
  overflow: 'hidden',
};
const BODY: ViewStyle = { marginTop: space.x2 };
const CONTENT: ViewStyle = { marginTop: space.x4 };
const ACTIONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: space.x2,
  marginTop: space.x6,
};

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

function isStrong(action: DialogAction): boolean {
  return action.variant === 'primary' || action.variant === 'destructive';
}

/** The given order, with every primary or destructive action moved last. */
function ordered(actions: readonly DialogAction[]): readonly DialogAction[] {
  return [
    ...actions.filter((action) => !isStrong(action)),
    ...actions.filter((action) => isStrong(action)),
  ];
}

/**
 * How the frame follows `open` (MO-sheet, the dialog form): it is laid out clear, fades in from the
 * next frame, and stays until the fade out has run.
 */
function usePresence(open: boolean): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  if (open && !mounted) {
    setMounted(true);
  }
  if (!open && entered) {
    setEntered(false);
  }

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        setEntered(true);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    if (!mounted) return undefined;
    const timer = setTimeout(() => {
      setMounted(false);
    }, motion.duration.fade);
    return () => {
      clearTimeout(timer);
    };
  }, [open, mounted]);

  return { mounted, shown: open && entered };
}

/**
 * The frame C-Dialog and C-Sheet's dialog form share: a `Modal` holding the frame and, behind it,
 * the flat scrim. `surface` with a hairline of `rule` all round, no shadow and no radius. The frame
 * comes first in the tree, so focus starts inside it.
 */
export function DialogFrame({
  open,
  onClose,
  size: sizeName = 'sm',
  title,
  body,
  actions = NO_ACTIONS,
  dismissible = true,
  testID,
  children,
}: DialogFrameProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const { t } = useTranslation('common');
  const titleId = useId();
  const { mounted, shown } = usePresence(open);
  const fade = useFade(shown);
  useShortcutBlocker(open);

  if (__DEV__ && actions.length > 3) {
    throw new Error('A dialog has at most three actions');
  }

  const large = sizeName === 'lg';
  const destructive = actions.some((action) => action.variant === 'destructive');
  // The large frame draws its children alone: its title is its name, and nothing more.
  const heading = large ? null : title;
  const sentence = large ? undefined : body;
  const hasText = heading !== null || sentence !== undefined;

  return (
    <Modal
      transparent={true}
      animationType="none"
      visible={mounted}
      onRequestClose={() => {
        if (dismissible) onClose();
      }}
    >
      {/* The gutter stays clear at each side of the small frame on a phone. */}
      <View style={[ROOT, large ? null : { padding: layout.gutter }]}>
        <Animated.View
          role={destructive ? 'alertdialog' : 'dialog'}
          aria-modal={true}
          aria-labelledby={heading === null ? undefined : titleId}
          aria-label={large && title !== null ? title : undefined}
          accessibilityViewIsModal={true}
          testID={testID}
          style={[
            large ? FRAME_LG : FRAME_SM,
            { backgroundColor: theme.color.surface, borderColor: theme.color.rule },
            fade,
          ]}
        >
          {heading === null ? null : (
            <View nativeID={titleId}>
              <Text role="heading" heading={2}>
                {heading}
              </Text>
            </View>
          )}
          {sentence === undefined ? null : (
            <View style={heading === null ? null : BODY}>
              <Text role="body" tone="secondary">
                {sentence}
              </Text>
            </View>
          )}
          {hasText && hasContent(children) ? <View style={CONTENT}>{children}</View> : children}
          {large || actions.length === 0 ? null : (
            <View style={ACTIONS}>
              {ordered(actions).map((action) => (
                <Button
                  key={action.testID}
                  variant={action.variant}
                  label={action.label}
                  onPress={action.onPress}
                  busy={action.busy ?? false}
                  disabled={action.disabled ?? false}
                  testID={action.testID}
                />
              ))}
            </View>
          )}
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
        <ToastOutlet place="window" />
      </View>
    </Modal>
  );
}

/**
 * C-Dialog: a centered modal that asks one question or holds one form. Its title asks the real
 * question and its body says what will happen. One dialog is open at a time; `Esc` and a press on
 * the scrim close it when it is dismissible.
 */
export function Dialog(props: DialogProps): JSX.Element {
  useOverlay('dialog', props.open, props.onClose);
  return <DialogFrame {...props} />;
}
