import { screen } from '@testing-library/react';
import type { JSX } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';

import { renderWithProviders, setViewport } from './render';

// This file reads the safe area itself, before the test render is loaded, so it names the build
// the test render uses: the one module both then share.
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);

const PROBE = 'probe.breakpoint';

/** Writes what the layout hook answers: the breakpoint and the window's size. */
function BreakpointProbe(): JSX.Element {
  const layout = useBreakpoint();
  return (
    <Text role="mono" testID={PROBE}>
      {`${layout.breakpoint} ${String(layout.width)} ${String(layout.height)}`}
    </Text>
  );
}

/** Writes the insets a component under the test render reads. */
function InsetsProbe(): JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Text role="mono" testID="probe.insets">
      {[insets.top, insets.right, insets.bottom, insets.left].join(' ')}
    </Text>
  );
}

describe('setViewport', () => {
  it('setViewport moves the breakpoint', () => {
    setViewport(1440, 900);
    renderWithProviders(<BreakpointProbe />);
    expect(screen.getByTestId(PROBE).textContent).toBe('expanded 1440 900');

    // A mounted screen follows the window as it changes.
    setViewport(390, 844);
    expect(screen.getByTestId(PROBE).textContent).toBe('compact 390 844');
    setViewport(820, 1180);
    expect(screen.getByTestId(PROBE).textContent).toBe('medium 820 1180');
  });

  it('the size stays until it is set again', () => {
    setViewport(1440, 900);
    const first = renderWithProviders(<BreakpointProbe />);
    expect(screen.getByTestId(PROBE).textContent).toBe('expanded 1440 900');
    first.unmount();
    renderWithProviders(<BreakpointProbe />);
    expect(screen.getByTestId(PROBE).textContent).toBe('expanded 1440 900');
    expect(window.innerWidth).toBe(1440);
    expect(window.innerHeight).toBe(900);
  });
});

describe('renderWithProviders', () => {
  it('gives its tree a safe area with no insets', () => {
    // Without a provider above it the hook throws.
    renderWithProviders(<InsetsProbe />);
    expect(screen.getByTestId('probe.insets').textContent).toBe('0 0 0 0');
  });
});
