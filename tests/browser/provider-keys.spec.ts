import { test, expect, type Page } from "@playwright/test";

const headers = { "X-Lumi-Request": "1" };
async function login(page: Page, role = "key_owner") {
  await page.goto("/login?next=/admin");
  await page.locator("input[type=email]").fill(`${role}@example.com`);
  await page.locator("input[type=password]").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3001/admin");
  await page.goto("/admin?tab=providers");
}

async function version(page: Page) {
  return (await (await page.request.get("/api/v1/admin/providers")).json())
    .selection.version;
}

test("owner without MFA saves a key, probes a profile, and deletes it without revealing the key", async ({
  page,
}) => {
  await login(page);
  const panel = page.getByTestId("provider-key-panel");
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "Thêm khóa OpenAI-compatible", exact: true })
    .click();
  await panel
    .getByLabel("Tên tham chiếu khóa", { exact: false })
    .fill("browser_api");
  const key = "browser-private-api-secret-2468";
  await panel.getByLabel("API key mới", { exact: true }).fill(key);
  expect(await panel.getByLabel("API key mới").getAttribute("type")).toBe(
    "password",
  );
  await panel.getByRole("button", { name: "Lưu API key", exact: true }).click();
  await expect(
    panel.getByText("Khóa admin · ••••2468", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel("API key mới")).toHaveCount(0);
  await panel.screenshot({
    path: test.info().outputPath("provider-keys-desktop.png"),
  });
  expect(await panel.textContent()).not.toContain(key);
  expect(
    await (await page.request.get("/api/v1/admin/providers/keys")).text(),
  ).not.toContain(key);
  await page.reload();
  await expect(
    panel.getByText("Khóa admin · ••••2468", { exact: true }),
  ).toBeVisible();

  let profileId = "";
  try {
    await page
      .getByRole("button", { name: "Thêm OpenAI-compatible", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Thêm OpenAI-compatible",
      exact: true,
    });
    await dialog
      .getByLabel("Tên hiển thị", { exact: true })
      .fill("Browser saved key");
    await dialog
      .getByLabel("Base URL", { exact: false })
      .fill("https://api.openai.com/v1");
    await dialog.getByLabel("Model", { exact: true }).fill("gpt-4o-mini");
    await dialog
      .getByRole("combobox", { name: "Tên khóa API", exact: true })
      .selectOption("browser_api");
    await dialog
      .getByLabel("Lý do lưu cấu hình", { exact: true })
      .fill("Test encrypted credential from admin");
    await dialog
      .getByRole("button", { name: "Lưu cấu hình LLM", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const data = await (
      await page.request.get("/api/v1/admin/providers")
    ).json();
    profileId = data.llm_profiles.find(
      (item: { name: string }) => item.name === "Browser saved key",
    ).id;
    await page
      .getByRole("combobox", { name: "Nguồn LLM để thử", exact: true })
      .selectOption(profileId);
    await page
      .getByRole("button", { name: "Thử phản hồi", exact: true })
      .click();
    await expect(page.getByText(/Đã nhận phản hồi hợp lệ/)).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "LLM đang dùng", exact: true }),
    ).toHaveValue("groq");
    await panel
      .getByRole("button", {
        name: "Xóa khóa OpenAI-compatible · browser_api",
        exact: true,
      })
      .click();
    const deletion = page.getByRole("dialog", {
      name: "Xóa khóa OpenAI-compatible · browser_api?",
      exact: true,
    });
    await expect(deletion.getByText(/chưa có API key/)).toBeVisible();
    await deletion
      .getByRole("button", { name: "Xác nhận xóa khóa", exact: true })
      .click();
    await expect(deletion).not.toBeVisible();
    const row = panel.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "OpenAI-compatible · browser_api",
        exact: true,
      }),
    });
    await expect(row.getByText("Chưa có khóa", { exact: true })).toBeVisible();
  } finally {
    if (profileId)
      await page.request.delete(`/api/v1/admin/providers/llm/${profileId}`, {
        headers,
        data: {
          version: await version(page),
          reason: "Remove browser credential test profile",
        },
      });
    await page.request.delete("/api/v1/admin/providers/keys/llm:browser_api", {
      headers,
      data: { version: await version(page) },
    });
  }
});

test("mobile owner replaces Deepgram key and explicitly restores server fallback", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByTestId("provider-key-panel");
  await panel
    .getByRole("button", { name: "Nhập khóa Deepgram", exact: true })
    .click();
  await panel
    .getByLabel("API key mới", { exact: true })
    .fill("browser-deepgram-key-7890");
  await panel.getByRole("button", { name: "Lưu API key", exact: true }).click();
  await expect(
    panel.getByText("Khóa admin · ••••7890", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Xóa khóa Deepgram", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Xóa khóa Deepgram?",
    exact: true,
  });
  await expect(
    dialog.getByText(/quay về khóa đã cấu hình trên server/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Xác nhận xóa khóa", exact: true })
    .click();
  const row = panel.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Deepgram", exact: true }),
  });
  await expect(
    row.getByText("Khóa server · Đã cấu hình", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("admin can select providers but cannot see or modify owner credentials", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(page.getByTestId("provider-panel")).toBeVisible();
  await expect(page.getByTestId("provider-key-panel")).toHaveCount(0);
  expect(
    (await page.request.get("/api/v1/admin/providers/keys")).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put("/api/v1/admin/providers/keys/groq", {
        headers,
        data: {
          version: await version(page),
          api_key: "unauthorized-secret-1234",
        },
      })
    ).status(),
  ).toBe(403);
});
