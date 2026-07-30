"""Numerical and file-handling core for the Scan & Fourier Analyzer."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Literal

import numpy as np
import pandas as pd


DetrendMode = Literal["none", "mean", "linear", "moving average"]
WindowMode = Literal["rectangular", "hann", "hamming", "blackman"]
QuantityMode = Literal["amplitude", "power", "power spectral density", "phase", "real", "imaginary"]
NormalizationMode = Literal[
    "none", "fft length", "coherent gain", "unit peak", "unit integrated power"
]
PaddingMode = Literal["points per side", "next power of two", "2x length", "4x length"]


@dataclass(frozen=True)
class PreprocessConfig:
    x_min: float | None = None
    x_max: float | None = None
    detrend: DetrendMode = "mean"
    moving_average_points: int = 101
    resample_nonuniform: bool = True
    uniformity_tolerance: float = 1e-4


@dataclass(frozen=True)
class SpectrumConfig:
    window: WindowMode = "hann"
    quantity: QuantityMode = "amplitude"
    normalization: NormalizationMode = "coherent gain"
    padding_mode: PaddingMode = "points per side"
    padding_points_each_side: int = 0
    two_sided: bool = False


@dataclass
class PreparedTrace:
    x: np.ndarray
    y_raw: np.ndarray
    y: np.ndarray
    x_error: np.ndarray | None
    y_error: np.ndarray | None
    relative_spacing_variation: float
    interpolated: bool


@dataclass
class SpectrumResult:
    frequency: np.ndarray
    value: np.ndarray
    fft_complex: np.ndarray
    trace: PreparedTrace
    window_values: np.ndarray
    n_input: int
    n_fft: int
    dx: float
    sampling_frequency: float
    nyquist: float
    frequency_spacing: float


def _looks_like_csv(path: Path) -> bool:
    if not path.is_file() or path.name.startswith("."):
        return False
    if path.suffix.lower() == ".csv":
        return True
    if path.suffix:
        return False
    try:
        with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
            first = handle.readline()
    except OSError:
        return False
    return "," in first and len(first.strip()) > 2


def discover_scan_files(folder: str | Path) -> tuple[list[Path], dict[Path, str]]:
    """Find readable CSV and extensionless CSV-like scans in one folder."""
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(root)
    found: list[Path] = []
    skipped: dict[Path, str] = {}
    for path in sorted(root.iterdir(), key=lambda p: p.name.casefold()):
        if not _looks_like_csv(path):
            continue
        try:
            frame = pd.read_csv(path, nrows=20)
            if frame.empty and len(frame.columns) == 0:
                raise ValueError("no columns")
            if not numeric_columns(frame):
                raise ValueError("no numeric columns")
        except Exception as exc:
            skipped[path] = str(exc)
        else:
            found.append(path)
    return found, skipped


def read_scan(path: str | Path) -> pd.DataFrame:
    """Read a scan and convert columns containing numeric values to numeric dtype."""
    frame = pd.read_csv(Path(path), na_values=["NAN", "NaN", "nan", ""])
    if frame.empty:
        raise ValueError("The scan contains no data rows.")
    converted = frame.copy()
    for column in converted.columns:
        values = pd.to_numeric(converted[column], errors="coerce")
        if values.notna().any():
            invalid = values.isna() & converted[column].notna()
            if invalid.any():
                rows = ", ".join(str(int(i) + 2) for i in converted.index[invalid][:5])
                raise ValueError(f"Column {column!r} contains non-numeric values at rows {rows}.")
            converted[column] = values
    return converted


def numeric_columns(frame: pd.DataFrame) -> list[str]:
    return [
        str(column)
        for column in frame.columns
        if pd.to_numeric(frame[column], errors="coerce").notna().any()
    ]


def common_numeric_columns(frames: Iterable[pd.DataFrame]) -> list[str]:
    frames = list(frames)
    if not frames:
        return []
    ordered = numeric_columns(frames[0])
    common = set(ordered)
    for frame in frames[1:]:
        common.intersection_update(numeric_columns(frame))
    return [name for name in ordered if name in common]


def validate_range_bounds(
    minimum_text: str,
    maximum_text: str,
    overlap: tuple[float, float] | None,
) -> tuple[float, float]:
    """Validate requested FFT bounds against the common selected-data extent."""
    try:
        minimum = float(minimum_text)
        maximum = float(maximum_text)
    except ValueError as exc:
        raise ValueError("FFT bounds must both be valid numbers.") from exc
    if not np.isfinite(minimum) or not np.isfinite(maximum):
        raise ValueError("FFT bounds must be finite numbers.")
    if minimum >= maximum:
        raise ValueError("FFT minimum must be smaller than the maximum.")
    if overlap is None:
        raise ValueError("No common X range is available for the selected datasets.")
    low, high = overlap
    tolerance = max(abs(high - low), 1.0) * 1e-12
    if minimum < low - tolerance or maximum > high + tolerance:
        raise ValueError(f"FFT range must stay inside the common data range [{low:.6g}, {high:.6g}].")
    return minimum, maximum


def _array(values: pd.Series | np.ndarray | None) -> np.ndarray | None:
    if values is None:
        return None
    if isinstance(values, pd.Series):
        return pd.to_numeric(values, errors="coerce").to_numpy(dtype=float)
    return np.asarray(values, dtype=float).reshape(-1)


def _moving_average(values: np.ndarray, size: int) -> np.ndarray:
    if size < 1:
        raise ValueError("Moving-average points must be at least 1.")
    size = min(int(size), values.size)
    left = size // 2
    right = size - 1 - left
    padded = np.pad(values, (left, right), mode="edge")
    return np.convolve(padded, np.ones(size) / size, mode="valid")


def prepare_trace(
    x: pd.Series | np.ndarray,
    y: pd.Series | np.ndarray,
    config: PreprocessConfig,
    x_error: pd.Series | np.ndarray | None = None,
    y_error: pd.Series | np.ndarray | None = None,
) -> PreparedTrace:
    """Clean, crop, optionally resample, and detrend one trace."""
    xa = _array(x)
    ya = _array(y)
    xe = _array(x_error)
    ye = _array(y_error)
    assert xa is not None and ya is not None
    if xa.size != ya.size:
        raise ValueError("X and Y lengths differ.")
    if xe is not None and xe.size != xa.size:
        raise ValueError("X-error length differs from X.")
    if ye is not None and ye.size != xa.size:
        raise ValueError("Y-error length differs from X.")

    mask = np.isfinite(xa) & np.isfinite(ya)
    xa, ya = xa[mask], ya[mask]
    xe = xe[mask] if xe is not None else None
    ye = ye[mask] if ye is not None else None
    if xa.size < 2:
        raise ValueError("At least two finite X/Y points are required.")

    order = np.argsort(xa)
    xa, ya = xa[order], ya[order]
    xe = xe[order] if xe is not None else None
    ye = ye[order] if ye is not None else None
    if np.any(np.diff(xa) == 0):
        raise ValueError("Duplicate X values are not supported.")

    bounds = [value for value in (config.x_min, config.x_max) if value is not None]
    low = min(bounds) if bounds else -np.inf
    high = max(bounds) if bounds else np.inf
    keep = (xa >= low) & (xa <= high)
    xa, ya = xa[keep], ya[keep]
    xe = xe[keep] if xe is not None else None
    ye = ye[keep] if ye is not None else None
    if xa.size < 2:
        raise ValueError("The selected interval contains fewer than two points.")

    spacing = np.diff(xa)
    dx = float(np.mean(spacing))
    variation = float(np.max(np.abs(spacing - dx)) / abs(dx))
    interpolated = variation > config.uniformity_tolerance
    if interpolated:
        if not config.resample_nonuniform:
            raise ValueError(f"X spacing is nonuniform (relative variation {variation:.3g}).")
        x_uniform = np.linspace(xa[0], xa[-1], xa.size)
        ya = np.interp(x_uniform, xa, ya)
        if xe is not None:
            xe = np.interp(x_uniform, xa, xe)
        if ye is not None:
            ye = np.interp(x_uniform, xa, ye)
        xa = x_uniform

    y_raw = ya.copy()
    if config.detrend == "mean":
        ya = ya - np.mean(ya)
    elif config.detrend == "linear":
        ya = ya - np.polyval(np.polyfit(xa, ya, 1), xa)
    elif config.detrend == "moving average":
        ya = ya - _moving_average(ya, config.moving_average_points)
    elif config.detrend != "none":
        raise ValueError(f"Unknown detrend mode: {config.detrend}")
    return PreparedTrace(xa, y_raw, ya, xe, ye, variation, interpolated)


def _window(name: WindowMode, n: int) -> np.ndarray:
    return {
        "rectangular": np.ones,
        "hann": np.hanning,
        "hamming": np.hamming,
        "blackman": np.blackman,
    }[name](n)


def _fft_length(n: int, config: SpectrumConfig) -> int:
    if config.padding_mode == "points per side":
        if config.padding_points_each_side < 0:
            raise ValueError("Padding points cannot be negative.")
        return n + 2 * int(config.padding_points_each_side)
    if config.padding_mode == "next power of two":
        return 1 << (n - 1).bit_length()
    if config.padding_mode == "2x length":
        return 2 * n
    if config.padding_mode == "4x length":
        return 4 * n
    raise ValueError(f"Unknown padding mode: {config.padding_mode}")


def compute_spectrum(trace: PreparedTrace, config: SpectrumConfig) -> SpectrumResult:
    """Calculate an FFT and the requested display quantity."""
    n = trace.y.size
    if n < 2:
        raise ValueError("At least two points are required for an FFT.")
    dx = float(np.mean(np.diff(trace.x)))
    n_fft = _fft_length(n, config)
    window = _window(config.window, n)
    signal = trace.y * window
    fft = np.fft.fft(signal, n=n_fft)
    frequency = np.fft.fftfreq(n_fft, d=dx)

    scale = np.ones_like(frequency, dtype=float)
    if config.normalization == "fft length":
        scale /= n
    elif config.normalization == "coherent gain":
        gain = float(np.sum(window))
        if gain == 0:
            raise ValueError("The selected window has zero coherent gain.")
        scale /= gain

    if config.quantity == "amplitude":
        value = np.abs(fft) * scale
        if config.normalization == "coherent gain" and not config.two_sided:
            value[1:] *= 2
    elif config.quantity == "power":
        value = np.abs(fft * scale) ** 2
    elif config.quantity == "power spectral density":
        value = np.abs(fft) ** 2 / (abs(1 / dx) * np.sum(window**2))
    elif config.quantity == "phase":
        value = np.angle(fft)
    elif config.quantity == "real":
        value = np.real(fft) * scale
    elif config.quantity == "imaginary":
        value = np.imag(fft) * scale
    else:
        raise ValueError(f"Unknown spectrum quantity: {config.quantity}")

    if config.normalization == "unit peak":
        peak = float(np.nanmax(np.abs(value)))
        if peak:
            value = value / peak
    elif config.normalization == "unit integrated power":
        power = np.abs(value) ** 2 if config.quantity not in ("power", "power spectral density") else np.abs(value)
        integral = float(np.sum(power) / (n_fft * abs(dx)))
        if integral:
            value = value / np.sqrt(abs(integral))
    elif config.normalization not in ("none", "fft length", "coherent gain"):
        raise ValueError(f"Unknown normalization: {config.normalization}")

    if config.two_sided:
        frequency = np.fft.fftshift(frequency)
        fft = np.fft.fftshift(fft)
        value = np.fft.fftshift(value)
    else:
        keep = frequency >= 0
        frequency, fft, value = frequency[keep], fft[keep], value[keep]

    return SpectrumResult(
        frequency=frequency,
        value=value,
        fft_complex=fft,
        trace=trace,
        window_values=window,
        n_input=n,
        n_fft=n_fft,
        dx=dx,
        sampling_frequency=1 / abs(dx),
        nyquist=1 / (2 * abs(dx)),
        frequency_spacing=1 / (n_fft * abs(dx)),
    )


def trace_statistics(y: pd.Series | np.ndarray, error: pd.Series | np.ndarray | None = None) -> dict[str, float | int]:
    values = _array(y)
    errors = _array(error)
    assert values is not None
    values = values[np.isfinite(values)]
    errors = errors[np.isfinite(errors)] if errors is not None else np.array([])
    n = values.size
    std = float(np.std(values, ddof=1)) if n > 1 else np.nan
    return {
        "n": int(n),
        "mean_y": float(np.mean(values)) if n else np.nan,
        "mean_error": float(np.mean(errors)) if errors.size else np.nan,
        "std_y": std,
        "sem_y": std / np.sqrt(n) if n > 1 else np.nan,
        "median_y": float(np.median(values)) if n else np.nan,
        "min_y": float(np.min(values)) if n else np.nan,
        "max_y": float(np.max(values)) if n else np.nan,
    }


def configs_as_dict(preprocess: PreprocessConfig, spectrum: SpectrumConfig) -> dict[str, object]:
    return {"preprocess": asdict(preprocess), "spectrum": asdict(spectrum)}
