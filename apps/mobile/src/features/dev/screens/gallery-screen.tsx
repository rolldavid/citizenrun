import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react';
import type { ComponentType, JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { HostInstance, TextInstance, ViewStyle } from 'react-native';

import {
  ActionRow,
  AddressField,
  AgeGate,
  AppBar,
  Avatar,
  BigNumber,
  Button,
  CardShell,
  Checkbox,
  CodeField,
  CompactShell,
  ConfidenceBadge,
  CountBadge,
  DeadlineBlock,
  DeadlineLine,
  DeadlineRing,
  DealLine,
  Dialog,
  EmptyChair,
  EmptyState,
  ExpandedShell,
  FactRow,
  FeedRule,
  Flag,
  FollowButton,
  FormField,
  HandleField,
  Icon,
  IconButton,
  InteractionPreview,
  IssueChip,
  IssueGrid,
  IssueTile,
  Link,
  List,
  ListRow,
  MediumShell,
  Meter,
  MeterInputs,
  MiniMapStill,
  Notice,
  OfficeCard,
  OfficeTile,
  PersonRow,
  PhotoCredit,
  Popover,
  Pressable,
  ProfileHeader,
  Progress,
  Prose,
  Radio,
  RadioGroup,
  Rail,
  RightColumn,
  Rule,
  Screen,
  SectionHeader,
  Select,
  Sheet,
  Skeleton,
  SourceLink,
  SourcesSheet,
  StickyFooter,
  Switch,
  SystemScreen,
  TabBar,
  Table,
  Tag,
  Text,
  TextField,
  ToastOutlet,
  Tooltip,
  Wordmark,
  showToast,
  useBreakpoint,
} from '@/ui';
import type {
  ActionRowProps,
  AddressFieldProps,
  AgeGateProps,
  CardShellProps,
  CheckboxProps,
  CodeFieldProps,
  DialogProps,
  FollowButtonProps,
  HandleFieldProps,
  InteractionPreviewState,
  IssueChipProps,
  IssueGridProps,
  IssueTileProps,
  ListProps,
  OfficeCardProps,
  PopoverProps,
  RadioGroupProps,
  RadioProps,
  RightColumnProps,
  SelectProps,
  SheetProps,
  SourcesSheetProps,
  TableProps,
  StickyFooterProps,
  SwitchProps,
  TextFieldProps,
} from '@/ui';
import * as actionRowFixtures from '@/ui/components/action-row.fixtures';
import * as addressFieldFixtures from '@/ui/components/address-field.fixtures';
import * as ageGateFixtures from '@/ui/components/age-gate.fixtures';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as bigNumberFixtures from '@/ui/components/big-number.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as cardShellFixtures from '@/ui/components/card-shell.fixtures';
import * as checkboxFixtures from '@/ui/components/checkbox.fixtures';
import * as codeFieldFixtures from '@/ui/components/code-field.fixtures';
import * as confidenceBadgeFixtures from '@/ui/components/confidence-badge.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as deadlineBlockFixtures from '@/ui/components/deadline-block.fixtures';
import * as deadlineLineFixtures from '@/ui/components/deadline-line.fixtures';
import * as deadlineRingFixtures from '@/ui/components/deadline-ring.fixtures';
import * as dealLineFixtures from '@/ui/components/deal-line.fixtures';
import * as dialogFixtures from '@/ui/components/dialog.fixtures';
import * as emptyChairFixtures from '@/ui/components/empty-chair.fixtures';
import * as emptyStateFixtures from '@/ui/components/empty-state.fixtures';
import * as factRowFixtures from '@/ui/components/fact-row.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as flagFixtures from '@/ui/components/flag.fixtures';
import * as followButtonFixtures from '@/ui/components/follow-button.fixtures';
import * as formFieldFixtures from '@/ui/components/form-field.fixtures';
import * as handleFieldFixtures from '@/ui/components/handle-field.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as issueChipFixtures from '@/ui/components/issue-chip.fixtures';
import * as issueGridFixtures from '@/ui/components/issue-grid.fixtures';
import * as issueTileFixtures from '@/ui/components/issue-tile.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as listRowFixtures from '@/ui/components/list-row.fixtures';
import * as listFixtures from '@/ui/components/list.fixtures';
import * as meterInputsFixtures from '@/ui/components/meter-inputs.fixtures';
import * as meterFixtures from '@/ui/components/meter.fixtures';
import * as miniMapStillFixtures from '@/ui/components/mini-map-still.fixtures';
import * as noticeFixtures from '@/ui/components/notice.fixtures';
import * as officeCardFixtures from '@/ui/components/office-card.fixtures';
import * as officeTileFixtures from '@/ui/components/office-tile.fixtures';
import * as personRowFixtures from '@/ui/components/person-row.fixtures';
import * as photoCreditFixtures from '@/ui/components/photo-credit.fixtures';
import * as popoverFixtures from '@/ui/components/popover.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as profileHeaderFixtures from '@/ui/components/profile-header.fixtures';
import * as progressFixtures from '@/ui/components/progress.fixtures';
import * as proseFixtures from '@/ui/components/prose.fixtures';
import * as radioGroupFixtures from '@/ui/components/radio-group.fixtures';
import * as radioFixtures from '@/ui/components/radio.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as screenFixtures from '@/ui/components/screen.fixtures';
import * as sectionHeaderFixtures from '@/ui/components/section-header.fixtures';
import * as selectFixtures from '@/ui/components/select.fixtures';
import * as sheetFixtures from '@/ui/components/sheet.fixtures';
import * as skeletonFixtures from '@/ui/components/skeleton.fixtures';
import * as sourceLinkFixtures from '@/ui/components/source-link.fixtures';
import * as sourcesSheetFixtures from '@/ui/components/sources-sheet.fixtures';
import * as stickyFooterFixtures from '@/ui/components/sticky-footer.fixtures';
import * as switchFixtures from '@/ui/components/switch.fixtures';
import * as systemScreenFixtures from '@/ui/components/system-screen.fixtures';
import * as tableFixtures from '@/ui/components/table.fixtures';
import * as tagFixtures from '@/ui/components/tag.fixtures';
import * as textFieldFixtures from '@/ui/components/text-field.fixtures';
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
import { gutter, rule, size, space } from '@/ui/tokens';
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

/**
 * One state of C-SourcesSheet: the button that opens it, and the sheet, closed until then. The
 * button of its footer closes it.
 */
function SourcesSheetSpecimen({
  state,
  fixture,
}: {
  state: string;
  fixture: SourcesSheetProps;
}): JSX.Element {
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
        testID={`gallery.open-sources-sheet-${kebab(state)}`}
        onPress={() => {
          setOpen(true);
        }}
      />
      <SourcesSheet
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

/**
 * A section whose specimens the gallery draws round each state's fixture: a field that holds what
 * is typed into it, an overlay behind the button that opens it. `order` gives the states where
 * the order of the fixtures would not do.
 */
function fixtureSection<P>(
  id: string,
  slug: string,
  cell: GallerySection['cell'],
  fixtures: Fixtures<P>,
  draw: (fixture: P, state: string) => ReactNode,
  order: readonly string[] = Object.keys(fixtures.STATES),
): GallerySection {
  return {
    id,
    slug,
    cell,
    states: order,
    preview: fixtures.PREVIEW,
    ground: fixtures.GROUND,
    frame: () => null,
    render: (state) => {
      const fixture = fixtures.STATES[state];
      return fixture === undefined ? null : draw(fixture, state);
    },
  };
}

const ANCHOR_START: ViewStyle = { alignSelf: 'flex-start' };
// A popover whose end edge lines up with its control's needs the room before it.
const ANCHOR_END: ViewStyle = { alignSelf: 'flex-end' };

/**
 * The states of C-Popover in the order the gallery draws them: those that open upward come last,
 * at the bottom of the section, where there is room above them.
 */
const POPOVER_ORDER: readonly string[] = [
  ...Object.keys(popoverFixtures.STATES).filter((state) => !state.startsWith('above')),
  ...Object.keys(popoverFixtures.STATES).filter((state) => state.startsWith('above')),
];

/** The rows of a popover's fixture closing the popover when one is picked; anything else as it is. */
function closingRows(children: ReactNode, close: () => void): ReactNode {
  return isValidElement<{ onPick?: () => void }>(children) && 'onPick' in children.props
    ? cloneElement(children, { onPick: close })
    : children;
}

/**
 * One state of C-Popover: the control that opens it, which is its anchor, and the popover, closed
 * until then. The control stands at the end of its cell for a popover that lines up with its end
 * edge, and the narrow anchor is an icon button.
 */
function PopoverSpecimen({
  state,
  fixture,
}: {
  state: string;
  fixture: PopoverProps;
}): JSX.Element {
  const anchor = useRef<HostInstance>(null);
  const [open, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
  };
  const show = (): void => {
    setOpen(true);
  };
  const testID = `gallery.popover-open-${kebab(state)}`;
  return (
    <>
      <View
        ref={anchor}
        style={fixture.placement?.endsWith('-end') === true ? ANCHOR_END : ANCHOR_START}
      >
        {state === 'narrowAnchor' ? (
          <IconButton
            icon="more"
            variant="framed"
            label={`Open ${state}`}
            testID={testID}
            onPress={show}
          />
        ) : (
          <Button variant="secondary" label={`Open ${state}`} testID={testID} onPress={show} />
        )}
      </View>
      <Popover {...fixture} anchor={anchor} open={open} onClose={close}>
        {closingRows(fixture.children, close)}
      </Popover>
    </>
  );
}

/** One state of C-TextField, holding what is typed into it: a fixture's own value never changes. */
function TextFieldSpecimen({ fixture }: { fixture: TextFieldProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return (
    <TextField
      {...fixture}
      value={value}
      onChangeText={setValue}
      {...(fixture.onClear === undefined
        ? {}
        : {
            onClear: () => {
              setValue('');
            },
          })}
    />
  );
}

/**
 * One state of C-AddressField, holding what is typed into it. The suggestions stay the fixture's:
 * they are the caller's to fetch, and the gallery fetches nothing.
 */
function AddressFieldSpecimen({ fixture }: { fixture: AddressFieldProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return <AddressField {...fixture} value={value} onChangeText={setValue} />;
}

/** One state of C-HandleField, holding what is typed into it; the answer of its check stays the fixture's. */
function HandleFieldSpecimen({ fixture }: { fixture: HandleFieldProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return <HandleField {...fixture} value={value} onChangeText={setValue} />;
}

// The six boxes are as wide as the smallest phone between its gutters, so the row takes back the
// cell's own room at each side.
const CODE_ROW: ViewStyle = { marginHorizontal: -space.x3 };

/** One state of C-CodeField, holding the digits typed or pasted into it. */
function CodeFieldSpecimen({ fixture }: { fixture: CodeFieldProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return (
    <View style={CODE_ROW}>
      <CodeField {...fixture} value={value} onChangeText={setValue} />
    </View>
  );
}

/** One state of C-Select, holding what is chosen from its list: nothing, until a row is pressed. */
function SelectSpecimen({ fixture }: { fixture: SelectProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return <Select {...fixture} value={value} onChange={setValue} />;
}

/** One state of C-Checkbox, ticked and cleared by a press. */
function CheckboxSpecimen({ fixture }: { fixture: CheckboxProps }): JSX.Element {
  const [checked, setChecked] = useState(fixture.checked);
  return <Checkbox {...fixture} checked={checked} onChange={setChecked} />;
}

/**
 * One state of C-Radio in a group of its own, which the product gives it through C-RadioGroup. A
 * press chooses it, and as the group's one option it stays chosen.
 */
function RadioSpecimen({ state, fixture }: { state: string; fixture: RadioProps }): JSX.Element {
  const [selected, setSelected] = useState(fixture.selected);
  return (
    <View role="radiogroup" aria-label={`Specimen group of ${state}`}>
      <Radio
        {...fixture}
        selected={selected}
        onSelect={() => {
          setSelected(true);
        }}
      />
    </View>
  );
}

/** One state of C-RadioGroup, holding its choice. */
function RadioGroupSpecimen({ fixture }: { fixture: RadioGroupProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return <RadioGroup {...fixture} value={value} onChange={setValue} />;
}

/** One state of C-Switch, flipped by a press. */
function SwitchSpecimen({ fixture }: { fixture: SwitchProps }): JSX.Element {
  const [value, setValue] = useState(fixture.value);
  return <Switch {...fixture} value={value} onChange={setValue} />;
}

/** One state of C-AgeGate, holding the month and the year chosen from its two lists. */
function AgeGateSpecimen({ fixture }: { fixture: AgeGateProps }): JSX.Element {
  const [answer, setAnswer] = useState({ month: fixture.month, year: fixture.year });
  return <AgeGate {...fixture} month={answer.month} year={answer.year} onChange={setAnswer} />;
}

// The foot of a screen: a little of its ground over the footer, which is not pinned here.
const FOOTER_BOX: ViewStyle = { marginHorizontal: -space.x3, borderWidth: rule.hairline };
const FOOTER_GROUND: ViewStyle = { height: size.listRowMin };

/** One state of C-StickyFooter at the foot of an outlined box, in place of the window it is pinned to. */
function StickyFooterSpecimen({ fixture }: { fixture: StickyFooterProps }): JSX.Element {
  const theme = useTheme();
  return (
    <View style={[FOOTER_BOX, { borderColor: theme.color.rule }]}>
      <View style={FOOTER_GROUND} />
      <StickyFooter {...fixture} />
    </View>
  );
}

const CHIP_ROW: ViewStyle = { flexDirection: 'row' };

/** One state of C-IssueChip, selected and starred by its own presses; a display chip stays as it is. */
function IssueChipSpecimen({ fixture }: { fixture: IssueChipProps }): JSX.Element {
  const [selected, setSelected] = useState(fixture.selected === true);
  const [starred, setStarred] = useState(fixture.star?.starred === true);
  const { onPress, star, ...props } = fixture;
  return (
    // In a row, as a chip stands in the product: as wide as its name.
    <View style={CHIP_ROW}>
      <IssueChip
        {...props}
        selected={selected}
        {...(onPress === undefined
          ? {}
          : {
              onPress: () => {
                setSelected(!selected);
              },
            })}
        {...(star === undefined || star === null
          ? {}
          : {
              star: {
                ...star,
                starred,
                onToggle: () => {
                  setStarred(!starred);
                },
              },
            })}
      />
    </View>
  );
}

/**
 * One state of C-ActionRow, followed and bookmarked by its own presses, at the width the product
 * gives it. At compact the gallery's own column is the window: a row a card or a page draws from
 * edge to edge takes back the room around its cell, the action card's row the cell's own room
 * alone. From medium up the row stands in a box as wide as the feed column or the action card.
 */
function ActionRowSpecimen({ fixture }: { fixture: ActionRowProps }): JSX.Element {
  const layout = useBreakpoint();
  const [following, setFollowing] = useState(fixture.following);
  const [bookmarked, setBookmarked] = useState(fixture.bookmarked);
  const stacked = fixture.layout === 'stacked';
  return (
    <View
      style={
        layout.breakpoint === 'compact'
          ? { marginHorizontal: -(stacked ? space.x3 : space.x3 + layout.gutter) }
          : { width: stacked ? size.actionCard : size.feedColumn }
      }
    >
      <ActionRow
        {...fixture}
        following={following}
        bookmarked={bookmarked}
        onToggleFollow={() => {
          setFollowing(!following);
        }}
        onToggleBookmark={() => {
          setBookmarked(!bookmarked);
        }}
      />
    </View>
  );
}

/**
 * A card at the width the feed gives it. At compact the gallery's own column is the window: the
 * card takes back the room around its cell, so its box runs from edge to edge as it does in the
 * feed. From medium up the card is as wide as its canvas, at the start of its cell.
 */
function CardSpecimen({ children }: { children: ReactNode }): JSX.Element {
  const layout = useBreakpoint();
  return (
    <View
      style={
        layout.breakpoint === 'compact' ? { marginHorizontal: -(space.x3 + layout.gutter) } : null
      }
    >
      {children}
    </View>
  );
}

/** One state of C-OfficeCard, followed and bookmarked by its own presses. */
function OfficeCardSpecimen({ fixture }: { fixture: OfficeCardProps }): JSX.Element {
  const [following, setFollowing] = useState(fixture.actions.following);
  const [bookmarked, setBookmarked] = useState(fixture.actions.bookmarked);
  return (
    <CardSpecimen>
      <OfficeCard
        {...fixture}
        actions={{
          ...fixture.actions,
          following,
          bookmarked,
          onToggleFollow: () => {
            setFollowing(!following);
          },
          onToggleBookmark: () => {
            setBookmarked(!bookmarked);
          },
        }}
      />
    </CardSpecimen>
  );
}

/** One state of C-FollowButton, followed and unfollowed by a press. */
function FollowButtonSpecimen({ fixture }: { fixture: FollowButtonProps }): JSX.Element {
  const [following, setFollowing] = useState(fixture.following);
  return (
    <FollowButton
      {...fixture}
      following={following}
      onToggle={() => {
        setFollowing(!following);
      }}
    />
  );
}

/** The 19 issues with the short names the grid's fixtures print. */
const ISSUES: IssueGridProps['issues'] = issueGridFixtures.STATES.none.issues;

const TILE_STRIP: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: space.x1 };

/** Every issue's tile in the order of the issues, each named for a screen reader. */
function IssueTileStrip(): JSX.Element {
  return (
    <View style={TILE_STRIP}>
      {ISSUES.map((item) => (
        <IssueTile key={item.id} issueId={item.id} label={item.name} />
      ))}
    </View>
  );
}

/** The state of the C-IssueTile section that is no fixture: all 19 tiles in one strip. */
const EVERY_TILE = 'everyIssue';
const TILE_STATES: Readonly<Record<string, IssueTileProps>> = issueTileFixtures.STATES;

/**
 * The width of the phone the sign-up grid is laid out for, in points. It is the size of a window,
 * which no design token holds.
 */
const PHONE_WINDOW = 390;
/** The column a screen gives the grid at medium and expanded. */
const COLUMN_WINDOW = size.feedColumn;
const GRID_NOTE: ViewStyle = { marginTop: space.x2 };

/**
 * A frame that stands in for a window `width` points wide: outlined, with the gutters such a
 * window has. In a gallery narrower than the frame the gallery's own column is the window, so the
 * frame takes the column, with no outline and no gutters of its own.
 */
function WindowFrame({ width, children }: { width: number; children: ReactNode }): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const column = Math.min(layout.width, size.contentMax) - layout.gutter * 2;
  const fits = column >= width + rule.hairline * 2;
  return (
    <View
      style={
        fits
          ? {
              alignSelf: 'flex-start',
              width: width + rule.hairline * 2,
              paddingHorizontal: width < gutter.narrowBelow ? gutter.narrow : gutter.regular,
              paddingVertical: space.x3,
              borderWidth: rule.hairline,
              borderColor: theme.color.ruleSoft,
            }
          : // The cell's own room at each side is taken back, so the grid is as wide as on a phone.
            { marginHorizontal: -space.x3, width: column }
      }
    >
      {children}
    </View>
  );
}

/**
 * One state of C-IssueGrid in a window frame, holding what is picked and starred. A tap past a
 * limit changes nothing, and the line under the grid says which limit was met.
 */
function IssueGridSpecimen({
  fixture,
  width,
  testID,
}: {
  fixture: IssueGridProps;
  width: number;
  testID: string;
}): JSX.Element {
  const [selectedIds, setSelectedIds] = useState(fixture.selectedIds);
  const [starredIds, setStarredIds] = useState(fixture.starredIds);
  const [limit, setLimit] = useState<'selected' | 'starred' | null>(null);
  const counts = `${String(selectedIds.length)} picked, ${String(starredIds.length)} starred`;
  const most = limit === 'selected' ? fixture.maxSelected : fixture.maxStarred;
  return (
    <WindowFrame width={width}>
      <IssueGrid
        {...fixture}
        testID={testID}
        selectedIds={selectedIds}
        starredIds={starredIds}
        onToggle={(id) => {
          setLimit(null);
          // An issue that is no longer picked keeps no star.
          setStarredIds(starredIds.filter((starred) => starred !== id));
          setSelectedIds(
            selectedIds.includes(id)
              ? selectedIds.filter((selected) => selected !== id)
              : [...selectedIds, id],
          );
        }}
        onToggleStar={(id) => {
          setLimit(null);
          setStarredIds(
            starredIds.includes(id)
              ? starredIds.filter((starred) => starred !== id)
              : [...starredIds, id],
          );
        }}
        onLimit={setLimit}
      />
      <View style={GRID_NOTE}>
        <Text role="caption" tone="secondary">
          {limit === null ? counts : `${counts}. ${String(most)} is the most.`}
        </Text>
      </View>
    </WindowFrame>
  );
}

/** The state of the C-IssueGrid section that is no fixture: `three` in the column of a wide window. */
const GRID_IN_COLUMN = 'threeInColumn';
const GRID_STATES: Readonly<Record<string, IssueGridProps>> = issueGridFixtures.STATES;

const SHEET_STATES: Readonly<Record<string, SheetProps>> = sheetFixtures.STATES;
const DIALOG_STATES: Readonly<Record<string, DialogProps>> = dialogFixtures.STATES;
const TOAST_STATES: Readonly<Record<string, Parameters<typeof showToast>[0]>> =
  toastFixtures.STATES;
const SOURCES_SHEET_STATES: Readonly<Record<string, SourcesSheetProps>> =
  sourcesSheetFixtures.STATES;

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
  fixtureSection<PopoverProps>(
    'C-Popover',
    'popover',
    'wide',
    popoverFixtures,
    (fixture, state) => <PopoverSpecimen state={state} fixture={fixture} />,
    POPOVER_ORDER,
  ),
  section('C-Tooltip', 'tooltip', 'wide', Tooltip, tooltipFixtures),
  // A toast is drawn apart from what asks for it, so its specimen is the button that asks.
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
  section('C-FormField', 'form-field', 'wide', FormField, formFieldFixtures),
  fixtureSection<TextFieldProps>(
    'C-TextField',
    'text-field',
    'wide',
    textFieldFixtures,
    (fixture) => <TextFieldSpecimen fixture={fixture} />,
  ),
  fixtureSection<AddressFieldProps>(
    'C-AddressField',
    'address-field',
    'wide',
    addressFieldFixtures,
    (fixture) => <AddressFieldSpecimen fixture={fixture} />,
  ),
  fixtureSection<HandleFieldProps>(
    'C-HandleField',
    'handle-field',
    'wide',
    handleFieldFixtures,
    (fixture) => <HandleFieldSpecimen fixture={fixture} />,
  ),
  fixtureSection<CodeFieldProps>(
    'C-CodeField',
    'code-field',
    'full',
    codeFieldFixtures,
    (fixture) => <CodeFieldSpecimen fixture={fixture} />,
  ),
  fixtureSection<SelectProps>('C-Select', 'select', 'wide', selectFixtures, (fixture) => (
    <SelectSpecimen fixture={fixture} />
  )),
  fixtureSection<CheckboxProps>('C-Checkbox', 'checkbox', 'wide', checkboxFixtures, (fixture) => (
    <CheckboxSpecimen fixture={fixture} />
  )),
  fixtureSection<RadioProps>('C-Radio', 'radio', 'wide', radioFixtures, (fixture, state) => (
    <RadioSpecimen state={state} fixture={fixture} />
  )),
  fixtureSection<RadioGroupProps>(
    'C-RadioGroup',
    'radio-group',
    'wide',
    radioGroupFixtures,
    (fixture) => <RadioGroupSpecimen fixture={fixture} />,
  ),
  fixtureSection<SwitchProps>('C-Switch', 'switch', 'wide', switchFixtures, (fixture) => (
    <SwitchSpecimen fixture={fixture} />
  )),
  fixtureSection<AgeGateProps>('C-AgeGate', 'age-gate', 'wide', ageGateFixtures, (fixture) => (
    <AgeGateSpecimen fixture={fixture} />
  )),
  section('C-Progress', 'progress', 'wide', Progress, progressFixtures),
  fixtureSection<StickyFooterProps>(
    'C-StickyFooter',
    'sticky-footer',
    'wide',
    stickyFooterFixtures,
    (fixture) => <StickyFooterSpecimen fixture={fixture} />,
  ),
  section('C-SectionHeader', 'section-header', 'wide', SectionHeader, sectionHeaderFixtures),
  section('C-ListRow', 'list-row', 'wide', ListRow, listRowFixtures),
  section('C-PersonRow', 'person-row', 'wide', PersonRow, personRowFixtures),
  section('C-FactRow', 'fact-row', 'wide', FactRow, factRowFixtures),
  // In the column a screen gives it, so a wide window shows every column and a phone scrolls.
  fixtureSection<TableProps>('C-Table', 'table', 'full', tableFixtures, (fixture) => (
    <WindowFrame width={COLUMN_WINDOW}>
      <Table {...fixture} />
    </WindowFrame>
  )),
  section('C-Tag', 'tag', 'narrow', Tag, tagFixtures),
  section('C-Flag', 'flag', 'narrow', Flag, flagFixtures),
  section(
    'C-ConfidenceBadge',
    'confidence-badge',
    'narrow',
    ConfidenceBadge,
    confidenceBadgeFixtures,
  ),
  section('C-SourceLink', 'source-link', 'wide', SourceLink, sourceLinkFixtures),
  specimenSection('C-SourcesSheet', 'sources-sheet', Object.keys(SOURCES_SHEET_STATES), (state) => {
    const fixture = SOURCES_SHEET_STATES[state];
    return fixture === undefined ? null : <SourcesSheetSpecimen state={state} fixture={fixture} />;
  }),
  section('C-Prose', 'prose', 'full', Prose, proseFixtures),
  section('C-PhotoCredit', 'photo-credit', 'narrow', PhotoCredit, photoCreditFixtures),
  section('C-BigNumber', 'big-number', 'wide', BigNumber, bigNumberFixtures),
  section('C-DealLine', 'deal-line', 'wide', DealLine, dealLineFixtures),
  section('C-Meter', 'meter', 'wide', Meter, meterFixtures),
  section('C-MeterInputs', 'meter-inputs', 'wide', MeterInputs, meterInputsFixtures),
  section('C-DeadlineRing', 'deadline-ring', 'narrow', DeadlineRing, deadlineRingFixtures),
  section('C-DeadlineBlock', 'deadline-block', 'wide', DeadlineBlock, deadlineBlockFixtures),
  section('C-DeadlineLine', 'deadline-line', 'wide', DeadlineLine, deadlineLineFixtures),
  {
    id: 'C-IssueTile',
    slug: 'issue-tile',
    cell: 'wide',
    states: [...Object.keys(TILE_STATES), EVERY_TILE],
    preview: issueTileFixtures.PREVIEW,
    ground: issueTileFixtures.GROUND,
    frame: () => null,
    render: (state) => {
      if (state === EVERY_TILE) {
        return <IssueTileStrip />;
      }
      const fixture = TILE_STATES[state];
      return fixture === undefined ? null : <IssueTile {...fixture} />;
    },
  },
  fixtureSection<IssueChipProps>(
    'C-IssueChip',
    'issue-chip',
    'wide',
    issueChipFixtures,
    (fixture) => <IssueChipSpecimen fixture={fixture} />,
  ),
  {
    id: 'C-IssueGrid',
    slug: 'issue-grid',
    cell: 'full',
    states: [...Object.keys(GRID_STATES), GRID_IN_COLUMN],
    preview: issueGridFixtures.PREVIEW,
    ground: issueGridFixtures.GROUND,
    frame: () => null,
    render: (state) => {
      // The same picks in a wide window's column, under ids of its own.
      const inColumn = state === GRID_IN_COLUMN;
      const fixture = GRID_STATES[inColumn ? 'three' : state];
      return fixture === undefined ? null : (
        <IssueGridSpecimen
          fixture={fixture}
          width={inColumn ? COLUMN_WINDOW : PHONE_WINDOW}
          testID={inColumn ? 'gallery.issue-grid-three-in-column' : fixture.testID}
        />
      );
    },
  },
  section('C-OfficeTile', 'office-tile', 'narrow', OfficeTile, officeTileFixtures),
  section('C-ProfileHeader', 'profile-header', 'wide', ProfileHeader, profileHeaderFixtures),
  // A card is as wide as its canvas, which a cell of a column's width cannot hold.
  fixtureSection<CardShellProps>(
    'C-CardShell',
    'card-shell',
    'full',
    cardShellFixtures,
    (fixture) => (
      <CardSpecimen>
        <CardShell {...fixture} />
      </CardSpecimen>
    ),
  ),
  fixtureSection<ActionRowProps>(
    'C-ActionRow',
    'action-row',
    'full',
    actionRowFixtures,
    (fixture) => <ActionRowSpecimen fixture={fixture} />,
  ),
  fixtureSection<FollowButtonProps>(
    'C-FollowButton',
    'follow-button',
    'wide',
    followButtonFixtures,
    (fixture) => <FollowButtonSpecimen fixture={fixture} />,
  ),
  fixtureSection<OfficeCardProps>(
    'C-OfficeCard',
    'office-card',
    'full',
    officeCardFixtures,
    (fixture) => <OfficeCardSpecimen fixture={fixture} />,
  ),
  section('MiniMapStill', 'mini-map-still', 'wide', MiniMapStill, miniMapStillFixtures),
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
        // As in C-Screen: a press on a specimen's button reaches it while a field has the keyboard up.
        keyboardShouldPersistTaps="handled"
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
      {/* The gallery's own theme, text size and motion reach a toast only when it is drawn here. */}
      <ToastOutlet place="screen" />
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
