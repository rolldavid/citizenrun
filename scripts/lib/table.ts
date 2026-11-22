/**
 * Formats a plain-text table: left-aligned columns padded to the widest cell, two spaces between
 * columns, one header line and one dashed line, no trailing spaces, lines joined with `\n`.
 */
export function formatTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const columns = Math.max(header.length, ...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    const cells = [header[column] ?? '', ...rows.map((row) => row[column] ?? '')];
    widths.push(Math.max(...cells.map((cell) => cell.length)));
  }
  const line = (cells: readonly string[]): string =>
    widths
      .map((width, column) => (cells[column] ?? '').padEnd(width))
      .join('  ')
      .trimEnd();
  const dashes = widths.map((width) => '-'.repeat(width));
  return [line(header), line(dashes), ...rows.map(line)].join('\n');
}
