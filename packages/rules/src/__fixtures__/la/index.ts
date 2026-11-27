import type { RulesFixture } from '../../types.ts';
import { fixture as la2023General } from './2023-general.fixtures.ts';
import { fixture as la2024General } from './2024-general.fixtures.ts';
import { fixture as la2026GeneralParishQualifying } from './2026-general-parish-qualifying.fixtures.ts';
import { fixture as la2026GeneralUsHouse } from './2026-general-us-house.fixtures.ts';
import { fixture as la2026General } from './2026-general.fixtures.ts';
import { fixture as la2026Spring } from './2026-spring.fixtures.ts';
import { fixture as la2027General } from './2027-general.fixtures.ts';

export const LA_FIXTURES: readonly RulesFixture[] = [
  la2023General,
  la2024General,
  la2026GeneralParishQualifying,
  la2026GeneralUsHouse,
  la2026General,
  la2026Spring,
  la2027General,
];
