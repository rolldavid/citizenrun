import { brandVariant } from '@citizenrun/shared';
import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { getI18n } from './i18n';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { variant: 'staging' } } } }));

/** A loose view of `t`: the probe key is not in the typed catalog. */
type LooseT = (key: string) => string;

function Probe(): JSX.Element {
  const { t } = useTranslation();
  const loose = t as unknown as LooseT; // the probe key is not in the typed catalog
  return <span data-testid="fixture.probe">{loose('common:appNameProbe')}</span>;
}

describe('getI18n and react-i18next', () => {
  // The root error boundary's fallback renders outside I18nextProvider and relies on this (06b 3.1).
  it('useTranslation reads the app instance with no provider', () => {
    getI18n().addResource('en', 'common', 'appNameProbe', '{{appName}}');
    render(<Probe />);
    expect(screen.getByTestId('fixture.probe').textContent).toBe(
      brandVariant('staging').displayName,
    );
  });
});
