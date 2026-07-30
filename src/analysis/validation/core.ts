export function validateRangeBounds(
  minimumText: string,
  maximumText: string,
  overlap: [number, number] | null
): [number, number] {
  const minimum = Number(minimumText);
  const maximum = Number(maximumText);
  if (!minimumText.trim() || !maximumText.trim() || Number.isNaN(minimum) || Number.isNaN(maximum)) {
    throw new Error("FFT bounds must both be valid numbers.");
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new Error("FFT bounds must be finite numbers.");
  }
  if (minimum >= maximum) throw new Error("FFT minimum must be smaller than the maximum.");
  if (!overlap) throw new Error("No common X range is available for the selected datasets.");
  const [low, high] = overlap;
  const tolerance = Math.max(Math.abs(high - low), 1) * 1e-12;
  if (minimum < low - tolerance || maximum > high + tolerance) {
    throw new Error(
      `FFT range must stay inside the common data range [${low.toPrecision(6)}, ${high.toPrecision(6)}].`
    );
  }
  return [minimum, maximum];
}
