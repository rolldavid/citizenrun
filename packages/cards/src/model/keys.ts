/** A kebab-case id as the camelCase segment of a catalog key: `data-centers-ai` is `dataCentersAi`. */
export function camelKey(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, first: string) => first.toUpperCase());
}
