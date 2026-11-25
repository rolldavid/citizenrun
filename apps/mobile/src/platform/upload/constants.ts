// The upload module's own limits (PM-upload, PC6C-20). The byte limit and the file extensions are
// `PHOTO_MAX_BYTES` and `UPLOAD_EXTENSIONS` of `@citizenrun/shared`, never repeated here.

/** The widest a prepared photo may be, in pixels; a narrower source is never enlarged. */
export const PHOTO_MAX_WIDTH = 1080;

/** The JPEG quality of the first encode. */
export const PHOTO_JPEG_QUALITY = 0.85;

/** The JPEG quality of the one second encode, when the first is over `PHOTO_MAX_BYTES`. */
export const PHOTO_JPEG_QUALITY_RETRY = 0.7;
