import { cleanup, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { describedByProps } from './field-shell';
import { FormField, useFieldA11y } from './form-field';
import type { FormFieldProps } from './form-field';
import { GROUND, PREVIEW, STATES } from './form-field.fixtures';
import { InteractionPreview } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = ['labelOnly', 'withHelper', 'error', 'valid', 'labelHidden'] as const;

const COMPACT = [390, 844] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.control';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one field, in place of whatever was drawn before. */
function draw(props: FormFieldProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  return renderWithProviders(<FormField {...props} />, options).container;
}

/** The control a state's fixture draws: a group that takes the field's name. */
function controlOf(container: HTMLElement): HTMLElement {
  return within(container).getByRole('group');
}

/** A control of a feature's own, as a screen would write one. */
function ProbeControl(): JSX.Element {
  const { describedBy, ...named } = useFieldA11y();
  return (
    <View
      {...named}
      {...describedByProps(describedBy)}
      accessible={true}
      role="group"
      testID={PROBE}
    />
  );
}

/** The shapes an icon draws, to tell one icon from another. */
function iconOf(container: HTMLElement): string | undefined {
  return container.querySelector('svg')?.innerHTML;
}

describe('FormField', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          cleanup();
          const view = renderWithProviders(
            <InteractionPreview state={PREVIEW[state] ?? {}}>
              <FormField {...STATES[state]} />
            </InteractionPreview>,
            { theme, textScale: scale },
          );
          const name = `${state} ${theme} ${String(scale)}`;
          const control = controlOf(view.container);
          expect(control.style.height, name).toBe(`${String(size.input)}px`);
          const label = within(view.container).queryByText(STATES[state].label);
          expect(label === null, name).toBe(state === 'labelHidden');
          expect(label?.style.fontSize ?? '', name).toBe(
            state === 'labelHidden' ? '' : `${String(14 * scale)}px`,
          );
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the five states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    const states: Readonly<Record<StateName, FormFieldProps>> = STATES;
    expect(states.labelOnly.helper).toBeUndefined();
    expect(states.withHelper.helper).toBe('Pick the seat that is on your ballot.');
    expect(states.error.status).toBe('error');
    expect(states.valid.status).toBe('valid');
    expect(states.labelHidden.labelHidden).toBe(true);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const container = draw(STATES[state]);
      // The control is the caller's: the field gives it its name, and keeps the role it has.
      const control = controlOf(container);
      expect(control.getAttribute('aria-label'), state).toBe(STATES[state].label);
      const labelledBy = control.getAttribute('aria-labelledby');
      if (state === 'labelHidden') {
        expect(labelledBy, state).toBeNull();
      } else {
        expect(container.querySelector(`[id="${labelledBy ?? ''}"]`)?.textContent, state).toBe(
          STATES[state].label,
        );
      }
      // The line that describes it is the one the field draws under it.
      const describedBy = control.getAttribute('aria-describedby');
      if (state === 'labelOnly') {
        expect(describedBy, state).toBeNull();
      } else {
        const line = container.querySelector(`[id="${describedBy ?? ''}"]`);
        const states: Readonly<Record<StateName, FormFieldProps>> = STATES;
        expect(line?.textContent, state).toBe(states[state].statusText ?? states[state].helper);
      }
    }
  });

  it('has a testID', () => {
    // The field draws nothing a person can press or type into: its one control is the caller's,
    // and it keeps the id the caller gave it.
    cleanup();
    const view = renderWithProviders(
      <FormField label="Office you are running for" helper="Pick the seat that is on your ballot.">
        <ProbeControl />
      </FormField>,
    );
    const control = screen.getByTestId(PROBE);
    expect(PROBE).toMatch(TEST_ID);
    expect(control.getAttribute('aria-label')).toBe('Office you are running for');
    const line = view.container.querySelector(
      `[id="${control.getAttribute('aria-describedby') ?? ''}"]`,
    );
    expect(line?.textContent).toBe('Pick the seat that is on your ballot.');
    const pressable = view.container.querySelectorAll(
      'button, a, input, textarea, select, [role="button"], [role="link"], [tabindex]',
    );
    expect(pressable).toHaveLength(0);
    for (const state of STATE_NAMES) {
      const container = draw(STATES[state]);
      expect(
        container.querySelectorAll('button, a, input, textarea, select, [tabindex]'),
        state,
      ).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    // Nothing of the field moves: with or without motion it is drawn at once, at full strength.
    for (const reducedMotion of [false, true]) {
      for (const state of STATE_NAMES) {
        const container = draw(STATES[state], { reducedMotion });
        for (const part of container.querySelectorAll<HTMLElement>('*')) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(['', '1'], state).toContain(part.style.opacity);
        }
      }
    }
  });

  it('every status line', () => {
    for (const theme of ['light', 'dark'] as const) {
      // The helper, in the secondary color, with no icon.
      const helped = draw(STATES.withHelper, { theme });
      const helper = within(helped).getByText(STATES.withHelper.helper);
      expect(helper.style.color).toBe(written(color[theme].textSecondary));
      expect(helped.querySelector('svg')).toBeNull();
      expect(helped.querySelector('[role="alert"]')).toBeNull();

      // An error: its sentence in danger behind the warning icon, in the helper's place, said at once.
      const failed = draw(STATES.error, { theme });
      expect(within(failed).queryByText(STATES.error.helper)).toBeNull();
      const error = within(failed).getByText(STATES.error.statusText);
      expect(error.style.color).toBe(written(color[theme].danger));
      expect(error.closest('[role="alert"]')).not.toBeNull();
      expect(failed.querySelectorAll('svg')).toHaveLength(1);
      const warning = iconOf(failed);

      // A valid state: its sentence in success behind the check icon, and no alert.
      const passed = draw(STATES.valid, { theme });
      expect(within(passed).queryByText(STATES.valid.helper)).toBeNull();
      const valid = within(passed).getByText(STATES.valid.statusText);
      expect(valid.style.color).toBe(written(color[theme].success));
      expect(passed.querySelector('[role="alert"]')).toBeNull();
      expect(passed.querySelectorAll('svg')).toHaveLength(1);
      expect(iconOf(passed)).not.toBe(warning);
      for (const container of [failed, passed]) {
        expect(container.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull();
      }
    }
  });

  it('a hidden label is not drawn and still names the control', () => {
    const container = draw(STATES.labelHidden);
    expect(within(container).queryByText(STATES.labelHidden.label)).toBeNull();
    expect(within(container).getByRole('group', { name: STATES.labelHidden.label })).toBeDefined();
    expect(within(container).getByText(STATES.labelHidden.helper)).toBeDefined();
  });
});
