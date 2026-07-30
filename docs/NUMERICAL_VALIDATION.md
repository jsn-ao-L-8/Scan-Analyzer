# Numerical validation policy

The unchanged Python `Analyzer/analysis_core.py` is the numerical oracle.
`tools/python/generate_fixtures.py` creates only deterministic synthetic input
and expected output.

The committed oracle matrix crosses:

- detrending: none, mean, linear, moving average;
- windows: rectangular, Hann, Hamming, Blackman;
- quantities: amplitude, power, PSD, phase, real, imaginary;
- normalizations: none, FFT length, coherent gain, unit peak, unit integrated
  power;
- padding: points per side, next power of two, 2×, 4×; and
- positive-frequency and centered two-sided output.

It uses an odd prime input length so arbitrary-length transforms and even/odd
output rules are exercised. Focused unit cases cover descending and nonuniform
X, resampling rejection, duplicates, missing/nonfinite input, known coherent
sine amplitude, malformed CSV, ordered common columns, padding lengths, and
statistics.

## Comparison

Exact equality is required for array lengths, flags, mode dispatch, and error
categories. Scalar preprocessing and sampling metadata use:

`abs(actual - expected) <= 1e-12 × max(1, abs(expected))`

FFT complex components and derived values use:

`abs(actual - expected) <= 1e-12 × referenceScale + 1e-10 × abs(expected)`

Complex values are checked even when phase is undefined at a zero-magnitude
bin. A tolerance may change only with a written numerical explanation and a
new fixture proving the platform difference.
