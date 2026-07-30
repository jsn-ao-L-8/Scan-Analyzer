# Scan & Fourier Analyzer

A standalone desktop application for plotting multiple laboratory scans and
interactively comparing their Fourier spectra.

## Run

Install Python 3.10 or newer, then from this directory:

```powershell
python -m pip install -r requirements.txt
python run_analyzer.py
```

Use **Browse** to choose a folder, select one or more datasets, choose common
numeric columns, and click **Plot / Update**. The upper pane is reserved for
the large time-domain and spectrum plots; datasets and settings occupy the
resizable lower pane.

The Fourier tab offers three range modes:

- **Full** transforms every dataset over its full valid range.
- **Drag** enables the shaded selector on the time plot.
- **Manual** accepts precise minimum and maximum values.

Only the explicit **Select FFT Range** mouse mode captures a drag. Switch to
Pointer, Pan, or Box Zoom to leave range-selection mode.

The program recognizes both `.csv` files and comma-separated scan files with
no extension. Its initial settings are mean detrending, Hann windowing,
coherent-gain-corrected amplitude, positive frequencies, and no zero padding.
Nonuniform X data are interpolated onto an equally spaced grid.

## Controls, navigation, and export

- **Time Domain:** X/Y and optional X/Y error columns, styling, labels, and
  visible limits.
- **Fourier:** interval, window, quantity, normalization, zero padding, and
  positive or centered two-sided spectrum.
- **Statistics:** descriptive statistics and sampling/spectrum metadata.
- **Export:** combined or individual PNG/PDF/SVG figures, tidy analysis CSV
  with JSON settings, and statistics CSV.
- The interaction bar provides Pointer, FFT selection, Pan, Box Zoom, Home,
  Back, and Forward. The mouse wheel zooms around the cursor; double-click
  restores the plot under the cursor.
- Shortcuts: `Ctrl+O` opens a folder, `Ctrl+S` exports a figure, `Ctrl+E`
  exports derived data, `F5` refreshes the folder, and `Esc` returns to
  Pointer mode.

The settings JSON is written beside an exported analysis CSV. Display and
Fourier preferences, the last folder, selected settings tab, and lower-pane
splitter position persist in `.scan_fourier_analyzer.json` in the user's home
directory. The plots initially receive about 77% of the window height, and the
divider remains adjustable. The application always reopens in safe Pointer
mode.

## Test

```powershell
python -m unittest -v
```
