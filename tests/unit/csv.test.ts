import { describe, expect, it } from "vitest";
import { parseCsvText, rowsToCsv } from "../../src/io/csv";
import {
  commonNumericColumns,
  firstMatch,
  stableColor,
  X_CANDIDATES
} from "../../src/data/datasets";

describe("CSV import", () => {
  it("preserves ordered numeric columns and missing values", () => {
    const dataset = parseCsvText(
      "\uFEFFdelay_ps,x_mean,note\n0,1,a\n1,NAN,b\n2,3,c\n",
      { name: "scan.csv" }
    );
    expect(dataset.numericColumns).toEqual(["delay_ps", "x_mean"]);
    expect(Number.isNaN(dataset.data.x_mean[1])).toBe(true);
    expect(dataset.rowCount).toBe(3);
  });

  it("reports invalid numeric rows", () => {
    expect(() =>
      parseCsvText("x,y\n0,1\n1,oops\n", { name: "bad.csv" })
    ).toThrow(/Column "y".*row.*3/i);
  });

  it("rejects malformed row widths", () => {
    expect(() =>
      parseCsvText("x,y\n0,1,extra\n", { name: "bad.csv" })
    ).toThrow(/fields/);
  });

  it("escapes exported CSV", () => {
    expect(rowsToCsv(["a", "b"], [["hello, world", '"quoted"']])).toBe(
      'a,b\r\n"hello, world","""quoted"""'
    );
  });
});

describe("dataset helpers", () => {
  it("matches columns case-insensitively", () => {
    expect(firstMatch(X_CANDIDATES, ["Delay_PS", "signal"])).toBe("Delay_PS");
  });

  it("preserves first-dataset common-column order", () => {
    expect(
      commonNumericColumns([
        { numericColumns: ["x", "y"] },
        { numericColumns: ["y", "x", "z"] }
      ])
    ).toEqual(["x", "y"]);
  });

  it("assigns a stable color", () => {
    expect(stableColor("scan.csv:42")).toBe(stableColor("scan.csv:42"));
  });
});
