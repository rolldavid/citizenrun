import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { color, issue } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import {
  Circle,
  ClipPath,
  Defs,
  G,
  Image,
  LinearGradient,
  Mask,
  Path,
  Rect,
  Stop,
  Svg,
  Text,
  TSpan,
} from '@citizenrun/cards/primitives';
import { HELLO_TEXT, HELLO_TREASURER } from '../__fixtures__/hello.fixtures.ts';
import { canvasColorsFrom } from '../colors.ts';
import type { CanvasColors } from '../colors.ts';
import { HelloCard } from './hello-card.tsx';

type Node = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function childrenOf(element: Node): Node[] {
  return Children.toArray(element.props.children).filter((child): child is Node =>
    isValidElement(child),
  );
}

/** The element and everything under it, in drawing order. */
function walk(element: Node): Node[] {
  return [element, ...childrenOf(element).flatMap(walk)];
}

/** An element's own attributes, without what it holds. */
function attrs(element: Node): Record<string, unknown> {
  const { children: _children, ...rest } = element.props;
  return rest;
}

/** Colors that name their own role, so a test reads which role an element took. */
const COLORS: CanvasColors = {
  theme: 'light',
  bg: 'c-bg',
  surface: 'c-surface',
  text: 'c-text',
  textSecondary: 'c-text-secondary',
  ruleSoft: 'c-rule-soft',
  accent: 'c-accent',
  highlight: 'c-highlight',
  onHighlight: 'c-on-highlight',
  posterBg: 'c-poster-bg',
  posterText: 'c-poster-text',
  posterTextSecondary: 'c-poster-text-secondary',
  issue: {},
};
const PHOTO = 'data:image/jpeg;base64,AAAA';

const MONO = { fontFamily: 'Chivo Mono', fontWeight: '500' };
const REGULAR = { fontFamily: 'Special Gothic', fontWeight: '400' };
const MEDIUM = { fontFamily: 'Special Gothic', fontWeight: '500' };
const BOLD = { fontFamily: 'Special Gothic', fontWeight: '700' };

const card: Node = HelloCard({ colors: COLORS, photoHref: PHOTO });
const parts = childrenOf(card);

describe('HelloCard', () => {
  it('is the 4:5 canvas at its reference width by default', () => {
    expect(card.type).toBe(Svg);
    expect(attrs(card)).toEqual({
      width: 1080,
      height: 1350,
      viewBox: '0 0 1080 1350',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
  });

  it('scales to the width it is given and keeps the canvas units', () => {
    const half: Node = HelloCard({ colors: COLORS, photoHref: PHOTO, width: 540 });
    expect(half.props).toMatchObject({ width: 540, height: 675, viewBox: '0 0 1080 1350' });
    const odd: Node = HelloCard({ colors: COLORS, photoHref: PHOTO, width: 333 });
    expect(odd.props).toMatchObject({ width: 333, height: 416.3, viewBox: '0 0 1080 1350' });
    expect(childrenOf(half).map(attrs)).toEqual(parts.map(attrs));
  });

  it('holds the twelve elements in drawing order', () => {
    expect(parts.map((part) => part.type)).toEqual([
      Rect, // 1 ground
      Text, // 2 mono label
      Text, // 3 title
      Image, // 4 photo
      Rect, //   and its keyline
      Text, // 5 big number
      Text, // 6 caption
      G, // 7 volt block
      Text, // 8 fact line
      Text, // 9 paragraph, three lines
      Text,
      Text,
      G, // 10 drawing
      Defs, // 11 gradient
      Rect,
      Defs, // 12 clipped photo
      G,
    ]);
  });

  it('1: the ground covers the canvas in the surface color', () => {
    expect(parts[0]?.props).toEqual({ x: 0, y: 0, width: 1080, height: 1350, fill: 'c-surface' });
  });

  it('2: the mono label is tracked caps in the mono face', () => {
    expect(parts[1]?.props).toEqual({
      x: 66,
      y: 110,
      ...MONO,
      fontSize: 40,
      letterSpacing: 1.6,
      fill: 'c-text-secondary',
      children: 'SPIKE 7 · FOUR FACES',
    });
  });

  it('3: the title is the medium face, tracked tight', () => {
    expect(parts[2]?.props).toEqual({
      x: 66,
      y: 200,
      ...MEDIUM,
      fontSize: 92,
      letterSpacing: -1.4,
      fill: 'c-text',
      children: 'Treasurer',
    });
  });

  it('4: the photo fills its box under a keyline', () => {
    expect(parts[3]?.props).toEqual({
      x: 614,
      y: 86,
      width: 400,
      height: 500,
      href: PHOTO,
      preserveAspectRatio: 'xMidYMid slice',
    });
    expect(parts[4]?.props).toEqual({
      x: 614,
      y: 86,
      width: 400,
      height: 500,
      fill: 'none',
      stroke: 'c-rule-soft',
      strokeWidth: 3,
    });
  });

  it('5: the big number is the bold face at its largest size', () => {
    expect(parts[5]?.props).toEqual({
      x: 66,
      y: 560,
      ...BOLD,
      fontSize: 330,
      letterSpacing: -9.9,
      fill: 'c-text',
      children: '14',
    });
  });

  it('6: the caption is the regular face, untracked', () => {
    expect(parts[6]?.props).toEqual({
      x: 66,
      y: 640,
      ...REGULAR,
      fontSize: 44,
      fill: 'c-text-secondary',
      children: 'days to file, regular face',
    });
  });

  it('7: the volt block is a tilted group of a keylined block and its label', () => {
    const sticker = parts[7];
    expect(sticker === undefined ? undefined : attrs(sticker)).toEqual({
      transform: 'rotate(-3 236 726)',
    });
    const inside = sticker === undefined ? [] : childrenOf(sticker);
    expect(inside.map((part) => part.type)).toEqual([Rect, Text]);
    expect(inside[0]?.props).toEqual({
      x: 66,
      y: 690,
      width: 340,
      height: 72,
      fill: 'c-highlight',
      stroke: 'c-on-highlight',
      strokeWidth: 3,
    });
    expect(inside[1]?.props).toEqual({
      x: 86,
      y: 740,
      ...MONO,
      fontSize: 40,
      letterSpacing: 1.6,
      fill: 'c-on-highlight',
      children: 'OPEN SEAT',
    });
  });

  it('the volt block turns about the middle of its block', () => {
    expect([66 + 340 / 2, 690 + 72 / 2]).toEqual([236, 726]);
  });

  it('8: the fact line is the medium face at the fact size', () => {
    expect(parts[8]?.props).toEqual({
      x: 66,
      y: 880,
      ...MEDIUM,
      fontSize: 100,
      fill: 'c-text',
      children: 'Alder',
    });
  });

  it('9: the paragraph is three lines, each on its own baseline', () => {
    expect(parts.slice(9, 12).map((part) => part.props)).toEqual([
      { x: 66, y: 960, ...REGULAR, fontSize: 44, fill: 'c-text', children: 'Three lines broken' },
      {
        x: 66,
        y: 1016,
        ...REGULAR,
        fontSize: 44,
        fill: 'c-text',
        children: 'by hand, each on its',
      },
      { x: 66, y: 1072, ...REGULAR, fontSize: 44, fill: 'c-text', children: 'own baseline.' },
    ]);
    expect(HELLO_TEXT.paragraph).toHaveLength(3);
  });

  it('10: the drawing is nine shapes in the paper roles, cut by the right edge alone', () => {
    const drawing = parts[12];
    expect(drawing === undefined ? undefined : attrs(drawing)).toEqual({
      transform: 'translate(630 790) scale(5.625)',
    });
    const shapes = drawing === undefined ? [] : childrenOf(drawing);
    expect(shapes).toHaveLength(9);
    expect(HELLO_TREASURER.shapes).toHaveLength(9);
    expect(shapes.map((shape) => shape.type)).toEqual([
      Rect,
      Path,
      Rect,
      Rect,
      Circle,
      Circle,
      Circle,
      Rect,
      Rect,
    ]);
    expect(shapes.map((shape) => shape.props)).toEqual([
      { x: 10, y: 12, width: 76, height: 70, fill: 'c-text' },
      { d: 'M18 82h12v6H18zM66 82h12v6H66z', fill: 'c-text' },
      { x: 16, y: 18, width: 64, height: 58, fill: 'c-surface' },
      { x: 20, y: 22, width: 56, height: 50, fill: 'c-text-secondary' },
      { cx: 40, cy: 47, r: 12, fill: 'c-surface' },
      { cx: 40, cy: 47, r: 8, fill: 'c-text' },
      { cx: 40, cy: 47, r: 3, fill: 'c-surface' },
      { x: 58, y: 32, width: 13, height: 30, fill: 'c-surface' },
      { x: 60.5, y: 35, width: 8, height: 24, fill: 'c-accent' },
    ]);
    // The crop line of the drawing falls on the canvas edge, and the drawing is 540 units wide.
    expect(630 + HELLO_TREASURER.crop * 5.625).toBe(1080);
    expect(96 * 5.625).toBe(540);
  });

  it('11: the gradient runs from the text color to the highlight across its block', () => {
    const defs = parts[13];
    const gradients = defs === undefined ? [] : childrenOf(defs);
    expect(gradients.map((part) => part.type)).toEqual([LinearGradient]);
    const gradient = gradients[0];
    expect(gradient === undefined ? undefined : attrs(gradient)).toEqual({
      id: 'hello-gradient',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
    });
    const stops = gradient === undefined ? [] : childrenOf(gradient);
    expect(stops.map((stop) => stop.type)).toEqual([Stop, Stop]);
    expect(stops.map((stop) => stop.props)).toEqual([
      { offset: 0, stopColor: 'c-text' },
      { offset: 1, stopColor: 'c-highlight' },
    ]);
    expect(parts[14]?.props).toEqual({
      x: 66,
      y: 1130,
      width: 200,
      height: 60,
      fill: 'url(#hello-gradient)',
    });
  });

  it('12: the second photo is cut to a circle by a clip path', () => {
    const defs = parts[15];
    const clips = defs === undefined ? [] : childrenOf(defs);
    expect(clips.map((part) => part.type)).toEqual([ClipPath]);
    const clip = clips[0];
    expect(clip === undefined ? undefined : attrs(clip)).toEqual({ id: 'hello-clip' });
    const cut = clip === undefined ? [] : childrenOf(clip);
    expect(cut.map((part) => part.type)).toEqual([Circle]);
    expect(cut[0]?.props).toEqual({ cx: 360, cy: 1185, r: 60, fill: 'c-text' });

    const group = parts[16];
    expect(group === undefined ? undefined : attrs(group)).toEqual({
      clipPath: 'url(#hello-clip)',
    });
    const clipped = group === undefined ? [] : childrenOf(group);
    expect(clipped.map((part) => part.type)).toEqual([Image]);
    expect(clipped[0]?.props).toEqual({
      x: 300,
      y: 1110,
      width: 120,
      height: 150,
      href: PHOTO,
      preserveAspectRatio: 'xMidYMid slice',
    });
  });

  it('draws the photo twice, from the one href it is given', () => {
    const images = walk(card).filter((element) => element.type === Image);
    expect(images.map((image) => image.props.href)).toEqual([PHOTO, PHOTO]);
    const hrefs = walk(card).filter((element) => 'href' in element.props);
    expect(hrefs).toHaveLength(2);
  });

  it('tracks the caps, the title and the big number, and nothing else', () => {
    const tracked = walk(card)
      .filter((element) => 'letterSpacing' in element.props)
      .map((element) => [element.props.children, element.props.letterSpacing]);
    expect(tracked).toEqual([
      ['SPIKE 7 · FOUR FACES', 1.6],
      ['Treasurer', -1.4],
      ['14', -9.9],
      ['OPEN SEAT', 1.6],
    ]);
  });

  it('writes every number with at most one decimal place, the two transforms aside', () => {
    for (const element of walk(card)) {
      for (const [name, value] of Object.entries(element.props)) {
        if (typeof value === 'number') {
          expect(Math.round(value * 10) / 10, name).toBe(value);
        }
      }
    }
  });

  it('has no style, no opacity and no handler anywhere in the tree', () => {
    const names = walk(card).flatMap((element) => Object.keys(element.props));
    expect(names.filter((name) => name === 'style')).toEqual([]);
    expect(names.filter((name) => /opacity/i.test(name))).toEqual([]);
    expect(names.filter((name) => /^on[A-Z]/.test(name))).toEqual([]);
  });

  it('draws no text span and no mask', () => {
    const types = walk(card).map((element) => element.type);
    expect(types.filter((type) => type === TSpan || type === Mask)).toEqual([]);
    // The root, its seventeen parts, and the eighteen elements the groups and definitions hold.
    expect(walk(card)).toHaveLength(1 + 17 + 2 + 9 + 3 + 2 + 1);
  });

  it('takes every color from the colors it is given', () => {
    const given = new Set<unknown>(
      Object.values(COLORS).filter((value) => typeof value === 'string'),
    );
    const painted = walk(card).flatMap((element) =>
      (['fill', 'stroke', 'stopColor'] as const)
        .filter((name) => name in element.props)
        .map((name) => element.props[name]),
    );
    const others = painted.filter((value) => !given.has(value));
    expect([...new Set(others)]).toEqual(['none', 'url(#hello-gradient)']);
  });

  it('follows the theme of the colors it is given', () => {
    const light: Node = HelloCard({
      colors: canvasColorsFrom('light', color.light, issue),
      photoHref: PHOTO,
    });
    const dark: Node = HelloCard({
      colors: canvasColorsFrom('dark', color.dark, issue),
      photoHref: PHOTO,
    });
    expect(childrenOf(light)[0]?.props.fill).toBe('#FDFCF9');
    expect(childrenOf(light)[2]?.props.fill).toBe('#141412');
    expect(childrenOf(dark)[0]?.props.fill).toBe(color.dark.surface);
    expect(childrenOf(dark)[2]?.props.fill).toBe(color.dark.text);
    expect(childrenOf(dark)[0]?.props.fill).not.toBe('#FDFCF9');
  });
});
