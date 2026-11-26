import { v5 } from 'uuid';

export const CIVIC_ID_NAMESPACE = '6f1c2a54-8f0b-4d6e-9b7a-2c5e8d3f1a90';

export type CivicTable =
  | 'jurisdictions'
  | 'districts'
  | 'offices'
  | 'elections'
  | 'filing_tracks'
  | 'results'
  | 'people'
  | 'officeholders'
  | 'candidacies'
  | 'unmatched_filings'
  | 'forms';

/** The id of a civic row (L-civic-id). Same inputs, same id, in every environment; the key is used exactly as given. */
export function civicId(table: CivicTable, key: string): string {
  return v5(`${table}:${key}`, CIVIC_ID_NAMESPACE);
}
