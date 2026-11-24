import type { ArtRoles } from '../colors.ts';

// CARD-hello: the hello card's literal test strings and the one drawing it shows.

export type HelloShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; role: keyof ArtRoles }
  | { kind: 'circle'; cx: number; cy: number; r: number; role: keyof ArtRoles }
  | { kind: 'path'; d: string; role: keyof ArtRoles };

export const HELLO_TEXT = {
  monoLabel: 'SPIKE 7 · FOUR FACES',
  title: 'Treasurer',
  bigNumber: '14',
  caption: 'days to file, regular face',
  sticker: 'OPEN SEAT',
  fact: 'Alder',
  paragraph: ['Three lines broken', 'by hand, each on its', 'own baseline.'],
} as const;

/** The County Treasurer drawing on the 96-unit grid: crop line 80, spot 8 by 24. */
export const HELLO_TREASURER: { crop: 80; shapes: readonly HelloShape[] } = {
  crop: 80,
  shapes: [
    { kind: 'rect', x: 10, y: 12, width: 76, height: 70, role: 'ink' },
    { kind: 'path', d: 'M18 82h12v6H18zM66 82h12v6H66z', role: 'ink' },
    { kind: 'rect', x: 16, y: 18, width: 64, height: 58, role: 'paper' },
    { kind: 'rect', x: 20, y: 22, width: 56, height: 50, role: 'tone' },
    { kind: 'circle', cx: 40, cy: 47, r: 12, role: 'paper' },
    { kind: 'circle', cx: 40, cy: 47, r: 8, role: 'ink' },
    { kind: 'circle', cx: 40, cy: 47, r: 3, role: 'paper' },
    { kind: 'rect', x: 58, y: 32, width: 13, height: 30, role: 'paper' },
    { kind: 'rect', x: 60.5, y: 35, width: 8, height: 24, role: 'spot' },
  ],
};
