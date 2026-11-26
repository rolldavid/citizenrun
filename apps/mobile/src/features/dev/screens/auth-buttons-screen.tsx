import { useState } from 'react';
import type { ComponentProps, JSX, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useAuthButtonsViewModel } from '@/features/dev/view-models/auth-buttons';
import type { AuthButtonsViewModel } from '@/features/dev/view-models/auth-buttons';
// Each module itself, not the design system's index: a module that two lazy routes share moves into
// the chunk every page loads, and the index carries every component (D-164).
import { Rule } from '@/ui/components/rule';
import { Text } from '@/ui/components/text';
import { AppBarInset } from '@/ui/shells/app-bar';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { rule, size, space } from '@/ui/tokens';

/** How a provider draws its own button, read from the view-model's component reference (PC6C-18). */
type Appearance = ComponentProps<AuthButtonsViewModel['apple']>['appearance'];
type Variants = Pick<Appearance, 'appleStyle' | 'googleTheme'>;

/** One pairing of the two buttons on the ground it is made for. */
type Pairing = {
  id: string;
  title: string;
  note: string;
  ground: 'light' | 'dark';
  variants: Variants;
  /** False where the specimen shows a style of Apple's button alone. */
  google: boolean;
};

const PAIRINGS: readonly Pairing[] = [
  {
    id: 'light',
    title: 'Light pairing',
    note: 'Apple black, Google outline, on the light ground.',
    ground: 'light',
    variants: { appleStyle: 'black', googleTheme: 'outline' },
    google: true,
  },
  {
    id: 'dark',
    title: 'Dark pairing',
    note: 'Apple white, Google filled black, on the dark ground.',
    ground: 'dark',
    variants: { appleStyle: 'white', googleTheme: 'filled_black' },
    google: true,
  },
  {
    id: 'outline',
    title: 'Apple, white with outline',
    note: 'The third Apple style, which no screen asks for, on the light ground.',
    ground: 'light',
    variants: { appleStyle: 'white_outline', googleTheme: 'outline' },
    google: false,
  },
];

/** The narrow width every button is also shown at, in points. */
const NARROW_WIDTH = 280;

const HEADER_RULE: ViewStyle = { marginVertical: space.x6 };
const SECTION: ViewStyle = { marginBottom: space.x8 };
const SECTION_BODY: ViewStyle = { marginTop: space.x3 };
const FRAME: ViewStyle = { padding: space.x4, borderWidth: rule.hairline };
// The room inside the frame, with one width of the buttons under the other.
const ROOM: ViewStyle = { width: '100%', gap: space.x6 };
// The column the buttons stand in: flush left, one above the other.
const SPECIMEN: ViewStyle = { gap: space.x3, alignItems: 'flex-start' };

/** One section of the screen: its heading, a line about what it holds, and the specimens. */
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

function offered(answer: boolean | null): string {
  if (answer === null) {
    return 'asking';
  }
  return answer ? 'offered' : 'not offered';
}

type SpecimenProps = {
  vm: AuthButtonsViewModel;
  pairing: Pairing;
  /** `full` or `narrow`: part of each button's id. */
  name: string;
  label: string;
  width: number;
};

/** The buttons of one pairing at one width, under the width's label. */
function Specimen({ vm, pairing, name, label, width }: SpecimenProps): JSX.Element {
  const { apple: Apple, google: Google } = vm;
  const appearance: Appearance = {
    ...pairing.variants,
    googleShape: 'rectangular',
    googleSize: 'large',
    width,
    height: size.target,
  };
  return (
    <View style={SPECIMEN}>
      <Text role="monoLabel">{label}</Text>
      <Apple
        appearance={appearance}
        testID={`auth-buttons.${pairing.id}-apple-${name}`}
        accessibilityLabel="Continue with Apple"
      />
      {pairing.google ? (
        <Google
          appearance={appearance}
          testID={`auth-buttons.${pairing.id}-google-${name}`}
          accessibilityLabel="Continue with Google"
        />
      ) : null}
    </View>
  );
}

/** The frame of one pairing, on the page ground of the theme the pairing is made for. */
function PairingFrame({
  vm,
  pairing,
}: {
  vm: AuthButtonsViewModel;
  pairing: Pairing;
}): JSX.Element {
  const theme = useTheme();
  // The room inside the frame, once it is known: the buttons are drawn at widths in points.
  const [room, setRoom] = useState<number | null>(null);
  return (
    <View
      style={[FRAME, { backgroundColor: theme.color.bg, borderColor: theme.color.rule }]}
      testID={`auth-buttons.${pairing.id}`}
    >
      <View
        style={ROOM}
        onLayout={(event) => {
          setRoom(event.nativeEvent.layout.width);
        }}
      >
        {room === null ? null : (
          <>
            <Specimen
              vm={vm}
              pairing={pairing}
              name="full"
              label="Full column width"
              width={Math.min(room, size.authButtonMax)}
            />
            <Specimen
              vm={vm}
              pairing={pairing}
              name="narrow"
              label="280 points"
              width={Math.min(room, NARROW_WIDTH)}
            />
          </>
        )}
      </View>
    </View>
  );
}

function AuthButtonsPage({ vm }: { vm: AuthButtonsViewModel }): JSX.Element {
  const layout = useBreakpoint();
  const { availability } = vm;
  return (
    <>
      {/* The screen draws no bar: the top inset keeps its heading clear of the status bar. */}
      <AppBarInset />
      <ScrollView
        testID="auth-buttons.scroll"
        contentContainerStyle={{
          alignSelf: 'center',
          width: '100%',
          maxWidth: size.feedColumn,
          paddingHorizontal: layout.gutter,
          paddingTop: space.x6,
          paddingBottom: space.x12,
        }}
      >
        <View role="main">
          <Text role="title" heading={1}>
            Sign-in buttons
          </Text>
          <Text role="caption" tone="secondary">
            The two buttons the sign-in module draws, as this build and device draw them. A press
            starts no sign-in.
          </Text>
          <View style={HEADER_RULE}>
            <Rule variant="strong" />
          </View>
          <Section
            title="Availability"
            note="What the module answers here. A provider that is not offered may draw nothing below."
          >
            <View testID="auth-buttons.availability">
              <Text role="mono">{`apple: ${offered(availability?.apple ?? null)}`}</Text>
              <Text role="mono">{`google: ${offered(availability?.google ?? null)}`}</Text>
            </View>
          </Section>
          {PAIRINGS.map((pairing) => (
            <Section key={pairing.id} title={pairing.title} note={pairing.note}>
              <ThemeProvider choice={pairing.ground}>
                <PairingFrame vm={vm} pairing={pairing} />
              </ThemeProvider>
            </Section>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

/**
 * The sign-in buttons the platform module draws, which exist only on phones, laid out for review
 * against the providers' own button rules: each pairing on its ground, at the full column width
 * and at 280 points. It never ships to users, so its own labels are English.
 */
export function AuthButtonsScreen(): JSX.Element {
  const vm = useAuthButtonsViewModel();
  return <AuthButtonsPage vm={vm} />;
}
