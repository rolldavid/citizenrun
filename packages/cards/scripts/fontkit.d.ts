// The members of fontkit 3.0.0 that gen-advance-widths.ts reads; that version ships no types.
declare module 'fontkit' {
  export type Glyph = { advanceWidth: number };
  export type Font = {
    unitsPerEm: number;
    capHeight: number;
    xHeight: number;
    ascent: number;
    descent: number;
    characterSet: number[];
    glyphForCodePoint(codePoint: number): Glyph;
  };
  export type FontCollection = { fonts: Font[] };
  export function create(buffer: Uint8Array): Font | FontCollection;
}
