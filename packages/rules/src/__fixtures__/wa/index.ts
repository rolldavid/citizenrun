// Every Washington fixture of this folder, in file-name order (PIPE-rules-fixtures rule 1).
import type { RulesFixture } from '../../types.ts';
import { fixture as general2024 } from './2024-general.fixtures.ts';
import { fixture as general2025 } from './2025-general.fixtures.ts';
import { fixture as general2026 } from './2026-general.fixtures.ts';
import { fixture as general2027 } from './2027-general.fixtures.ts';
import { fixture as local2027 } from './2027-local.fixtures.ts';

export const WA_FIXTURES: readonly RulesFixture[] = [
  general2024,
  general2025,
  general2026,
  general2027,
  local2027,
];
