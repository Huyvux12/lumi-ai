import { test, expect, type Page } from "@playwright/test";

const headers = { "X-Lumi-Request": "1" };
async function login(page: Page, role = "owner") {
  await page.goto("/login?next=/admin");
  await page.locator("input[type=email]").fill(`${role}@example.com`);
  await page.locator("input[type=password]").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3001/admin");
}
function audio() {
  const data = Buffer.alloc(44 + 32000);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(32000, 40);
  return data;
}

test("admin creates and probes a compatible LLM, tests Nova-3 and persists independent source choices", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Nhà cung cấp AI", exact: true })
    .click();
  await expect(page.getByTestId("provider-panel")).toBeVisible();
  await page
    .getByRole("button", { name: "Thêm OpenAI-compatible", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Tên hiển thị", { exact: true })
    .fill("Browser OpenAI");
  await dialog
    .getByLabel("Base URL", { exact: false })
    .fill("https://api.openai.com/v1");
  await dialog.getByLabel("Model", { exact: true }).fill("gpt-4o-mini");
  await dialog
    .getByRole("combobox", { name: "Tên khóa API", exact: true })
    .selectOption("compat");
  await dialog
    .getByLabel("Lý do lưu cấu hình", { exact: true })
    .fill("Test compatible source in browser");
  await dialog
    .getByRole("button", { name: "Lưu cấu hình LLM", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Browser OpenAI", exact: true }),
  ).toBeVisible();
  const data = await (await page.request.get("/api/v1/admin/providers")).json();
  const profile = data.llm_profiles.find(
    (item: { name: string }) => item.name === "Browser OpenAI",
  );
  try {
    await page
      .getByRole("combobox", { name: "Nguồn LLM để thử", exact: true })
      .selectOption(profile.id);
    await page
      .getByRole("button", { name: "Thử phản hồi", exact: true })
      .click();
    await expect(page.getByText(/Đã nhận phản hồi hợp lệ/)).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "LLM đang dùng", exact: true }),
    ).toHaveValue("groq");
    await page
      .getByRole("combobox", { name: "Nguồn STT để thử", exact: true })
      .selectOption("deepgram");
    await page.getByLabel("Tệp audio", { exact: true }).setInputFiles({
      name: "probe.wav",
      mimeType: "audio/wav",
      buffer: audio(),
    });
    await page
      .getByRole("button", { name: "Thử nhận dạng", exact: true })
      .click();
    await expect(
      page.getByText("Xin chào từ Nova-3.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "STT đang dùng", exact: true }),
    ).toHaveValue("groq");
    await page
      .getByRole("combobox", { name: "LLM đang dùng", exact: true })
      .selectOption(profile.id);
    await page
      .getByRole("combobox", { name: "STT đang dùng", exact: true })
      .selectOption("deepgram");
    await page
      .getByLabel("Lý do đổi nguồn", { exact: true })
      .fill("Activate tested LLM and Vietnamese STT");
    await page
      .getByRole("button", { name: "Lưu nguồn AI", exact: true })
      .click();
    await expect(page.getByText("Đã lưu cấu hình AI.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "LLM đang dùng", exact: true }),
    ).toHaveValue(profile.id);
    await expect(
      page.getByRole("combobox", { name: "STT đang dùng", exact: true }),
    ).toHaveValue("deepgram");
    await page.screenshot({
      path: test.info().outputPath("providers-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
    await expect(
      page.getByText("LLM · Browser OpenAI", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("STT · Deepgram Nova-3", { exact: true }),
    ).toBeVisible();
  } finally {
    const current = await (
      await page.request.get("/api/v1/admin/providers")
    ).json();
    await page.request.patch("/api/v1/admin/providers", {
      headers,
      data: {
        version: current.selection.version,
        llm_id: "groq",
        stt_id: "groq",
        reason: "Restore browser test defaults",
      },
    });
    const reset = await (
      await page.request.get("/api/v1/admin/providers")
    ).json();
    await page.request.delete(`/api/v1/admin/providers/llm/${profile.id}`, {
      headers,
      data: {
        version: reset.selection.version,
        reason: "Remove browser test profile",
      },
    });
  }
});

test("mobile provider form rejects stale changes and reloads the current selection", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin?tab=providers");
  await expect(page.getByTestId("provider-panel")).toBeVisible();
  const current = await (
    await page.request.get("/api/v1/admin/providers")
  ).json();
  expect(
    (
      await page.request.patch("/api/v1/admin/providers", {
        headers,
        data: {
          ...current.selection,
          updated_at: undefined,
          reason: "Concurrent administrator update",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page
    .getByRole("combobox", { name: "STT đang dùng", exact: true })
    .selectOption("deepgram");
  await page
    .getByLabel("Lý do đổi nguồn", { exact: true })
    .fill("Try stale selection");
  await page.getByRole("button", { name: "Lưu nguồn AI", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Cấu hình AI vừa thay đổi" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "STT đang dùng", exact: true }),
  ).toHaveValue("groq");
  await page.screenshot({
    path: test.info().outputPath("providers-mobile.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test("moderator cannot access provider settings", async ({ page }) => {
  await login(page, "moderator");
  await page.goto("/admin?tab=providers");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhà cung cấp AI", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v1/admin/providers")).status()).toBe(
    403,
  );
});
