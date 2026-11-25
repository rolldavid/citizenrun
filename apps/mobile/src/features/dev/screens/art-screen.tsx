import { IssueIconSvg } from '@citizenrun/cards';
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

// Each module itself, not the design system's index: a module that two lazy routes share moves into
// the chunk every page loads, and the index carries every component (D-164).
import { Button } from '@/ui/components/button';
import { EmptyChair } from '@/ui/components/empty-chair';
import { IssueChip } from '@/ui/components/issue-chip';
import { IssueTile } from '@/ui/components/issue-tile';
import { Rule } from '@/ui/components/rule';
import { Text } from '@/ui/components/text';
import { Wordmark } from '@/ui/components/wordmark';
import type { WordmarkProps } from '@/ui/components/wordmark';
import { AppBarInset } from '@/ui/shells/app-bar';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { ThemeProvider, useTheme } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';
import { ISSUE_IDS, rule, size, space } from '@/ui/tokens';
import type { IssueId } from '@/ui/tokens';

type TextScale = 1 | 1.3;

/** The short name a chip prints for each issue. Specimen text of this screen, not the catalog. */
const SHORT_NAMES: Readonly<Record<IssueId, string>> = {
  'rent-housing': 'Rent',
  'utility-bills': 'Utility bills',
  'data-centers-ai': 'Data centers',
  climate: 'Climate',
  'corporate-subsidies': 'Corporate subsidies',
  'property-taxes': 'Property taxes',
  'wages-workers': 'Wages',
  'policing-justice': 'Policing',
  healthcare: 'Healthcare',
  'medicare-for-all': 'Medicare for All',
  schools: 'Schools',
  'water-land': 'Water and land',
  transit: 'Transit',
  'voting-access': 'Voting access',
  'money-in-politics': 'Money in politics',
  nominations: 'Nominations',
  'public-money': 'Public money',
  'defund-israel': 'Defunding Israel',
  'foreign-wars': 'Foreign wars',
};

/** The three sizes an issue icon is drawn at by itself. */
const ICON_SIZES = ['small', 'medium', 'standard'] as const;

/** The four marks of the identity: the name at its three cap heights, and the two letters. */
const MARKS: readonly (Pick<WordmarkProps, 'variant' | 'capHeight'> & { name: string })[] = [
  { name: 'wordmark-minimum', variant: 'wordmark', capHeight: size.wordmarkCap.minimum },
  { name: 'wordmark-app-bar', variant: 'wordmark', capHeight: size.wordmarkCap.appBar },
  { name: 'wordmark-rail', variant: 'wordmark', capHeight: size.wordmarkCap.rail },
  { name: 'monogram-rail', variant: 'monogram', capHeight: size.monogramRail },
];

type ControlOption<T> = { value: T; label: string; testID: string };

const THEME_OPTIONS: readonly ControlOption<ThemeChoice>[] = [
  { value: 'system', label: 'System', testID: 'art.theme-system' },
  { value: 'light', label: 'Light', testID: 'art.theme-light' },
  { value: 'dark', label: 'Dark', testID: 'art.theme-dark' },
];

const TEXT_OPTIONS: readonly ControlOption<TextScale>[] = [
  { value: 1, label: '100%', testID: 'art.text-100' },
  { value: 1.3, label: '130%', testID: 'art.text-130' },
];

// The header is the gallery's: the same two controls, drawn the same way. They are written out
// here because a module that two routes share is loaded with every page of the app, and the
// gallery's module holds every specimen.
const CONTROLS: ViewStyle = { marginTop: space.x4, gap: space.x2 };
const CONTROL_ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
// One column for the two labels, so the buttons line up.
const CONTROL_LABEL: ViewStyle = { minWidth: size.railIcon };
const CONTROL_BUTTONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  flexShrink: 1,
  gap: space.x2,
};
const HEADER_RULE: ViewStyle = { marginVertical: space.x6 };

const SECTION: ViewStyle = { marginBottom: space.x8 };
const SECTION_BODY: ViewStyle = { marginTop: space.x3 };
const ICON_ROW: ViewStyle = {
  paddingVertical: space.x3,
  borderBottomWidth: rule.hairline,
  gap: space.x3,
};
const ICON_ROW_ONE_LINE: ViewStyle = { flexDirection: 'row', alignItems: 'center' };
const DRAWN_ALONE: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x3 };
// One column for the 19 ids, so the icons of every row stand in line.
const ID_COLUMN: ViewStyle = { width: size.rightColumn / 2 };
const CHIPS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  flexShrink: 1,
  gap: space.x2,
};
const HOVER_PANEL: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: space.x4,
  padding: space.x4,
};
const TILE_WITH_ID: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
// A mark keeps its cap height clear on every side: the rail's 20 points fit in 24.
const MARKS_ROW: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: space.x6,
  padding: space.x6,
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

/** One section of the sheet: its heading, a line about what it holds, and the drawings. */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <View style={SECTION}>
      <Text role="heading" heading={2}>
        {title}
      </Text>
      <Text role="caption" tone="secondary">
        {note}
      </Text>
      <View style={SECTION_BODY}>{children}</View>
    </View>
  );
}

/** One issue: its id, its icon alone at the three sizes, its tile, and its chip at both sizes. */
function IssueRow({ id }: { id: IssueId }): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  // At compact the chips go under the icons; from medium up the row is one line.
  const oneLine = layout.breakpoint !== 'compact';
  return (
    <View
      style={[
        ICON_ROW,
        oneLine ? ICON_ROW_ONE_LINE : null,
        { borderBottomColor: theme.color.ruleSoft },
      ]}
      testID={`art.issue-${id}`}
    >
      <View style={DRAWN_ALONE}>
        <View style={ID_COLUMN}>
          <Text role="mono">{id}</Text>
        </View>
        {ICON_SIZES.map((name) => (
          <View key={name} testID={`art.icon-${id}-${name}`}>
            <IssueIconSvg id={id} size={size.icon[name]} fill={theme.color.text} />
          </View>
        ))}
        <View testID={`art.tile-${id}`}>
          <IssueTile issueId={id} />
        </View>
      </View>
      <View style={CHIPS}>
        <IssueChip issueId={id} name={SHORT_NAMES[id]} size="sm" testID={`art.chip-sm-${id}`} />
        <IssueChip issueId={id} name={SHORT_NAMES[id]} size="md" testID={`art.chip-md-${id}`} />
      </View>
    </View>
  );
}

/** The four marks in one tone, on the ground that tone is made for. */
function Marks({ tone }: { tone: NonNullable<WordmarkProps['tone']> }): JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[MARKS_ROW, tone === 'inverse' ? { backgroundColor: theme.color.inverseBg } : null]}
    >
      {MARKS.map((mark) => (
        <View key={mark.name} testID={`art.${mark.name}-${tone}`}>
          <Wordmark variant={mark.variant} capHeight={mark.capHeight} tone={tone} />
        </View>
      ))}
    </View>
  );
}

type ArtPageProps = {
  theme: ThemeChoice;
  textScale: TextScale;
  onTheme: (value: ThemeChoice) => void;
  onTextScale: (value: TextScale) => void;
};

/** The header with its two controls, then the drawings. Drawn inside the sheet's own theme. */
function ArtPage({ theme, textScale, onTheme, onTextScale }: ArtPageProps): JSX.Element {
  const colors = useTheme().color;
  const layout = useBreakpoint();
  return (
    <>
      {/* The sheet draws no bar: the top inset keeps its heading clear of the status bar. */}
      <AppBarInset />
      <ScrollView
        testID="art.scroll"
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
            Art
          </Text>
          <View style={CONTROLS}>
            <ControlRow label="Theme" options={THEME_OPTIONS} selected={theme} onSelect={onTheme} />
            <ControlRow
              label="Text"
              options={TEXT_OPTIONS}
              selected={textScale}
              onSelect={onTextScale}
            />
          </View>
          <View style={HEADER_RULE}>
            <Rule variant="strong" />
          </View>
          <Section
            title="Issue icons"
            note="Each of the 19 issues: its icon alone at 16, 20 and 24 points, its tile, and its chip at both sizes."
          >
            {ISSUE_IDS.map((id) => (
              <IssueRow key={id} id={id} />
            ))}
          </Section>
          <Section
            title="Tiles on a hovered ground"
            note="On the hover fill every tile carries its keyline."
          >
            <View style={[HOVER_PANEL, { backgroundColor: colors.hoverBg }]}>
              {ISSUE_IDS.map((id) => (
                <View key={id} style={TILE_WITH_ID} testID={`art.keyline-tile-${id}`}>
                  <IssueTile issueId={id} keyline={true} />
                  <Text role="mono">{id}</Text>
                </View>
              ))}
            </View>
          </Section>
          <Section title="Empty chair" note="The one drawing of an empty state, at its own size.">
            <View testID="art.empty-chair">
              <EmptyChair />
            </View>
          </Section>
          <Section
            title="Wordmark"
            note="The name at cap heights 14, 17 and 20, and the 2 letters at 20, on the page and on ink."
          >
            <Marks tone="primary" />
            <Marks tone="inverse" />
          </Section>
        </View>
      </ScrollView>
    </>
  );
}

/**
 * The art contact sheet: every drawing the app holds so far, laid out for review in the active
 * theme. It fetches nothing and never ships to users, so its own labels are English.
 */
export function ArtScreen(): JSX.Element {
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [textScale, setTextScale] = useState<TextScale>(1);
  return (
    <ThemeProvider choice={theme} textScale={textScale}>
      <ArtPage theme={theme} textScale={textScale} onTheme={setTheme} onTextScale={setTextScale} />
    </ThemeProvider>
  );
}
