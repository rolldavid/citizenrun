import { v7 } from 'uuid';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, uuidFloor } from './ids.ts';

const AT = new Date('2027-03-05T22:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('newId', () => {
  it('newId returns a version 7 uuid', () => {
    const id = newId();
    expect(id).toHaveLength(36);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const hex = id.replaceAll('-', '');
    expect(hex[12]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(hex[16]);
  });

  it('newId sorts by creation time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    const ids: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      vi.advanceTimersByTime(1);
      ids.push(newId());
    }
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(1000);
  });
});

describe('uuidFloor', () => {
  it('uuid floor is the smallest id of its millisecond', () => {
    const floor = uuidFloor(AT);
    expect(floor).toBe('01a417b4-f700-7000-8000-000000000000');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    for (let i = 0; i < 200; i += 1) {
      expect(newId() >= floor).toBe(true);
    }
    // newId keeps the generator's state for the process, so ids of exactly that millisecond with
    // fresh random bits are made by the generator directly.
    for (let i = 0; i < 200; i += 1) {
      const id = v7({ msecs: AT.getTime() });
      expect(id.slice(0, 13)).toBe(floor.slice(0, 13));
      expect(id >= floor).toBe(true);
    }
    expect('01a417b4-f6ff-7fff-bfff-ffffffffffff' < floor).toBe(true);
  });

  it('uuid floor of the epoch is all zeros before the version', () => {
    expect(uuidFloor(new Date(0))).toBe('00000000-0000-7000-8000-000000000000');
  });

  it('uuid floor refuses an invalid date', () => {
    expect(() => uuidFloor(new Date('x'))).toThrow(RangeError);
    expect(() => uuidFloor(new Date(-1))).toThrow(RangeError);
  });
});
