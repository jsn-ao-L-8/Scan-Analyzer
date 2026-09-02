import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEY = "scan-fourier-analyzer:preferences:v1";

async function importSyntheticCsv(page: Page) {
  const chooser = page.locator('input[accept=".csv,text/csv"]');
  const rows = ["delay_ps,x_mean,error"];
  for (let index = 0; index < 128; index += 1) {
    const x = index * 0.01;
    rows.push(`${x},${Math.sin(2 * Math.PI * 7 * x)},0.02`);
  }
  await chooser.setInputFiles({
    name: "synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(rows.join("\n"))
  });
}

test("imports and analyzes a synthetic CSV locally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Scan & Fourier Analyzer" })).toBeVisible();
  await importSyntheticCsv(page);
  await expect(page.getByText("synthetic.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("1 valid spectra")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Statistics" }).click();
  await expect(page.getByRole("cell", { name: "synthetic.csv" })).toBeVisible();
});

test("returns from select-on-plot FFT range to full range", async ({ page }) => {
  await page.goto("/");
  await importSyntheticCsv(page);
  await expect(page.getByText("1 valid spectra")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Fourier" }).click();
  await page.getByRole("button", { name: "Select on plot" }).click();
  await expect(page.locator('.modebar-btn[data-title="Box Select"]').first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const preprocess = JSON.parse(localStorage.getItem(key) ?? "null")?.preprocess;
        return [preprocess?.xMin, preprocess?.xMax];
      }, STORAGE_KEY)
    )
    .toEqual([0, 1.27]);

  await page.getByRole("button", { name: "full", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const preprocess = JSON.parse(localStorage.getItem(key) ?? "null")?.preprocess;
        return [preprocess?.xMin, preprocess?.xMax];
      }, STORAGE_KEY)
    )
    .toEqual([null, null]);
  await expect(page.getByLabel("Minimum", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Minimum", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Maximum", { exact: true })).toHaveValue("");
  await expect(page.getByText("1 valid spectra")).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset errors" })).toHaveCount(0);

  await page.getByRole("button", { name: "Select on plot" }).click();
  await expect(page.locator('.modebar-btn[data-title="Box Select"]').first()).toBeVisible();
});

test("returns from a manual FFT range to full range", async ({ page }) => {
  await page.goto("/");
  await importSyntheticCsv(page);
  await expect(page.getByText("1 valid spectra")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Fourier" }).click();
  await page.getByRole("button", { name: "manual", exact: true }).click();
  await page.getByLabel("Minimum", { exact: true }).fill("0.2");
  await page.getByLabel("Maximum", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Apply FFT range" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const preprocess = JSON.parse(localStorage.getItem(key) ?? "null")?.preprocess;
        return [preprocess?.xMin, preprocess?.xMax];
      }, STORAGE_KEY)
    )
    .toEqual([0.2, 1]);

  await page.getByRole("button", { name: "full", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const preprocess = JSON.parse(localStorage.getItem(key) ?? "null")?.preprocess;
        return [preprocess?.xMin, preprocess?.xMax];
      }, STORAGE_KEY)
    )
    .toEqual([null, null]);
  await page.waitForTimeout(300);
  await expect(page.getByText("1 valid spectra")).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset errors" })).toHaveCount(0);
});
