import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewInstance, ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { radius, rule, size, space } from '@/ui/tokens';

import { FieldFrame } from './field-frame';
import { FieldShell, useFieldA11y } from './field-shell';
import { Icon } from './icon';
import { KeyGroup } from './key-group';
import type { KeyGroupKey } from './key-group';
import { Popover } from './popover';
import { Pressable } from './pressable';
import { RadioGroup } from './radio-group';
import { Rule } from './rule';
import { Sheet } from './sheet';
import { Text } from './text';

export type SelectProps = {
  label: string;
  /** Null until the person chooses: there is never a default they did not pick. */
  value: string | null;
  options: readonly { value: string; label: string }[];
  placeholder: string;
  onChange: (value: string) => void;
  helper?: string;
  status?: 'none' | 'error';
  statusText?: string;
  disabled?: boolean;
  testID: string;
};

type ControlProps = Pick<
  SelectProps,
  'label' | 'value' | 'options' | 'placeholder' | 'onChange' | 'testID'
> & {
  status: NonNullable<SelectProps['status']>;
  disabled: boolean;
};

/** More options than this and the sheet takes a height of its own, in which its list scrolls. */
const SHORT_LIST = 7;
const SHORT_SHEET = ['content'] as const;
const TALL_SHEET = ['half', 'full'] as const;

const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
// The focus ring of a row stands outside it, so the list keeps the ring's room inside the popover.
const RING_ROOM = rule.focus + rule.focusGap;
const LIST: ViewStyle = { padding: RING_ROOM };
const OPTION: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.listRowCompact,
  paddingHorizontal: space.x4 - RING_ROOM,
  paddingVertical: space.x2,
};

/** What a list row may be asked beyond what every platform's view answers. */
type Row = { scrollIntoView?: (options: { block: 'nearest' }) => void; focus?: () => void };

/**
 * The row the keys of a list move focus to from row `from`; null for a key that moves nothing. Down
 * and Up stop at the ends, Home and End go to them, and a letter goes to the next row whose label
 * starts with it, round from the last row to the first.
 */
function rowAfterKey(key: string, from: number, labels: readonly string[]): number | null {
  const last = labels.length - 1;
  switch (key) {
    case 'ArrowDown':
      return Math.min(from + 1, last);
    case 'ArrowUp':
      return Math.max(from - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      break;
  }
  // One typed character: a named key is longer. Space presses the focused row and starts no label.
  if (Array.from(key).length !== 1 || key === ' ') {
    return null;
  }
  const typed = key.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const index = (from + step) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(typed) === true) {
      return index;
    }
  }
  return from;
}

/**
 * The field's control and the list it opens: a sheet of radio rows on a phone, and a popover list
 * under the control on a wider screen. It reads its name from the field around it.
 */
function Control({
  label,
  value,
  options,
  placeholder,
  onChange,
  status,
  disabled,
  testID,
}: ControlProps): JSX.Element {
  const layout = useBreakpoint();
  const named = useFieldA11y();
  // The open list's id: the control names the list it has open.
  const listId = useId();
  const trigger = useRef<ViewInstance>(null);
  const rows = useRef<(ViewInstance | null)[]>([]);
  const shown = useRef(false);
  const [open, setOpen] = useState(false);
  // The row of the popover list that holds the focus, and alone takes the Tab key.
  const [active, setActive] = useState(0);

  const chosenIndex = options.findIndex((option) => option.value === value);
  const chosen = options[chosenIndex];
  const compact = layout.breakpoint === 'compact';

  // Focus goes to the list's row once the list is up, and follows the keys from there. This runs
  // after the popover's own effects, so what the popover hands the focus back to when it closes is
  // still the control.
  useEffect(() => {
    if (open && !compact) {
      rows.current[active]?.focus();
    }
  }, [open, compact, active]);

  const show = (): void => {
    shown.current = false;
    setActive(Math.max(chosenIndex, 0));
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
  };
  const choose = (next: string): void => {
    // A list on its way out takes no second choice.
    if (!open) {
      return;
    }
    onChange(next);
    close();
  };

  const onListKey = (event: KeyGroupKey): void => {
    const next = rowAfterKey(
      event.key,
      active,
      options.map((option) => option.label),
    );
    if (next === null || options.length === 0) {
      return;
    }
    event.preventDefault();
    setActive(next);
  };

  // The popover gives the list its place a moment after the list is laid out, and only then can a
  // chosen row far down the list be brought into view. A phone's view has no such call.
  const showActiveRow = (): void => {
    if (shown.current) {
      return;
    }
    shown.current = true;
    requestAnimationFrame(() => {
      const row: Row | null = rows.current[active] ?? null;
      if (row !== null && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const tone = disabled ? 'disabled' : chosen === undefined ? 'secondary' : 'primary';

  return (
    <>
      <Pressable
        ref={trigger}
        role="combobox"
        label={named.accessibilityLabel}
        state={{ expanded: open }}
        {...(open ? { controls: listId } : {})}
        disabled={disabled}
        hover="fill"
        feedback="moveAndFill"
        testID={testID}
        onPress={show}
        {...(named.accessibilityHint === undefined ? {} : { hint: named.accessibilityHint })}
      >
        {({ hovered, pressed }) => (
          <FieldFrame
            status={status}
            // The ring is the press target's own, which the page shows for the keyboard alone; a
            // ring on the frame would stay after a pointer press.
            focused={false}
            disabled={disabled}
            // The press target paints its hover and pressed fills under the frame.
            clear={hovered || pressed}
            trailing={
              <Icon name="chevronDown" size="medium" tone={disabled ? 'disabled' : 'secondary'} />
            }
          >
            <View style={WORDS}>
              {/* A long label takes a second line and the frame grows: what was chosen is never cut. */}
              <Text role="body" tone={tone} numberOfLines={2}>
                {chosen === undefined ? placeholder : chosen.label}
              </Text>
            </View>
          </FieldFrame>
        )}
      </Pressable>
      {compact ? (
        <Sheet
          open={open}
          onClose={close}
          title={label}
          detents={options.length > SHORT_LIST ? TALL_SHEET : SHORT_SHEET}
          testID={`${testID}-sheet`}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <View nativeID={listId}>
              <RadioGroup
                label={label}
                labelHidden={true}
                value={value}
                options={options}
                onChange={choose}
                testID={`${testID}-options`}
              />
            </View>
          </ScrollView>
        </Sheet>
      ) : (
        <Popover
          open={open}
          onClose={close}
          anchor={trigger}
          placement="below-start"
          padded={false}
          label={label}
          testID={`${testID}-popover`}
        >
          <KeyGroup
            role="listbox"
            accessibilityLabel={label}
            nativeID={listId}
            onKeyDown={onListKey}
          >
            <View style={LIST} onLayout={showActiveRow}>
              {options.map((option, index) => (
                <Fragment key={option.value}>
                  {index === 0 ? null : <Rule variant="soft" />}
                  <Pressable
                    ref={(row) => {
                      rows.current[index] = row;
                    }}
                    role="option"
                    label={option.label}
                    state={{ selected: option.value === value }}
                    hover="fill"
                    feedback="fill"
                    radius={radius.none}
                    focusable={index === active}
                    testID={`${testID}-${option.value}`}
                    onPress={() => {
                      choose(option.value);
                    }}
                  >
                    <View style={OPTION}>
                      <View style={WORDS}>
                        <Text role="body">{option.label}</Text>
                      </View>
                      {option.value === value ? <Icon name="check" size="medium" /> : null}
                    </View>
                  </Pressable>
                </Fragment>
              ))}
            </View>
          </KeyGroup>
        </Popover>
      )}
    </>
  );
}

/**
 * C-Select: one choice from a list too long for radio rows on the page. The control is the frame of
 * a text field holding the chosen label, or the placeholder while nothing is chosen, and a chevron;
 * it is pressed, not typed in, so it fills under a pointer and a press and shows its focus ring for
 * the keyboard alone. It opens a sheet of radio rows on a phone and a popover list on a wider
 * screen, where the arrow keys, Home, End and a typed letter move through the rows. Nothing is ever
 * chosen for the person, and opening the list chooses nothing.
 */
export function Select({
  label,
  value,
  options,
  placeholder,
  onChange,
  helper,
  status = 'none',
  statusText,
  disabled = false,
  testID,
}: SelectProps): JSX.Element {
  return (
    <FieldShell
      label={label}
      status={status}
      announce="alert"
      {...(helper === undefined ? {} : { helper })}
      {...(statusText === undefined ? {} : { statusText })}
    >
      <Control
        label={label}
        value={value}
        options={options}
        placeholder={placeholder}
        onChange={onChange}
        status={status}
        disabled={disabled}
        testID={testID}
      />
    </FieldShell>
  );
}
