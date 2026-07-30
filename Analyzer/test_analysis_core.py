"""Tests for the numerical core; run with ``python -m unittest -v``."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from analysis_core import (
    PreprocessConfig,
    SpectrumConfig,
    common_numeric_columns,
    compute_spectrum,
    discover_scan_files,
    prepare_trace,
    read_scan,
    trace_statistics,
    validate_range_bounds,
)


class FileTests(unittest.TestCase):
    def test_discovers_csv_and_extensionless_scan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "a.csv").write_text("delay_ps,x_mean\n0,1\n1,2\n", encoding="utf-8")
            (root / "scan_no_suffix").write_text("delay_ps,x_mean\n0,2\n1,3\n", encoding="utf-8")
            (root / "notes.txt").write_text("not scan data", encoding="utf-8")
            found, skipped = discover_scan_files(root)
            self.assertEqual({p.name for p in found}, {"a.csv", "scan_no_suffix"})
            self.assertFalse(skipped)

    def test_invalid_numeric_cell_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.csv"
            path.write_text("x,y\n0,1\n1,oops\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "non-numeric"):
                read_scan(path)

    def test_common_columns_preserve_first_file_order(self) -> None:
        first = pd.DataFrame({"x": [1], "y": [2], "note": ["a"]})
        second = pd.DataFrame({"y": [3], "x": [4], "z": [5]})
        self.assertEqual(common_numeric_columns([first, second]), ["x", "y"])


class PreparationTests(unittest.TestCase):
    def test_descending_input_is_sorted_and_interpolated(self) -> None:
        x = np.array([3.0, 1.9, 1.0, 0.0])
        y = 2 * x + 1
        trace = prepare_trace(x, y, PreprocessConfig(detrend="linear"))
        self.assertTrue(np.all(np.diff(trace.x) > 0))
        self.assertTrue(trace.interpolated)
        np.testing.assert_allclose(trace.y, 0, atol=1e-12)

    def test_duplicate_x_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            prepare_trace([0, 1, 1], [1, 2, 3], PreprocessConfig())

    def test_empty_or_zero_width_crop_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "fewer than two"):
            prepare_trace([0, 1, 2], [1, 2, 3], PreprocessConfig(1, 1))

    def test_nonuniform_input_can_be_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "nonuniform"):
            prepare_trace([0, 1, 2.2], [1, 2, 3], PreprocessConfig(resample_nonuniform=False))

    def test_fft_range_validation(self) -> None:
        self.assertEqual(validate_range_bounds("1", "4", (0.0, 5.0)), (1.0, 4.0))
        for minimum, maximum in (("4", "1"), ("2", "2"), ("bad", "3"), ("-1", "3"), ("1", "6")):
            with self.assertRaises(ValueError):
                validate_range_bounds(minimum, maximum, (0.0, 5.0))


class SpectrumTests(unittest.TestCase):
    def setUp(self) -> None:
        self.x = np.arange(1000) * 0.01
        self.y = 3.0 * np.sin(2 * np.pi * 7.0 * self.x)

    def test_sine_peak_and_coherent_amplitude(self) -> None:
        trace = prepare_trace(self.x, self.y, PreprocessConfig(detrend="mean"))
        for window in ("rectangular", "hann", "hamming", "blackman"):
            result = compute_spectrum(trace, SpectrumConfig(window=window, normalization="coherent gain"))
            peak = int(np.argmax(result.value))
            self.assertAlmostEqual(result.frequency[peak], 7.0, places=8)
            self.assertAlmostEqual(result.value[peak], 3.0, delta=0.02)

    def test_padding_presets_and_two_sided_output(self) -> None:
        trace = prepare_trace(self.x[:300], self.y[:300], PreprocessConfig())
        next_pow = compute_spectrum(trace, SpectrumConfig(padding_mode="next power of two"))
        doubled = compute_spectrum(trace, SpectrumConfig(padding_mode="2x length", two_sided=True))
        self.assertEqual(next_pow.n_fft, 512)
        self.assertEqual(doubled.n_fft, 600)
        self.assertLess(doubled.frequency[0], 0)
        self.assertGreater(doubled.frequency[-1], 0)

    def test_all_quantities_and_normalizations_are_finite(self) -> None:
        trace = prepare_trace(self.x, self.y, PreprocessConfig())
        quantities = ("amplitude", "power", "power spectral density", "phase", "real", "imaginary")
        normalizations = ("none", "fft length", "coherent gain", "unit peak", "unit integrated power")
        for quantity in quantities:
            for normalization in normalizations:
                result = compute_spectrum(trace, SpectrumConfig(quantity=quantity, normalization=normalization))
                self.assertTrue(np.all(np.isfinite(result.value)), (quantity, normalization))

    def test_statistics(self) -> None:
        stats = trace_statistics([1, 2, np.nan, 3], [0.1, 0.2, np.nan, 0.3])
        self.assertEqual(stats["n"], 3)
        self.assertAlmostEqual(stats["mean_y"], 2)
        self.assertAlmostEqual(stats["sem_y"], 1 / np.sqrt(3))


if __name__ == "__main__":
    unittest.main()
