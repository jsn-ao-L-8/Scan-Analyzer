// Plotly's package does not publish declarations for its modular CommonJS
// entrypoints. Keep the unsafe boundary in this single adapter.
import PlotlyCore from "plotly.js/lib/core";
import Scatter from "plotly.js/lib/scatter";

PlotlyCore.register([Scatter]);

export const Plotly = PlotlyCore as typeof import("plotly.js");
