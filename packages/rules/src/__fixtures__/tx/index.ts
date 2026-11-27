// Every Texas fixture, in file-name order (PIPE-rules-fixtures rule 1).
import type { RulesFixture } from '../../types.ts';
import { fixture as primary2024 } from './2024-primary.fixtures.ts';
import { fixture as primary2026 } from './2026-primary.fixtures.ts';
import { fixture as uniform2026 } from './2026-uniform.fixtures.ts';
import { fixture as may2027 } from './2027-may.fixtures.ts';
import { fixture as november2027 } from './2027-november.fixtures.ts';
import { fixture as primary2028 } from './2028-primary.fixtures.ts';
import { fixture as uniform2028 } from './2028-uniform.fixtures.ts';

export const TX_FIXTURES: readonly RulesFixture[] = [
  primary2024,
  primary2026,
  uniform2026,
  may2027,
  november2027,
  primary2028,
  uniform2028,
];
