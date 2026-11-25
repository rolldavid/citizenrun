// The address form of the daily keyed address hash (CTL-07).

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-fA-F]{1,4}$/;
const IPV6_GROUPS = 8;
const IPV4_MAX_PART = 255;
const MAPPED_MARKER = 0xffff;
const PREFIX_GROUPS = 4; // CTL-07: an IPv6 address is hashed by its /64

function parseIpv4(text: string): number[] | null {
  const match = IPV4_PATTERN.exec(text);
  if (match === null) {
    return null;
  }
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= IPV4_MAX_PART) ? parts : null;
}

function parseGroups(text: string, endsAddress: boolean): number[] | null {
  if (text === '') {
    return [];
  }
  const groups: number[] = [];
  const parts = text.split(':');
  for (const [index, part] of parts.entries()) {
    const isLast = endsAddress && index === parts.length - 1;
    const v4 = isLast && part.includes('.') ? parseIpv4(part) : null;
    if (v4 !== null) {
      const [a = 0, b = 0, c = 0, d = 0] = v4;
      groups.push(a * 256 + b, c * 256 + d);
    } else if (IPV6_GROUP_PATTERN.test(part)) {
      groups.push(Number.parseInt(part, 16));
    } else {
      return null;
    }
  }
  return groups;
}

function parseIpv6(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const [headText = '', tailText] = halves;
  const head = parseGroups(headText, tailText === undefined);
  if (head === null) {
    return null;
  }
  if (tailText === undefined) {
    return head.length === IPV6_GROUPS ? head : null;
  }
  const tail = parseGroups(tailText, true);
  if (tail === null || head.length + tail.length >= IPV6_GROUPS) {
    return null;
  }
  const zeros = new Array<number>(IPV6_GROUPS - head.length - tail.length).fill(0);
  return [...head, ...zeros, ...tail];
}

/**
 * The canonical form of a client address: IPv4 as dotted decimal, an IPv4-mapped IPv6 address as
 * its IPv4 form, any other IPv6 address as its /64, and any other text trimmed and lower-cased.
 */
export function normalizeAddress(addr: string): string {
  const trimmed = addr.trim();
  let text = trimmed;
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1);
  }
  const zone = text.indexOf('%');
  if (zone >= 0) {
    text = text.slice(0, zone);
  }
  const v4 = parseIpv4(text);
  if (v4 !== null) {
    return v4.join('.');
  }
  const groups = parseIpv6(text);
  if (groups !== null) {
    const isMapped =
      groups.slice(0, 5).every((group) => group === 0) && groups[5] === MAPPED_MARKER;
    if (isMapped) {
      const [high = 0, low = 0] = groups.slice(6);
      return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    }
    return `${groups
      .slice(0, PREFIX_GROUPS)
      .map((group) => group.toString(16))
      .join(':')}::/64`;
  }
  // A malformed header value is hashed as text and never throws (CTL-07).
  return trimmed.toLowerCase();
}
