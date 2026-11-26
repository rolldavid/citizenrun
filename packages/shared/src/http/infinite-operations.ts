/**
 * Operation ids of the paged GET operations, sorted: each takes a `cursor` query parameter and
 * answers `{ items, nextCursor }`. Orval gives each of them an infinite-query hook.
 */
export const INFINITE_OPERATIONS: readonly string[] = ['listOfficeCandidates'];
