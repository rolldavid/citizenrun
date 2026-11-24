import { cleanup, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { defineScreen, defineStaticScreen } from '@/features/dev/screen-fixtures';
import type { ScreenRegistryEntry } from '@/features/dev/screen-fixtures';
import { renderWithProviders } from '@/test/render';
import { Text } from '@/ui/components/text';

import { FixtureScreen } from './fixture-screen';

type StubVm = { label: string };

function StubView({ vm }: { vm: StubVm }): JSX.Element {
  return (
    <Text role="body" testID="stub.label">
      {vm.label}
    </Text>
  );
}

function StaticView(): JSX.Element {
  return (
    <Text role="body" testID="static.body">
      Static
    </Text>
  );
}

const STUB_FIXTURES = { stubReady: { label: 'Ready' }, stubLong: { label: 'Long' } } as const;

const REGISTRY: Readonly<Record<string, ScreenRegistryEntry>> = {
  stub: defineScreen(StubView, STUB_FIXTURES),
  static: defineStaticScreen(StaticView, ['staticDefault']),
};

/** The text of the unknown-pair line, or null when it is not drawn. */
function unknownLine(): string | null {
  return screen.queryByTestId('dev.fixture-unknown')?.textContent ?? null;
}

afterEach(() => {
  cleanup();
});

describe('FixtureScreen', () => {
  it('shows the unknown line for a pair the default registry does not hold', () => {
    renderWithProviders(<FixtureScreen screen="hello" fixture="nope" />);
    expect(unknownLine()).toBe('No fixture "nope" for screen "hello".');
  });

  it('renders a known pair through defineScreen with that fixture', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />);
    expect(screen.getByTestId('stub.label').textContent).toBe('Ready');
    expect(unknownLine()).toBeNull();
  });

  it('renders another fixture of the same screen with its own view-model', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubLong" registry={REGISTRY} />);
    expect(screen.getByTestId('stub.label').textContent).toBe('Long');
  });

  it('shows the unknown line for a fixture the screen does not list', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="other" registry={REGISTRY} />);
    expect(unknownLine()).toBe('No fixture "other" for screen "stub".');
    expect(screen.queryByTestId('stub.label')).toBeNull();
  });

  it('renders a static screen for its listed fixture only', () => {
    renderWithProviders(
      <FixtureScreen screen="static" fixture="staticDefault" registry={REGISTRY} />,
    );
    expect(screen.getByTestId('static.body').textContent).toBe('Static');
    cleanup();
    renderWithProviders(
      <FixtureScreen screen="static" fixture="staticOther" registry={REGISTRY} />,
    );
    expect(screen.queryByTestId('static.body')).toBeNull();
    expect(unknownLine()).toBe('No fixture "staticOther" for screen "static".');
  });

  it('treats inherited object keys as unknown screens and fixtures', () => {
    renderWithProviders(
      <FixtureScreen screen="constructor" fixture="stubReady" registry={REGISTRY} />,
    );
    expect(unknownLine()).toBe('No fixture "stubReady" for screen "constructor".');
    cleanup();
    renderWithProviders(<FixtureScreen screen="stub" fixture="toString" registry={REGISTRY} />);
    expect(unknownLine()).toBe('No fixture "toString" for screen "stub".');
  });
});

describe('the registry helpers', () => {
  it('lists the fixture names of each entry', () => {
    expect(REGISTRY.stub?.fixtures).toEqual(['stubReady', 'stubLong']);
    expect(REGISTRY.static?.fixtures).toEqual(['staticDefault']);
  });

  it('render returns null for a name the entry does not hold', () => {
    expect(REGISTRY.stub?.render('stubReady')).not.toBeNull();
    expect(REGISTRY.stub?.render('missing')).toBeNull();
    expect(REGISTRY.static?.render('staticDefault')).not.toBeNull();
    expect(REGISTRY.static?.render('missing')).toBeNull();
  });

  it('a static entry keeps its names when the caller changes its own list', () => {
    const names = ['first'];
    const entry = defineStaticScreen(StaticView, names);
    names.push('second');
    expect(entry.fixtures).toEqual(['first']);
    expect(entry.render('second')).toBeNull();
  });
});
