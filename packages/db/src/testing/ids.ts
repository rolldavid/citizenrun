import { uuidFloor } from '@citizenrun/shared';
import { seedId } from '../seed/ids.ts';
import { nextSequence } from './sequence.ts';

/** A version 7 uuid whose embedded time is `at`; the random bits come from the factory sequence, so it is deterministic. */
export function idAt(at: Date): string {
  return seedId('factory', nextSequence(), at);
}

/** The smallest version 7 uuid for the millisecond of `at` (the uuid floor). */
export function uuidFloorAt(at: Date): string {
  return uuidFloor(at);
}
