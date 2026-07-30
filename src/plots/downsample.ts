export interface Downsampled {
  x: number[];
  y: number[];
  sourceIndices: number[];
}

/** Preserve endpoints plus the min/max Y point from each screen-sized bucket. */
export function minMaxDownsample(
  x: Float64Array,
  y: Float64Array,
  maxPoints = 5000
): Downsampled {
  if (x.length <= maxPoints) {
    return {
      x: Array.from(x),
      y: Array.from(y),
      sourceIndices: Array.from({ length: x.length }, (_, index) => index)
    };
  }
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = (x.length - 2) / bucketCount;
  const indices = [0];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.max(1, Math.floor(1 + bucket * bucketSize));
    const end = Math.min(x.length - 1, Math.floor(1 + (bucket + 1) * bucketSize));
    let min = start;
    let max = start;
    for (let index = start + 1; index < end; index += 1) {
      if (y[index] < y[min]) min = index;
      if (y[index] > y[max]) max = index;
    }
    if (min === max) indices.push(min);
    else indices.push(...(min < max ? [min, max] : [max, min]));
  }
  indices.push(x.length - 1);
  const unique = indices.filter((value, index) => index === 0 || value !== indices[index - 1]);
  return {
    x: unique.map((index) => x[index]),
    y: unique.map((index) => y[index]),
    sourceIndices: unique
  };
}
