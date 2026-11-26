/** The `Cache-Control` value of each operation that has its own row in L-cache-headers. */
export const CACHE_CONTROL_BY_OPERATION: Readonly<Record<string, string>> = {
  getOpenApiDocument: 'public, max-age=300', // E-REF-03
  listIssues: 'public, max-age=3600', // E-REF-01
};
