/// <reference lib="webworker" />

import { computeSpectrum } from "../analysis/core";
import { prepareTrace } from "../analysis/preprocessing/core";
import { traceStatistics } from "../analysis/statistics/core";
import type {
  AnalysisFailure,
  DatasetAnalysis,
  DatasetSummary,
  NumericDataset,
  WorkerRequest,
  WorkerResponse
} from "../analysis/types";
import { parseCsvFile } from "../io/csv";

const datasets = new Map<string, NumericDataset>();
const workerScope = self as DedicatedWorkerGlobalScope;

function summary(dataset: NumericDataset): DatasetSummary {
  return {
    id: dataset.id,
    name: dataset.name,
    size: dataset.size,
    lastModified: dataset.lastModified,
    columns: dataset.columns,
    numericColumns: dataset.numericColumns,
    numericExtents: dataset.numericExtents,
    rowCount: dataset.rowCount,
    color: dataset.color
  };
}

function failure(
  datasetName: string,
  error: unknown,
  datasetId?: string,
  code = "analysis_error"
): AnalysisFailure {
  return {
    datasetId,
    datasetName,
    code,
    message: error instanceof Error ? error.message : String(error)
  };
}

function post(response: WorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer);
}

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "remove") {
    for (const id of message.datasetIds) datasets.delete(id);
    return;
  }
  if (message.type === "parse") {
    const imported: DatasetSummary[] = [];
    const errors: AnalysisFailure[] = [];
    for (const file of message.files) {
      post({
        type: "progress",
        requestId: message.requestId,
        message: `Reading ${file.name}…`
      });
      try {
        const dataset = await parseCsvFile(file);
        datasets.set(dataset.id, dataset);
        imported.push(summary(dataset));
      } catch (error) {
        errors.push(failure(file.name, error, undefined, "parse_error"));
      }
    }
    post({ type: "parsed", requestId: message.requestId, datasets: imported, errors });
    return;
  }

  const results: DatasetAnalysis[] = [];
  const errors: AnalysisFailure[] = [];
  const transfer: Transferable[] = [];
  for (const id of message.datasetIds) {
    const dataset = datasets.get(id);
    if (!dataset) {
      errors.push(failure("Unknown dataset", "Dataset is no longer available.", id, "missing"));
      continue;
    }
    try {
      const x = dataset.data[message.columns.x];
      const y = dataset.data[message.columns.y];
      if (!x || !y) throw new Error("The selected X or Y column is not available.");
      const xError = message.columns.xError
        ? dataset.data[message.columns.xError] ?? null
        : null;
      const yError = message.columns.yError
        ? dataset.data[message.columns.yError] ?? null
        : null;
      const trace = prepareTrace(x, y, message.preprocess, xError, yError);
      const result = computeSpectrum(trace, message.spectrum);
      const finiteIndices: number[] = [];
      for (let index = 0; index < x.length; index += 1) {
        if (Number.isFinite(x[index]) && Number.isFinite(y[index])) finiteIndices.push(index);
      }
      const timeX = Float64Array.from(finiteIndices, (index) => x[index]);
      const timeY = Float64Array.from(finiteIndices, (index) => y[index]);
      const timeXError = xError
        ? Float64Array.from(finiteIndices, (index) => xError[index])
        : null;
      const timeYError = yError
        ? Float64Array.from(finiteIndices, (index) => yError[index])
        : null;
      const status = `${trace.interpolated ? "interpolated" : "uniform"}; variation ${trace.relativeSpacingVariation.toPrecision(2)}`;
      results.push({
        datasetId: id,
        datasetName: dataset.name,
        color: dataset.color,
        result,
        timeX,
        timeY,
        timeXError,
        timeYError,
        statistics: traceStatistics(y, yError),
        status
      });
      transfer.push(
        result.frequency.buffer,
        result.value.buffer,
        result.fftReal.buffer,
        result.fftImag.buffer,
        result.trace.x.buffer,
        result.trace.yRaw.buffer,
        result.trace.y.buffer,
        result.windowValues.buffer
        ,
        timeX.buffer,
        timeY.buffer
      );
      if (timeXError) transfer.push(timeXError.buffer);
      if (timeYError) transfer.push(timeYError.buffer);
      if (result.trace.xError) transfer.push(result.trace.xError.buffer);
      if (result.trace.yError) transfer.push(result.trace.yError.buffer);
    } catch (error) {
      errors.push(failure(dataset.name, error, id));
    }
  }
  post({ type: "analyzed", requestId: message.requestId, results, errors }, transfer);
};

export {};
