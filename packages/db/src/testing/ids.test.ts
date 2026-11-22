import { uuidFloor } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { idAt, uuidFloorAt } from './ids.ts';
import { resetSequence } from './sequence.ts';

const AT = new Date('2027-03-05T22:00:00.000Z');
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('test ids', () => {
  it('idAt is a version 7 uuid at its time', () => {
    resetSequence();
    const first = idAt(AT);
    const second = idAt(AT);
    expect(first).not.toBe(second);
    const timeDigits = uuidFloor(AT).replace(/-/g, '').slice(0, 12);
    for (const id of [first, second]) {
      expect(id).toMatch(UUID_V7);
      expect(id.replace(/-/g, '').slice(0, 12)).toBe(timeDigits);
    }
    resetSequence();
    expect(idAt(AT)).toBe(first);
  });

  it('uuidFloorAt equals the shared floor', () => {
    expect(uuidFloorAt(AT)).toBe(uuidFloor(AT));
    expect(uuidFloorAt(AT)).toBe('01a417b4-f700-7000-8000-000000000000');
  });
});
