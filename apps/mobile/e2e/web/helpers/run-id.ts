/** The first three parts of TEST-NET-2 (RFC 5737), the documentation range the journeys' addresses use. */
const TEST_NET_2 = '198.51.100';
/** How many host numbers the range gives, 1 to 254. */
const HOSTS = 254;

/** An id for one run of a journey, unique per millisecond. */
export function newRunId(): string {
  return Date.now().toString(36);
}

/** The client address of the person a run simulates, so per-address limits count per person. */
export function clientAddress(runId: string): string {
  const n = 1 + (parseInt(runId, 36) % HOSTS);
  return `${TEST_NET_2}.${String(n)}`;
}
