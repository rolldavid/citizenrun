import { vi } from 'vitest';

/** The two zones every date test runs under (D-252). */
export const TEST_ZONES = ['America/Los_Angeles', 'Pacific/Kiritimati'] as const;

/**
 * Runs `body` once per zone with the TZ variable stubbed to that zone, then removes every stub once
 * at the end, so a test that stubs another variable does it inside the body.
 */
export async function eachZone(
  body: (zone: (typeof TEST_ZONES)[number]) => void | Promise<void>,
): Promise<void> {
  try {
    for (const zone of TEST_ZONES) {
      vi.stubEnv('TZ', zone);
      await body(zone);
    }
  } finally {
    vi.unstubAllEnvs();
  }
}
