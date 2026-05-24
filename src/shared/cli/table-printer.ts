export function printTable(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const normalizedRows = rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
  const widths = headers.map((header, idx) => {
    const maxCell = Math.max(...normalizedRows.map((row) => row[idx]?.length ?? 0), 0);
    return Math.max(header.length, maxCell);
  });

  const format = (values: string[]) => values.map((value, idx) => value.padEnd(widths[idx] ?? value.length)).join(" | ");

  console.log(format(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
  for (const row of normalizedRows) {
    console.log(format(row));
  }
}
