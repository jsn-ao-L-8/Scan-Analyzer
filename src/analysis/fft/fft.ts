import FFT from "fft.js";

export interface ComplexTransform {
  real: Float64Array;
  imag: Float64Array;
}

function isPowerOfTwo(value: number): boolean {
  return value > 1 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("FFT length must be a positive safe integer.");
  }
  return 2 ** Math.ceil(Math.log2(value));
}

function transformPowerOfTwo(real: ArrayLike<number>, imag?: ArrayLike<number>): ComplexTransform {
  const n = real.length;
  const fft = new FFT(n);
  const input = fft.createComplexArray() as number[];
  const output = fft.createComplexArray() as number[];
  for (let index = 0; index < n; index += 1) {
    input[2 * index] = real[index];
    input[2 * index + 1] = imag?.[index] ?? 0;
  }
  fft.transform(output, input);
  const outputReal = new Float64Array(n);
  const outputImag = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    outputReal[index] = output[2 * index];
    outputImag[index] = output[2 * index + 1];
  }
  return { real: outputReal, imag: outputImag };
}

function inversePowerOfTwo(real: ArrayLike<number>, imag: ArrayLike<number>): ComplexTransform {
  const n = real.length;
  const fft = new FFT(n);
  const input = fft.createComplexArray() as number[];
  const output = fft.createComplexArray() as number[];
  for (let index = 0; index < n; index += 1) {
    input[2 * index] = real[index];
    input[2 * index + 1] = imag[index];
  }
  fft.inverseTransform(output, input);
  const outputReal = new Float64Array(n);
  const outputImag = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    outputReal[index] = output[2 * index];
    outputImag[index] = output[2 * index + 1];
  }
  return { real: outputReal, imag: outputImag };
}

/**
 * NumPy-compatible, unnormalized forward DFT. Power-of-two lengths use fft.js;
 * arbitrary lengths use Bluestein's chirp-z reduction to a power-of-two
 * convolution. All arithmetic remains float64.
 */
export function forwardReal(input: Float64Array, length = input.length): ComplexTransform {
  if (!Number.isSafeInteger(length) || length < 2) {
    throw new Error("At least two points are required for an FFT.");
  }
  const padded = new Float64Array(length);
  padded.set(input.subarray(0, Math.min(input.length, length)));
  if (isPowerOfTwo(length)) return transformPowerOfTwo(padded);

  const convolutionLength = nextPowerOfTwo(2 * length - 1);
  const aReal = new Float64Array(convolutionLength);
  const aImag = new Float64Array(convolutionLength);
  const bReal = new Float64Array(convolutionLength);
  const bImag = new Float64Array(convolutionLength);

  for (let index = 0; index < length; index += 1) {
    // Reduce the square modulo 2N before converting to Number to retain phase
    // accuracy for large transforms.
    const squareMod = (index * index) % (2 * length);
    const angle = Math.PI * squareMod / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    aReal[index] = padded[index] * cosine;
    aImag[index] = -padded[index] * sine;
    bReal[index] = cosine;
    bImag[index] = sine;
    if (index !== 0) {
      bReal[convolutionLength - index] = cosine;
      bImag[convolutionLength - index] = sine;
    }
  }

  const aFft = transformPowerOfTwo(aReal, aImag);
  const bFft = transformPowerOfTwo(bReal, bImag);
  const productReal = new Float64Array(convolutionLength);
  const productImag = new Float64Array(convolutionLength);
  for (let index = 0; index < convolutionLength; index += 1) {
    productReal[index] =
      aFft.real[index] * bFft.real[index] - aFft.imag[index] * bFft.imag[index];
    productImag[index] =
      aFft.real[index] * bFft.imag[index] + aFft.imag[index] * bFft.real[index];
  }
  const convolution = inversePowerOfTwo(productReal, productImag);
  const outputReal = new Float64Array(length);
  const outputImag = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const squareMod = (index * index) % (2 * length);
    const angle = Math.PI * squareMod / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    outputReal[index] =
      convolution.real[index] * cosine + convolution.imag[index] * sine;
    outputImag[index] =
      convolution.imag[index] * cosine - convolution.real[index] * sine;
  }
  return { real: outputReal, imag: outputImag };
}

export function fftFrequencies(length: number, spacing: number): Float64Array {
  const result = new Float64Array(length);
  const scale = length * spacing;
  const positiveEnd = Math.floor((length - 1) / 2);
  for (let index = 0; index <= positiveEnd; index += 1) result[index] = index / scale;
  for (let index = positiveEnd + 1; index < length; index += 1) {
    result[index] = (index - length) / scale;
  }
  return result;
}

export function fftShift(values: Float64Array): Float64Array {
  const result = new Float64Array(values.length);
  const shift = Math.ceil(values.length / 2);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = values[(index + shift) % values.length];
  }
  return result;
}

export { nextPowerOfTwo };
