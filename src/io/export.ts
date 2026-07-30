import type {
  ColumnSelection,
  DatasetAnalysis,
  PreprocessConfig,
  SpectrumConfig
} from "../analysis/types";
import { rowsToCsv } from "./csv";

export interface ExportContext {
  results: DatasetAnalysis[];
  columns: ColumnSelection;
  rangeMode: string;
  preprocess: PreprocessConfig;
  spectrum: SpectrumConfig;
}

function finiteOrBlank(value: number): number | "" {
  return Number.isFinite(value) ? value : "";
}

export function analysisCsv(results: DatasetAnalysis[]): string {
  const rows: unknown[][] = [];
  for (const analysis of results) {
    const { result } = analysis;
    for (let index = 0; index < result.trace.x.length; index += 1) {
      rows.push([
        analysis.datasetName,
        "time",
        result.trace.x[index],
        result.trace.y[index],
        result.trace.yRaw[index],
        result.trace.xError?.[index] ?? "",
        result.trace.yError?.[index] ?? "",
        "",
        ""
      ]);
    }
    for (let index = 0; index < result.frequency.length; index += 1) {
      rows.push([
        analysis.datasetName,
        "spectrum",
        result.frequency[index],
        result.value[index],
        "",
        "",
        "",
        result.fftReal[index],
        result.fftImag[index]
      ]);
    }
  }
  return rowsToCsv(
    [
      "dataset",
      "domain",
      "x",
      "value",
      "raw_value",
      "x_error",
      "y_error",
      "fft_real",
      "fft_imag"
    ],
    rows
  );
}

export function statisticsCsv(results: DatasetAnalysis[]): string {
  const rows = results.map(({ datasetName, statistics, result, status }) => [
    datasetName,
    statistics.n,
    finiteOrBlank(statistics.meanY),
    finiteOrBlank(statistics.meanError),
    finiteOrBlank(statistics.stdY),
    finiteOrBlank(statistics.semY),
    finiteOrBlank(statistics.medianY),
    finiteOrBlank(statistics.minY),
    finiteOrBlank(statistics.maxY),
    result.dx,
    result.samplingFrequency,
    result.nyquist,
    result.frequencySpacing,
    status
  ]);
  return rowsToCsv(
    [
      "file",
      "n",
      "mean_y",
      "mean_error",
      "std_y",
      "sem_y",
      "median_y",
      "min_y",
      "max_y",
      "dx",
      "sampling_frequency",
      "nyquist",
      "frequency_spacing",
      "status"
    ],
    rows
  );
}

export function metadataJson(context: ExportContext): string {
  const metadata = {
    schemaVersion: 1,
    application: {
      name: "Scan & Fourier Analyzer",
      version: __APP_VERSION__,
      commit: __BUILD_COMMIT__
    },
    selectedFiles: context.results.map(({ datasetName }) => datasetName),
    columns: context.columns,
    rangeMode: context.rangeMode,
    preprocess: context.preprocess,
    spectrum: context.spectrum,
    spectra: Object.fromEntries(
      context.results.map(({ datasetName, result }) => [
        datasetName,
        {
          nInput: result.nInput,
          nFft: result.nFft,
          dx: result.dx,
          samplingFrequency: result.samplingFrequency,
          nyquist: result.nyquist,
          frequencySpacing: result.frequencySpacing,
          interpolated: result.trace.interpolated,
          relativeSpacingVariation: result.trace.relativeSpacingVariation
        }
      ])
    )
  };
  return JSON.stringify(metadata, null, 2);
}

export function textFile(contents: string, name: string, type: string): File {
  return new File([contents], name, { type, lastModified: Date.now() });
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownload(files: File[]): Promise<"shared" | "downloaded"> {
  const navigatorWithShare = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  const shareData: ShareData = { files, title: "Scan & Fourier Analyzer export" };
  if (
    navigator.share &&
    navigatorWithShare.canShare?.(shareData)
  ) {
    await navigator.share(shareData);
    return "shared";
  }
  files.forEach(download);
  return "downloaded";
}
