import { describe, expect, it } from 'vitest';
import { TIGER_LAYERS } from '../bundle/keys.ts';
import { CENSUS_LAYER_NAMES, STATE_CODES, TERRITORY_BOUNDS, territoryAt } from './geo.ts';

describe('STATE_CODES', () => {
  it('56 unique codes', () => {
    expect(STATE_CODES).toHaveLength(56);
    expect(new Set(STATE_CODES).size).toBe(56);
  });

  it('the six non-state codes close the list in order', () => {
    expect(STATE_CODES.slice(50)).toEqual(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);
    expect(STATE_CODES.slice(0, 3)).toEqual(['AL', 'AK', 'AZ']);
    expect(STATE_CODES[49]).toBe('WY');
  });

  it('every code is two upper-case letters', () => {
    for (const code of STATE_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('territoryAt', () => {
  it('territory boxes hold their capitals', () => {
    const capitals = [
      ['PR', 18.4655, -66.1057], // San Juan
      ['VI', 18.3419, -64.9307], // Charlotte Amalie
      ['GU', 13.4757, 144.7489], // Hagåtña
      ['AS', -14.2756, -170.702], // Pago Pago
      ['MP', 15.185, 145.7467], // Saipan
    ] as const;
    for (const [code, lat, lng] of capitals) {
      expect(territoryAt(lat, lng)).toBe(code);
    }
  });

  it('no box holds a point of the states', () => {
    const points = [
      [24.5551, -81.78], // Key West
      [25.7617, -80.1918], // Miami
      [25.9017, -97.4975], // Brownsville
      [21.3069, -157.8583], // Honolulu
      [19.7241, -155.0868], // Hilo
      [61.2181, -149.9003], // Anchorage
      [51.88, -176.6581], // Adak
      [38.9072, -77.0369], // Washington
    ] as const;
    for (const [lat, lng] of points) {
      expect(territoryAt(lat, lng)).toBeNull();
    }
  });

  it('a box holds its own edges', () => {
    const [west, south, east, north] = TERRITORY_BOUNDS.GU;
    expect(territoryAt(south, west)).toBe('GU');
    expect(territoryAt(north, east)).toBe('GU');
    expect(territoryAt(north + 0.001, east)).toBeNull();
  });

  it('the first box wins where two overlap', () => {
    // PR's east edge and VI's west edge overlap between -65.2 and -65.1.
    expect(territoryAt(18.0, -65.15)).toBe('PR');
  });

  it('every territory is a state-level code', () => {
    const codes: readonly string[] = STATE_CODES;
    for (const code of Object.keys(TERRITORY_BOUNDS)) {
      expect(codes).toContain(code);
    }
  });
});

describe('CENSUS_LAYER_NAMES', () => {
  it('layer tokens are boundary layers', () => {
    const layers: readonly string[] = TIGER_LAYERS;
    for (const token of Object.values(CENSUS_LAYER_NAMES)) {
      expect(layers).toContain(token);
    }
    expect(Object.keys(CENSUS_LAYER_NAMES)).toHaveLength(9);
  });
});
