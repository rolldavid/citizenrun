// Every North Carolina fixture, in file-name order (PIPE-rules-fixtures rule 1).
import type { RulesFixture } from '../../types.ts';
import { fixture as generalIndependent2020 } from './2020-general-independent.fixtures.ts';
import { fixture as primary2020 } from './2020-primary.fixtures.ts';
import { fixture as soilWater2022 } from './2022-soil-water.fixtures.ts';
import { fixture as municipal2023 } from './2023-municipal.fixtures.ts';
import { fixture as generalIndependent2024 } from './2024-general-independent.fixtures.ts';
import { fixture as primary2024 } from './2024-primary.fixtures.ts';
import { fixture as soilWater2024 } from './2024-soil-water.fixtures.ts';
import { fixture as municipal2025 } from './2025-municipal.fixtures.ts';
import { fixture as generalIndependent2026 } from './2026-general-independent.fixtures.ts';
import { fixture as municipalSoilWater2026 } from './2026-municipal-soil-water.fixtures.ts';
import { fixture as primary2026 } from './2026-primary.fixtures.ts';

export const NC_FIXTURES: readonly RulesFixture[] = [
  generalIndependent2020,
  primary2020,
  soilWater2022,
  municipal2023,
  generalIndependent2024,
  primary2024,
  soilWater2024,
  municipal2025,
  generalIndependent2026,
  municipalSoilWater2026,
  primary2026,
];
