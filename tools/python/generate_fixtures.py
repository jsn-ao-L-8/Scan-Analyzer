"""Generate deterministic NumPy/Pandas oracle results without editing Analyzer."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "Analyzer"))

from analysis_core import PreprocessConfig, SpectrumConfig, compute_spectrum, prepare_trace  # noqa: E402


def array(values: np.ndarray) -> list[float]:
    return [float(value) for value in values]


def main() -> None:
    fixture_dir = ROOT / "tests" / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20260730)
    x = np.arange(17, dtype=float) * 0.125
    y = (
        1.7 * np.sin(2 * np.pi * 1.25 * x)
        + 0.35 * np.cos(2 * np.pi * 2.1 * x)
        + rng.normal(0, 0.015, x.size)
        + 0.08 * x
    )
    windows = ("rectangular", "hann", "hamming", "blackman")
    quantities = ("amplitude", "power", "power spectral density", "phase", "real", "imaginary")
    normalizations = ("none", "fft length", "coherent gain", "unit peak", "unit integrated power")
    paddings = (
        ("points per side", 3),
        ("next power of two", 0),
        ("2x length", 0),
        ("4x length", 0),
    )
    cases: list[dict[str, object]] = []
    for detrend in ("none", "mean", "linear", "moving average"):
        preprocess = PreprocessConfig(detrend=detrend, moving_average_points=5)
        trace = prepare_trace(x, y, preprocess)
        for window in windows:
            for quantity in quantities:
                for normalization in normalizations:
                    for padding_mode, padding_points in paddings:
                        for two_sided in (False, True):
                            spectrum = SpectrumConfig(
                                window=window,
                                quantity=quantity,
                                normalization=normalization,
                                padding_mode=padding_mode,
                                padding_points_each_side=padding_points,
                                two_sided=two_sided,
                            )
                            result = compute_spectrum(trace, spectrum)
                            cases.append(
                                {
                                    "name": f"{detrend}|{window}|{quantity}|{normalization}|{padding_mode}|{two_sided}",
                                    "preprocess": {
                                        "xMin": None,
                                        "xMax": None,
                                        "detrend": detrend,
                                        "movingAveragePoints": 5,
                                        "resampleNonuniform": True,
                                        "uniformityTolerance": 1e-4,
                                    },
                                    "spectrum": {
                                        "window": window,
                                        "quantity": quantity,
                                        "normalization": normalization,
                                        "paddingMode": padding_mode,
                                        "paddingPointsEachSide": padding_points,
                                        "twoSided": two_sided,
                                    },
                                    "expected": {
                                        "frequency": array(result.frequency),
                                        "value": array(result.value),
                                        "fftReal": array(result.fft_complex.real),
                                        "fftImag": array(result.fft_complex.imag),
                                        "traceX": array(result.trace.x),
                                        "traceY": array(result.trace.y),
                                        "window": array(result.window_values),
                                        "nInput": result.n_input,
                                        "nFft": result.n_fft,
                                        "dx": result.dx,
                                        "samplingFrequency": result.sampling_frequency,
                                        "nyquist": result.nyquist,
                                        "frequencySpacing": result.frequency_spacing,
                                    },
                                }
                            )
    document = {
        "schemaVersion": 1,
        "seed": 20260730,
        "input": {"x": array(x), "y": array(y)},
        "cases": cases,
    }
    (fixture_dir / "oracle.json").write_text(
        json.dumps(document, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(cases)} oracle cases to {fixture_dir / 'oracle.json'}")


if __name__ == "__main__":
    main()
