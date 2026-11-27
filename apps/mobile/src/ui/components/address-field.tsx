import { GEO_QUERY_MIN, GEO_SUGGESTIONS_MAX } from '@citizenrun/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { TextInput, View } from 'react-native';
import type { Role, TextInputInstance, TextInputKeyPressEvent, ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { FieldFrame, useFieldTextStyle } from './field-frame';
import { FieldShell, describedByProps, useFieldA11y } from './field-shell';
import { Icon } from './icon';
import { Link } from './link';
import { Pressable, useInteractionPreview } from './pressable';
import { Skeleton } from './skeleton';
import { Text } from './text';

/** How long the text must stand unchanged before the field asks for suggestions, in milliseconds. */
export const ADDRESS_QUIET_MS = 250;

export type AddressFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  suggestions: readonly { id: string; primary: string; secondary: string | null }[];
  suggestionsStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  onSelect: (id: string) => void;
  message?: { kind: 'error' | 'info'; text: string } | null;
  /** The trimmed text after ADDRESS_QUIET_MS without a change, when it has GEO_QUERY_MIN code points or more; null at once when it drops under that. */
  onQuery?: (text: string | null) => void;
  /** The submit key with no highlighted row. */
  onSubmit?: (text: string) => void;
  /** Drawn under the rows while the list shows suggestions. */
  credits?: readonly { text: string; href: string }[];
  disabled?: boolean;
  testID: string;
};

type ControlProps = Pick<
  AddressFieldProps,
  | 'value'
  | 'onChangeText'
  | 'suggestions'
  | 'suggestionsStatus'
  | 'onSelect'
  | 'onQuery'
  | 'onSubmit'
  | 'testID'
> & {
  credits: NonNullable<AddressFieldProps['credits']>;
  status: 'none' | 'error';
  disabled: boolean;
};

/** What only the web reads of a combobox; React Native's own types leave these out. */
type ComboboxProps = {
  'aria-autocomplete': 'list';
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
};

/** The rows a loading list shows in place of its suggestions. */
const LOADING_ROWS = [0, 1] as const;
/** No row is highlighted: the text itself is. */
const NO_ROW = -1;

// One line is as tall as its row, so the text stands in the middle of the frame.
const ONE_LINE: ViewStyle = { alignSelf: 'stretch' };
// The frame's bottom edge is the list's top edge, so one rule runs round both.
const LIST: ViewStyle = {
  borderLeftWidth: rule.hairline,
  borderRightWidth: rule.hairline,
  borderBottomWidth: rule.hairline,
  borderBottomLeftRadius: radius.control,
  borderBottomRightRadius: radius.control,
  overflow: 'hidden',
};
const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.listRowCompact,
  paddingHorizontal: space.x4,
};
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
const LOADING_ROW: ViewStyle = {
  minHeight: size.listRowCompact,
  justifyContent: 'center',
  paddingHorizontal: space.x4,
};
const CREDITS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  columnGap: space.x3,
  paddingVertical: space.x2,
  paddingHorizontal: space.x4,
  borderTopWidth: rule.hairline,
};
// What a selection says is heard, not seen: one point of room, with nothing drawn outside it.
const SAID: ViewStyle = {
  position: 'absolute',
  width: rule.hairline,
  height: rule.hairline,
  overflow: 'hidden',
};

/** The input in its frame and the list under it; it reads its name and its description from the field around it. */
function Control({
  value,
  onChangeText,
  suggestions,
  suggestionsStatus,
  onSelect,
  onQuery,
  onSubmit,
  credits,
  status,
  disabled,
  testID,
}: ControlProps): JSX.Element {
  const theme = useTheme();
  const { describedBy, ...named } = useFieldA11y();
  const preview = useInteractionPreview();
  const input = useRef<TextInputInstance>(null);
  const listId = useId();
  const text = useFieldTextStyle(disabled);
  const [isFocused, setFocused] = useState(false);
  const [closed, setClosed] = useState(false);
  const [highlighted, setHighlighted] = useState(NO_ROW);
  const [said, setSaid] = useState<string | null>(null);

  const rows = suggestions.slice(0, GEO_SUGGESTIONS_MAX);
  const ready = suggestionsStatus === 'ready' && rows.length > 0;
  const listShown = !disabled && !closed && (suggestionsStatus === 'loading' || ready);
  const choosing = listShown && ready;

  // The highlight belongs to the rows it was moved over: new rows start with none.
  const rowsKey = JSON.stringify(rows.map((row) => row.id));
  const [seenRows, setSeenRows] = useState(rowsKey);
  if (seenRows !== rowsKey) {
    setSeenRows(rowsKey);
    setHighlighted(NO_ROW);
  }
  // A list that is not showing rows has none highlighted.
  const current = choosing && highlighted < rows.length ? highlighted : NO_ROW;

  // The latest callback, so a caller that passes a new function on each render restarts no wait.
  const report = useRef(onQuery);
  useEffect(() => {
    report.current = onQuery;
  });
  // The last text reported, and nothing else of what is typed: it is never stored, cached or logged.
  const lastQuery = useRef<string | null>(null);
  useEffect(() => {
    if (disabled) {
      return undefined;
    }
    const query = value.trim();
    if (Array.from(query).length < GEO_QUERY_MIN) {
      if (lastQuery.current !== null) {
        lastQuery.current = null;
        report.current?.(null);
      }
      return undefined;
    }
    const timer = setTimeout(() => {
      if (query !== lastQuery.current) {
        lastQuery.current = query;
        report.current?.(query);
      }
    }, ADDRESS_QUIET_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value, disabled]);

  const focused = !disabled && (isFocused || preview.focused === true);
  const optionId = (index: number): string => `${listId}-option-${String(index)}`;

  const close = (): void => {
    setClosed(true);
    setHighlighted(NO_ROW);
  };
  const select = (index: number): void => {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    onSelect(row.id);
    close();
    setSaid(row.primary);
  };
  const change = (next: string): void => {
    setClosed(false);
    setSaid(null);
    onChangeText(next);
  };
  // The submit key: on the web it is Enter. With a highlighted row it chooses the row.
  const submit = (): void => {
    if (current !== NO_ROW) {
      select(current);
      return;
    }
    const typed = value.trim();
    if (typed !== '') {
      onSubmit?.(typed);
    }
  };
  // The platform reports the key on the web and from a hardware keyboard.
  const onKeyPress = (event: TextInputKeyPressEvent): void => {
    const { key } = event.nativeEvent;
    if (key === 'Escape') {
      if (listShown) {
        close();
      }
      return;
    }
    if (!choosing) {
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted(Math.min(current + 1, rows.length - 1));
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(Math.max(current - 1, NO_ROW));
    }
  };

  const combobox: ComboboxProps = {
    'aria-autocomplete': 'list',
    // Both name an element that is in the page: the list while it shows, the row while one is highlighted.
    ...(listShown ? { 'aria-controls': listId } : {}),
    ...(current === NO_ROW ? {} : { 'aria-activedescendant': optionId(current) }),
  };

  return (
    <View>
      <FieldFrame
        status={status}
        focused={focused}
        disabled={disabled}
        squareBottom={listShown}
        onPress={() => {
          input.current?.focus();
        }}
      >
        <TextInput
          ref={input}
          {...named}
          {...describedByProps(describedBy)}
          {...combobox}
          role="combobox"
          aria-expanded={listShown}
          aria-disabled={disabled ? true : undefined}
          style={[text, ONE_LINE]}
          value={value}
          onChangeText={change}
          placeholderTextColor={theme.color.textSecondary}
          editable={!disabled}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
          autoCorrect={false}
          returnKeyType="search"
          enterKeyHint="search"
          onSubmitEditing={submit}
          onKeyPress={onKeyPress}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          testID={testID}
        />
      </FieldFrame>
      {listShown ? (
        // In the flow under the field, so the list covers nothing.
        <View
          style={[LIST, { backgroundColor: theme.color.surface, borderColor: theme.color.rule }]}
        >
          <View
            nativeID={listId}
            role={'listbox' as Role} // React Native's types leave the listbox role out; the web's view takes it
            aria-label={named.accessibilityLabel}
            aria-busy={ready ? undefined : true}
          >
            {ready
              ? rows.map((row, index) => (
                  <View
                    key={row.id}
                    nativeID={optionId(index)}
                    style={
                      index === 0
                        ? null
                        : { borderTopWidth: rule.hairline, borderTopColor: theme.color.ruleSoft }
                    }
                  >
                    {/* Focus stays in the input: the rows are chosen from it, or by a press. */}
                    <Pressable
                      role="option"
                      // Both lines are read, in the order they are drawn.
                      label={
                        row.secondary === null ? row.primary : `${row.primary}. ${row.secondary}`
                      }
                      state={{ selected: index === current }}
                      focusable={false}
                      hover="fill"
                      feedback="fill"
                      radius={radius.none}
                      testID={`${testID}-option-${String(index)}`}
                      onPress={() => {
                        select(index);
                      }}
                    >
                      <View
                        style={[
                          ROW,
                          index === current ? { backgroundColor: theme.color.hoverBg } : null,
                        ]}
                      >
                        <Icon name="pin" size="medium" />
                        <View style={WORDS}>
                          <Text role="body" numberOfLines={1}>
                            {row.primary}
                          </Text>
                          {row.secondary === null ? null : (
                            <Text role="caption" tone="secondary" numberOfLines={1}>
                              {row.secondary}
                            </Text>
                          )}
                        </View>
                      </View>
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
          {ready
            ? null
            : LOADING_ROWS.map((index) => (
                <View
                  key={index}
                  style={[
                    LOADING_ROW,
                    index === 0
                      ? null
                      : { borderTopWidth: rule.hairline, borderTopColor: theme.color.ruleSoft },
                  ]}
                >
                  <Skeleton shape="line" />
                </View>
              ))}
          {ready && credits.length > 0 ? (
            // The provider's credit and the map data's, each with its link (D-212).
            <View style={[CREDITS, { borderTopColor: theme.color.ruleSoft }]}>
              {credits.map((credit, index) => (
                <Link
                  key={credit.href}
                  external={true}
                  href={credit.href}
                  label={credit.text}
                  testID={`${testID}-credit-${String(index)}`}
                >
                  <Text role="caption" tone="secondary">
                    {credit.text}
                  </Text>
                </Link>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {/* A selection is said to a screen reader as a toast is: a status that waits its turn. */}
      <View style={SAID} role="status" aria-live="polite" pointerEvents="none">
        {said === null ? null : <Text role="caption">{said}</Text>}
      </View>
    </View>
  );
}

/**
 * C-AddressField: a typed address with suggestions as you type. The field waits for three
 * characters and a quarter second before it asks, shows at most five rows joined to it with the
 * provider's credit under them, and falls back to the typed text. Down and Up move the highlight,
 * the submit key chooses it, Escape closes the list and keeps the text. What is typed is held by
 * the caller alone: the field draws no map, asks for no location and remembers no address.
 */
export function AddressField({
  label,
  value,
  onChangeText,
  suggestions,
  suggestionsStatus,
  onSelect,
  message = null,
  onQuery,
  onSubmit,
  credits = [],
  disabled = false,
  testID,
}: AddressFieldProps): JSX.Element {
  const failed = message?.kind === 'error';
  return (
    <FieldShell
      label={label}
      status={failed ? 'error' : 'none'}
      announce="alert"
      {...(message === null
        ? {}
        : failed
          ? { statusText: message.text }
          : { helper: message.text })}
    >
      <Control
        value={value}
        onChangeText={onChangeText}
        suggestions={suggestions}
        suggestionsStatus={suggestionsStatus}
        onSelect={onSelect}
        credits={credits}
        status={failed ? 'error' : 'none'}
        disabled={disabled}
        testID={testID}
        {...(onQuery === undefined ? {} : { onQuery })}
        {...(onSubmit === undefined ? {} : { onSubmit })}
      />
    </FieldShell>
  );
}
