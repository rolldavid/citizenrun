// PM-map-spike on the web: the camera limits, each set on its own so one refused value does not leave the others
// at their old values. Library errors stay inside the module.

/** The three setters of a MapLibre GL JS map the camera limits use. */
export type CameraLimitTarget = {
  setMaxBounds(bounds: [number, number, number, number] | null): unknown;
  setMinZoom(zoom: number): unknown;
  setMaxZoom(zoom: number): unknown;
};

/** Applies the bounds and both zoom limits; returns how many setters threw. */
export function applyCameraLimits(
  map: CameraLimitTarget,
  bounds: [number, number, number, number] | null,
  minZoom: number,
  maxZoom: number,
): number {
  const steps = [
    () => map.setMaxBounds(bounds),
    () => map.setMinZoom(minZoom),
    () => map.setMaxZoom(maxZoom),
  ];
  let failed = 0;
  for (const step of steps) {
    try {
      step();
    } catch {
      failed += 1;
    }
  }
  return failed;
}
