import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import type { ComponentType, JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import {
  AppBar,
  Avatar,
  Button,
  CompactShell,
  CountBadge,
  Dialog,
  EmptyChair,
  EmptyState,
  ExpandedShell,
  FeedRule,
  Icon,
  IconButton,
  InteractionPreview,
  Link,
  List,
  MediumShell,
  Notice,
  Pressable,
  Rail,
  RightColumn,
  Rule,
  Screen,
  Sheet,
  Skeleton,
  SystemScreen,
  TabBar,
  Text,
  Tooltip,
  Wordmark,
  showToast,
  useBreakpoint,
} from '@/ui';
import type {
  DialogProps,
  InteractionPreviewState,
  ListProps,
  RightColumnProps,
  SheetProps,
} from '@/ui';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as dialogFixtures from '@/ui/components/dialog.fixtures';
import * as emptyChairFixtures from '@/ui/components/empty-chair.fixtures';
import * as emptyStateFixtures from '@/ui/components/empty-state.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as listFixtures from '@/ui/components/list.fixtures';
import * as noticeFixtures from '@/ui/components/notice.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as screenFixtures from '@/ui/components/screen.fixtures';
import * as sheetFixtures from '@/ui/components/sheet.fixtures';
import * as skeletonFixtures from '@/ui/components/skeleton.fixtures';
import * as systemScreenFixtures from '@/ui/components/system-screen.fixtures';
import * as textFixtures from '@/ui/components/text.fixtures';
import * as toastFixtures from '@/ui/components/toast.fixtures';
import * as tooltipFixtures from '@/ui/components/tooltip.fixtures';
import * as wordmarkFixtures from '@/ui/components/wordmark.fixtures';
import { ReducedMotionOverride } from '@/ui/motion';
import { AppBarInset } from '@/ui/shells/app-bar';
import * as appBarFixtures from '@/ui/shells/app-bar.fixtures';
import * as appShellFixtures from '@/ui/shells/app-shell.fixtures';
import * as railFixtures from '@/ui/shells/rail.fixtures';
import * as rightColumnFixtures from '@/ui/shells/right-column.fixtures';
import * as tabBarFixtures from '@/ui/shells/tab-bar.fixtures';
import { ThemeProvider, useTheme } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';
import { rule, size, space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

export type GalleryScreenProps = {
  /** The theme the gallery opens in. */
  initialTheme: ThemeChoice;
  /** The text scale the gallery opens at. */
  initialTextScale: 1 | 1.3;
  /** Reduced motion forced on (true) or off (false); null follows the system. */
  initialReducedMotion: boolean | null;
  /** The kebab name of the one component to draw; null draws every component. */
  only: string | null;
};

type TextScale = GalleryScreenProps['initialTextScale'];

/** What a component's fixtures file exports. */
type Fixtures<P> = {
  STATES: Readonly<Record<string, P>>;
  PREVIEW: Readonly<Partial<Record<string, InteractionPreviewState>>>;
  GROUND: Readonly<Partial<Record<string, ColorToken>>>;
};

type GallerySection = {
  /** The component's id: the section's heading. */
  id: string;
  /** The component's kebab name: the value `only` takes, and a part of each cell's testID. */
  slug: string;
  /** 'full': as wide as the gallery's content column. */
  cell: 'wide' | 'narrow' | 'full';
  /** The state names, in the order of the fixtures. */
  states: readonly string[];
  preview: Readonly<Partial<Record<string, InteractionPreviewState>>>;
  ground: Readonly<Partial<Record<string, ColorToken>>>;
  /** The height of the frame a state is drawn in, for a specimen that fills its parent; null draws it at its own height. */
  frame: (state: string) => number | null;
  /** The component drawn with one state's props. */
  render: (state: string) => ReactNode;
};

/** One section of the gallery. Every specimen is checked against its component's props. */
function section<P extends object>(
  id: string,
  slug: string,
  cell: GallerySection['cell'],
  Component: ComponentType<P>,
  fixtures: Fixtures<P>,
  frame: GallerySection['frame'] = () => null,
): GallerySection {
  return {
    id,
    slug,
    cell,
    states: Object.keys(fixtures.STATES),
    preview: fixtures.PREVIEW,
    ground: fixtures.GROUND,
    frame,
    render: (state) => {
      const props = fixtures.STATES[state];
      return props === undefined ? null : <Component {...props} />;
    },
  };
}

/** The height of the frame a shell, a screen or a system screen is drawn in. */
const SHELL_FRAME = size.listRowMin * 8;
/** The height of the frame a list is drawn in: a list fills a parent that has a height. */
const LIST_FRAME = size.listRowMin * 6;
/** The height of the frame a labeled rail is drawn in, so its foot sits at the bottom. */
const RAIL_FRAME = size.listRowMin * 10;
/**
 * The height of the frame a full screen's longest text is drawn in: near enough the window of the
 * smallest phone (360 by 740), the least room that text will really have.
 */
const WINDOW_FRAME = size.listRowMin * 13;

/** The three layouts C-AppShell chooses between, each drawn whatever the window's width. */
const SHELL_LAYOUTS = [
  { name: 'compact', Shell: CompactShell },
  { name: 'medium', Shell: MediumShell },
  { name: 'expanded', Shell: ExpandedShell },
] as const;

/** The name of a shell state drawn through one layout: `signedOutHome` at compact is `compactSignedOutHome`. */
function shellStateName(layout: string, state: string): string {
  return `${layout}${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

/** The shells: every state of C-AppShell through each of the three layouts, around a placeholder. */
function shellsSection(): GallerySection {
  const specimens = new Map<string, () => ReactNode>();
  for (const { name, Shell } of SHELL_LAYOUTS) {
    for (const [state, props] of Object.entries(appShellFixtures.STATES)) {
      specimens.set(shellStateName(name, state), () => (
        <Shell {...props}>
          <Text role="body">Content</Text>
        </Shell>
      ));
    }
  }
  return {
    id: 'Shells',
    slug: 'shells',
    cell: 'full',
    states: [...specimens.keys()],
    preview: {},
    ground: {},
    frame: () => SHELL_FRAME,
    render: (state) => specimens.get(state)?.() ?? null,
  };
}

/** A row of the specimen lists. */
type ListSpecimenItem = (typeof listFixtures.STATES)['ready']['items'][number];

/** C-List over the rows of its fixtures: the gallery draws a component of one props type. */
function SpecimenList(props: ListProps<ListSpecimenItem>): JSX.Element {
  return <List {...props} />;
}

// C-RightColumn brings the gap that parts it from the main column. No main column stands beside a
// specimen, so the gap and the cell's own room before it are taken back: the column starts at the
// cell's edge, where the narrowest window holds all of it.
const RIGHT_COLUMN_START: ViewStyle = { marginLeft: -(size.columnGap + space.x3) };

/** C-RightColumn at the start of its cell. */
function SpecimenRightColumn(props: RightColumnProps): JSX.Element {
  return (
    <View style={RIGHT_COLUMN_START}>
      <RightColumn {...props} />
    </View>
  );
}

/** A state name as a testID writes it: `runHover` is `run-hover`. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A section whose specimens are drawn by the gallery itself: one for each state, in the given order. */
function specimenSection(
  id: string,
  slug: string,
  states: readonly string[],
  render: GallerySection['render'],
): GallerySection {
  return { id, slug, cell: 'wide', states, preview: {}, ground: {}, frame: () => null, render };
}

/** The footer of a sheet's fixture with its one button closing the sheet; any other footer as it is. */
function closingFooter(footer: ReactNode, close: () => void): ReactNode {
  return isValidElement<{ onPress?: () => void }>(footer) && 'onPress' in footer.props
    ? cloneElement(footer, { onPress: close })
    : footer;
}

/**
 * One state of C-Sheet: the button that opens it, and the sheet, closed until then. An open
 * overlay would cover the page, so none is open when the gallery loads.
 */
function SheetSpecimen({ state, fixture }: { state: string; fixture: SheetProps }): JSX.Element {
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };
  const { footer, ...props } = fixture;
  return (
    <>
      <Button
        variant="secondary"
        label={`Open ${state}`}
        testID={`gallery.open-sheet-${kebab(state)}`}
        onPress={() => {
          setOpen(true);
        }}
      />
      <Sheet
        {...props}
        open={open}
        onClose={close}
        {...(footer === undefined ? {} : { footer: closingFooter(footer, close) })}
      />
    </>
  );
}

/** One state of C-Dialog: the button that opens it, and the dialog, whose every action closes it. */
function DialogSpecimen({ state, fixture }: { state: string; fixture: DialogProps }): JSX.Element {
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };
  const { actions, ...props } = fixture;
  return (
    <>
      <Button
        variant="secondary"
        label={`Open ${state}`}
        testID={`gallery.open-dialog-${kebab(state)}`}
        onPress={() => {
          setOpen(true);
        }}
      />
      <Dialog
        {...props}
        open={open}
        onClose={close}
        {...(actions === undefined
          ? {}
          : { actions: actions.map((action) => ({ ...action, onPress: close })) })}
      />
    </>
  );
}

const SHEET_STATES: Readonly<Record<string, SheetProps>> = sheetFixtures.STATES;
const DIALOG_STATES: Readonly<Record<string, DialogProps>> = dialogFixtures.STATES;
const TOAST_STATES: Readonly<Record<string, Parameters<typeof showToast>[0]>> =
  toastFixtures.STATES;

/** Every component built so far, in the order of the design system (DS-gallery). */
const GALLERY_SECTIONS: readonly GallerySection[] = [
  shellsSection(),
  section('C-TabBar', 'tab-bar', 'wide', TabBar, tabBarFixtures),
  section('C-Rail', 'rail', 'wide', Rail, railFixtures, (state) =>
    state.startsWith('labeled') ? RAIL_FRAME : null,
  ),
  section('C-AppBar', 'app-bar', 'wide', AppBar, appBarFixtures),
  section('C-RightColumn', 'right-column', 'full', SpecimenRightColumn, rightColumnFixtures),
  section('C-Text', 'text', 'wide', Text, textFixtures),
  section('C-Pressable', 'pressable', 'wide', Pressable, pressableFixtures),
  section('C-Icon', 'icon', 'narrow', Icon, iconFixtures),
  section('C-Link', 'link', 'wide', Link, linkFixtures),
  section('C-Rule', 'rule', 'wide', Rule, ruleFixtures),
  section('C-FeedRule', 'feed-rule', 'wide', FeedRule, feedRuleFixtures),
  section('C-Button', 'button', 'wide', Button, buttonFixtures),
  section('C-IconButton', 'icon-button', 'wide', IconButton, iconButtonFixtures),
  section('C-Avatar', 'avatar', 'narrow', Avatar, avatarFixtures),
  section('C-CountBadge', 'count-badge', 'narrow', CountBadge, countBadgeFixtures),
  section('C-Wordmark', 'wordmark', 'wide', Wordmark, wordmarkFixtures),
  section('C-EmptyChair', 'empty-chair', 'wide', EmptyChair, emptyChairFixtures),
  section('C-Notice', 'notice', 'wide', Notice, noticeFixtures),
  section('C-Skeleton', 'skeleton', 'wide', Skeleton, skeletonFixtures),
  section('C-EmptyState', 'empty-state', 'wide', EmptyState, emptyStateFixtures),
  section('C-Screen', 'screen', 'full', Screen, screenFixtures, () => SHELL_FRAME),
  section('C-List', 'list', 'wide', SpecimenList, listFixtures, () => LIST_FRAME),
  section('C-SystemScreen', 'system-screen', 'full', SystemScreen, systemScreenFixtures, (state) =>
    state === 'longText' ? WINDOW_FRAME : SHELL_FRAME,
  ),
  specimenSection('C-Sheet', 'sheet', Object.keys(SHEET_STATES), (state) => {
    const fixture = SHEET_STATES[state];
    return fixture === undefined ? null : <SheetSpecimen state={state} fixture={fixture} />;
  }),
  specimenSection('C-Dialog', 'dialog', Object.keys(DIALOG_STATES), (state) => {
    const fixture = DIALOG_STATES[state];
    return fixture === undefined ? null : <DialogSpecimen state={state} fixture={fixture} />;
  }),
  section('C-Tooltip', 'tooltip', 'wide', Tooltip, tooltipFixtures),
  // A toast is drawn by the host of the root layout, so its specimen is the button that asks for it.
  specimenSection('C-Toast', 'toast', Object.keys(TOAST_STATES), (state) => {
    const fixture = TOAST_STATES[state];
    return fixture === undefined ? null : (
      <Button
        variant="secondary"
        label={`Show ${state}`}
        testID={`gallery.show-toast-${kebab(state)}`}
        onPress={() => {
          showToast(fixture);
        }}
      />
    );
  }),
];

type ControlOption<T> = { value: T; label: string; testID: string };

const THEME_OPTIONS: readonly ControlOption<ThemeChoice>[] = [
  { value: 'system', label: 'System', testID: 'gallery.theme-system' },
  { value: 'light', label: 'Light', testID: 'gallery.theme-light' },
  { value: 'dark', label: 'Dark', testID: 'gallery.theme-dark' },
];

const TEXT_OPTIONS: readonly ControlOption<TextScale>[] = [
  { value: 1, label: '100%', testID: 'gallery.text-100' },
  { value: 1.3, label: '130%', testID: 'gallery.text-130' },
];

const MOTION_OPTIONS: readonly ControlOption<boolean | null>[] = [
  { value: null, label: 'System', testID: 'gallery.motion-system' },
  { value: true, label: 'Reduced', testID: 'gallery.motion-reduced' },
];

const CONTROLS: ViewStyle = { marginTop: space.x4, gap: space.x2 };
const CONTROL_ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
// One column for the three labels, wide enough for the longest at 130% text, so the buttons line up.
const CONTROL_LABEL: ViewStyle = { minWidth: size.railIcon };
const CONTROL_BUTTONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  flexShrink: 1,
  gap: space.x2,
};
const HEADER_RULE: ViewStyle = { marginVertical: space.x6 };
const CELLS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: space.x4,
  marginTop: space.x3,
  marginBottom: space.x8,
};

/** One control of the header: its label and a small button for each value, the chosen one in ink. */
function ControlRow<T>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly ControlOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}): JSX.Element {
  return (
    <View style={CONTROL_ROW}>
      <View style={CONTROL_LABEL}>
        <Text role="monoLabel">{label}</Text>
      </View>
      <View style={CONTROL_BUTTONS}>
        {options.map((option) => (
          <Button
            key={option.testID}
            variant={option.value === selected ? 'primary' : 'secondary'}
            size="sm"
            label={option.label}
            testID={option.testID}
            onPress={() => {
              onSelect(option.value);
            }}
          />
        ))}
      </View>
    </View>
  );
}

/** One specimen: the state's name over the component, on the ground the state is made for. */
function Cell({ entry, state }: { entry: GallerySection; state: string }): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const preview = entry.preview[state];
  const specimen = entry.render(state);
  const frame = entry.frame(state);
  const wide = layout.breakpoint === 'compact' ? '100%' : size.rightColumn;
  const ground = theme.color[entry.ground[state] ?? 'bg'];
  return (
    <View
      style={{
        width:
          entry.cell === 'full' ? '100%' : entry.cell === 'narrow' ? size.rightColumn / 2 : wide,
      }}
      testID={`gallery.cell-${entry.slug}-${kebab(state)}`}
    >
      <Text role="mono" tone="secondary">
        {state}
      </Text>
      <View
        style={
          frame === null
            ? {
                marginTop: space.x2,
                padding: space.x3,
                minHeight: size.target,
                justifyContent: 'center',
                backgroundColor: ground,
              }
            : {
                // A frame stands in for the window: a row of the given height, outlined so its
                // edges show, with no room of its own around the specimen.
                marginTop: space.x2,
                height: frame,
                flexDirection: 'row',
                borderWidth: rule.hairline,
                borderColor: theme.color.rule,
                backgroundColor: ground,
              }
        }
      >
        {preview === undefined ? (
          specimen
        ) : (
          <InteractionPreview state={preview}>{specimen}</InteractionPreview>
        )}
      </View>
    </View>
  );
}

/** One component: its id, the number of its states and a cell for each of them. */
function Section({ entry }: { entry: GallerySection }): JSX.Element {
  const count = entry.states.length;
  return (
    <View>
      <Text role="heading" heading={2}>
        {entry.id}
      </Text>
      <Text role="caption" tone="secondary">
        {count === 1 ? '1 state' : `${String(count)} states`}
      </Text>
      <View style={CELLS}>
        {entry.states.map((state) => (
          <Cell key={state} entry={entry} state={state} />
        ))}
      </View>
    </View>
  );
}

type GalleryPageProps = {
  theme: ThemeChoice;
  textScale: TextScale;
  reducedMotion: boolean | null;
  only: string | null;
  onTheme: (value: ThemeChoice) => void;
  onTextScale: (value: TextScale) => void;
  onReducedMotion: (value: boolean | null) => void;
};

/** The header with its three controls, then the sections. Drawn inside the gallery's own theme. */
function GalleryPage({
  theme,
  textScale,
  reducedMotion,
  only,
  onTheme,
  onTextScale,
  onReducedMotion,
}: GalleryPageProps): JSX.Element {
  const layout = useBreakpoint();
  const headingRef = useRef<TextInstance>(null);
  // A specimen that focuses its title when it mounts would keep the focus and leave the page
  // scrolled down to it. The page's heading takes the focus from it, which brings the top back
  // into view, and lets it go, so the page opens as it does without such a specimen.
  useEffect(() => {
    // Neither member is on every platform's implementation, whatever the types say.
    const heading: { focus?: () => void; blur?: () => void } | null = headingRef.current;
    if (heading === null) return;
    if (typeof heading.focus === 'function') heading.focus();
    if (typeof heading.blur === 'function') heading.blur();
  }, []);
  const sections =
    only === null ? GALLERY_SECTIONS : GALLERY_SECTIONS.filter((entry) => entry.slug === only);
  return (
    <>
      {/* The gallery draws no bar: the top inset keeps its heading clear of the status bar. */}
      <AppBarInset />
      <ScrollView
        testID="gallery.scroll"
        contentContainerStyle={{
          alignSelf: 'center',
          width: '100%',
          maxWidth: size.contentMax,
          paddingHorizontal: layout.gutter,
          paddingTop: space.x6,
          paddingBottom: space.x12,
        }}
      >
        <View role="main">
          <Text ref={headingRef} role="title" heading={1}>
            Gallery
          </Text>
          <View style={CONTROLS}>
            <ControlRow label="Theme" options={THEME_OPTIONS} selected={theme} onSelect={onTheme} />
            <ControlRow
              label="Text"
              options={TEXT_OPTIONS}
              selected={textScale}
              onSelect={onTextScale}
            />
            <ControlRow
              label="Motion"
              options={MOTION_OPTIONS}
              selected={reducedMotion}
              onSelect={onReducedMotion}
            />
          </View>
          <View style={HEADER_RULE}>
            <Rule variant="strong" />
          </View>
          {only !== null && sections.length === 0 ? (
            <Text role="body">{`No component named ${only}.`}</Text>
          ) : (
            sections.map((entry) => <Section key={entry.slug} entry={entry} />)
          )}
        </View>
      </ScrollView>
    </>
  );
}

/**
 * The development gallery (DS-gallery): every component built so far in every state of its
 * fixtures, with controls for the theme, the text scale and reduced motion. It fetches nothing and
 * never ships to users, so its own labels are English.
 */
export function GalleryScreen({
  initialTheme,
  initialTextScale,
  initialReducedMotion,
  only,
}: GalleryScreenProps): JSX.Element {
  const [theme, setTheme] = useState(initialTheme);
  const [textScale, setTextScale] = useState(initialTextScale);
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion);
  return (
    <ThemeProvider choice={theme} textScale={textScale}>
      <ReducedMotionOverride value={reducedMotion}>
        <GalleryPage
          theme={theme}
          textScale={textScale}
          reducedMotion={reducedMotion}
          only={only}
          onTheme={setTheme}
          onTextScale={setTextScale}
          onReducedMotion={setReducedMotion}
        />
      </ReducedMotionOverride>
    </ThemeProvider>
  );
}
