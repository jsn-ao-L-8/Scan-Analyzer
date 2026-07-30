import Papa from "papaparse";
import type { NumericDataset } from "../analysis/types";
import { stableColor } from "../data/datasets";

const MISSING_VALUES = new Set(["", "nan"]);

function parseNumber(value: string): number {
  const trimmed = value.trim();
  if (MISSING_VALUES.has(trimmed.toLocaleLowerCase())) return Number.NaN;
  if (/^[+-]?(?:inf(?:inity)?)$/i.test(trimmed)) {
    return trimmed.startsWith("-") ? -Infinity : Infinity;
  }
  const number = Number(trimmed);
  return number;
}

export function parseCsvText(
  text: string,
  source: { name: string; size?: number; lastModified?: number }
): NumericDataset {
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: false
  });
  const fatal = parsed.errors.filter(
    (error) => error.code !== "UndetectableDelimiter"
  );
  if (fatal.length) {
    const first = fatal[0];
    throw new Error(
      `${first.message}${typeof first.row === "number" ? ` at row ${first.row + 1}` : ""}.`
    );
  }
  const rows = parsed.data;
  if (!rows.length) throw new Error("The scan contains no columns.");
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  if (!headers.length || headers.every((header) => !header)) {
    throw new Error("The scan contains no columns.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("Duplicate column names are not supported.");
  }
  const dataRows = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  if (!dataRows.length) throw new Error("The scan contains no data rows.");
  for (let index = 0; index < dataRows.length; index += 1) {
    if (dataRows[index].length !== headers.length) {
      throw new Error(
        `Row ${index + 2} has ${dataRows[index].length} fields; expected ${headers.length}.`
      );
    }
  }

  const data: Record<string, Float64Array> = {};
  const numericColumns: string[] = [];
  headers.forEach((header, columnIndex) => {
    const raw = dataRows.map((row) => row[columnIndex] ?? "");
    const converted = raw.map(parseNumber);
    const hasNumeric = converted.some((value) => !Number.isNaN(value));
    if (!hasNumeric) return;
    const invalidRows = converted
      .map((value, rowIndex) => ({ value, rowIndex, raw: raw[rowIndex] }))
      .filter(
        ({ value, raw: cell }) =>
          Number.isNaN(value) && !MISSING_VALUES.has(cell.trim().toLocaleLowerCase())
      )
      .slice(0, 5);
    if (invalidRows.length) {
      const rowNumbers = invalidRows.map(({ rowIndex }) => rowIndex + 2).join(", ");
      throw new Error(
        `Column ${JSON.stringify(header)} contains non-numeric values at rows ${rowNumbers}.`
      );
    }
    numericColumns.push(header);
    data[header] = Float64Array.from(converted);
  });
  if (!numericColumns.length) throw new Error("The scan has no numeric columns.");
  const numericExtents = Object.fromEntries(
    numericColumns.map((column) => {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const value of data[column]) {
        if (Number.isFinite(value)) {
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      return [
        column,
        Number.isFinite(minimum) ? ([minimum, maximum] as [number, number]) : null
      ];
    })
  );

  const key = `${source.name}:${source.size ?? text.length}:${source.lastModified ?? 0}`;
  return {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: source.name,
    size: source.size ?? text.length,
    lastModified: source.lastModified ?? 0,
    columns: headers,
    numericColumns,
    numericExtents,
    data,
    rowCount: dataRows.length,
    color: stableColor(key)
  };
}

export async function parseCsvFile(file: File): Promise<NumericDataset> {
  const text = await file.text();
  if (!file.name.toLocaleLowerCase().endsWith(".csv") && !text.split(/\r?\n/, 1)[0].includes(",")) {
    throw new Error("The selected extensionless file does not look like comma-separated data.");
  }
  return parseCsvText(text, file);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(","))
  ].join("\r\n");
}
