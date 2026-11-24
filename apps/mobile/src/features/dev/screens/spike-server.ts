/** The port of the map spike's local style and tile host (scripts/map-spike/server.ts). */
export const MAP_SPIKE_PORT = 8091;

const OVERRIDE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const API_ORIGIN = /^(https?:\/\/[A-Za-z0-9.-]+)(:\d{1,5})?\/?$/;
const LOCAL = `http://localhost:${String(MAP_SPIKE_PORT)}`;

/**
 * The origin the map spike loads its style from, on every target. A valid override wins; the web,
 * where the page and the API share an origin, uses localhost; a phone uses the host of its API
 * origin with the spike host's port; anything else falls back to localhost. Never throws.
 */
export function spikeServerOrigin(apiOrigin: string, override: string | null): string {
  if (override !== null && OVERRIDE.test(override)) {
    return override;
  }
  if (apiOrigin === '') {
    return LOCAL;
  }
  const match = API_ORIGIN.exec(apiOrigin);
  const host = match?.[1];
  if (host !== undefined) {
    return `${host}:${String(MAP_SPIKE_PORT)}`;
  }
  return LOCAL;
}
