import { fftFrequencies, fftShift, forwardReal, nextPowerOfTwo } from "./fft/fft";
import type {
  PreparedTrace,
  SpectrumConfig,
  SpectrumResult,
  WindowMode
} from "./types";

export function windowValues(name: WindowMode, length: number): Float64Array {
  const values = new Float64Array(length);
  if (name === "rectangular") {
    values.fill(1);
    return values;
  }
  for (let index = 0; index < length; index += 1) {
    const angle = 2 * Math.PI * index / (length - 1);
    if (name === "hann") values[index] = 0.5 - 0.5 * Math.cos(angle);
    else if (name === "hamming") values[index] = 0.54 - 0.46 * Math.cos(angle);
    else if (name === "blackman") {
      values[index] = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
    } else throw new Error(`Unknown window mode: ${String(name)}`);
  }
  return values;
}

export function fftLength(inputLength: number, config: SpectrumConfig): number {
  if (config.paddingMode === "points per side") {
    if (!Number.isInteger(config.paddingPointsEachSide) || config.paddingPointsEachSide < 0) {
      throw new Error("Padding points cannot be negative.");
    }
    return inputLength + 2 * config.paddingPointsEachSide;
  }
  if (config.paddingMode === "next power of two") return nextPowerOfTwo(inputLength);
  if (config.paddingMode === "2x length") return 2 * inputLength;
  if (config.paddingMode === "4x length") return 4 * inputLength;
  throw new Error(`Unknown padding mode: ${String(config.paddingMode)}`);
}

export function computeSpectrum(
  trace: PreparedTrace,
  config: SpectrumConfig
): SpectrumResult {
  const n = trace.y.length;
  if (n < 2) throw new Error("At least two points are required for an FFT.");
  let dx = 0;
  for (let index = 1; index < trace.x.length; index += 1) {
    dx += trace.x[index] - trace.x[index - 1];
  }
  dx /= trace.x.length - 1;
  const nFft = fftLength(n, config);
  const window = windowValues(config.window, n);
  const signal = Float64Array.from(trace.y, (value, index) => value * window[index]);
  let fft = forwardReal(signal, nFft);
  let frequency = fftFrequencies(nFft, dx);
  const scale = new Float64Array(nFft);
  scale.fill(1);
  if (config.normalization === "fft length") {
    for (let index = 0; index < nFft; index += 1) scale[index] /= n;
  } else if (config.normalization === "coherent gain") {
    let gain = 0;
    for (const value of window) gain += value;
    if (gain === 0) throw new Error("The selected window has zero coherent gain.");
    for (let index = 0; index < nFft; index += 1) scale[index] /= gain;
  }

  let value: Float64Array = new Float64Array(nFft);
  for (let index = 0; index < nFft; index += 1) {
    const magnitude = Math.hypot(fft.real[index], fft.imag[index]);
    if (config.quantity === "amplitude") value[index] = magnitude * scale[index];
    else if (config.quantity === "power") value[index] = (magnitude * scale[index]) ** 2;
    else if (config.quantity === "phase") {
      value[index] = Math.atan2(fft.imag[index], fft.real[index]);
    } else if (config.quantity === "real") value[index] = fft.real[index] * scale[index];
    else if (config.quantity === "imaginary") value[index] = fft.imag[index] * scale[index];
  }
  if (config.quantity === "power spectral density") {
    let windowPower = 0;
    for (const item of window) windowPower += item ** 2;
    const denominator = Math.abs(1 / dx) * windowPower;
    for (let index = 0; index < nFft; index += 1) {
      value[index] = (fft.real[index] ** 2 + fft.imag[index] ** 2) / denominator;
    }
  }
  if (
    config.quantity === "amplitude" &&
    config.normalization === "coherent gain" &&
    !config.twoSided
  ) {
    for (let index = 1; index < nFft; index += 1) value[index] *= 2;
  }

  if (config.normalization === "unit peak") {
    let peak = 0;
    for (const item of value) peak = Math.max(peak, Math.abs(item));
    if (peak) for (let index = 0; index < nFft; index += 1) value[index] /= peak;
  } else if (config.normalization === "unit integrated power") {
    let power = 0;
    const alreadyPower =
      config.quantity === "power" || config.quantity === "power spectral density";
    for (const item of value) power += alreadyPower ? Math.abs(item) : Math.abs(item) ** 2;
    const integral = power / (nFft * Math.abs(dx));
    if (integral) {
      const divisor = Math.sqrt(Math.abs(integral));
      for (let index = 0; index < nFft; index += 1) value[index] /= divisor;
    }
  } else if (
    !["none", "fft length", "coherent gain"].includes(config.normalization)
  ) {
    throw new Error(`Unknown normalization: ${String(config.normalization)}`);
  }

  if (config.twoSided) {
    frequency = fftShift(frequency);
    value = fftShift(value);
    fft = { real: fftShift(fft.real), imag: fftShift(fft.imag) };
  } else {
    let count = 0;
    while (count < frequency.length && frequency[count] >= 0) count += 1;
    frequency = frequency.slice(0, count);
    value = value.slice(0, count);
    fft = { real: fft.real.slice(0, count), imag: fft.imag.slice(0, count) };
  }

  return {
    frequency,
    value,
    fftReal: fft.real,
    fftImag: fft.imag,
    trace,
    windowValues: window,
    nInput: n,
    nFft,
    dx,
    samplingFrequency: 1 / Math.abs(dx),
    nyquist: 1 / (2 * Math.abs(dx)),
    frequencySpacing: 1 / (nFft * Math.abs(dx))
  };
}
