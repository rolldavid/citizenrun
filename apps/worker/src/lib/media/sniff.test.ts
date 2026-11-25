import { describe, expect, it } from 'vitest';
import { familyOfContentType, sniffImage } from './sniff.ts';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('sniffImage', () => {
  it('recognises the three formats', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('jpeg');
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('png');
    const webp = new Uint8Array(12);
    webp.set(ascii('RIFF'), 0);
    webp.set(bytes(0x24, 0x00, 0x00, 0x00), 4);
    webp.set(ascii('WEBP'), 8);
    expect(sniffImage(webp)).toBe('webp');
  });

  it('refuses everything else', () => {
    expect(sniffImage(ascii('GIF89a\u0001\u0000\u0001\u0000'))).toBeNull();
    const heic = new Uint8Array(12);
    heic.set(bytes(0x00, 0x00, 0x00, 0x18), 0);
    heic.set(ascii('ftypheic'), 4);
    expect(sniffImage(heic)).toBeNull();
    expect(sniffImage(ascii('<!doctype html>'))).toBeNull();
    expect(sniffImage(new Uint8Array(8))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    // A RIFF container of another kind, and a JPEG or PNG head cut short.
    const wave = new Uint8Array(12);
    wave.set(ascii('RIFF'), 0);
    wave.set(ascii('WAVE'), 8);
    expect(sniffImage(wave)).toBeNull();
    expect(sniffImage(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });

  it('maps content types', () => {
    expect(familyOfContentType('image/jpeg')).toBe('jpeg');
    expect(familyOfContentType('image/png')).toBe('png');
    expect(familyOfContentType('image/webp')).toBe('webp');
    expect(familyOfContentType('image/heic')).toBeNull();
    expect(familyOfContentType('video/mp4')).toBeNull();
  });
});
