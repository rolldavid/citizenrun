/** Reference tables a migration fills, which resetDb() never truncates. */
export const KEEP_TABLES: readonly string[] = [
  'issues',
  'powers',
  'issue_powers',
  'office_types',
  'state_rules',
];
