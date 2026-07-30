import { expect, test } from "@playwright/test";

test("imports and analyzes a synthetic CSV locally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Scan & Fourier Analyzer" })).toBeVisible();
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
  await expect(page.getByText("synthetic.csv", { exact: true })).toBeVisible();
  await expect(page.getByText("1 valid spectra")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Statistics" }).click();
  await expect(page.getByRole("cell", { name: "synthetic.csv" })).toBeVisible();
});
