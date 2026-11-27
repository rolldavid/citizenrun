import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { color, rule, size, space } from '@/ui/tokens';

import { SourcesSheet } from './sources-sheet';
import type { SourcesSheetProps } from './sources-sheet';
import { GROUND, PREVIEW, STATES } from './sources-sheet.fixtures';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
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

const STATE_NAMES = ['card', 'page', 'lowNoLink', 'withCredit', 'withFooter'] as const;

const ALL: Readonly<Record<StateName, SourcesSheetProps>> = STATES;

const COMPACT = [360, 740] as const;
const EXPANDED = [1440, 900] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const WORDS = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one sheet, in place of whatever was drawn before, and gives back its frame. */
function draw(props: SourcesSheetProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<SourcesSheet {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The block of one source: the box round the words that say what it covers. */
function blockOf(frame: HTMLElement, covers: string): HTMLElement {
  const block = within(frame).getByText(covers).parentElement;
  if (block === null) {
    throw new Error(`no block for ${covers}`);
  }
  return block;
}

describe('SourcesSheet', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      for (const theme of ['light', 'dark'] as const) {
        for (const state of STATE_NAMES) {
          const frame = draw(ALL[state], { theme });
          const name = `${state} ${theme} ${String(viewport[0])}`;
          for (const [index, source] of ALL[state].sources.entries()) {
            const block = blockOf(frame, source.covers);
            // 12 points above and below, and a soft rule between one source and the next.
            expect(block.style.paddingTop, name).toBe(`${String(space.x3)}px`);
            expect(block.style.paddingBottom, name).toBe(`${String(space.x3)}px`);
            if (index === 0) {
              expect(block.style.borderTopWidth, name).toBe('');
            } else {
              expect(block.style.borderTopWidth, name).toBe(`${String(rule.hairline)}px`);
              expect(block.style.borderTopColor, name).toBe(written(color[theme].ruleSoft));
            }
            // What it covers, its confidence, and its line in grey mono.
            expect(within(block).getByText(WORDS[source.confidence]), name).toBeTruthy();
            const line = within(block).getByText(source.line);
            expect(line.style.fontFamily, name).toContain('ChivoMono');
            expect(line.style.color, name).toBe(written(color[theme].textSecondary));
          }
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
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.sources-sheet-${kebab(state)}`);
      expect(ALL[state].open, state).toBe(true);
      expect(ALL[state].title, state).toBe('Sources');
    }
    expect(STATES.card.sources.map((source) => source.id)).toEqual(['pay', 'filing', 'votes']);
    expect(STATES.lowNoLink.sources[0]).toMatchObject({
      confidence: 'low',
      url: null,
      domain: null,
    });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      for (const state of STATE_NAMES) {
        const frame = draw(ALL[state]);
        // The sheet is the dialog, named by its title.
        expect(screen.getByRole('dialog', { name: 'Sources' }), state).toBe(frame);
        expect(within(frame).getByRole('heading', { name: 'Sources' }), state).toBeTruthy();
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const frame = draw(ALL[state]);
      expect(frame.getAttribute('data-testid'), state).toMatch(TEST_ID);
      // Every link carries the sheet's id, the word "link" and its source's id.
      for (const source of ALL[state].sources) {
        const link = within(frame).queryByTestId(`${ALL[state].testID}-link-${source.id}`);
        expect(link === null, `${state} ${source.id}`).toBe(source.url === null);
      }
      for (const target of frame.querySelectorAll('a, [role="button"], [role="link"]')) {
        expect(target.getAttribute('data-testid'), state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    // With reduced motion the sheet fades and does not rise.
    const still = draw(STATES.card, { reducedMotion: true });
    expect(still.style.transform).toBe('');
    expect(still.style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.sheet);
    });
    expect(still.style.transform).toBe('');
    expect(still.style.opacity).toBe('1');
    // Without it the sheet rises from under the bottom edge; nothing inside it moves either way.
    const rising = draw(STATES.card);
    expect(rising.style.transform).toBe('translateY(100%)');
    act(() => {
      vi.advanceTimersByTime(motion.duration.sheet);
    });
    expect(rising.style.transform).toBe('translateY(0%)');
    for (const source of STATES.card.sources) {
      const block = blockOf(rising, source.covers);
      for (const part of [block, ...block.querySelectorAll<HTMLElement>('*')]) {
        expect(part.style.transform).toBe('');
        expect(part.style.animationName).toBe('');
      }
    }
    vi.useRealTimers();
  });

  it('one block per source in order', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.card);
    const blocks = ['Pay', 'Filing', 'Votes'].map((covers) => blockOf(frame, covers));
    expect(blocks[0]?.parentElement).toBe(blocks[1]?.parentElement);
    const drawn = [...(blocks[0]?.parentElement?.children ?? [])].slice(0, 3);
    expect(drawn).toEqual(blocks);
    // Each block: what it covers, the confidence in words, and the line.
    expect(blocks.map((block) => block.firstElementChild?.textContent)).toEqual([
      'Pay',
      'Filing',
      'Votes',
    ]);
    expect(within(blocks[0] as HTMLElement).getByText('High confidence')).toBeTruthy();
    expect(within(blocks[1] as HTMLElement).getByText('Medium confidence')).toBeTruthy();
    expect(
      within(blocks[0] as HTMLElement).getByText('Pay: wrencounty.example, Mon, Nov 9.'),
    ).toBeTruthy();
    expect(
      within(blocks[1] as HTMLElement).getByText('Filing: wrencounty.example, Mon, Nov 9.'),
    ).toBeTruthy();
    expect(
      within(blocks[2] as HTMLElement).getByText('wrencounty.example. Checked Mon, Nov 9.'),
    ).toBeTruthy();
    // Three pips beside each confidence.
    for (const block of blocks) {
      const pips = [...block.querySelectorAll<HTMLElement>('*')].filter(
        (part) => part.style.width === `${String(size.confidencePip.width)}px`,
      );
      expect(pips).toHaveLength(size.confidencePips);
    }
  });

  it('quote in quotation marks', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.card);
    const quote = within(frame).getByText('“The treasurer is paid $52,900 a year.”');
    expect(blockOf(frame, 'Pay').contains(quote)).toBe(true);
    // A source with no quote draws none.
    expect(blockOf(frame, 'Filing').textContent).not.toContain('“');
    expect(blockOf(frame, 'Votes').textContent).not.toContain('“');
  });

  it('domain as an outside link', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.card);
    const links = within(frame).getAllByRole('link', {
      name: 'wrencounty.example, opens in your browser',
    });
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual([
      'gallery.sources-sheet-card-link-pay',
      'gallery.sources-sheet-card-link-filing',
      'gallery.sources-sheet-card-link-votes',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      STATES.card.sources.map((source) => source.url),
    );
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
      expect(link.textContent).toBe('wrencounty.example');
    }
    // A low confidence source with no link draws none, and its line says so.
    const low = draw(STATES.lowNoLink);
    expect(within(low).queryAllByRole('link')).toHaveLength(0);
    expect(within(low).getByText('No link to the source. Checked Mon, Nov 9.')).toBeTruthy();
  });

  it('caution, credit and footer', () => {
    setViewport(...COMPACT);
    const card = draw(STATES.card);
    const caution = within(card).getByText('Confirm with your election office.');
    expect(
      blockOf(card, 'Votes').compareDocumentPosition(caution) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(caution.parentElement?.style.marginTop).toBe(`${String(space.x6)}px`);

    const credited = draw(STATES.withCredit, { theme: 'dark' });
    const credit = within(credited).getByText('Photo: Fixture Photographer, CC BY 4.0, cropped');
    expect(credit.style.fontFamily).toContain('ChivoMono');
    expect(credit.style.color).toBe(written(color.dark.textSecondary));
    expect(
      blockOf(credited, 'Holder').compareDocumentPosition(credit) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const footed = draw(STATES.withFooter);
    const report = within(footed).getByRole('button', { name: 'Report a mistake' });
    expect(report.getAttribute('data-testid')).toBe('gallery.sources-sheet-with-footer-report');
    expect(
      blockOf(footed, 'Pay').compareDocumentPosition(report) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The three together stand in that order under the last source.
    const all = draw({
      ...STATES.withFooter,
      caution: 'Confirm with your election office.',
      credit: 'Photo: Fixture Photographer, CC BY 4.0, cropped',
    });
    const parts = [
      within(all).getByText('Confirm with your election office.'),
      within(all).getByText('Photo: Fixture Photographer, CC BY 4.0, cropped'),
      within(all).getByRole('button', { name: 'Report a mistake' }),
    ];
    for (const [index, part] of parts.entries()) {
      const next = parts[index + 1];
      if (next !== undefined) {
        expect(part.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
    // A sheet with none of them draws none.
    const page = draw(STATES.page);
    expect(within(page).queryByText('Confirm with your election office.')).toBeNull();
    expect(within(page).queryAllByRole('button', { name: 'Report a mistake' })).toHaveLength(0);
  });

  it('a sure source without a link throws', () => {
    setViewport(...COMPACT);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const confidence of ['high', 'medium'] as const) {
      cleanup();
      expect(() => {
        renderWithProviders(
          <SourcesSheet
            {...STATES.page}
            sources={[{ ...STATES.page.sources[0], confidence, url: null, domain: null }]}
          />,
        );
      }, confidence).toThrow('A high or medium confidence source always has its link.');
    }
    errors.mockRestore();
    // A low confidence source may have none.
    expect(draw(STATES.lowNoLink)).toBeTruthy();
  });

  it('closes like any sheet', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    draw({ ...STATES.card, onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Closed, it draws nothing.
    cleanup();
    renderWithProviders(<SourcesSheet {...STATES.card} open={false} />);
    expect(screen.queryByTestId(STATES.card.testID)).toBeNull();
  });
});
