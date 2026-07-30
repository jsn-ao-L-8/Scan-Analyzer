import { describe, expect, it } from "vitest";
import { computeSpectrum, fftLength, windowValues } from "../../src/analysis/core";
import { fftFrequencies, forwardReal } from "../../src/analysis/fft/fft";
import { prepareTrace } from "../../src/analysis/preprocessing/core";
import { traceStatistics } from "../../src/analysis/statistics/core";
import {
  DEFAULT_PREPROCESS,
  DEFAULT_SPECTRUM,
  type SpectrumConfig
} from "../../src/analysis/types";
import { validateRangeBounds } from "../../src/analysis/validation/core";

function naiveDft(input: number[]): { real: number[]; imag: number[] } {
  const real: number[] = [];
  const imag: number[] = [];
  for (let k = 0; k < input.length; k += 1) {
    let sumReal = 0;
    let sumImag = 0;
    for (let n = 0; n < input.length; n += 1) {
      const angle = -2 * Math.PI * k * n / input.length;
      sumReal += input[n] * Math.cos(angle);
      sumImag += input[n] * Math.sin(angle);
    }
    real.push(sumReal);
    imag.push(sumImag);
  }
  return { real, imag };
}

function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 1e-10) {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(Math.abs(actual[index] - expected[index])).toBeLessThanOrEqual(
      tolerance * Math.max(1, Math.abs(expected[index]))
    );
  }
}

describe("arbitrary-length FFT", () => {
  for (const length of [3, 4, 5, 8, 11, 16, 30]) {
    it(`matches a direct DFT for length ${length}`, () => {
      const input = Array.from({ length }, (_, index) =>
        Math.sin(index * 0.73) + 0.2 * Math.cos(index * 1.1)
      );
      const expected = naiveDft(input);
      const actual = forwardReal(Float64Array.from(input));
      expectClose(actual.real, expected.real);
      expectClose(actual.imag, expected.imag);
    });
  }

  it("matches NumPy frequency ordering", () => {
    expect(Array.from(fftFrequencies(4, 0.5))).toEqual([0, 0.5, -1, -0.5]);
    expect(Array.from(fftFrequencies(5, 0.5))).toEqual([0, 0.4, 0.8, -0.8, -0.4]);
  });
});

describe("trace preparation", () => {
  it("sorts, resamples, and linearly detrends descending X", () => {
    const x = Float64Array.from([3, 1.9, 1, 0]);
    const y = Float64Array.from(x, (value) => 2 * value + 1);
    const trace = prepareTrace(x, y, { ...DEFAULT_PREPROCESS, detrend: "linear" });
    expect(trace.interpolated).toBe(true);
    expectClose(trace.y, new Float64Array(4), 1e-12);
  });

  it("rejects duplicate X", () => {
    expect(() =>
      prepareTrace(
        Float64Array.from([0, 1, 1]),
        Float64Array.from([1, 2, 3]),
        DEFAULT_PREPROCESS
      )
    ).toThrow(/Duplicate/);
  });

  it("rejects nonuniform X when resampling is disabled", () => {
    expect(() =>
      prepareTrace(
        Float64Array.from([0, 1, 2.2]),
        Float64Array.from([1, 2, 3]),
        { ...DEFAULT_PREPROCESS, resampleNonuniform: false }
      )
    ).toThrow(/nonuniform/);
  });
});

describe("spectrum compatibility", () => {
  it("recovers coherent-gain sine amplitude through all windows", () => {
    const x = Float64Array.from({ length: 1000 }, (_, index) => index * 0.01);
    const y = Float64Array.from(x, (value) => 3 * Math.sin(2 * Math.PI * 7 * value));
    const trace = prepareTrace(x, y, DEFAULT_PREPROCESS);
    for (const window of ["rectangular", "hann", "hamming", "blackman"] as const) {
      const result = computeSpectrum(trace, { ...DEFAULT_SPECTRUM, window });
      let peak = 0;
      for (let index = 1; index < result.value.length; index += 1) {
        if (result.value[index] > result.value[peak]) peak = index;
      }
      expect(result.frequency[peak]).toBeCloseTo(7, 9);
      expect(result.value[peak]).toBeCloseTo(3, 2);
    }
  });

  it("implements all padding lengths", () => {
    const base = DEFAULT_SPECTRUM;
    const config = (paddingMode: SpectrumConfig["paddingMode"]): SpectrumConfig => ({
      ...base,
      paddingMode
    });
    expect(fftLength(300, config("next power of two"))).toBe(512);
    expect(fftLength(300, config("2x length"))).toBe(600);
    expect(fftLength(300, config("4x length"))).toBe(1200);
    expect(
      fftLength(300, { ...config("points per side"), paddingPointsEachSide: 11 })
    ).toBe(322);
  });

  it("produces finite output for every quantity and normalization", () => {
    const x = Float64Array.from({ length: 31 }, (_, index) => index * 0.1);
    const y = Float64Array.from(x, (value) => Math.sin(2 * Math.PI * value));
    const trace = prepareTrace(x, y, DEFAULT_PREPROCESS);
    const quantities = [
      "amplitude", "power", "power spectral density", "phase", "real", "imaginary"
    ] as const;
    const normalizations = [
      "none", "fft length", "coherent gain", "unit peak", "unit integrated power"
    ] as const;
    for (const quantity of quantities) {
      for (const normalization of normalizations) {
        const result = computeSpectrum(trace, {
          ...DEFAULT_SPECTRUM,
          quantity,
          normalization
        });
        expect(Array.from(result.value).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("unit-integrated phase satisfies the reference normalization invariant", () => {
    const x = Float64Array.from({ length: 31 }, (_, index) => index * 0.1);
    const y = Float64Array.from(x, (value) => Math.sin(2 * Math.PI * value) + 0.2);
    const trace = prepareTrace(x, y, { ...DEFAULT_PREPROCESS, detrend: "none" });
    const result = computeSpectrum(trace, {
      ...DEFAULT_SPECTRUM,
      quantity: "phase",
      normalization: "unit integrated power",
      twoSided: true
    });
    let power = 0;
    for (const value of result.value) power += Math.abs(value) ** 2;
    expect(power / (result.nFft * Math.abs(result.dx))).toBeCloseTo(1, 12);
  });

  it("builds NumPy-compatible windows", () => {
    expectClose(windowValues("hann", 5), Float64Array.from([0, 0.5, 1, 0.5, 0]), 1e-15);
  });
});

describe("validation and statistics", () => {
  it("validates FFT bounds", () => {
    expect(validateRangeBounds("1", "4", [0, 5])).toEqual([1, 4]);
    expect(() => validateRangeBounds("4", "1", [0, 5])).toThrow();
    expect(() => validateRangeBounds("-1", "4", [0, 5])).toThrow();
  });

  it("matches sample statistics semantics", () => {
    const stats = traceStatistics(
      Float64Array.from([1, 2, Number.NaN, 3]),
      Float64Array.from([0.1, 0.2, Number.NaN, 0.3])
    );
    expect(stats.n).toBe(3);
    expect(stats.meanY).toBe(2);
    expect(stats.semY).toBeCloseTo(1 / Math.sqrt(3), 14);
  });
});
