import type { TraceStatistics } from "../types";

function finite(values: Float64Array | null): number[] {
  if (!values) return [];
  return Array.from(values).filter(Number.isFinite);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function traceStatistics(
  input: Float64Array,
  error: Float64Array | null = null
): TraceStatistics {
  const values = finite(input);
  const errors = finite(error);
  const n = values.length;
  const average = n ? mean(values) : Number.NaN;
  let std = Number.NaN;
  if (n > 1) {
    let squares = 0;
    for (const value of values) squares += (value - average) ** 2;
    std = Math.sqrt(squares / (n - 1));
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(n / 2);
  const median =
    n === 0
      ? Number.NaN
      : n % 2
        ? ordered[middle]
        : (ordered[middle - 1] + ordered[middle]) / 2;
  return {
    n,
    meanY: average,
    meanError: errors.length ? mean(errors) : Number.NaN,
    stdY: std,
    semY: n > 1 ? std / Math.sqrt(n) : Number.NaN,
    medianY: median,
    minY: n ? ordered[0] : Number.NaN,
    maxY: n ? ordered[n - 1] : Number.NaN
  };
}
