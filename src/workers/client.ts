import type {
  AnalysisRequest,
  DatasetSummary,
  ParseRequest,
  WorkerResponse
} from "../analysis/types";

type ParsedResponse = Extract<WorkerResponse, { type: "parsed" }>;
type AnalyzedResponse = Extract<WorkerResponse, { type: "analyzed" }>;

export class AnalysisWorkerClient {
  private readonly worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module"
  });
  private nextRequestId = 1;
  private pending = new Map<
    number,
    {
      resolve: (response: ParsedResponse | AnalyzedResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  onProgress: ((message: string) => void) | null = null;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === "progress") {
        this.onProgress?.(response.message);
        return;
      }
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      pending.resolve(response);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Analysis worker failed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  parse(files: File[]): Promise<ParsedResponse> {
    const requestId = this.nextRequestId++;
    const request: ParseRequest = { type: "parse", requestId, files };
    return this.send<ParsedResponse>(request);
  }

  analyze(request: Omit<AnalysisRequest, "type" | "requestId">): Promise<AnalyzedResponse> {
    const requestId = this.nextRequestId++;
    return this.send<AnalyzedResponse>({ ...request, type: "analyze", requestId });
  }

  remove(datasets: DatasetSummary[]): void {
    this.worker.postMessage({ type: "remove", datasetIds: datasets.map(({ id }) => id) });
  }

  close(): void {
    this.worker.terminate();
  }

  private send<T extends ParsedResponse | AnalyzedResponse>(
    request: ParseRequest | AnalysisRequest
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        resolve: resolve as (response: ParsedResponse | AnalyzedResponse) => void,
        reject
      });
      this.worker.postMessage(request);
    });
  }
}
