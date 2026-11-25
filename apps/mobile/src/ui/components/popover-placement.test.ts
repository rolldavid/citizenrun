import { describe, expect, it } from 'vitest';

import { placePopover } from './popover-placement';
import type { PopoverPlacement, Rect } from './popover-placement';

const PHONE = { width: 360, height: 740 };
const DESKTOP = { width: 1440, height: 900 };
const GAP = 8;
const MARGIN = 16;

/** Places a popover in the phone window with the gap and the margin of the cases below. */
function place(
  anchor: Rect,
  content: { width: number; height: number },
  placement: PopoverPlacement,
  view = PHONE,
): ReturnType<typeof placePopover> {
  return placePopover({ anchor, content, window: view, placement, gap: GAP, margin: MARGIN });
}

describe('placePopover', () => {
  it('below and flips above', () => {
    const content = { width: 200, height: 300 };
    // With room under the anchor it stands there, the gap clear of it.
    const high: Rect = { x: 16, y: 100, width: 200, height: 44 };
    const under = place(high, content, 'below-start');
    expect(under.placement).toBe('below-start');
    expect(under.top).toBe(high.y + high.height + GAP);
    expect(under.left).toBe(high.x);

    // An anchor at the bottom of the window leaves no room under it.
    const low: Rect = { x: 16, y: 660, width: 200, height: 44 };
    const over = place(low, content, 'below-start');
    expect(over.placement).toBe('above-start');
    expect(over.top + content.height).toBeLessThanOrEqual(low.y - GAP);
    expect(over.top + content.height).toBe(low.y - GAP);
    expect(over.left).toBe(low.x);

    // And the other way: asked for above an anchor at the top, it stands under it.
    const top: Rect = { x: 16, y: 40, width: 200, height: 44 };
    const turned = place(top, content, 'above-end');
    expect(turned.placement).toBe('below-end');
    expect(turned.top).toBe(top.y + top.height + GAP);
  });

  it('above stands the gap over its anchor when it fits there', () => {
    const anchor: Rect = { x: 16, y: 500, width: 200, height: 44 };
    const placed = place(anchor, { width: 200, height: 180 }, 'above-start');
    expect(placed.placement).toBe('above-start');
    expect(placed.top).toBe(anchor.y - GAP - 180);
    expect(placed.maxHeight).toBe(anchor.y - GAP - MARGIN);
  });

  it('start lines up the left edges and end the right edges', () => {
    const anchor: Rect = { x: 600, y: 100, width: 120, height: 44 };
    const content = { width: 240, height: 160 };
    expect(place(anchor, content, 'below-start', DESKTOP).left).toBe(anchor.x);
    expect(place(anchor, content, 'below-end', DESKTOP).left).toBe(
      anchor.x + anchor.width - content.width,
    );
    // Where the edge asked for would leave the window, the other edge lines up.
    const right: Rect = { x: 1296, y: 100, width: 120, height: 44 };
    const turned = place(right, content, 'below-start', DESKTOP);
    expect(turned.placement).toBe('below-end');
    expect(turned.left).toBe(right.x + right.width - content.width);
    const left: Rect = { x: 24, y: 100, width: 120, height: 44 };
    const back = placePopover({
      anchor: left,
      content,
      window: DESKTOP,
      placement: 'above-end',
      gap: GAP,
      margin: 24,
    });
    expect(back.placement).toBe('below-start');
    expect(back.left).toBe(left.x);
  });

  it('end aligns and flips', () => {
    const content = { width: 200, height: 180 };
    // Beside its anchor, level with its top.
    const left: Rect = { x: 24, y: 200, width: 100, height: 44 };
    const beside = place(left, content, 'end', DESKTOP);
    expect(beside.placement).toBe('end');
    expect(beside.left).toBe(left.x + left.width + GAP);
    expect(beside.top).toBe(left.y);

    // An anchor at the right edge has no room after it: the popover stands before it.
    const right: Rect = { x: 1324, y: 200, width: 100, height: 44 };
    const before = place(right, content, 'end', DESKTOP);
    expect(before.left).toBe(right.x - GAP - content.width);
    expect(before.top).toBe(right.y);
  });

  it('end keeps the margin clear under an anchor near the bottom', () => {
    const anchor: Rect = { x: 24, y: 820, width: 100, height: 44 };
    const placed = place(anchor, { width: 200, height: 180 }, 'end', DESKTOP);
    expect(placed.top).toBe(DESKTOP.height - MARGIN - 180);
    expect(placed.maxHeight).toBe(DESKTOP.height - MARGIN * 2);
  });

  it('clamped inside the margin', () => {
    const content = { width: 300, height: 120 };
    const anchor: Rect = { x: 0, y: 100, width: 44, height: 44 };
    const placed = place(anchor, content, 'below-end');
    expect(placed.left).toBeGreaterThanOrEqual(MARGIN);
    expect(placed.left).toBe(MARGIN);
    expect(placed.left + content.width).toBeLessThanOrEqual(PHONE.width - MARGIN);

    // At the other side of the window the right margin is kept.
    const far: Rect = { x: 316, y: 100, width: 44, height: 44 };
    const kept = place(far, content, 'below-start');
    expect(kept.left).toBe(PHONE.width - MARGIN - content.width);

    // Content wider than the window less its margins starts at the margin.
    expect(place(far, { width: 400, height: 120 }, 'below-start').left).toBe(MARGIN);
  });

  it('too tall for both sides', () => {
    const content = { width: 200, height: 2000 };
    // More room under the anchor: it stands there and is as tall as that room.
    const high: Rect = { x: 16, y: 300, width: 200, height: 44 };
    const under = place(high, content, 'above-start');
    const roomBelow = PHONE.height - MARGIN - (high.y + high.height + GAP);
    const roomAbove = high.y - GAP - MARGIN;
    expect(roomBelow).toBeGreaterThan(roomAbove);
    expect(under.placement).toBe('below-start');
    expect(under.maxHeight).toBe(roomBelow);
    expect(under.top).toBe(high.y + high.height + GAP);

    // More room over the anchor: it starts at the margin and ends the gap over the anchor.
    const low: Rect = { x: 16, y: 500, width: 200, height: 44 };
    const over = place(low, content, 'below-start');
    expect(over.placement).toBe('above-start');
    expect(over.maxHeight).toBe(low.y - GAP - MARGIN);
    expect(over.top).toBe(MARGIN);
    expect(over.top + over.maxHeight).toBe(low.y - GAP);
  });
});
