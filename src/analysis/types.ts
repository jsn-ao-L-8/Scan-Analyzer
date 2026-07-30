export type DetrendMode = "none" | "mean" | "linear" | "moving average";
export type WindowMode = "rectangular" | "hann" | "hamming" | "blackman";
export type QuantityMode =
  | "amplitude"
  | "power"
  | "power spectral density"
  | "phase"
  | "real"
  | "imaginary";
export type NormalizationMode =
  | "none"
  | "fft length"
  | "coherent gain"
  | "unit peak"
  | "unit integrated power";
export type PaddingMode =
  | "points per side"
  | "next power of two"
  | "2x length"
  | "4x length";

export interface PreprocessConfig {
  xMin: number | null;
  xMax: number | null;
  detrend: DetrendMode;
  movingAveragePoints: number;
  resampleNonuniform: boolean;
  uniformityTolerance: number;
}

export interface SpectrumConfig {
  window: WindowMode;
  quantity: QuantityMode;
  normalization: NormalizationMode;
  paddingMode: PaddingMode;
  paddingPointsEachSide: number;
  twoSided: boolean;
}

export const DEFAULT_PREPROCESS: PreprocessConfig = {
  xMin: null,
  xMax: null,
  detrend: "mean",
  movingAveragePoints: 101,
  resampleNonuniform: true,
  uniformityTolerance: 1e-4
};

export const DEFAULT_SPECTRUM: SpectrumConfig = {
  window: "hann",
  quantity: "amplitude",
  normalization: "coherent gain",
  paddingMode: "points per side",
  paddingPointsEachSide: 0,
  twoSided: false
};

export interface NumericDataset {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  columns: string[];
  numericColumns: string[];
  numericExtents: Record<string, [number, number] | null>;
  data: Record<string, Float64Array>;
  rowCount: number;
  color: string;
}

export type DatasetSummary = Omit<NumericDataset, "data">;

export interface PreparedTrace {
  x: Float64Array;
  yRaw: Float64Array;
  y: Float64Array;
  xError: Float64Array | null;
  yError: Float64Array | null;
  relativeSpacingVariation: number;
  interpolated: boolean;
}

export interface SpectrumResult {
  frequency: Float64Array;
  value: Float64Array;
  fftReal: Float64Array;
  fftImag: Float64Array;
  trace: PreparedTrace;
  windowValues: Float64Array;
  nInput: number;
  nFft: number;
  dx: number;
  samplingFrequency: number;
  nyquist: number;
  frequencySpacing: number;
}

export interface TraceStatistics {
  n: number;
  meanY: number;
  meanError: number;
  stdY: number;
  semY: number;
  medianY: number;
  minY: number;
  maxY: number;
}

export interface ColumnSelection {
  x: string;
  y: string;
  xError: string | null;
  yError: string | null;
}

export interface DatasetAnalysis {
  datasetId: string;
  datasetName: string;
  color: string;
  result: SpectrumResult;
  timeX: Float64Array;
  timeY: Float64Array;
  timeXError: Float64Array | null;
  timeYError: Float64Array | null;
  statistics: TraceStatistics;
  status: string;
}

export interface AnalysisFailure {
  datasetId?: string;
  datasetName: string;
  code: string;
  message: string;
}

export interface AnalysisRequest {
  type: "analyze";
  requestId: number;
  datasetIds: string[];
  columns: ColumnSelection;
  preprocess: PreprocessConfig;
  spectrum: SpectrumConfig;
}

export interface ParseRequest {
  type: "parse";
  requestId: number;
  files: File[];
}

export interface RemoveRequest {
  type: "remove";
  datasetIds: string[];
}

export type WorkerRequest = AnalysisRequest | ParseRequest | RemoveRequest;

export type WorkerResponse =
  | {
      type: "parsed";
      requestId: number;
      datasets: DatasetSummary[];
      errors: AnalysisFailure[];
    }
  | {
      type: "analyzed";
      requestId: number;
      results: DatasetAnalysis[];
      errors: AnalysisFailure[];
    }
  | {
      type: "progress";
      requestId: number;
      message: string;
    };
