import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import { Text } from './text';
import type { TextProps } from './text';

export const STATES = {
  // One specimen per type role.
  display: { role: 'display', children: 'Wren County' },
  title: { role: 'title', children: 'County clerk' },
  heading: { role: 'heading', children: 'Offices near you' },
  body: { role: 'body', children: 'Filing opens in March and closes in May.' },
  bodyStrong: { role: 'bodyStrong', children: 'Carol Wynn' },
  label: { role: 'label', children: 'Filing closes Fri, Nov 27' },
  caption: { role: 'caption', children: 'Updated Mon, Nov 23' },
  captionStrong: { role: 'captionStrong', children: 'Alder city council' },
  monoLabel: { role: 'monoLabel', children: 'Cost to run' },
  mono: { role: 'mono', children: 'dana_okafor' },
  numeralHero: { role: 'numeralHero', children: '4' },
  numeralDisplay: { role: 'numeralDisplay', children: '1,204' },
  numeralTitle: { role: 'numeralTitle', children: '37' },
  numeralHeading: { role: 'numeralHeading', children: '12' },
  initialsSm: { role: 'initialsSm', children: 'CW' },
  initialsMd: { role: 'initialsMd', children: 'DO' },
  initialsLg: { role: 'initialsLg', children: 'A' },
  // The tones other than primary, each on the ground it is made for.
  secondary: { role: 'body', tone: 'secondary', children: 'Seat held since 2019' },
  inverse: { role: 'body', tone: 'inverse', children: '3 seats are open' },
  inverseSecondary: { role: 'body', tone: 'inverseSecondary', children: 'Nobody has filed yet' },
  onAccent: { role: 'body', tone: 'onAccent', children: 'Run for this office' },
  onHighlight: { role: 'body', tone: 'onHighlight', children: 'Closes in 5 days, on Fri, Nov 27' },
  danger: { role: 'body', tone: 'danger', children: 'Filing has closed' },
  success: { role: 'body', tone: 'success', children: 'Your filing was received' },
  disabled: { role: 'body', tone: 'disabled', children: 'Filing closed' },
  onMedia: { role: 'body', tone: 'onMedia', children: '2 of 5' },
  tabular: { role: 'numeralTitle', tabular: true, children: '1111 0808' },
  headingOne: { role: 'title', heading: 1, children: 'Wren County clerk' },
  twoLines: {
    role: 'body',
    numberOfLines: 2,
    children:
      'Filing for the Wren County clerk opens on the first Monday of March and closes at 5 p.m. on the last Wednesday of April.',
  },
  // A name the bundled face cannot draw: the whole string is set in the system font.
  fallback: { role: 'body', children: 'Nguyễn Văn An' },
  // A handle in the mono at the start of a caption.
  nested: {
    role: 'body',
    children: (
      <>
        <Text role="mono">dana_okafor</Text> Filed for the Alder city council this morning.
      </>
    ),
  },
  centered: { role: 'body', align: 'center', children: 'Nobody is running yet.' },
} as const satisfies Readonly<Record<string, TextProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {
  inverse: 'inverseBg',
  inverseSecondary: 'inverseBg',
  onAccent: 'accent',
  onHighlight: 'highlight',
  onMedia: 'mediaControlBg',
};
