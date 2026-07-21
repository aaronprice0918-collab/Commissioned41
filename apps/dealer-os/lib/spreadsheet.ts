// ── Spreadsheet parsing (client) ─────────────────────────────────────────────
// Reads a .xlsx/.xls/.csv/.tsv file into headers + row objects so EILA can map its
// columns to a plan's metric keys. Uses a dynamic xlsx import (matching app/import
// and app/setup) so SheetJS isn't pulled into the initial bundle.
export type SheetData = { headers: string[]; rows: Record<string, string | number>[] };

export async function parseSheet(file: File): Promise<SheetData> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });
  // Prefer keys from the data rows; fall back to the raw header row for empty sheets.
  const headerRow = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 })[0] as (string | number)[] | undefined;
  const headers = rows.length ? Object.keys(rows[0]) : (headerRow ?? []).map(String);
  return { headers, rows };
}
