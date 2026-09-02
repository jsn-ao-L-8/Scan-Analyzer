import {
  DEFAULT_PREPROCESS,
  DEFAULT_SPECTRUM,
  type PreprocessConfig,
  type SpectrumConfig
} from "../analysis/types";

const STORAGE_KEY = "scan-fourier-analyzer:preferences:v1";

export interface PlotPreferences {
  showLegend: boolean;
  showGrid: boolean;
  showMarkers: boolean;
  showLines: boolean;
  showErrors: boolean;
  timeScale: "linear" | "log" | "symlog";
  spectrumLog: boolean;
  title: string;
  xLabel: string;
  yLabel: string;
  timeXMinimum: string;
  timeXMaximum: string;
  timeYMinimum: string;
  timeYMaximum: string;
  spectrumXMinimum: string;
  spectrumXMaximum: string;
  spectrumYMinimum: string;
  spectrumYMaximum: string;
}

export interface Preferences {
  schemaVersion: 1;
  preprocess: PreprocessConfig;
  spectrum: SpectrumConfig;
  plot: PlotPreferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  schemaVersion: 1,
  preprocess: DEFAULT_PREPROCESS,
  spectrum: DEFAULT_SPECTRUM,
  plot: {
    showLegend: true,
    showGrid: true,
    showMarkers: true,
    showLines: true,
    showErrors: true,
    timeScale: "linear",
    spectrumLog: false,
    title: "Selected scans",
    xLabel: "",
    yLabel: "",
    timeXMinimum: "",
    timeXMaximum: "",
    timeYMinimum: "",
    timeYMaximum: "",
    spectrumXMinimum: "",
    spectrumXMaximum: "",
    spectrumYMinimum: "",
    spectrumYMaximum: ""
  }
};

export function normalizePreprocessRange(
  preprocess: PreprocessConfig
): PreprocessConfig {
  const { xMin, xMax } = preprocess;
  if (xMin === null && xMax === null) return preprocess;
  if (
    typeof xMin !== "number" ||
    typeof xMax !== "number" ||
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    xMin >= xMax
  ) {
    return { ...preprocess, xMin: null, xMax: null };
  }
  return preprocess;
}

export function loadPreferences(): Preferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (parsed?.schemaVersion !== 1) return structuredClone(DEFAULT_PREFERENCES);
    const preprocess = normalizePreprocessRange({
      ...DEFAULT_PREPROCESS,
      ...parsed.preprocess
    });
    return {
      ...structuredClone(DEFAULT_PREFERENCES),
      ...parsed,
      preprocess,
      spectrum: { ...DEFAULT_SPECTRUM, ...parsed.spectrum },
      plot: { ...DEFAULT_PREFERENCES.plot, ...parsed.plot }
    };
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

export function savePreferences(preferences: Preferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export async function resetApplication(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY);
  if ("caches" in window) {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  }
}
