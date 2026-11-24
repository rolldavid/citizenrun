import { describe, expect, it } from 'vitest';

import { breakpointFor, layoutFor } from './use-breakpoint';

function at(width: number, height = 800, fontScale = 1, topBarHeight = 0) {
  return layoutFor({ width, height, fontScale, topBarHeight });
}

describe('breakpoints and layout', () => {
  it('breakpointFor', () => {
    expect(breakpointFor(599)).toBe('compact');
    expect(breakpointFor(600)).toBe('medium');
    expect(breakpointFor(1023)).toBe('medium');
    expect(breakpointFor(1024)).toBe('expanded');
  });

  it('360 by 740 at font scale 1', () => {
    const layout = at(360, 740);
    expect(layout.breakpoint).toBe('compact');
    expect(layout.gutter).toBe(16);
    expect(layout.canvasWidth).toBe(360);
    expect(layout.isNarrow).toBe(true);
    expect(layout.isTight).toBe(false);
  });

  it('the gutter widens at 380', () => {
    expect(at(379).gutter).toBe(16);
    expect(at(379).isNarrow).toBe(true);
    expect(at(380).gutter).toBe(24);
    expect(at(380).isNarrow).toBe(false);
  });

  it('820 by 1180', () => {
    const layout = at(820, 1180);
    expect(layout.breakpoint).toBe('medium');
    expect(layout.mainWidth).toBe(748);
    expect(layout.feedColumnWidth).toBe(600);
    expect(layout.canvasWidth).toBe(600);
    expect(layout.showsRightColumn).toBe(false);
  });

  it('1024 by 768', () => {
    const layout = at(1024, 768);
    expect(layout.breakpoint).toBe('expanded');
    expect(layout.mainWidth).toBe(804);
    expect(layout.feedColumnWidth).toBe(388);
  });

  it('1236 wide', () => {
    expect(at(1236, 900).feedColumnWidth).toBe(600);
  });

  it('1440 by 900', () => {
    const layout = at(1440, 900);
    expect(layout.mainWidth).toBe(1060);
    expect(layout.feedColumnWidth).toBe(600);
    expect(layout.canvasWidth).toBeCloseTo(540.8, 10);
    expect(layout.showsRightColumn).toBe(true);
  });

  it('1440 by 900 under a 44 point top bar', () => {
    expect(at(1440, 900, 1, 44).canvasWidth).toBeCloseTo(505.6, 10);
  });

  it('1920 wide caps the content at 1280', () => {
    expect(at(1920, 1080).mainWidth).toBe(1060);
  });

  it('isTight', () => {
    expect(at(360, 740, 1.15).isTight).toBe(true);
    expect(at(360, 740, 1.14).isTight).toBe(false);
    expect(at(380, 740, 1.3).isTight).toBe(false);
  });
});
