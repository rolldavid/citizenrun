export type Rect = { x: number; y: number; width: number; height: number };

export type PopoverPlacement = 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'end';

type Side = 'below' | 'above';
type Edge = 'start' | 'end';

type Placed = { top: number; left: number; maxHeight: number; placement: PopoverPlacement };

function clamp(value: number, least: number, most: number): number {
  // A range with no room keeps its start: the content starts at the margin and runs past the end.
  return Math.max(least, Math.min(value, most));
}

/**
 * Where a popover stands in the window, from its anchor, its own size and the placement asked for.
 *
 * Below or above: `gap` clear of the anchor on the side asked for; on the other side when it does
 * not fit there inside `margin` and fits on the other; and where it fits on neither, on the side
 * with more room, which is then its `maxHeight`. Its start or its end edge lines up with the
 * anchor's, and with the other one when the edge asked for would leave the window.
 *
 * `end`: beside the anchor, `gap` past its end edge and level with its top, or before its start
 * edge when it would leave the window there.
 *
 * Last, it is moved to keep `margin` clear on every side. The placement given back is the one used.
 */
export function placePopover(input: {
  anchor: Rect;
  content: { width: number; height: number };
  window: { width: number; height: number };
  placement: PopoverPlacement;
  gap: number;
  margin: number;
}): Placed {
  const { anchor, content, window: view, placement, gap, margin } = input;
  const mostLeft = view.width - margin - content.width;

  if (placement === 'end') {
    const room = view.height - margin * 2;
    const height = Math.min(content.height, room);
    const after = anchor.x + anchor.width + gap;
    const before = anchor.x - gap - content.width;
    const left = after + content.width > view.width - margin ? before : after;
    return {
      top: clamp(anchor.y, margin, view.height - margin - height),
      left: clamp(left, margin, mostLeft),
      maxHeight: room,
      placement,
    };
  }

  const asked: Side = placement.startsWith('below') ? 'below' : 'above';
  const other: Side = asked === 'below' ? 'above' : 'below';
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap;
  const room: Record<Side, number> = {
    below: view.height - margin - below,
    above: above - margin,
  };
  const fits = (side: Side): boolean => content.height <= room[side];
  const side: Side = fits(asked)
    ? asked
    : fits(other)
      ? other
      : room[other] > room[asked]
        ? other
        : asked;
  const maxHeight = Math.max(0, room[side]);
  const height = Math.min(content.height, maxHeight);
  const top = side === 'below' ? below : above - height;

  const askedEdge: Edge = placement.endsWith('start') ? 'start' : 'end';
  const leftAt: Record<Edge, number> = {
    start: anchor.x,
    end: anchor.x + anchor.width - content.width,
  };
  const inside = (edge: Edge): boolean =>
    leftAt[edge] >= margin && leftAt[edge] + content.width <= view.width - margin;
  const otherEdge: Edge = askedEdge === 'start' ? 'end' : 'start';
  const edge: Edge = !inside(askedEdge) && inside(otherEdge) ? otherEdge : askedEdge;

  return {
    top: clamp(top, margin, view.height - margin - height),
    left: clamp(leftAt[edge], margin, mostLeft),
    maxHeight,
    placement: `${side}-${edge}`,
  };
}
