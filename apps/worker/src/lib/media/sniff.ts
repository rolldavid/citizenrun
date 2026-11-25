// CTL-06: the first bytes of an upload must announce the family its declared type names, before
// any decoder sees them.

export type ImageFamily = 'jpeg' | 'png' | 'webp';

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
// 'RIFF' at offset 0 and 'WEBP' at offset 8.
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const;
const WEBP_OFFSET = 8;

function hasBytesAt(head: Uint8Array, bytes: readonly number[], offset: number): boolean {
  if (head.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/** The family the first bytes announce: JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP 'RIFF' at 0 and 'WEBP' at 8; otherwise null. */
export function sniffImage(head: Uint8Array): ImageFamily | null {
  if (hasBytesAt(head, JPEG_MAGIC, 0)) {
    return 'jpeg';
  }
  if (hasBytesAt(head, PNG_MAGIC, 0)) {
    return 'png';
  }
  if (hasBytesAt(head, RIFF_MAGIC, 0) && hasBytesAt(head, WEBP_MAGIC, WEBP_OFFSET)) {
    return 'webp';
  }
  return null;
}

/** image/jpeg, image/png, image/webp to their family; anything else null. */
export function familyOfContentType(contentType: string): ImageFamily | null {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}
