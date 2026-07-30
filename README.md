# Offline iPad Scan & Fourier Analyzer

A touch-first Progressive Web App for private, local processing of laboratory
scan files. It is a TypeScript port of the behavioral and numerical contracts
in `Analyzer/analysis_core.py`.

## Privacy and offline behavior

- Files are opened with the browser's Files picker and processed in a Web
  Worker. They are never uploaded.
- There is no analytics, telemetry, remote logging, advertising, remote font,
  CDN, or runtime API dependency.
- Imported data and calculated results are held only for the current app
  session. Only an allowlist of display and analysis preferences is stored in
  `localStorage`.
- Once the application assets have been loaded and cached, the installed Home
  Screen app opens and calculates without internet access.
- Google Drive is accessed only as an iPad Files provider. A file that Drive
  has not downloaded may still require a connection before the browser can
  open it.

## Use on iPad

1. Open the deployed GitHub Pages URL in Safari while online.
2. Use **Share → Add to Home Screen**.
3. Launch the new icon once and wait for “ready offline.”
4. Choose one or more `.csv` scans. Use the extensionless picker for a
   comma-separated scan without a suffix; if iPadOS disables it, rename the
   file with a `.csv` extension.
5. Select common numeric columns and analysis settings. The visible time plot
   and FFT calculation range are separate.
6. Use the Export tab to share full-resolution CSV/JSON results, statistics, or
   PNG plots back to Files or Google Drive.

The plot toolbar supports pan, zoom, autoscale, and reset. **Select on plot**
temporarily dedicates a horizontal drag on the time plot to the FFT range.

## Development

Requirements: Node.js 22+, pnpm 10+, and Python 3 with the packages listed in
`Analyzer/requirements.txt` when regenerating numerical fixtures.

```powershell
pnpm install
pnpm test
pnpm dev
```

Other checks:

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm exec playwright install webkit
pnpm test:e2e
```

Regenerate the deterministic Python oracle without modifying `Analyzer/`:

```powershell
python tools/python/generate_fixtures.py
pnpm test
```

The oracle matrix covers every detrending mode, window, quantity,
normalization, padding preset, and output sidedness. Preprocessing and metadata
use a scale-aware `1e-12` tolerance; FFT output uses `rtol=1e-10` with a
scale-aware `1e-12` absolute floor.

## Scientific compatibility

Version 1 intentionally preserves the Python reference, including behavior
that differs from some conventional spectrum implementations:

- FFT-length normalization divides by the unpadded input length.
- “Points per side” selects an FFT length of `N + 2P`; NumPy appends the zeros
  after the signal rather than symmetrically around it.
- One-sided coherent-gain amplitude doubles all retained non-DC bins.
- PSD has its own sampling-frequency/window-energy scale.
- Unit-integrated-power normalization follows the reference's displayed-value
  formula.
- Descriptive statistics describe the original numeric Y column, not the
  cropped or detrended trace.

Changing these rules requires an explicit, versioned scientific mode and new
oracle fixtures.

## Repository and deployment

- `Analyzer/` is the unchanged desktop reference and is never included in the
  built site.
- `src/analysis/` contains framework-free scientific code.
- `src/workers/` owns imported data and performs calculations off the UI
  thread.
- `tests/fixtures/` contains synthetic public data only.
- GitHub Actions runs lint, type checking, numerical/unit tests, and a
  production build before GitHub Pages deployment.

Vite derives the Pages base path from `GITHUB_REPOSITORY`. To test another
subpath locally, set `VITE_BASE_PATH=/repository-name/` before building.
Releases should be tagged `vX.Y.Z`. The About screen and export metadata show
both the semantic version and short build commit. Roll back by rerunning the
Pages workflow from a prior tagged commit or by restoring its retained Pages
artifact.

## Physical iPad release checklist

Record the iPad model, memory tier, and current iPadOS version, then verify:

- Safari and installed Home Screen launch, portrait, and landscape layouts.
- Offline relaunch after the “ready offline” message.
- Multiple local Files and Google Drive files.
- Extensionless import behavior and the documented `.csv` rename fallback.
- Pinch zoom, pan, reset, and touch FFT range selection.
- CSV/JSON/PNG share and save into both local Files and Google Drive.
- One million aggregate rows without a blocked UI, unsafe memory pressure, or
  an analysis time above five seconds after import.
- An update prompt installs a complete new version and About reports it.
- Reset removes preferences and application caches.

Browser automation is a regression aid and does not replace this device gate.

## Current export policy

CSV, JSON, statistics CSV, and PNG are implemented. SVG and PDF remain
intentionally gated until they have reliable physical-iPad rendering and
sharing results.
