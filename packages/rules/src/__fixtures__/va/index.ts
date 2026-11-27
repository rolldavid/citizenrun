// Every Virginia fixture of this folder, in file-name order (PIPE-rules-fixtures rule 1).
import type { RulesFixture } from '../../types.ts';
import { fixture as generalAssembly2023 } from './2023-general-assembly.fixtures.ts';
import { fixture as local2023 } from './2023-local.fixtures.ts';
import { fixture as local2024 } from './2024-local.fixtures.ts';
import { fixture as usHouse2024 } from './2024-us-house.fixtures.ts';
import { fixture as usSenate2024 } from './2024-us-senate.fixtures.ts';
import { fixture as houseOfDelegates2025 } from './2025-house-of-delegates.fixtures.ts';
import { fixture as local2025 } from './2025-local.fixtures.ts';
import { fixture as statewide2025 } from './2025-statewide.fixtures.ts';
import { fixture as fiveYearSchedule2026 } from './2026-five-year-schedule.fixtures.ts';
import { fixture as local2026 } from './2026-local.fixtures.ts';
import { fixture as usHouse2026 } from './2026-us-house.fixtures.ts';
import { fixture as usSenate2026 } from './2026-us-senate.fixtures.ts';

export const VA_FIXTURES: readonly RulesFixture[] = [
  generalAssembly2023,
  local2023,
  local2024,
  usHouse2024,
  usSenate2024,
  houseOfDelegates2025,
  local2025,
  statewide2025,
  fiveYearSchedule2026,
  local2026,
  usHouse2026,
  usSenate2026,
];
