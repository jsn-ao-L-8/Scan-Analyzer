import type { PreparedTrace, PreprocessConfig } from "../types";

function finitePairIndices(x: Float64Array, y: Float64Array): number[] {
  const indices: number[] = [];
  for (let index = 0; index < x.length; index += 1) {
    if (Number.isFinite(x[index]) && Number.isFinite(y[index])) indices.push(index);
  }
  return indices;
}

function select(values: Float64Array | null, indices: number[]): Float64Array | null {
  if (!values) return null;
  return Float64Array.from(indices, (index) => values[index]);
}

function interpolate(
  x: Float64Array,
  values: Float64Array,
  target: Float64Array
): Float64Array {
  const output = new Float64Array(target.length);
  let source = 0;
  for (let index = 0; index < target.length; index += 1) {
    const point = target[index];
    while (source + 1 < x.length - 1 && x[source + 1] < point) source += 1;
    if (point <= x[0]) output[index] = values[0];
    else if (point >= x[x.length - 1]) output[index] = values[values.length - 1];
    else {
      const ratio = (point - x[source]) / (x[source + 1] - x[source]);
      output[index] = values[source] + ratio * (values[source + 1] - values[source]);
    }
  }
  return output;
}

function movingAverage(values: Float64Array, requestedSize: number): Float64Array {
  if (!Number.isInteger(requestedSize) || requestedSize < 1) {
    throw new Error("Moving-average points must be at least 1.");
  }
  const size = Math.min(requestedSize, values.length);
  const left = Math.floor(size / 2);
  const right = size - 1 - left;
  const padded = new Float64Array(values.length + left + right);
  padded.fill(values[0], 0, left);
  padded.set(values, left);
  padded.fill(values[values.length - 1], left + values.length);
  const result = new Float64Array(values.length);
  let sum = 0;
  for (let index = 0; index < size; index += 1) sum += padded[index];
  result[0] = sum / size;
  for (let index = 1; index < values.length; index += 1) {
    sum += padded[index + size - 1] - padded[index - 1];
    result[index] = sum / size;
  }
  return result;
}

export function prepareTrace(
  xInput: Float64Array,
  yInput: Float64Array,
  config: PreprocessConfig,
  xErrorInput: Float64Array | null = null,
  yErrorInput: Float64Array | null = null
): PreparedTrace {
  if (xInput.length !== yInput.length) throw new Error("X and Y lengths differ.");
  if (xErrorInput && xErrorInput.length !== xInput.length) {
    throw new Error("X-error length differs from X.");
  }
  if (yErrorInput && yErrorInput.length !== xInput.length) {
    throw new Error("Y-error length differs from X.");
  }

  const finite = finitePairIndices(xInput, yInput);
  if (finite.length < 2) throw new Error("At least two finite X/Y points are required.");
  finite.sort((left, right) => xInput[left] - xInput[right] || left - right);
  let x = select(xInput, finite)!;
  let y = select(yInput, finite)!;
  let xError = select(xErrorInput, finite);
  let yError = select(yErrorInput, finite);
  for (let index = 1; index < x.length; index += 1) {
    if (x[index] - x[index - 1] === 0) throw new Error("Duplicate X values are not supported.");
  }

  const bounds = [config.xMin, config.xMax].filter(
    (value): value is number => value !== null
  );
  const low = bounds.length ? Math.min(...bounds) : -Infinity;
  const high = bounds.length ? Math.max(...bounds) : Infinity;
  const kept: number[] = [];
  for (let index = 0; index < x.length; index += 1) {
    if (x[index] >= low && x[index] <= high) kept.push(index);
  }
  x = select(x, kept)!;
  y = select(y, kept)!;
  xError = select(xError, kept);
  yError = select(yError, kept);
  if (x.length < 2) throw new Error("The selected interval contains fewer than two points.");

  let spacingSum = 0;
  for (let index = 1; index < x.length; index += 1) spacingSum += x[index] - x[index - 1];
  const dx = spacingSum / (x.length - 1);
  let maxDifference = 0;
  for (let index = 1; index < x.length; index += 1) {
    maxDifference = Math.max(maxDifference, Math.abs(x[index] - x[index - 1] - dx));
  }
  const relativeSpacingVariation = maxDifference / Math.abs(dx);
  const interpolated = relativeSpacingVariation > config.uniformityTolerance;
  if (interpolated) {
    if (!config.resampleNonuniform) {
      throw new Error(
        `X spacing is nonuniform (relative variation ${relativeSpacingVariation.toPrecision(3)}).`
      );
    }
    const uniform = Float64Array.from(
      { length: x.length },
      (_, index) => x[0] + (index * (x[x.length - 1] - x[0])) / (x.length - 1)
    );
    y = interpolate(x, y, uniform);
    if (xError) xError = interpolate(x, xError, uniform);
    if (yError) yError = interpolate(x, yError, uniform);
    x = uniform;
  }

  const yRaw = y.slice();
  if (config.detrend === "mean") {
    let sum = 0;
    for (const value of y) sum += value;
    const mean = sum / y.length;
    for (let index = 0; index < y.length; index += 1) y[index] -= mean;
  } else if (config.detrend === "linear") {
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let index = 0; index < x.length; index += 1) {
      sumX += x[index];
      sumY += y[index];
      sumXX += x[index] * x[index];
      sumXY += x[index] * y[index];
    }
    const denominator = x.length * sumXX - sumX * sumX;
    const slope = (x.length * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / x.length;
    for (let index = 0; index < y.length; index += 1) {
      y[index] -= slope * x[index] + intercept;
    }
  } else if (config.detrend === "moving average") {
    const trend = movingAverage(y, config.movingAveragePoints);
    for (let index = 0; index < y.length; index += 1) y[index] -= trend[index];
  } else if (config.detrend !== "none") {
    throw new Error(`Unknown detrend mode: ${String(config.detrend)}`);
  }

  return {
    x,
    yRaw,
    y,
    xError,
    yError,
    relativeSpacingVariation,
    interpolated
  };
}
