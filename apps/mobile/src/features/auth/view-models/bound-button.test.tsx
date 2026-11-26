import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';

import type { ProviderButtonAppearance } from '@/platform/auth';

import { createBoundButton } from './bound-button';
import type { ScreenButtonProps } from './bound-button';

const APPEARANCE: ProviderButtonAppearance = {
  appleStyle: 'black',
  googleTheme: 'outline',
  googleShape: 'rectangular',
  googleSize: 'large',
  width: 320,
  height: 44,
};

type ProbeProps = ScreenButtonProps & { nonceHash: string; disabled: boolean };

function probe(): {
  Probe: (props: ProbeProps) => JSX.Element;
  mounts: number[];
  props: ProbeProps[];
} {
  const mounts: number[] = [];
  const props: ProbeProps[] = [];
  function Probe(received: ProbeProps): JSX.Element {
    props.push(received);
    useEffect(() => {
      mounts.push(mounts.length + 1);
    }, []);
    return <span data-testid={received.testID} />;
  }
  return { Probe, mounts, props };
}

function screenProps(): ScreenButtonProps {
  return { appearance: APPEARANCE, testID: 'probe', accessibilityLabel: 'Probe' };
}

describe('createBoundButton', () => {
  it('renders nothing before a binding', () => {
    const { Probe, props } = probe();
    const { Button } = createBoundButton(Probe);
    const view = render(<Button {...screenProps()} />);
    expect(view.container.innerHTML).toBe('');
    expect(props).toEqual([]);
  });

  it('merges the binding with the screen props', () => {
    const { Probe, props } = probe();
    const { Button } = createBoundButton(Probe, { nonceHash: 'hash-one', disabled: false });
    const view = render(<Button {...screenProps()} />);
    expect(view.getByTestId('probe')).toBeTruthy();
    expect(props.at(-1)).toEqual({
      nonceHash: 'hash-one',
      disabled: false,
      appearance: APPEARANCE,
      testID: 'probe',
      accessibilityLabel: 'Probe',
    });
  });

  it('re-renders the same mounted button with a new binding', () => {
    const { Probe, mounts, props } = probe();
    const bound = createBoundButton(Probe);
    const { Button } = bound;
    const view = render(<Button {...screenProps()} />);
    act(() => {
      bound.bind({ nonceHash: 'hash-one', disabled: true });
    });
    const node = view.getByTestId('probe');
    act(() => {
      bound.bind({ nonceHash: 'hash-two', disabled: false });
    });

    expect(mounts).toEqual([1]);
    expect(props.map((received) => received.nonceHash)).toEqual(['hash-one', 'hash-two']);
    expect(props.at(-1)?.disabled).toBe(false);
    expect(view.getByTestId('probe')).toBe(node);
  });
});
