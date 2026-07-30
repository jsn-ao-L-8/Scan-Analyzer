"""Tkinter desktop UI for interactive scan and Fourier analysis."""

from __future__ import annotations

import json
import math
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.widgets import SpanSelector

from analysis_core import (
    PreprocessConfig,
    SpectrumConfig,
    common_numeric_columns,
    compute_spectrum,
    configs_as_dict,
    discover_scan_files,
    prepare_trace,
    read_scan,
    trace_statistics,
    validate_range_bounds,
)


X_CANDIDATES = ("delay_ps", "time_ps", "time", "x")
Y_CANDIDATES = ("x_mean", "r_mean", "y_mean", "mean", "x", "r", "y")
ERROR_CANDIDATES = ("x_error", "r_error", "y_error", "error", "sem", "stderr")
SETTINGS_PATH = Path.home() / ".scan_fourier_analyzer.json"
LAYOUT_VERSION = 2
DEFAULT_PLOT_FRACTION = 0.77


def first_match(candidates: tuple[str, ...], columns: list[str], fallback: str = "") -> str:
    lookup = {item.casefold(): item for item in columns}
    for candidate in candidates:
        if candidate.casefold() in lookup:
            return lookup[candidate.casefold()]
    return columns[0] if columns else fallback


class ScanFourierAnalyzer:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Scan & Fourier Analyzer")
        self.root.geometry("1520x920")
        self.root.minsize(1120, 700)

        self.files: list[Path] = []
        self.visible_files: list[Path] = []
        self.frames: dict[Path, pd.DataFrame] = {}
        self.results: dict[Path, object] = {}
        self.colors: dict[Path, str] = {}
        self.stats = pd.DataFrame()
        self.update_job: str | None = None
        self.selector: SpanSelector | None = None
        self.loading = False
        self.last_valid_range: tuple[float, float] | None = None
        self._last_cursor_text = ""
        self._saved_plot_fraction = DEFAULT_PLOT_FRACTION
        self._saved_tab = 0

        saved = self._load_preferences()
        self.folder = Path(saved.get("last_folder", Path.cwd()))
        if int(saved.get("layout_version", 0)) >= LAYOUT_VERSION:
            self._saved_plot_fraction = float(saved.get("plot_fraction", DEFAULT_PLOT_FRACTION))
        self._saved_tab = int(saved.get("selected_tab", 0))

        self.folder_var = tk.StringVar(value=str(self.folder))
        self.search_var = tk.StringVar()
        self.x_var = tk.StringVar()
        self.y_var = tk.StringVar()
        self.xerr_var = tk.StringVar(value="None")
        self.yerr_var = tk.StringVar(value="None")
        self.title_var = tk.StringVar(value="Selected scans")
        self.xlabel_var = tk.StringVar()
        self.ylabel_var = tk.StringVar()
        self.legend_var = tk.BooleanVar(value=True)
        self.grid_var = tk.BooleanVar(value=True)
        self.errors_var = tk.BooleanVar(value=True)
        self.markers_var = tk.BooleanVar(value=True)
        self.lines_var = tk.BooleanVar(value=True)
        self.yscale_var = tk.StringVar(value="linear")
        self.xlim_min_var = tk.StringVar()
        self.xlim_max_var = tk.StringVar()
        self.ylim_min_var = tk.StringVar()
        self.ylim_max_var = tk.StringVar()
        self.range_mode_var = tk.StringVar(value="full")
        self.interaction_mode_var = tk.StringVar(value="pointer")
        self.range_min_var = tk.StringVar()
        self.range_max_var = tk.StringVar()
        self.range_error_var = tk.StringVar()
        self.detrend_var = tk.StringVar(value="mean")
        self.moving_points_var = tk.IntVar(value=101)
        self.resample_var = tk.BooleanVar(value=True)
        self.window_var = tk.StringVar(value="hann")
        self.quantity_var = tk.StringVar(value="amplitude")
        self.normalization_var = tk.StringVar(value="coherent gain")
        self.padding_mode_var = tk.StringVar(value="points per side")
        self.padding_points_var = tk.IntVar(value=0)
        self.two_sided_var = tk.BooleanVar(value=False)
        self.spectrum_log_var = tk.BooleanVar(value=False)
        self.dpi_var = tk.IntVar(value=300)
        self.export_target_var = tk.StringVar(value="combined")
        self.status_var = tk.StringVar(value="Ready")

        for name, variable in self._preference_variables().items():
            if name in saved:
                try:
                    variable.set(saved[name])
                except (tk.TclError, TypeError):
                    pass

        self._build_ui()
        self._bind_events()
        self.root.after_idle(self._restore_layout)
        if self.folder.is_dir():
            self.load_folder(self.folder)

    # ---------- UI construction ----------

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        self.main_panes = ttk.Panedwindow(self.root, orient="vertical")
        self.main_panes.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)
        plot_pane = ttk.Frame(self.main_panes)
        bottom_pane = ttk.Frame(self.main_panes)
        self.main_panes.add(plot_pane, weight=7)
        self.main_panes.add(bottom_pane, weight=3)

        plot_pane.columnconfigure(0, weight=1)
        plot_pane.rowconfigure(0, weight=1)
        self.figure, (self.time_ax, self.spectrum_ax) = plt.subplots(
            1, 2, figsize=(12, 6), constrained_layout=True
        )
        self.canvas = FigureCanvasTkAgg(self.figure, master=plot_pane)
        self.canvas.get_tk_widget().grid(row=0, column=0, sticky="nsew")

        # Keep a real Matplotlib toolbar for its navigation stack, but expose a
        # clearer, smaller set of application-owned controls.
        self.toolbar = NavigationToolbar2Tk(self.canvas, plot_pane, pack_toolbar=False)
        self.toolbar.update()
        self._build_interaction_bar(plot_pane)

        bottom_pane.columnconfigure(0, weight=0)
        bottom_pane.columnconfigure(1, weight=1)
        bottom_pane.rowconfigure(0, weight=1)
        dataset_panel = ttk.LabelFrame(bottom_pane, text="Datasets", padding=6)
        dataset_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 7))
        self._build_dataset_panel(dataset_panel)

        self.notebook = ttk.Notebook(bottom_pane)
        self.notebook.grid(row=0, column=1, sticky="nsew")
        time_tab = ttk.Frame(self.notebook, padding=8)
        fft_tab = ttk.Frame(self.notebook, padding=8)
        stats_tab = ttk.Frame(self.notebook, padding=6)
        export_tab = ttk.Frame(self.notebook, padding=8)
        self.notebook.add(time_tab, text="Time Domain")
        self.notebook.add(fft_tab, text="Fourier")
        self.notebook.add(stats_tab, text="Statistics")
        self.notebook.add(export_tab, text="Export")
        self._build_time_tab(time_tab)
        self._build_fft_tab(fft_tab)
        self._build_stats_tab(stats_tab)
        self._build_export_tab(export_tab)

        ttk.Label(self.root, textvariable=self.status_var, relief="sunken", anchor="w").grid(
            row=1, column=0, sticky="ew"
        )
        self._recreate_selector()
        self._sync_range_widgets()

    def _build_interaction_bar(self, parent: ttk.Frame) -> None:
        bar = ttk.Frame(parent, padding=(4, 3))
        bar.grid(row=1, column=0, sticky="ew")
        ttk.Label(bar, text="Mouse:").pack(side="left")
        for text, value in (
            ("Pointer", "pointer"),
            ("Select FFT Range", "select"),
            ("Pan", "pan"),
            ("Box Zoom", "zoom"),
        ):
            ttk.Radiobutton(
                bar, text=text, value=value, variable=self.interaction_mode_var,
                command=lambda mode=value: self.set_interaction_mode(mode),
            ).pack(side="left", padx=(5, 0))
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)
        ttk.Button(bar, text="Home", command=self.home_views).pack(side="left")
        ttk.Button(bar, text="Back", command=self.toolbar.back).pack(side="left", padx=(4, 0))
        ttk.Button(bar, text="Forward", command=self.toolbar.forward).pack(side="left", padx=(4, 0))
        ttk.Label(
            bar,
            text="Wheel: zoom at cursor  •  Double-click: reset plot",
            foreground="#666666",
        ).pack(side="right")

    def _build_dataset_panel(self, panel: ttk.Frame) -> None:
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(3, weight=1)
        folder_row = ttk.Frame(panel)
        folder_row.grid(row=0, column=0, sticky="ew")
        folder_row.columnconfigure(0, weight=1)
        ttk.Entry(folder_row, textvariable=self.folder_var, width=38).grid(row=0, column=0, sticky="ew")
        ttk.Button(folder_row, text="Browse…", command=self.browse_folder).grid(row=0, column=1, padx=(4, 0))
        ttk.Label(panel, text="Filter files").grid(row=1, column=0, sticky="w", pady=(5, 0))
        ttk.Entry(panel, textvariable=self.search_var).grid(row=2, column=0, sticky="ew")
        list_frame = ttk.Frame(panel)
        list_frame.grid(row=3, column=0, sticky="nsew", pady=4)
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(0, weight=1)
        self.file_list = tk.Listbox(
            list_frame, selectmode=tk.EXTENDED, exportselection=False, width=44, height=8
        )
        self.file_list.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(list_frame, command=self.file_list.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.file_list.configure(yscrollcommand=scroll.set)
        buttons = ttk.Frame(panel)
        buttons.grid(row=4, column=0, sticky="ew")
        ttk.Button(buttons, text="All", command=self.select_all).pack(side="left")
        ttk.Button(buttons, text="Clear", command=self.clear_selection).pack(side="left", padx=3)
        ttk.Button(buttons, text="Refresh", command=self.refresh_folder).pack(side="left")
        ttk.Button(buttons, text="Plot / Update", command=lambda: self.plot(reset_views=False)).pack(side="right")

    @staticmethod
    def _group(parent: ttk.Frame, title: str, column: int) -> ttk.LabelFrame:
        group = ttk.LabelFrame(parent, text=title, padding=7)
        group.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 5, 0))
        group.columnconfigure(1, weight=1)
        return group

    @staticmethod
    def _combo(
        parent: ttk.Frame,
        row: int,
        label: str,
        variable: tk.Variable,
        values: list[str],
        width: int = 20,
    ) -> ttk.Combobox:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", pady=2)
        box = ttk.Combobox(parent, textvariable=variable, values=values, state="readonly", width=width)
        box.grid(row=row, column=1, sticky="ew", padx=(6, 0), pady=2)
        return box

    def _build_time_tab(self, tab: ttk.Frame) -> None:
        for column in range(3):
            tab.columnconfigure(column, weight=1)
        columns = self._group(tab, "Columns", 0)
        processing = self._group(tab, "Processing & style", 1)
        labels = self._group(tab, "Labels & visible limits", 2)

        self.x_box = self._combo(columns, 0, "X", self.x_var, [])
        self.y_box = self._combo(columns, 1, "Y", self.y_var, [])
        self.xerr_box = self._combo(columns, 2, "X error", self.xerr_var, ["None"])
        self.yerr_box = self._combo(columns, 3, "Y error", self.yerr_var, ["None"])

        self._combo(processing, 0, "FFT detrend", self.detrend_var, ["none", "mean", "linear", "moving average"])
        ttk.Label(processing, text="Moving avg. points").grid(row=1, column=0, sticky="w")
        ttk.Spinbox(processing, textvariable=self.moving_points_var, from_=1, to=999999, width=10).grid(row=1, column=1, sticky="ew", padx=(6, 0))
        ttk.Checkbutton(processing, text="Resample nonuniform X", variable=self.resample_var).grid(row=2, column=0, columnspan=2, sticky="w")
        style_row = ttk.Frame(processing)
        style_row.grid(row=3, column=0, columnspan=2, sticky="w")
        for text, variable in (("Errors", self.errors_var), ("Markers", self.markers_var), ("Lines", self.lines_var)):
            ttk.Checkbutton(style_row, text=text, variable=variable).pack(side="left")
        self._combo(processing, 4, "Y scale", self.yscale_var, ["linear", "log", "symlog"])

        for row, text, variable in (
            (0, "Title", self.title_var), (1, "X label", self.xlabel_var), (2, "Y label", self.ylabel_var),
        ):
            ttk.Label(labels, text=text).grid(row=row, column=0, sticky="w")
            ttk.Entry(labels, textvariable=variable).grid(row=row, column=1, sticky="ew", padx=(6, 0), pady=2)
        self._limit_pair(labels, 3, "Visible X", self.xlim_min_var, self.xlim_max_var)
        self._limit_pair(labels, 4, "Visible Y", self.ylim_min_var, self.ylim_max_var)
        toggles = ttk.Frame(labels)
        toggles.grid(row=5, column=0, columnspan=2, sticky="w")
        ttk.Checkbutton(toggles, text="Legend", variable=self.legend_var).pack(side="left")
        ttk.Checkbutton(toggles, text="Grid", variable=self.grid_var).pack(side="left")
        ttk.Button(labels, text="Apply view limits", command=self.apply_view_limits).grid(row=6, column=0, sticky="ew", pady=(4, 0))
        ttk.Button(labels, text="Reset view", command=self.home_views).grid(row=6, column=1, sticky="ew", padx=(6, 0), pady=(4, 0))

    @staticmethod
    def _limit_pair(parent: ttk.Frame, row: int, label: str, left: tk.Variable, right: tk.Variable) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w")
        pair = ttk.Frame(parent)
        pair.grid(row=row, column=1, sticky="ew", padx=(6, 0), pady=2)
        ttk.Entry(pair, textvariable=left, width=9).pack(side="left", fill="x", expand=True)
        ttk.Entry(pair, textvariable=right, width=9).pack(side="left", fill="x", expand=True, padx=(3, 0))

    def _build_fft_tab(self, tab: ttk.Frame) -> None:
        for column in range(3):
            tab.columnconfigure(column, weight=1)
        range_group = self._group(tab, "Transform range", 0)
        transform = self._group(tab, "Transform", 1)
        display = self._group(tab, "Spectrum display", 2)

        ttk.Label(range_group, text="Mode").grid(row=0, column=0, sticky="w")
        modes = ttk.Frame(range_group)
        modes.grid(row=0, column=1, sticky="w", padx=(6, 0))
        for text, value in (("Full", "full"), ("Drag", "drag"), ("Manual", "manual")):
            ttk.Radiobutton(
                modes, text=text, value=value, variable=self.range_mode_var,
                command=self.range_mode_changed,
            ).pack(side="left")
        ttk.Label(range_group, text="Minimum").grid(row=1, column=0, sticky="w")
        self.range_min_entry = ttk.Entry(range_group, textvariable=self.range_min_var)
        self.range_min_entry.grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=2)
        ttk.Label(range_group, text="Maximum").grid(row=2, column=0, sticky="w")
        self.range_max_entry = ttk.Entry(range_group, textvariable=self.range_max_var)
        self.range_max_entry.grid(row=2, column=1, sticky="ew", padx=(6, 0), pady=2)
        self.range_apply_button = ttk.Button(range_group, text="Apply manual range", command=self.apply_manual_range)
        self.range_apply_button.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(4, 0))
        ttk.Label(range_group, textvariable=self.range_error_var, foreground="#b00020", wraplength=300).grid(
            row=4, column=0, columnspan=2, sticky="w", pady=(4, 0)
        )

        self._combo(transform, 0, "Window", self.window_var, ["rectangular", "hann", "hamming", "blackman"])
        self._combo(transform, 1, "Detrend", self.detrend_var, ["none", "mean", "linear", "moving average"])
        self._combo(transform, 2, "Zero padding", self.padding_mode_var, ["points per side", "next power of two", "2x length", "4x length"])
        ttk.Label(transform, text="Points per side").grid(row=3, column=0, sticky="w")
        ttk.Spinbox(transform, textvariable=self.padding_points_var, from_=0, to=10000000).grid(row=3, column=1, sticky="ew", padx=(6, 0))

        self._combo(display, 0, "Quantity", self.quantity_var, ["amplitude", "power", "power spectral density", "phase", "real", "imaginary"])
        self._combo(display, 1, "Normalization", self.normalization_var, ["none", "fft length", "coherent gain", "unit peak", "unit integrated power"])
        ttk.Checkbutton(display, text="Centered two-sided", variable=self.two_sided_var).grid(row=2, column=0, columnspan=2, sticky="w")
        ttk.Checkbutton(display, text="Logarithmic Y", variable=self.spectrum_log_var).grid(row=3, column=0, columnspan=2, sticky="w")

    def _build_stats_tab(self, tab: ttk.Frame) -> None:
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(0, weight=1)
        columns = ("file", "n", "mean", "std", "sem", "dx", "fs", "nyquist", "df", "status")
        self.stats_tree = ttk.Treeview(tab, columns=columns, show="headings", height=8)
        labels = {
            "file": "Dataset", "n": "N", "mean": "Mean", "std": "Std", "sem": "SEM",
            "dx": "Δx", "fs": "Sampling freq.", "nyquist": "Nyquist", "df": "Δf", "status": "Status",
        }
        for name in columns:
            self.stats_tree.heading(name, text=labels[name])
            self.stats_tree.column(name, width=110 if name != "file" else 220, anchor="center")
        self.stats_tree.grid(row=0, column=0, sticky="nsew")
        vertical = ttk.Scrollbar(tab, orient="vertical", command=self.stats_tree.yview)
        horizontal = ttk.Scrollbar(tab, orient="horizontal", command=self.stats_tree.xview)
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal.grid(row=1, column=0, sticky="ew")
        self.stats_tree.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)

    def _build_export_tab(self, tab: ttk.Frame) -> None:
        tab.columnconfigure(0, weight=1)
        settings = ttk.LabelFrame(tab, text="Figure", padding=8)
        settings.grid(row=0, column=0, sticky="ew")
        settings.columnconfigure(1, weight=1)
        self._combo(settings, 0, "Target", self.export_target_var, ["combined", "time plot", "spectrum plot"])
        ttk.Label(settings, text="DPI").grid(row=1, column=0, sticky="w")
        ttk.Spinbox(settings, textvariable=self.dpi_var, from_=72, to=1200).grid(row=1, column=1, sticky="ew", padx=(6, 0))
        actions = ttk.Frame(tab)
        actions.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        for column in range(3):
            actions.columnconfigure(column, weight=1)
        ttk.Button(actions, text="Export figure…", command=self.export_figure).grid(row=0, column=0, sticky="ew")
        ttk.Button(actions, text="Export data + settings…", command=self.export_data).grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Button(actions, text="Export statistics…", command=self.export_statistics).grid(row=0, column=2, sticky="ew")

    # ---------- State and event wiring ----------

    def _bind_events(self) -> None:
        self.search_var.trace_add("write", lambda *_: self.filter_files())
        self.file_list.bind("<<ListboxSelect>>", self._selection_changed)
        self.root.bind("<Control-o>", lambda _e: self.browse_folder())
        self.root.bind("<Control-s>", lambda _e: self.export_figure())
        self.root.bind("<Control-e>", lambda _e: self.export_data())
        self.root.bind("<Escape>", lambda _e: self.set_interaction_mode("pointer"))
        self.root.bind("<F5>", lambda _e: self.refresh_folder())

        for variable in (self.x_var, self.y_var, self.xerr_var, self.yerr_var):
            variable.trace_add("write", lambda *_: self.schedule_full_plot(reset_views=True))
        for variable in (
            self.title_var, self.xlabel_var, self.ylabel_var, self.legend_var, self.grid_var,
            self.errors_var, self.markers_var, self.lines_var, self.yscale_var,
        ):
            variable.trace_add("write", lambda *_: self.schedule_full_plot(reset_views=False))
        for variable in (
            self.detrend_var, self.moving_points_var, self.resample_var, self.window_var,
            self.quantity_var, self.normalization_var, self.padding_mode_var,
            self.padding_points_var, self.two_sided_var, self.spectrum_log_var,
        ):
            variable.trace_add("write", lambda *_: self.schedule_spectrum_update())

        self.canvas.mpl_connect("scroll_event", self._wheel_zoom)
        self.canvas.mpl_connect("motion_notify_event", self._motion)
        self.canvas.mpl_connect("button_press_event", self._button_press)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def _restore_layout(self) -> None:
        try:
            height = max(self.main_panes.winfo_height(), 1)
            fraction = min(max(self._saved_plot_fraction, 0.45), 0.88)
            position = min(max(round(height * fraction), 350), max(height - 180, 350))
            self.main_panes.sashpos(0, position)
            self.notebook.select(min(max(self._saved_tab, 0), len(self.notebook.tabs()) - 1))
        except (tk.TclError, IndexError):
            pass

    def _load_preferences(self) -> dict[str, object]:
        try:
            return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _preference_variables(self) -> dict[str, tk.Variable]:
        return {
            "range_mode": self.range_mode_var, "detrend": self.detrend_var,
            "moving_points": self.moving_points_var, "resample": self.resample_var,
            "window": self.window_var, "quantity": self.quantity_var,
            "normalization": self.normalization_var, "padding_mode": self.padding_mode_var,
            "padding_points": self.padding_points_var, "two_sided": self.two_sided_var,
            "legend": self.legend_var, "grid": self.grid_var, "errors": self.errors_var,
            "markers": self.markers_var, "lines": self.lines_var,
            "time_yscale": self.yscale_var, "spectrum_log": self.spectrum_log_var,
            "dpi": self.dpi_var, "export_target": self.export_target_var,
        }

    def _save_preferences(self) -> None:
        try:
            settings = {"last_folder": str(self.folder)}
            settings.update({name: variable.get() for name, variable in self._preference_variables().items()})
            pane_height = max(self.main_panes.winfo_height(), 1)
            settings["layout_version"] = LAYOUT_VERSION
            settings["plot_fraction"] = self.main_panes.sashpos(0) / pane_height
            settings["selected_tab"] = self.notebook.index(self.notebook.select())
            SETTINGS_PATH.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        except (OSError, tk.TclError):
            pass

    # ---------- Dataset management ----------

    def browse_folder(self) -> None:
        path = filedialog.askdirectory(initialdir=self.folder)
        if path:
            self.load_folder(Path(path))

    def refresh_folder(self) -> None:
        self.load_folder(Path(self.folder_var.get()).expanduser())

    def select_all(self) -> None:
        self.file_list.selection_set(0, tk.END)
        self.update_columns()
        self.schedule_full_plot(reset_views=True)

    def clear_selection(self) -> None:
        self.file_list.selection_clear(0, tk.END)
        self.schedule_full_plot(reset_views=True)

    def load_folder(self, folder: Path) -> None:
        try:
            files, skipped = discover_scan_files(folder)
        except Exception as exc:
            messagebox.showerror("Invalid folder", str(exc))
            return
        self.folder = folder.resolve()
        self.folder_var.set(str(self.folder))
        self.files = files
        self.frames.clear()
        for path in files:
            try:
                self.frames[path] = read_scan(path)
            except Exception as exc:
                skipped[path] = str(exc)
        self.files = [path for path in files if path in self.frames]
        self.filter_files()
        if self.visible_files:
            self.file_list.selection_set(0)
            self.update_columns()
            if self.range_mode_var.get() != "full":
                self._restore_range_fields()
                self._sync_range_widgets()
            self.plot(reset_views=True)
        self.status_var.set(f"Loaded {len(self.files)} scans" + (f"; skipped {len(skipped)}" if skipped else ""))

    def filter_files(self) -> None:
        selected = set(self.selected_paths())
        term = self.search_var.get().casefold().strip()
        self.visible_files = [path for path in self.files if term in path.name.casefold()]
        self.file_list.delete(0, tk.END)
        for index, path in enumerate(self.visible_files):
            self.file_list.insert(tk.END, path.name)
            if path in selected:
                self.file_list.selection_set(index)

    def selected_paths(self) -> list[Path]:
        return [self.visible_files[i] for i in self.file_list.curselection() if i < len(self.visible_files)]

    def _selection_changed(self, _event: object = None) -> None:
        self.update_columns()
        self.schedule_full_plot(reset_views=True)

    def update_columns(self) -> None:
        columns = common_numeric_columns([self.frames[path] for path in self.selected_paths()])
        for box in (self.x_box, self.y_box):
            box["values"] = columns
        for box in (self.xerr_box, self.yerr_box):
            box["values"] = ["None", *columns]
        self.loading = True
        if self.x_var.get() not in columns:
            self.x_var.set(first_match(X_CANDIDATES, columns))
        if self.y_var.get() not in columns:
            self.y_var.set(first_match(Y_CANDIDATES, columns))
        if self.xerr_var.get() not in ["None", *columns]:
            self.xerr_var.set("None")
        if self.yerr_var.get() not in ["None", *columns]:
            self.yerr_var.set(first_match(ERROR_CANDIDATES, columns, "None"))
        if not self.xlabel_var.get():
            self.xlabel_var.set(self.x_var.get())
        if not self.ylabel_var.get():
            self.ylabel_var.set(self.y_var.get())
        self.loading = False

    # ---------- Range and tool modes ----------

    def common_x_overlap(self) -> tuple[float, float] | None:
        paths = self.selected_paths()
        column = self.x_var.get()
        if not paths or not column:
            return None
        extents: list[tuple[float, float]] = []
        for path in paths:
            values = pd.to_numeric(self.frames[path][column], errors="coerce").to_numpy(dtype=float)
            values = values[np.isfinite(values)]
            if not values.size:
                return None
            extents.append((float(np.min(values)), float(np.max(values))))
        low = max(extent[0] for extent in extents)
        high = min(extent[1] for extent in extents)
        return (low, high) if low < high else None

    def range_mode_changed(self) -> None:
        mode = self.range_mode_var.get()
        self.range_error_var.set("")
        if mode == "full":
            self.loading = True
            self.range_min_var.set("")
            self.range_max_var.set("")
            self.loading = False
            if self.interaction_mode_var.get() == "select":
                self.set_interaction_mode("pointer")
            self._sync_range_widgets()
            self.schedule_spectrum_update()
        elif mode == "drag":
            self._restore_range_fields()
            self._sync_range_widgets()
            self.set_interaction_mode("select")
            self.schedule_spectrum_update()
        else:
            self._restore_range_fields()
            if self.interaction_mode_var.get() == "select":
                self.set_interaction_mode("pointer")
            self._sync_range_widgets()

    def _restore_range_fields(self) -> None:
        if self.last_valid_range is None:
            overlap = self.common_x_overlap()
            if overlap is not None:
                self.last_valid_range = overlap
        if self.last_valid_range is not None:
            self.loading = True
            self.range_min_var.set(f"{self.last_valid_range[0]:.9g}")
            self.range_max_var.set(f"{self.last_valid_range[1]:.9g}")
            self.loading = False

    def _sync_range_widgets(self) -> None:
        mode = self.range_mode_var.get()
        state = "normal" if mode == "manual" else ("readonly" if mode == "drag" else "disabled")
        self.range_min_entry.configure(state=state)
        self.range_max_entry.configure(state=state)
        self.range_apply_button.configure(state="normal" if mode == "manual" else "disabled")
        self._sync_selector()

    def apply_manual_range(self) -> None:
        try:
            bounds = validate_range_bounds(
                self.range_min_var.get(), self.range_max_var.get(), self.common_x_overlap()
            )
        except ValueError as exc:
            self.range_error_var.set(str(exc))
            self.status_var.set(str(exc))
            return
        self.last_valid_range = bounds
        self.range_error_var.set("")
        self._sync_selector()
        self.schedule_spectrum_update(delay=0)

    def _span_selected(self, xmin: float, xmax: float) -> None:
        if self.range_mode_var.get() != "drag" or self.interaction_mode_var.get() != "select":
            return
        minimum, maximum = min(xmin, xmax), max(xmin, xmax)
        try:
            bounds = validate_range_bounds(
                f"{minimum:.17g}", f"{maximum:.17g}", self.common_x_overlap()
            )
        except ValueError as exc:
            self.range_error_var.set(str(exc))
            self.status_var.set(str(exc))
            if self.last_valid_range and self.selector:
                self.selector.extents = self.last_valid_range
            self.canvas.draw_idle()
            return
        self.last_valid_range = bounds
        self.loading = True
        self.range_min_var.set(f"{bounds[0]:.9g}")
        self.range_max_var.set(f"{bounds[1]:.9g}")
        self.loading = False
        self.range_error_var.set("")
        self.schedule_spectrum_update(delay=150)

    def set_interaction_mode(self, mode: str) -> None:
        if mode == "select" and self.range_mode_var.get() != "drag":
            self.range_mode_var.set("drag")
            self._restore_range_fields()
            self._sync_range_widgets()
        self._disable_toolbar_mode()
        self.interaction_mode_var.set(mode)
        if mode == "pan":
            self.toolbar.pan()
        elif mode == "zoom":
            self.toolbar.zoom()
        self._sync_selector()
        self._set_status(f"Interaction mode: {self._mode_label()}")

    def _disable_toolbar_mode(self) -> None:
        mode = str(self.toolbar.mode).casefold()
        if "pan" in mode:
            self.toolbar.pan()
        elif "zoom" in mode:
            self.toolbar.zoom()

    def _mode_label(self) -> str:
        return {
            "pointer": "Pointer", "select": "Select FFT Range",
            "pan": "Pan", "zoom": "Box Zoom",
        }.get(self.interaction_mode_var.get(), self.interaction_mode_var.get())

    def _recreate_selector(self) -> None:
        if self.selector is not None:
            self.selector.disconnect_events()
        self.selector = SpanSelector(
            self.time_ax, self._span_selected, "horizontal", useblit=True,
            props={"facecolor": "tab:orange", "alpha": 0.18},
            interactive=True, drag_from_anywhere=True, minspan=0,
        )
        self._sync_selector()

    def _sync_selector(self) -> None:
        if self.selector is None:
            return
        visible = self.range_mode_var.get() in ("drag", "manual") and self.last_valid_range is not None
        active = self.range_mode_var.get() == "drag" and self.interaction_mode_var.get() == "select"
        self.selector.set_active(active)
        self.selector.set_visible(visible)
        if self.last_valid_range is not None:
            self.selector.extents = self.last_valid_range
        self.canvas.draw_idle()

    # ---------- Plotting ----------

    def configs(self) -> tuple[PreprocessConfig, SpectrumConfig]:
        bounds = self.last_valid_range if self.range_mode_var.get() != "full" else None
        return (
            PreprocessConfig(
                bounds[0] if bounds else None,
                bounds[1] if bounds else None,
                self.detrend_var.get(),
                self.moving_points_var.get(),
                self.resample_var.get(),
            ),
            SpectrumConfig(
                self.window_var.get(), self.quantity_var.get(), self.normalization_var.get(),
                self.padding_mode_var.get(), self.padding_points_var.get(), self.two_sided_var.get(),
            ),
        )

    def schedule_full_plot(self, delay: int = 250, reset_views: bool = False) -> None:
        if self.loading:
            return
        if self.update_job:
            self.root.after_cancel(self.update_job)
        self.update_job = self.root.after(delay, lambda: self.plot(reset_views=reset_views))

    def schedule_spectrum_update(self, delay: int = 250) -> None:
        if self.loading:
            return
        if self.update_job:
            self.root.after_cancel(self.update_job)
        self.update_job = self.root.after(delay, self.update_spectrum)

    def plot(self, reset_views: bool = False) -> None:
        self.update_job = None
        paths = self.selected_paths()
        if not paths or not self.x_var.get() or not self.y_var.get():
            return
        old_time = None if reset_views or not self.time_ax.has_data() else (self.time_ax.get_xlim(), self.time_ax.get_ylim())
        old_spectrum = None if reset_views or not self.spectrum_ax.has_data() else (self.spectrum_ax.get_xlim(), self.spectrum_ax.get_ylim())

        self.time_ax.clear()
        self.colors.clear()
        marker = "o" if self.markers_var.get() else None
        linestyle = "-" if self.lines_var.get() else "None"
        xcol, ycol = self.x_var.get(), self.y_var.get()
        all_stats: list[np.ndarray] = []
        base_rows: dict[Path, dict[str, object]] = {}

        for path in paths:
            frame = self.frames[path]
            color = self.time_ax._get_lines.get_next_color()
            self.colors[path] = color
            xerr = frame[self.xerr_var.get()] if self.xerr_var.get() != "None" else None
            yerr = frame[self.yerr_var.get()] if self.yerr_var.get() != "None" else None
            x_values = pd.to_numeric(frame[xcol], errors="coerce")
            y_values = pd.to_numeric(frame[ycol], errors="coerce")
            mask = np.isfinite(x_values) & np.isfinite(y_values)
            xp = x_values[mask].to_numpy()
            yp = y_values[mask].to_numpy()
            if self.errors_var.get() and (xerr is not None or yerr is not None):
                xe = pd.to_numeric(xerr[mask], errors="coerce").to_numpy() if xerr is not None else None
                ye = pd.to_numeric(yerr[mask], errors="coerce").to_numpy() if yerr is not None else None
                self.time_ax.errorbar(
                    xp, yp, xerr=xe, yerr=ye, marker=marker, linestyle=linestyle,
                    markersize=3, linewidth=1, capsize=2, color=color, label=path.stem,
                )
            else:
                self.time_ax.plot(
                    xp, yp, marker=marker, linestyle=linestyle, markersize=3,
                    linewidth=1, color=color, label=path.stem,
                )
            base_rows[path] = {"file": path.name, **trace_statistics(frame[ycol], yerr)}
            all_stats.append(y_values.dropna().to_numpy())

        self.time_ax.set_title(self.title_var.get().strip() or "Selected scans")
        self.time_ax.set_xlabel(self.xlabel_var.get().strip() or xcol)
        self.time_ax.set_ylabel(self.ylabel_var.get().strip() or ycol)
        self.time_ax.set_yscale(self.yscale_var.get())
        self.time_ax.grid(self.grid_var.get(), alpha=0.3)
        if self.legend_var.get() and self.time_ax.get_legend_handles_labels()[0]:
            legend = self.time_ax.legend(fontsize="small")
            if legend:
                legend.set_draggable(True)
        if old_time is not None:
            self.time_ax.set_xlim(old_time[0])
            self.time_ax.set_ylim(old_time[1])
        else:
            self.time_ax.relim()
            self.time_ax.autoscale_view()

        self._recreate_selector()
        self._calculate_and_draw_spectra(base_rows, all_stats, preserve_limits=old_spectrum)
        self.toolbar.update()
        self.canvas.draw_idle()

    def update_spectrum(self) -> None:
        self.update_job = None
        if not self.selected_paths() or not self.time_ax.has_data():
            return
        old_limits = (self.spectrum_ax.get_xlim(), self.spectrum_ax.get_ylim()) if self.spectrum_ax.has_data() else None
        base_rows: dict[Path, dict[str, object]] = {}
        all_stats: list[np.ndarray] = []
        ycol = self.y_var.get()
        for path in self.selected_paths():
            frame = self.frames[path]
            yerr = frame[self.yerr_var.get()] if self.yerr_var.get() != "None" else None
            base_rows[path] = {"file": path.name, **trace_statistics(frame[ycol], yerr)}
            all_stats.append(pd.to_numeric(frame[ycol], errors="coerce").dropna().to_numpy())
        self._calculate_and_draw_spectra(base_rows, all_stats, preserve_limits=old_limits)
        self.canvas.draw_idle()

    def _calculate_and_draw_spectra(
        self,
        base_rows: dict[Path, dict[str, object]],
        all_stats: list[np.ndarray],
        preserve_limits: tuple[tuple[float, float], tuple[float, float]] | None,
    ) -> None:
        try:
            preprocess, spectrum_config = self.configs()
        except Exception as exc:
            self.status_var.set(str(exc))
            return
        self.spectrum_ax.clear()
        self.results.clear()
        rows: list[dict[str, object]] = []
        errors: list[str] = []
        xcol, ycol = self.x_var.get(), self.y_var.get()

        for path in self.selected_paths():
            frame = self.frames[path]
            xerr = frame[self.xerr_var.get()] if self.xerr_var.get() != "None" else None
            yerr = frame[self.yerr_var.get()] if self.yerr_var.get() != "None" else None
            row = base_rows[path]
            try:
                trace = prepare_trace(frame[xcol], frame[ycol], preprocess, xerr, yerr)
                result = compute_spectrum(trace, spectrum_config)
                self.results[path] = result
                self.spectrum_ax.plot(
                    result.frequency, result.value, linewidth=1.2,
                    color=self.colors.get(path), label=path.stem,
                )
                status = f"{'interpolated' if trace.interpolated else 'uniform'}; variation {trace.relative_spacing_variation:.2g}"
                rows.append({
                    **row, "dx": result.dx, "fs": result.sampling_frequency,
                    "nyquist": result.nyquist, "df": result.frequency_spacing, "status": status,
                })
            except Exception as exc:
                errors.append(f"{path.name}: {exc}")
                rows.append({
                    **row, "dx": np.nan, "fs": np.nan, "nyquist": np.nan,
                    "df": np.nan, "status": str(exc),
                })

        if all_stats:
            overall = trace_statistics(np.concatenate(all_stats))
            rows.append({
                "file": "OVERALL", **overall, "dx": np.nan, "fs": np.nan,
                "nyquist": np.nan, "df": np.nan, "status": f"{len(base_rows)} datasets",
            })
        self.spectrum_ax.set_title("Fourier spectrum")
        unit = "THz" if xcol.casefold().endswith("_ps") or "ps" in xcol.casefold() else f"1 / {xcol}"
        self.spectrum_ax.set_xlabel(f"Frequency ({unit})")
        self.spectrum_ax.set_ylabel(f"{spectrum_config.quantity} [{spectrum_config.normalization}]")
        self.spectrum_ax.set_yscale("log" if self.spectrum_log_var.get() else "linear")
        self.spectrum_ax.grid(self.grid_var.get(), alpha=0.3)
        if self.legend_var.get() and self.spectrum_ax.get_legend_handles_labels()[0]:
            legend = self.spectrum_ax.legend(fontsize="small")
            if legend:
                legend.set_draggable(True)
        if preserve_limits is not None:
            self.spectrum_ax.set_xlim(preserve_limits[0])
            self.spectrum_ax.set_ylim(preserve_limits[1])
        else:
            self.spectrum_ax.relim()
            self.spectrum_ax.autoscale_view()

        self.stats = pd.DataFrame(rows)
        self._display_stats(rows)
        suffix = f". {errors[0]}" if errors else ""
        self._set_status(f"Plotted {len(base_rows)} dataset(s); {len(self.results)} spectra{suffix}")

    # ---------- Navigation ----------

    def _wheel_zoom(self, event: object) -> None:
        axes = getattr(event, "inaxes", None)
        if axes not in (self.time_ax, self.spectrum_ax):
            return
        button = getattr(event, "button", None)
        factor = 0.8 if button == "up" else 1.25
        try:
            inverse = axes.transData.inverted()
            xlim, ylim = axes.get_xlim(), axes.get_ylim()
            display = axes.transData.transform(
                np.array([[xlim[0], ylim[0]], [xlim[1], ylim[1]]], dtype=float)
            )
            pivot = np.array([float(event.x), float(event.y)])
            zoomed = pivot + (display - pivot) * factor
            data = inverse.transform(zoomed)
            axes.set_xlim(data[0, 0], data[1, 0])
            axes.set_ylim(data[0, 1], data[1, 1])
            self.toolbar.push_current()
            self.canvas.draw_idle()
        except (ValueError, OverflowError, FloatingPointError):
            return

    def _motion(self, event: object) -> None:
        if getattr(event, "inaxes", None) in (self.time_ax, self.spectrum_ax):
            xdata, ydata = getattr(event, "xdata", None), getattr(event, "ydata", None)
            if xdata is not None and ydata is not None:
                name = "Time" if event.inaxes is self.time_ax else "Spectrum"
                self._last_cursor_text = f"{name}: x={xdata:.6g}, y={ydata:.6g}"
                self._set_status(self._last_cursor_text)

    def _button_press(self, event: object) -> None:
        if getattr(event, "dblclick", False) and getattr(event, "inaxes", None) in (self.time_ax, self.spectrum_ax):
            self.home_axis(event.inaxes)

    def home_axis(self, axes: object) -> None:
        axes.relim()
        axes.autoscale_view()
        self.toolbar.push_current()
        self.canvas.draw_idle()

    def home_views(self) -> None:
        for axes in (self.time_ax, self.spectrum_ax):
            axes.relim()
            axes.autoscale_view()
        for variable in (self.xlim_min_var, self.xlim_max_var, self.ylim_min_var, self.ylim_max_var):
            variable.set("")
        self.toolbar.push_current()
        self.canvas.draw_idle()

    def apply_view_limits(self) -> None:
        try:
            xmin = None if not self.xlim_min_var.get().strip() else float(self.xlim_min_var.get())
            xmax = None if not self.xlim_max_var.get().strip() else float(self.xlim_max_var.get())
            ymin = None if not self.ylim_min_var.get().strip() else float(self.ylim_min_var.get())
            ymax = None if not self.ylim_max_var.get().strip() else float(self.ylim_max_var.get())
            current_x, current_y = self.time_ax.get_xlim(), self.time_ax.get_ylim()
            self.time_ax.set_xlim(xmin if xmin is not None else current_x[0], xmax if xmax is not None else current_x[1])
            self.time_ax.set_ylim(ymin if ymin is not None else current_y[0], ymax if ymax is not None else current_y[1])
            self.toolbar.push_current()
            self.canvas.draw_idle()
        except ValueError:
            self.status_var.set("Visible-axis limits must be valid numbers.")

    def _set_status(self, message: str) -> None:
        self.status_var.set(f"{self._mode_label()}  |  {message}")

    # ---------- Statistics and export ----------

    def _display_stats(self, rows: list[dict[str, object]]) -> None:
        self.stats_tree.delete(*self.stats_tree.get_children())
        for row in rows:
            values = [
                row["file"], row["n"], self._fmt(row["mean_y"]), self._fmt(row["std_y"]),
                self._fmt(row["sem_y"]), self._fmt(row["dx"]), self._fmt(row["fs"]),
                self._fmt(row["nyquist"]), self._fmt(row["df"]), row["status"],
            ]
            self.stats_tree.insert("", tk.END, values=values)

    @staticmethod
    def _fmt(value: object) -> str:
        try:
            number = float(value)
            return f"{number:.5g}" if math.isfinite(number) else ""
        except (TypeError, ValueError):
            return ""

    def export_figure(self) -> None:
        path = filedialog.asksaveasfilename(
            initialdir=self.folder, defaultextension=".png",
            filetypes=[("PNG", "*.png"), ("PDF", "*.pdf"), ("SVG", "*.svg")],
        )
        if path:
            try:
                target = self.export_target_var.get()
                if target == "combined":
                    bbox = "tight"
                else:
                    self.canvas.draw()
                    renderer = self.figure.canvas.get_renderer()
                    axes = self.time_ax if target == "time plot" else self.spectrum_ax
                    bbox = axes.get_tightbbox(renderer).transformed(self.figure.dpi_scale_trans.inverted())
                self.figure.savefig(path, dpi=self.dpi_var.get(), bbox_inches=bbox)
                self.status_var.set(f"Saved figure: {path}")
            except Exception as exc:
                messagebox.showerror("Export error", str(exc))

    def export_data(self) -> None:
        if not self.results:
            messagebox.showinfo("No results", "Plot at least one valid spectrum first.")
            return
        path = filedialog.asksaveasfilename(
            initialdir=self.folder, initialfile="analysis_export.csv",
            defaultextension=".csv", filetypes=[("CSV", "*.csv")],
        )
        if not path:
            return
        rows: list[pd.DataFrame] = []
        for source, result in self.results.items():
            time_data: dict[str, object] = {
                "dataset": source.name, "domain": "time", "x": result.trace.x,
                "value": result.trace.y, "raw_value": result.trace.y_raw,
            }
            if result.trace.x_error is not None:
                time_data["x_error"] = result.trace.x_error
            if result.trace.y_error is not None:
                time_data["y_error"] = result.trace.y_error
            rows.append(pd.DataFrame(time_data))
            rows.append(pd.DataFrame({
                "dataset": source.name, "domain": "spectrum", "x": result.frequency,
                "value": result.value, "fft_real": result.fft_complex.real,
                "fft_imag": result.fft_complex.imag,
            }))
        destination = Path(path)
        pd.concat(rows, ignore_index=True).to_csv(destination, index=False)
        preprocess, spectrum = self.configs()
        metadata = {
            "selected_files": [str(path) for path in self.selected_paths()],
            "columns": {
                "x": self.x_var.get(), "y": self.y_var.get(),
                "x_error": self.xerr_var.get(), "y_error": self.yerr_var.get(),
            },
            "range_mode": self.range_mode_var.get(),
            **configs_as_dict(preprocess, spectrum),
            "spectra": {
                source.name: {
                    "n_input": result.n_input, "n_fft": result.n_fft, "dx": result.dx,
                    "sampling_frequency": result.sampling_frequency,
                    "nyquist": result.nyquist, "frequency_spacing": result.frequency_spacing,
                }
                for source, result in self.results.items()
            },
        }
        destination.with_suffix(".json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        self.status_var.set(f"Saved data and settings beside {destination.name}")

    def export_statistics(self) -> None:
        if self.stats.empty:
            messagebox.showinfo("No statistics", "Plot data first.")
            return
        path = filedialog.asksaveasfilename(
            initialdir=self.folder, initialfile="scan_statistics.csv",
            defaultextension=".csv", filetypes=[("CSV", "*.csv")],
        )
        if path:
            self.stats.to_csv(path, index=False)

    def close(self) -> None:
        self._save_preferences()
        if self.selector is not None:
            self.selector.disconnect_events()
        plt.close(self.figure)
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    ScanFourierAnalyzer(root)
    root.mainloop()


if __name__ == "__main__":
    main()
