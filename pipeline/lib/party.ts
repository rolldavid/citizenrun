// Party labels to party keys (PIPE-data-parties). A label is never mapped to a party it does not name.
import type { PartiesFile } from './data-files.ts';

/** The longest party key (PartySchema). */
const PARTY_KEY_MAX = 40;

/**
 * The party key of a label: an alias list's key, null for an empty or nonpartisan label, else the
 * label's words in snake_case, starting with a letter and at most 40 characters.
 */
export function normaliseParty(label: string, parties: PartiesFile): string | null {
  let value = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (value.startsWith('prefers ')) {
    value = value.slice('prefers '.length);
  }
  if (value.endsWith(' party')) {
    value = value.slice(0, -' party'.length);
  }
  if (value === '' || parties.nonpartisan.includes(value)) {
    return null;
  }
  for (const [key, aliases] of Object.entries(parties.aliases)) {
    if (aliases.includes(value)) {
      return key;
    }
  }
  const snake = value
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, PARTY_KEY_MAX)
    .replace(/_+$/, '');
  return snake === '' ? null : snake;
}
