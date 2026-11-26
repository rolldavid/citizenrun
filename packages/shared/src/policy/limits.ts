// The product limits this module owns (L-limits, D-475). A limit another element owns keeps its one
// constant there and is not repeated here.

export const LIMITS = {
  clientErrorBytes: 4_096, // L-limits
  followsPerDay: { newAccount: 100, established: 400 }, // L-limits
  fieldReportsPerDay: 10, // L-limits
  reportNoteChars: 1_000, // L-limits
} as const;
