import { useState } from 'react';
import type { ComponentType, JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import {
  Avatar,
  Button,
  CountBadge,
  EmptyChair,
  FeedRule,
  Icon,
  IconButton,
  InteractionPreview,
  Link,
  Pressable,
  Rule,
  Text,
  Wordmark,
  useBreakpoint,
} from '@/ui';
import type { InteractionPreviewState } from '@/ui';
import * as avatarFixtures from '@/ui/components/avatar.fixtures';
import * as buttonFixtures from '@/ui/components/button.fixtures';
import * as countBadgeFixtures from '@/ui/components/count-badge.fixtures';
import * as emptyChairFixtures from '@/ui/components/empty-chair.fixtures';
import * as feedRuleFixtures from '@/ui/components/feed-rule.fixtures';
import * as iconButtonFixtures from '@/ui/components/icon-button.fixtures';
import * as iconFixtures from '@/ui/components/icon.fixtures';
import * as linkFixtures from '@/ui/components/link.fixtures';
import * as pressableFixtures from '@/ui/components/pressable.fixtures';
import * as ruleFixtures from '@/ui/components/rule.fixtures';
import * as textFixtures from '@/ui/components/text.fixtures';
import * as wordmarkFixtures from '@/ui/components/wordmark.fixtures';
import { ReducedMotionOverride } from '@/ui/motion';
import { ThemeProvider, useTheme } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';
import { size, space } from '@/ui/tokens';
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
  cell: 'wide' | 'narrow';
  /** The state names, in the order of the fixtures. */
  states: readonly string[];
  preview: Readonly<Partial<Record<string, InteractionPreviewState>>>;
  ground: Readonly<Partial<Record<string, ColorToken>>>;
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
): GallerySection {
  return {
    id,
    slug,
    cell,
    states: Object.keys(fixtures.STATES),
    preview: fixtures.PREVIEW,
    ground: fixtures.GROUND,
    render: (state) => {
      const props = fixtures.STATES[state];
      return props === undefined ? null : <Component {...props} />;
    },
  };
}

/** Every component built so far, in the order of the design system (DS-gallery). */
const GALLERY_SECTIONS: readonly GallerySection[] = [
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

/** A state name as a testID writes it: `runHover` is `run-hover`. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

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
  const wide = layout.breakpoint === 'compact' ? '100%' : size.rightColumn;
  return (
    <View
      style={{ width: entry.cell === 'narrow' ? size.rightColumn / 2 : wide }}
      testID={`gallery.cell-${entry.slug}-${kebab(state)}`}
    >
      <Text role="mono" tone="secondary">
        {state}
      </Text>
      <View
        style={{
          marginTop: space.x2,
          padding: space.x3,
          minHeight: size.target,
          justifyContent: 'center',
          backgroundColor: theme.color[entry.ground[state] ?? 'bg'],
        }}
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
  const sections =
    only === null ? GALLERY_SECTIONS : GALLERY_SECTIONS.filter((entry) => entry.slug === only);
  return (
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
        <Text role="title" heading={1}>
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
