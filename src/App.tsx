import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";
import type {
  AnalysisFailure,
  ColumnSelection,
  DatasetAnalysis,
  DatasetSummary,
  DetrendMode,
  NormalizationMode,
  PaddingMode,
  QuantityMode,
  WindowMode
} from "./analysis/types";
import {
  ERROR_CANDIDATES,
  X_CANDIDATES,
  Y_CANDIDATES,
  commonNumericColumns,
  commonXOverlap,
  firstMatch
} from "./data/datasets";
import {
  analysisCsv,
  metadataJson,
  shareOrDownload,
  statisticsCsv,
  textFile
} from "./io/export";
import {
  loadPreferences,
  resetApplication,
  savePreferences,
  type Preferences
} from "./preferences/preferences";
import {
  ScientificPlot,
  type ScientificPlotHandle
} from "./plots/ScientificPlot";
import { UpdateStatus } from "./pwa/UpdateStatus";
import { validateRangeBounds } from "./analysis/validation/core";
import { AnalysisWorkerClient } from "./workers/client";

type Tab = "time" | "fourier" | "statistics" | "export" | "about";
type RangeMode = "full" | "manual" | "touch";

interface State {
  datasets: DatasetSummary[];
  selected: Set<string>;
  columns: ColumnSelection;
  preferences: Preferences;
  results: DatasetAnalysis[];
  errors: AnalysisFailure[];
  status: string;
  busy: boolean;
  search: string;
  rangeMode: RangeMode;
  rangeMinimum: string;
  rangeMaximum: string;
  tab: Tab;
}

type Action =
  | { type: "datasets"; datasets: DatasetSummary[]; errors: AnalysisFailure[] }
  | { type: "toggle"; id: string }
  | { type: "select_all"; ids: string[] }
  | { type: "clear_selection" }
  | { type: "columns"; columns: Partial<ColumnSelection> }
  | { type: "preferences"; preferences: Preferences }
  | { type: "analysis"; results: DatasetAnalysis[]; errors: AnalysisFailure[] }
  | { type: "status"; status: string; busy?: boolean }
  | { type: "search"; search: string }
  | {
      type: "range";
      mode?: RangeMode;
      minimum?: string;
      maximum?: string;
    }
  | { type: "tab"; tab: Tab }
  | { type: "remove"; ids: Set<string> };

function initialState(): State {
  return {
    datasets: [],
    selected: new Set(),
    columns: { x: "", y: "", xError: null, yError: null },
    preferences: loadPreferences(),
    results: [],
    errors: [],
    status: "Choose one or more CSV scans to begin.",
    busy: false,
    search: "",
    rangeMode: "full",
    rangeMinimum: "",
    rangeMaximum: "",
    tab: "time"
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "datasets": {
      const datasets = [...state.datasets, ...action.datasets];
      const selected = new Set(state.selected);
      action.datasets.forEach(({ id }) => selected.add(id));
      const selectedDatasets = datasets.filter(({ id }) => selected.has(id));
      const common = commonNumericColumns(selectedDatasets);
      const x = common.includes(state.columns.x)
        ? state.columns.x
        : firstMatch(X_CANDIDATES, common);
      const y = common.includes(state.columns.y)
        ? state.columns.y
        : firstMatch(Y_CANDIDATES, common);
      const yError =
        state.columns.yError && common.includes(state.columns.yError)
          ? state.columns.yError
          : firstMatch(ERROR_CANDIDATES, common, "") || null;
      return {
        ...state,
        datasets,
        selected,
        columns: { x, y, xError: null, yError },
        errors: action.errors,
        busy: false,
        status: `Loaded ${action.datasets.length} scan${action.datasets.length === 1 ? "" : "s"}${action.errors.length ? `; ${action.errors.length} failed` : ""}.`
      };
    }
    case "toggle": {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case "select_all":
      return { ...state, selected: new Set(action.ids) };
    case "clear_selection":
      return { ...state, selected: new Set(), results: [] };
    case "columns":
      return { ...state, columns: { ...state.columns, ...action.columns } };
    case "preferences":
      return { ...state, preferences: action.preferences };
    case "analysis":
      return {
        ...state,
        results: action.results,
        errors: action.errors,
        busy: false,
        status: `Analyzed ${action.results.length} dataset${action.results.length === 1 ? "" : "s"}${action.errors.length ? `; ${action.errors.length} failed` : ""}.`
      };
    case "status":
      return {
        ...state,
        status: action.status,
        busy: action.busy ?? state.busy
      };
    case "search":
      return { ...state, search: action.search };
    case "range":
      return {
        ...state,
        rangeMode: action.mode ?? state.rangeMode,
        rangeMinimum: action.minimum ?? state.rangeMinimum,
        rangeMaximum: action.maximum ?? state.rangeMaximum
      };
    case "tab":
      return { ...state, tab: action.tab };
    case "remove": {
      const datasets = state.datasets.filter(({ id }) => !action.ids.has(id));
      const selected = new Set([...state.selected].filter((id) => !action.ids.has(id)));
      return { ...state, datasets, selected, results: [], errors: [] };
    }
  }
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Switch({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function format(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(6) : "—";
}

async function dataUrlFile(url: string, name: string): Promise<File> {
  const blob = await fetch(url).then((response) => response.blob());
  return new File([blob], name, { type: "image/png", lastModified: Date.now() });
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [client] = useState(() => new AnalysisWorkerClient());
  const [online, setOnline] = useState(() => navigator.onLine);
  const analysisGeneration = useRef(0);
  const csvInput = useRef<HTMLInputElement>(null);
  const unrestrictedInput = useRef<HTMLInputElement>(null);
  const timePlot = useRef<ScientificPlotHandle>(null);
  const spectrumPlot = useRef<ScientificPlotHandle>(null);

  const selectedDatasets = useMemo(
    () => state.datasets.filter(({ id }) => state.selected.has(id)),
    [state.datasets, state.selected]
  );
  const visibleDatasets = useMemo(() => {
    const search = state.search.trim().toLocaleLowerCase();
    return state.datasets.filter(({ name }) => name.toLocaleLowerCase().includes(search));
  }, [state.datasets, state.search]);
  const commonColumns = useMemo(
    () => commonNumericColumns(selectedDatasets),
    [selectedDatasets]
  );
  const overlap = useMemo(
    () => commonXOverlap(selectedDatasets, state.columns.x),
    [selectedDatasets, state.columns.x]
  );

  useEffect(() => {
    client.onProgress = (status) => dispatch({ type: "status", status, busy: true });
    return () => client.close();
  }, [client]);

  useEffect(() => {
    const updateOnlineStatus = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => savePreferences(state.preferences), [state.preferences]);

  useEffect(() => {
    if (!selectedDatasets.length || !state.columns.x || !state.columns.y) return;
    const generation = ++analysisGeneration.current;
    const timeout = window.setTimeout(async () => {
      dispatch({ type: "status", status: "Calculating locally…", busy: true });
      try {
        const response = await client.analyze({
          datasetIds: selectedDatasets.map(({ id }) => id),
          columns: state.columns,
          preprocess: state.preferences.preprocess,
          spectrum: state.preferences.spectrum
        });
        if (generation === analysisGeneration.current) {
          dispatch({
            type: "analysis",
            results: response.results,
            errors: response.errors
          });
        }
      } catch (error) {
        if (generation === analysisGeneration.current) {
          dispatch({
            type: "status",
            status: error instanceof Error ? error.message : String(error),
            busy: false
          });
        }
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    client,
    selectedDatasets,
    state.columns,
    state.preferences.preprocess,
    state.preferences.spectrum
  ]);

  useEffect(() => {
    const common = commonColumns;
    if (!common.length) return;
    const updates: Partial<ColumnSelection> = {};
    if (!common.includes(state.columns.x)) updates.x = firstMatch(X_CANDIDATES, common);
    if (!common.includes(state.columns.y)) updates.y = firstMatch(Y_CANDIDATES, common);
    if (state.columns.xError && !common.includes(state.columns.xError)) updates.xError = null;
    if (state.columns.yError && !common.includes(state.columns.yError)) updates.yError = null;
    if (Object.keys(updates).length) dispatch({ type: "columns", columns: updates });
  }, [commonColumns, state.columns]);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    dispatch({ type: "status", status: `Reading ${files.length} file(s) locally…`, busy: true });
    try {
      const response = await client.parse(Array.from(files));
      dispatch({ type: "datasets", datasets: response.datasets, errors: response.errors });
    } catch (error) {
      dispatch({
        type: "status",
        status: error instanceof Error ? error.message : String(error),
        busy: false
      });
    }
  };

  const updatePreferences = useCallback(
    (update: (preferences: Preferences) => Preferences) => {
      dispatch({ type: "preferences", preferences: update(state.preferences) });
    },
    [state.preferences]
  );
  const setPreprocess = <K extends keyof Preferences["preprocess"]>(
    key: K,
    value: Preferences["preprocess"][K]
  ) =>
    updatePreferences((preferences) => ({
      ...preferences,
      preprocess: { ...preferences.preprocess, [key]: value }
    }));
  const setSpectrum = <K extends keyof Preferences["spectrum"]>(
    key: K,
    value: Preferences["spectrum"][K]
  ) =>
    updatePreferences((preferences) => ({
      ...preferences,
      spectrum: { ...preferences.spectrum, [key]: value }
    }));
  const setPlot = <K extends keyof Preferences["plot"]>(
    key: K,
    value: Preferences["plot"][K]
  ) =>
    updatePreferences((preferences) => ({
      ...preferences,
      plot: { ...preferences.plot, [key]: value }
    }));

  const applyRange = useCallback(
    (minimum = state.rangeMinimum, maximum = state.rangeMaximum) => {
      try {
        const bounds = validateRangeBounds(minimum, maximum, overlap);
        dispatch({
          type: "range",
          minimum: bounds[0].toPrecision(10),
          maximum: bounds[1].toPrecision(10)
        });
        updatePreferences((preferences) => ({
          ...preferences,
          preprocess: {
            ...preferences.preprocess,
            xMin: bounds[0],
            xMax: bounds[1]
          }
        }));
      } catch (error) {
        dispatch({
          type: "status",
          status: error instanceof Error ? error.message : String(error),
          busy: false
        });
      }
    },
    [overlap, state.rangeMaximum, state.rangeMinimum, updatePreferences]
  );

  const setRangeMode = (mode: RangeMode) => {
    dispatch({ type: "range", mode });
    if (mode === "full") {
      setPreprocess("xMin", null);
      setPreprocess("xMax", null);
    } else if (!state.rangeMinimum && overlap) {
      const minimum = overlap[0].toPrecision(10);
      const maximum = overlap[1].toPrecision(10);
      dispatch({ type: "range", minimum, maximum });
      applyRange(minimum, maximum);
    }
  };

  const onTouchRange = useCallback(
    (minimum: number, maximum: number) => {
      const minText = minimum.toPrecision(10);
      const maxText = maximum.toPrecision(10);
      dispatch({ type: "range", minimum: minText, maximum: maxText });
      applyRange(minText, maxText);
    },
    [applyRange]
  );

  const exportData = async () => {
    if (!state.results.length) return;
    const files = [
      textFile(analysisCsv(state.results), "analysis_export.csv", "text/csv"),
      textFile(
        metadataJson({
          results: state.results,
          columns: state.columns,
          rangeMode: state.rangeMode,
          preprocess: state.preferences.preprocess,
          spectrum: state.preferences.spectrum
        }),
        "analysis_export.json",
        "application/json"
      )
    ];
    const outcome = await shareOrDownload(files);
    dispatch({ type: "status", status: `Analysis files ${outcome}.`, busy: false });
  };

  const exportStats = async () => {
    const outcome = await shareOrDownload([
      textFile(statisticsCsv(state.results), "scan_statistics.csv", "text/csv")
    ]);
    dispatch({ type: "status", status: `Statistics ${outcome}.`, busy: false });
  };

  const exportPng = async (target: "time" | "spectrum" | "combined") => {
    if (!timePlot.current || !spectrumPlot.current) return;
    dispatch({ type: "status", status: "Rendering PNG locally…", busy: true });
    try {
      if (target !== "combined") {
        const url =
          target === "time"
            ? await timePlot.current.toPng(2)
            : await spectrumPlot.current.toPng(2);
        await shareOrDownload([await dataUrlFile(url, `${target}_plot.png`)]);
      } else {
        const [timeUrl, spectrumUrl] = await Promise.all([
          timePlot.current.toPng(2),
          spectrumPlot.current.toPng(2)
        ]);
        const [timeImage, spectrumImage] = await Promise.all(
          [timeUrl, spectrumUrl].map(
            (src) =>
              new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = src;
              })
          )
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(timeImage.width, spectrumImage.width);
        canvas.height = timeImage.height + spectrumImage.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PNG canvas is unavailable.");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(timeImage, 0, 0);
        context.drawImage(spectrumImage, 0, timeImage.height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error("PNG export failed."))),
            "image/png"
          )
        );
        await shareOrDownload([
          new File([blob], "combined_plots.png", { type: "image/png" })
        ]);
      }
      dispatch({ type: "status", status: "PNG export ready.", busy: false });
    } catch (error) {
      dispatch({
        type: "status",
        status: error instanceof Error ? error.message : String(error),
        busy: false
      });
    }
  };

  const removeSelected = () => {
    const removing = state.datasets.filter(({ id }) => state.selected.has(id));
    client.remove(removing);
    dispatch({ type: "remove", ids: new Set(removing.map(({ id }) => id)) });
  };

  const plotPrefs = state.preferences.plot;
  const spectrum = state.preferences.spectrum;
  const preprocess = state.preferences.preprocess;
  const frequencyUnit = state.columns.x.toLocaleLowerCase().includes("ps")
    ? "Frequency (THz)"
    : `Frequency (1 / ${state.columns.x || "X"})`;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Scan &amp; Fourier Analyzer</h1>
          <p>Private, local analysis · v{__APP_VERSION__}</p>
        </div>
        <div className="connectivity" aria-live="polite">
          <span className={online ? "online" : "offline"} />
          {online ? "Online" : "Offline"}
        </div>
      </header>

      <main>
        <section className="plot-workspace" aria-label="Scientific plots">
          <ScientificPlot
            ref={timePlot}
            kind="time"
            results={state.results}
            preferences={plotPrefs}
            xLabel={plotPrefs.xLabel || state.columns.x || "X"}
            yLabel={plotPrefs.yLabel || state.columns.y || "Y"}
            selectionMode={state.rangeMode === "touch"}
            onRangeSelected={onTouchRange}
          />
          <ScientificPlot
            ref={spectrumPlot}
            kind="spectrum"
            results={state.results}
            preferences={plotPrefs}
            xLabel={frequencyUnit}
            yLabel={`${spectrum.quantity} [${spectrum.normalization}]`}
          />
        </section>

        <section className="control-workspace">
          <details className="dataset-panel" open>
            <summary>Datasets ({state.selected.size}/{state.datasets.length})</summary>
            <div className="import-actions">
              <button onClick={() => csvInput.current?.click()}>Choose CSV files</button>
              <button className="secondary" onClick={() => unrestrictedInput.current?.click()}>
                Choose extensionless files
              </button>
              <input
                ref={csvInput}
                hidden
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={(event) => {
                  void importFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <input
                ref={unrestrictedInput}
                hidden
                type="file"
                multiple
                onChange={(event) => {
                  void importFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
            <input
              className="search"
              aria-label="Filter datasets"
              type="search"
              placeholder="Filter datasets"
              value={state.search}
              onChange={(event) => dispatch({ type: "search", search: event.target.value })}
            />
            <div className="dataset-list">
              {visibleDatasets.length ? (
                visibleDatasets.map((dataset) => (
                  <label className="dataset-row" key={dataset.id}>
                    <input
                      type="checkbox"
                      checked={state.selected.has(dataset.id)}
                      onChange={() => dispatch({ type: "toggle", id: dataset.id })}
                    />
                    <span className="color-chip" style={{ background: dataset.color }} />
                    <span>
                      <strong>{dataset.name}</strong>
                      <small>
                        {dataset.rowCount.toLocaleString()} rows · {dataset.numericColumns.length} numeric columns
                      </small>
                    </span>
                  </label>
                ))
              ) : (
                <p className="empty">No datasets loaded.</p>
              )}
            </div>
            <div className="dataset-buttons">
              <button
                className="secondary"
                onClick={() =>
                  dispatch({
                    type: "select_all",
                    ids: visibleDatasets.map(({ id }) => id)
                  })
                }
              >
                Select shown
              </button>
              <button className="secondary" onClick={() => dispatch({ type: "clear_selection" })}>
                Clear
              </button>
              <button className="danger" disabled={!state.selected.size} onClick={removeSelected}>
                Remove selected
              </button>
            </div>
          </details>

          <div className="settings-panel">
            <nav className="tabs" aria-label="Analysis settings">
              {(
                [
                  ["time", "Time"],
                  ["fourier", "Fourier"],
                  ["statistics", "Statistics"],
                  ["export", "Export"],
                  ["about", "About"]
                ] as [Tab, string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  className={state.tab === tab ? "active" : ""}
                  aria-current={state.tab === tab ? "page" : undefined}
                  onClick={() => dispatch({ type: "tab", tab })}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="tab-content">
              {state.tab === "time" && (
                <div className="settings-grid">
                  <fieldset>
                    <legend>Columns</legend>
                    <Field label="X column">
                      <select
                        value={state.columns.x}
                        onChange={(event) =>
                          dispatch({ type: "columns", columns: { x: event.target.value } })
                        }
                      >
                        {commonColumns.map((column) => <option key={column}>{column}</option>)}
                      </select>
                    </Field>
                    <Field label="Y column">
                      <select
                        value={state.columns.y}
                        onChange={(event) =>
                          dispatch({ type: "columns", columns: { y: event.target.value } })
                        }
                      >
                        {commonColumns.map((column) => <option key={column}>{column}</option>)}
                      </select>
                    </Field>
                    <Field label="X error">
                      <select
                        value={state.columns.xError ?? ""}
                        onChange={(event) =>
                          dispatch({
                            type: "columns",
                            columns: { xError: event.target.value || null }
                          })
                        }
                      >
                        <option value="">None</option>
                        {commonColumns.map((column) => <option key={column}>{column}</option>)}
                      </select>
                    </Field>
                    <Field label="Y error">
                      <select
                        value={state.columns.yError ?? ""}
                        onChange={(event) =>
                          dispatch({
                            type: "columns",
                            columns: { yError: event.target.value || null }
                          })
                        }
                      >
                        <option value="">None</option>
                        {commonColumns.map((column) => <option key={column}>{column}</option>)}
                      </select>
                    </Field>
                  </fieldset>
                  <fieldset>
                    <legend>Processing</legend>
                    <Field label="Detrend">
                      <select
                        value={preprocess.detrend}
                        onChange={(event) =>
                          setPreprocess("detrend", event.target.value as DetrendMode)
                        }
                      >
                        {["none", "mean", "linear", "moving average"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Moving-average points">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={preprocess.movingAveragePoints}
                        onChange={(event) =>
                          setPreprocess("movingAveragePoints", Number(event.target.value))
                        }
                      />
                    </Field>
                    <Switch
                      label="Resample nonuniform X"
                      checked={preprocess.resampleNonuniform}
                      onChange={(value) => setPreprocess("resampleNonuniform", value)}
                    />
                    <Field label="Uniformity tolerance">
                      <input
                        type="number"
                        min="0"
                        step="0.00001"
                        value={preprocess.uniformityTolerance}
                        onChange={(event) =>
                          setPreprocess("uniformityTolerance", Number(event.target.value))
                        }
                      />
                    </Field>
                  </fieldset>
                  <fieldset>
                    <legend>Plot appearance</legend>
                    <Field label="Title">
                      <input value={plotPrefs.title} onChange={(event) => setPlot("title", event.target.value)} />
                    </Field>
                    <Field label="X label">
                      <input value={plotPrefs.xLabel} onChange={(event) => setPlot("xLabel", event.target.value)} />
                    </Field>
                    <Field label="Y label">
                      <input value={plotPrefs.yLabel} onChange={(event) => setPlot("yLabel", event.target.value)} />
                    </Field>
                    <Field label="Y scale">
                      <select
                        value={plotPrefs.timeScale}
                        onChange={(event) =>
                          setPlot("timeScale", event.target.value as "linear" | "log" | "symlog")
                        }
                      >
                        <option>linear</option>
                        <option>log</option>
                        <option>symlog</option>
                      </select>
                    </Field>
                    <Field label="Visible X minimum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.timeXMinimum}
                        onChange={(event) => setPlot("timeXMinimum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible X maximum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.timeXMaximum}
                        onChange={(event) => setPlot("timeXMaximum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible Y minimum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.timeYMinimum}
                        onChange={(event) => setPlot("timeYMinimum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible Y maximum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.timeYMaximum}
                        onChange={(event) => setPlot("timeYMaximum", event.target.value)}
                      />
                    </Field>
                    <div className="switches">
                      <Switch label="Legend" checked={plotPrefs.showLegend} onChange={(value) => setPlot("showLegend", value)} />
                      <Switch label="Grid" checked={plotPrefs.showGrid} onChange={(value) => setPlot("showGrid", value)} />
                      <Switch label="Markers" checked={plotPrefs.showMarkers} onChange={(value) => setPlot("showMarkers", value)} />
                      <Switch label="Lines" checked={plotPrefs.showLines} onChange={(value) => setPlot("showLines", value)} />
                      <Switch label="Error bars" checked={plotPrefs.showErrors} onChange={(value) => setPlot("showErrors", value)} />
                    </div>
                  </fieldset>
                </div>
              )}

              {state.tab === "fourier" && (
                <div className="settings-grid">
                  <fieldset>
                    <legend>FFT range</legend>
                    <div className="segmented">
                      {(["full", "manual", "touch"] as RangeMode[]).map((mode) => (
                        <button
                          key={mode}
                          className={state.rangeMode === mode ? "active" : "secondary"}
                          onClick={() => setRangeMode(mode)}
                        >
                          {mode === "touch" ? "Select on plot" : mode}
                        </button>
                      ))}
                    </div>
                    <Field label="Minimum">
                      <input
                        inputMode="decimal"
                        disabled={state.rangeMode === "full"}
                        readOnly={state.rangeMode === "touch"}
                        value={state.rangeMinimum}
                        onChange={(event) =>
                          dispatch({ type: "range", minimum: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Maximum">
                      <input
                        inputMode="decimal"
                        disabled={state.rangeMode === "full"}
                        readOnly={state.rangeMode === "touch"}
                        value={state.rangeMaximum}
                        onChange={(event) =>
                          dispatch({ type: "range", maximum: event.target.value })
                        }
                      />
                    </Field>
                    {state.rangeMode === "manual" && (
                      <button onClick={() => applyRange()}>Apply FFT range</button>
                    )}
                    {state.rangeMode === "touch" && (
                      <p className="hint">Drag horizontally on the time plot. Pinch/pan is restored when you leave this mode.</p>
                    )}
                    <p className="hint">
                      Common extent: {overlap ? `${format(overlap[0])} to ${format(overlap[1])}` : "unavailable"}
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Transform</legend>
                    <Field label="Window">
                      <select
                        value={spectrum.window}
                        onChange={(event) =>
                          setSpectrum("window", event.target.value as WindowMode)
                        }
                      >
                        {["rectangular", "hann", "hamming", "blackman"].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Field label="Zero padding">
                      <select
                        value={spectrum.paddingMode}
                        onChange={(event) =>
                          setSpectrum("paddingMode", event.target.value as PaddingMode)
                        }
                      >
                        {["points per side", "next power of two", "2x length", "4x length"].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Field
                      label="Points per side"
                      hint="Compatibility behavior: increases FFT length by twice this number."
                    >
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={spectrum.paddingMode !== "points per side"}
                        value={spectrum.paddingPointsEachSide}
                        onChange={(event) =>
                          setSpectrum("paddingPointsEachSide", Number(event.target.value))
                        }
                      />
                    </Field>
                  </fieldset>
                  <fieldset>
                    <legend>Output</legend>
                    <Field label="Quantity">
                      <select
                        value={spectrum.quantity}
                        onChange={(event) =>
                          setSpectrum("quantity", event.target.value as QuantityMode)
                        }
                      >
                        {["amplitude", "power", "power spectral density", "phase", "real", "imaginary"].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Field label="Normalization">
                      <select
                        value={spectrum.normalization}
                        onChange={(event) =>
                          setSpectrum("normalization", event.target.value as NormalizationMode)
                        }
                      >
                        {["none", "fft length", "coherent gain", "unit peak", "unit integrated power"].map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </Field>
                    <Switch
                      label="Centered two-sided spectrum"
                      checked={spectrum.twoSided}
                      onChange={(value) => setSpectrum("twoSided", value)}
                    />
                    <Switch
                      label="Logarithmic spectrum Y"
                      checked={plotPrefs.spectrumLog}
                      onChange={(value) => setPlot("spectrumLog", value)}
                    />
                    <Field label="Visible frequency minimum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.spectrumXMinimum}
                        onChange={(event) => setPlot("spectrumXMinimum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible frequency maximum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.spectrumXMaximum}
                        onChange={(event) => setPlot("spectrumXMaximum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible value minimum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.spectrumYMinimum}
                        onChange={(event) => setPlot("spectrumYMinimum", event.target.value)}
                      />
                    </Field>
                    <Field label="Visible value maximum">
                      <input
                        inputMode="decimal"
                        placeholder="Auto"
                        value={plotPrefs.spectrumYMaximum}
                        onChange={(event) => setPlot("spectrumYMaximum", event.target.value)}
                      />
                    </Field>
                  </fieldset>
                </div>
              )}

              {state.tab === "statistics" && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["File", "N", "Mean", "Std", "SEM", "Median", "Min", "Max", "dx", "fs", "Nyquist", "df", "Status"].map((heading) => <th key={heading}>{heading}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {state.results.map(({ datasetId, datasetName, statistics, result, status }) => (
                        <tr key={datasetId}>
                          <th>{datasetName}</th>
                          <td>{statistics.n}</td>
                          <td>{format(statistics.meanY)}</td>
                          <td>{format(statistics.stdY)}</td>
                          <td>{format(statistics.semY)}</td>
                          <td>{format(statistics.medianY)}</td>
                          <td>{format(statistics.minY)}</td>
                          <td>{format(statistics.maxY)}</td>
                          <td>{format(result.dx)}</td>
                          <td>{format(result.samplingFrequency)}</td>
                          <td>{format(result.nyquist)}</td>
                          <td>{format(result.frequencySpacing)}</td>
                          <td>{status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {state.tab === "export" && (
                <div className="export-grid">
                  <article>
                    <h2>Analysis data</h2>
                    <p>Full-resolution processed traces, complex FFT values, settings, and metadata.</p>
                    <button disabled={!state.results.length} onClick={() => void exportData()}>
                      Share data + settings
                    </button>
                  </article>
                  <article>
                    <h2>Statistics</h2>
                    <p>Raw-data descriptive statistics and sampling metadata as CSV.</p>
                    <button disabled={!state.results.length} onClick={() => void exportStats()}>
                      Share statistics
                    </button>
                  </article>
                  <article>
                    <h2>PNG plots</h2>
                    <p>PNG is the verified portable image format. SVG and PDF remain device-gated.</p>
                    <div className="button-row">
                      <button disabled={!state.results.length} onClick={() => void exportPng("combined")}>Combined</button>
                      <button className="secondary" disabled={!state.results.length} onClick={() => void exportPng("time")}>Time</button>
                      <button className="secondary" disabled={!state.results.length} onClick={() => void exportPng("spectrum")}>Spectrum</button>
                    </div>
                  </article>
                </div>
              )}

              {state.tab === "about" && (
                <div className="about">
                  <h2>Offline and private by design</h2>
                  <p>
                    Scan files are read and analyzed only inside this browser. No analytics,
                    telemetry, uploads, remote logging, or persistent scientific-data storage
                    is used.
                  </p>
                  <dl>
                    <div><dt>Version</dt><dd>{__APP_VERSION__}</dd></div>
                    <div><dt>Build</dt><dd>{__BUILD_COMMIT__}</dd></div>
                    <div><dt>Connection</dt><dd>{online ? "Online" : "Offline"}</dd></div>
                    <div><dt>Data lifetime</dt><dd>Current app session only</dd></div>
                  </dl>
                  <h3>iPad file notes</h3>
                  <p>
                    Google Drive is available through the iPad Files picker when its provider
                    is enabled. A Drive file not already downloaded may require internet access.
                    If an extensionless scan is disabled in Files, rename it with a <code>.csv</code>
                    extension before importing.
                  </p>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!window.confirm("Reset saved preferences and cached application files? Imported data in this session will also be lost.")) return;
                      await resetApplication();
                      window.location.reload();
                    }}
                  >
                    Reset preferences and cache
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {!!state.errors.length && (
          <section className="error-panel" aria-label="Dataset errors">
            <h2>Dataset issues</h2>
            <ul>
              {state.errors.map((error, index) => (
                <li key={`${error.datasetName}-${index}`}>
                  <strong>{error.datasetName}:</strong> {error.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="status-bar" aria-live="polite">
        {state.busy && <span className="spinner" aria-hidden="true" />}
        <span>{state.status}</span>
        <span>{state.results.length ? `${state.results.length} valid spectra` : "No results"}</span>
      </footer>
      <UpdateStatus />
    </div>
  );
}
