// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSpectrum } from "../../src/analysis/core";
import { prepareTrace } from "../../src/analysis/preprocessing/core";
import type { PreprocessConfig, SpectrumConfig } from "../../src/analysis/types";

interface Expected {
  frequency: number[];
  value: number[];
  fftReal: number[];
  fftImag: number[];
  traceX: number[];
  traceY: number[];
  window: number[];
  nInput: number;
  nFft: number;
  dx: number;
  samplingFrequency: number;
  nyquist: number;
  frequencySpacing: number;
}

interface Fixture {
  input: { x: number[]; y: number[] };
  cases: Array<{
    name: string;
    preprocess: PreprocessConfig;
    spectrum: SpectrumConfig;
    expected: Expected;
  }>;
}

const fixturePath = resolve(process.cwd(), "tests", "fixtures", "oracle.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

function compare(actual: ArrayLike<number>, expected: number[], rtol = 1e-10) {
  expect(actual.length).toBe(expected.length);
  let scale = 1;
  for (const value of expected) scale = Math.max(scale, Math.abs(value));
  const atol = 1e-12 * scale;
  for (let index = 0; index < expected.length; index += 1) {
    const difference = Math.abs(actual[index] - expected[index]);
    expect(
      difference <= atol + rtol * Math.abs(expected[index]),
      `index ${index}: ${actual[index]} vs ${expected[index]}`
    ).toBe(true);
  }
}

function comparePhase(
  actual: ArrayLike<number>,
  expected: Expected,
  normalization: SpectrumConfig["normalization"]
) {
  let peakMagnitude = 0;
  let peakDisplayedPhase = 0;
  const magnitudes = expected.fftReal.map((real, index) =>
    Math.hypot(real, expected.fftImag[index])
  );
  for (const magnitude of magnitudes) peakMagnitude = Math.max(peakMagnitude, magnitude);
  for (const value of expected.value) {
    peakDisplayedPhase = Math.max(peakDisplayedPhase, Math.abs(value));
  }
  if (normalization === "unit integrated power") {
    const stable = expected.value
      .map((value, index) => ({ value, index }))
      .filter(
        ({ value, index }) =>
          magnitudes[index] > peakMagnitude * 1e-12 &&
          Math.abs(value) > 1e-8 &&
          Math.abs(value) < peakDisplayedPhase * 0.9
      );
    if (stable.length > 1) {
      const reference = stable[0].index;
      for (const { index } of stable.slice(1)) {
        const actualRatio = actual[index] / actual[reference];
        const expectedRatio = expected.value[index] / expected.value[reference];
        expect(
          Math.abs(actualRatio - expectedRatio) <=
            1e-10 * Math.max(1, Math.abs(expectedRatio)),
          `phase ratio ${index}/${reference}: ${actualRatio} vs ${expectedRatio}`
        ).toBe(true);
      }
    }
    return;
  }
  for (let index = 0; index < expected.value.length; index += 1) {
    if (magnitudes[index] <= peakMagnitude * 1e-12) continue;
    let difference = Math.abs(actual[index] - expected.value[index]);
    const scaled = ["unit peak", "unit integrated power"].includes(normalization);
    if (!scaled) {
      difference = Math.abs(
        Math.atan2(
          Math.sin(actual[index] - expected.value[index]),
          Math.cos(actual[index] - expected.value[index])
        )
      );
    } else if (
      Math.sign(actual[index]) !== Math.sign(expected.value[index]) &&
      Math.abs(Math.abs(actual[index]) - peakDisplayedPhase) <= 1e-10 &&
      Math.abs(Math.abs(expected.value[index]) - peakDisplayedPhase) <= 1e-10
    ) {
      // atan2 may choose +π or -π at the negative real-axis branch cut.
      // Unit normalization scales that equivalent endpoint representation.
      difference = 0;
    }
    expect(
      difference <= 1e-12 + 1e-10 * Math.abs(expected.value[index]),
      `phase index ${index}: ${actual[index]} vs ${expected.value[index]}`
    ).toBe(true);
  }
}

describe("Python oracle", () => {
  it.each(fixture.cases)("$name", ({ preprocess, spectrum, expected }) => {
    const trace = prepareTrace(
      Float64Array.from(fixture.input.x),
      Float64Array.from(fixture.input.y),
      preprocess
    );
    const result = computeSpectrum(trace, spectrum);
    expect(result.nInput).toBe(expected.nInput);
    expect(result.nFft).toBe(expected.nFft);
    compare(result.trace.x, expected.traceX, 1e-12);
    compare(result.trace.y, expected.traceY, 1e-12);
    compare(result.windowValues, expected.window, 1e-12);
    compare(result.frequency, expected.frequency, 1e-12);
    compare(result.fftReal, expected.fftReal);
    compare(result.fftImag, expected.fftImag);
    if (spectrum.quantity === "phase") {
      comparePhase(result.value, expected, spectrum.normalization);
    } else {
      compare(result.value, expected.value);
    }
    for (const [actual, reference] of [
      [result.dx, expected.dx],
      [result.samplingFrequency, expected.samplingFrequency],
      [result.nyquist, expected.nyquist],
      [result.frequencySpacing, expected.frequencySpacing]
    ]) {
      expect(Math.abs(actual - reference)).toBeLessThanOrEqual(
        1e-12 * Math.max(1, Math.abs(reference))
      );
    }
  });
});
