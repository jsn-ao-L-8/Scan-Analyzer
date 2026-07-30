import type { DatasetSummary, NumericDataset } from "../analysis/types";

export const X_CANDIDATES = ["delay_ps", "time_ps", "time", "x"] as const;
export const Y_CANDIDATES = [
  "x_mean",
  "r_mean",
  "y_mean",
  "mean",
  "x",
  "r",
  "y"
] as const;
export const ERROR_CANDIDATES = [
  "x_error",
  "r_error",
  "y_error",
  "error",
  "sem",
  "stderr"
] as const;

export function stableColor(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = ((hash >>> 0) * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 68% 43%)`;
}

export function firstMatch(
  candidates: readonly string[],
  columns: string[],
  fallback = ""
): string {
  const lookup = new Map(columns.map((column) => [column.toLocaleLowerCase(), column]));
  for (const candidate of candidates) {
    const match = lookup.get(candidate.toLocaleLowerCase());
    if (match) return match;
  }
  return columns[0] ?? fallback;
}

export function commonNumericColumns(
  datasets: Array<Pick<DatasetSummary | NumericDataset, "numericColumns">>
): string[] {
  if (!datasets.length) return [];
  const common = new Set(datasets[0].numericColumns);
  for (const dataset of datasets.slice(1)) {
    const present = new Set(dataset.numericColumns);
    for (const column of common) if (!present.has(column)) common.delete(column);
  }
  return datasets[0].numericColumns.filter((column) => common.has(column));
}

export function commonXOverlap(
  datasets: Array<Pick<DatasetSummary | NumericDataset, "numericExtents">>,
  xColumn: string
): [number, number] | null {
  if (!datasets.length || !xColumn) return null;
  let low = -Infinity;
  let high = Infinity;
  for (const dataset of datasets) {
    const extent = dataset.numericExtents[xColumn];
    if (!extent) return null;
    low = Math.max(low, extent[0]);
    high = Math.min(high, extent[1]);
  }
  return low < high ? [low, high] : null;
}
