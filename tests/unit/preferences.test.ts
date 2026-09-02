import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  normalizePreprocessRange
} from "../../src/preferences/preferences";

const STORAGE_KEY = "scan-fourier-analyzer:preferences:v1";

describe("FFT range preferences", () => {
  beforeEach(() => localStorage.clear());

  it("preserves a complete valid range", () => {
    const preprocess = normalizePreprocessRange({
      ...DEFAULT_PREFERENCES.preprocess,
      xMin: 1,
      xMax: 4
    });

    expect(preprocess.xMin).toBe(1);
    expect(preprocess.xMax).toBe(4);
  });

  it.each([
    { xMin: 1, xMax: null },
    { xMin: null, xMax: 4 },
    { xMin: 4, xMax: 1 },
    { xMin: Number.NaN, xMax: 4 }
  ])("normalizes an invalid range pair to full range", ({ xMin, xMax }) => {
    const preprocess = normalizePreprocessRange({
      ...DEFAULT_PREFERENCES.preprocess,
      xMin,
      xMax
    });

    expect(preprocess.xMin).toBeNull();
    expect(preprocess.xMax).toBeNull();
  });

  it("repairs a persisted one-sided range", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...DEFAULT_PREFERENCES,
        preprocess: {
          ...DEFAULT_PREFERENCES.preprocess,
          xMin: 1,
          xMax: null
        }
      })
    );

    const preferences = loadPreferences();

    expect(preferences.preprocess.xMin).toBeNull();
    expect(preferences.preprocess.xMax).toBeNull();
  });
});
