import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { DatasetAnalysis } from "../analysis/types";
import type { PlotPreferences } from "../preferences/preferences";
import { minMaxDownsample } from "./downsample";
import { Plotly } from "./plotly";

export interface ScientificPlotHandle {
  toPng: (scale?: number) => Promise<string>;
}

interface Props {
  kind: "time" | "spectrum";
  results: DatasetAnalysis[];
  preferences: PlotPreferences;
  xLabel: string;
  yLabel: string;
  selectionMode?: boolean;
  onRangeSelected?: (minimum: number, maximum: number) => void;
}

type PlotDiv = HTMLDivElement & {
  on: (event: string, handler: (event: unknown) => void) => void;
  removeAllListeners: (event: string) => void;
};

function displayRange(
  minimumText: string,
  maximumText: string,
  scale: "linear" | "log" | "symlog"
): [number, number] | undefined {
  if (!minimumText.trim() || !maximumText.trim()) return undefined;
  const minimum = Number(minimumText);
  const maximum = Number(maximumText);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
    return undefined;
  }
  if (scale === "log") {
    if (minimum <= 0) return undefined;
    return [Math.log10(minimum), Math.log10(maximum)];
  }
  if (scale === "symlog") {
    const transform = (value: number) =>
      Math.sign(value) * Math.log10(1 + Math.abs(value));
    return [transform(minimum), transform(maximum)];
  }
  return [minimum, maximum];
}

export const ScientificPlot = forwardRef<ScientificPlotHandle, Props>(
  function ScientificPlot(
    {
      kind,
      results,
      preferences,
      xLabel,
      yLabel,
      selectionMode = false,
      onRangeSelected
    },
    ref
  ) {
    const element = useRef<PlotDiv | null>(null);
    useImperativeHandle(ref, () => ({
      toPng: async (scale = 2) => {
        if (!element.current) throw new Error("Plot is not ready.");
        return Plotly.toImage(element.current, {
          format: "png",
          width: element.current.clientWidth,
          height: element.current.clientHeight,
          scale
        });
      }
    }));

    useEffect(() => {
      if (!element.current) return;
      const traces = results.map((analysis) => {
        const result = analysis.result;
        const sourceX = kind === "time" ? analysis.timeX : result.frequency;
        const sourceY = kind === "time" ? analysis.timeY : result.value;
        const display = minMaxDownsample(sourceX, sourceY);
        const indices = display.sourceIndices;
        const errorX =
          kind === "time" && preferences.showErrors && analysis.timeXError
            ? {
                type: "data" as const,
                array: indices.map((index) => analysis.timeXError![index]),
                visible: true
              }
            : undefined;
        const errorY =
          kind === "time" && preferences.showErrors && analysis.timeYError
            ? {
                type: "data" as const,
                array: indices.map((index) => analysis.timeYError![index]),
                visible: true
              }
            : undefined;
        return {
          type: "scatter" as const,
          mode:
            kind === "spectrum"
              ? ("lines" as const)
              : preferences.showLines && preferences.showMarkers
                ? ("lines+markers" as const)
                : preferences.showMarkers
                  ? ("markers" as const)
                  : ("lines" as const),
          name: analysis.datasetName.replace(/\.[^.]+$/, ""),
          x: display.x,
          y: display.y,
          line: { color: analysis.color, width: kind === "time" ? 1.4 : 1.8 },
          marker: { color: analysis.color, size: 5 },
          error_x: errorX,
          error_y: errorY,
          hovertemplate: `%{x:.7g}, %{y:.7g}<extra>${analysis.datasetName}</extra>`
        };
      });
      const isSymlog = kind === "time" && preferences.timeScale === "symlog";
      const yScale =
        (kind === "spectrum" && preferences.spectrumLog) ||
        (kind === "time" && preferences.timeScale === "log")
          ? "log"
          : isSymlog
            ? "symlog"
            : "linear";
      const xRange = displayRange(
        kind === "time" ? preferences.timeXMinimum : preferences.spectrumXMinimum,
        kind === "time" ? preferences.timeXMaximum : preferences.spectrumXMaximum,
        "linear"
      );
      const yRange = displayRange(
        kind === "time" ? preferences.timeYMinimum : preferences.spectrumYMinimum,
        kind === "time" ? preferences.timeYMaximum : preferences.spectrumYMaximum,
        yScale
      );
      if (isSymlog) {
        for (const trace of traces) {
          trace.y = (trace.y as number[]).map(
            (value) => Math.sign(value) * Math.log10(1 + Math.abs(value))
          );
        }
      }
      void Plotly.react(
        element.current,
        traces,
        {
          title: {
            text: kind === "time" ? preferences.title || "Selected scans" : "Fourier spectrum",
            font: { size: 17 }
          },
          margin: { l: 70, r: 24, t: 50, b: 64 },
          paper_bgcolor: "#ffffff",
          plot_bgcolor: "#ffffff",
          showlegend: preferences.showLegend,
          legend: { orientation: "h", y: -0.22 },
          dragmode: selectionMode ? "select" : "pan",
          selectdirection: "h",
          xaxis: {
            title: { text: xLabel },
            range: xRange,
            gridcolor: preferences.showGrid ? "#d9e2ec" : "transparent",
            zerolinecolor: "#bcccdc"
          },
          yaxis: {
            title: {
              text: isSymlog ? `${yLabel} (symmetric log display)` : yLabel
            },
            type: yScale === "log" ? "log" : "linear",
            range: yRange,
            gridcolor: preferences.showGrid ? "#d9e2ec" : "transparent",
            zerolinecolor: "#829ab1"
          },
          uirevision: `${kind}-view`
        },
        {
          responsive: true,
          displaylogo: false,
          scrollZoom: true,
          displayModeBar: true,
          modeBarButtonsToRemove: [
            "lasso2d",
            "toggleSpikelines",
            "hoverClosestCartesian",
            "hoverCompareCartesian",
            "toImage"
          ]
        }
      );
      const plot = element.current;
      plot.removeAllListeners?.("plotly_selected");
      if (selectionMode && onRangeSelected) {
        plot.on("plotly_selected", (rawEvent: unknown) => {
          const event = rawEvent as { range?: { x?: [number, number] } };
          if (event.range?.x) {
            onRangeSelected(
              Math.min(event.range.x[0], event.range.x[1]),
              Math.max(event.range.x[0], event.range.x[1])
            );
          }
        });
      }
      return () => {
        plot.removeAllListeners?.("plotly_selected");
      };
    }, [
      kind,
      onRangeSelected,
      preferences,
      results,
      selectionMode,
      xLabel,
      yLabel
    ]);

    useEffect(
      () => () => {
        if (element.current) Plotly.purge(element.current);
      },
      []
    );

    return (
      <div
        ref={element}
        className="scientific-plot"
        aria-label={`${kind === "time" ? "Time-domain" : "Fourier spectrum"} plot`}
      />
    );
  }
);
