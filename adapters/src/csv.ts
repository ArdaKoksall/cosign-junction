export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (cols[i] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}
