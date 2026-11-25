import sharp from 'sharp';

/** Threads libvips may use for one image at a time in this process. */
export const SHARP_CONCURRENCY = 2; // D-250

/**
 * The image library's process-wide settings (D-250): no operation cache, so a decoded upload never
 * outlives its job in memory, and at most SHARP_CONCURRENCY threads. Called once, at boot.
 */
export function configureSharp(): void {
  sharp.cache(false);
  sharp.concurrency(SHARP_CONCURRENCY);
}
