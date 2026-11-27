import { beforeAll, describe, expect, it } from 'vitest';
import { G, Path, Svg } from '@citizenrun/cards/primitives';
import { setStrictGlyphs } from '../layout-text.ts';
import { draw } from '../regions/testing/tree.ts';
import { DistrictShape, DistrictShapeSvg, validOutline } from './district-shape.tsx';

beforeAll(() => {
  setStrictGlyphs(true);
});

const RECTANGLE = 'M0 0 L1000 0 L1000 500 L0 500 Z';
/** A box three quarters as wide as it is tall, in metres. */
const TALL_BOX: [number, number, number, number] = [0, 0, 750, 1000];
const TALL = 'M0 0 L750 0 L750 1000 L0 1000 Z';

describe('validOutline', () => {
  it('valid outlines', () => {
    expect(validOutline(RECTANGLE)).toBe(true);
    expect(validOutline('m0 0 l10 0 h5 v-5.5 z')).toBe(true);

    expect(validOutline(`${RECTANGLE}<script>`)).toBe(false);
    expect(validOutline(`${RECTANGLE}" onload="x`)).toBe(false);
    // A curve is no part of an outline.
    expect(validOutline('M0 0 C10 10 20 20 30 30 Z')).toBe(false);
    expect(validOutline('')).toBe(false);

    expect(validOutline(`M0 0 ${'0'.repeat(19_995)}`)).toBe(true);
    expect(validOutline(`M0 0 ${'0'.repeat(19_996)}`)).toBe(false);

    expect(validOutline(`M0 0${' L1 1'.repeat(399)}`)).toBe(true);
    expect(validOutline(`M0 0${' L1 1'.repeat(401)}`)).toBe(false);
  });
});

describe('DistrictShape', () => {
  it('centred in its square', () => {
    const [group] = draw(
      <DistrictShape svg={TALL} bbox={TALL_BOX} x={0} y={0} size={80} fill="c-accent" />,
    );
    expect(group?.type).toBe(G);
    expect(group?.props).toEqual({ transform: 'translate(10 0) scale(0.08)' });
    expect(group?.children).toHaveLength(1);
    expect(group?.children[0]?.type).toBe(Path);
    // One solid shape with no stroke.
    expect(group?.children[0]?.props).toEqual({ d: TALL, fill: 'c-accent', fillRule: 'evenodd' });

    const [wide] = draw(
      <DistrictShape
        svg={RECTANGLE}
        bbox={[0, 0, 1000, 500]}
        x={100}
        y={200}
        size={400}
        fill="c-accent"
      />,
    );
    expect(wide?.props.transform).toBe('translate(100 300) scale(0.4)');

    expect(
      draw(<DistrictShape svg="<svg>" bbox={TALL_BOX} x={0} y={0} size={80} fill="c-accent" />),
    ).toEqual([]);
  });

  it('stands alone in a square of its size', () => {
    const [root] = draw(<DistrictShapeSvg svg={TALL} bbox={TALL_BOX} size={80} fill="c-accent" />);
    expect(root?.type).toBe(Svg);
    expect(root?.props).toEqual({
      width: 80,
      height: 80,
      viewBox: '0 0 80 80',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': true,
      focusable: 'false',
    });
    expect(root?.children[0]?.props.transform).toBe('translate(10 0) scale(0.08)');

    const [empty] = draw(
      <DistrictShapeSvg svg={'M0 0 "'} bbox={TALL_BOX} size={80} fill="c-accent" />,
    );
    expect(empty?.type).toBe(Svg);
    expect(empty?.children).toEqual([]);
  });
});
