import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const profile = {
  name: "Browser Harbor Keeper", tagline: "The keeper of an ancient harbor library.",
  description: "A thoughtful librarian looking for a missing book near the harbor.",
  persona: "Friendly and observant. Speaks in gentle short sentences.",
  scenario: "A storm inside the lighthouse library.", greeting: "*opens the door* Come inside before the rain gets worse.",
  tags: ["Fantasy"], hue: 265, seed: "browser-harbor",
};
const user = {
  id: "mock-account", email: "mock@example.com", name: "Mock", username: "mock", bio: "", hue: 265,
  interests: [], createdAt: 1, role: "user", email_verified: false, mfa_enabled: false,
  plan: "free", signup_plan: "free", has_plan: true, plan_enabled: true, can_use_features: true,
  plan_message: null, subscription_ends_at: null,
};

test("Next forwards responses taking longer than its old 30-second timeout", async ({ request }) => {
  const response = await request.get("/api/v1/test/slow", { timeout: 45_000 });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ completed: true });
});

test("login rejects the backslash redirect reproduction", async ({ page }) => {
  await page.goto("/login?next=" + encodeURIComponent("/\\evil.example"));
  await page.locator("input[type=email]").fill("moderator@example.com");
  await page.locator("input[type=password]").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3001/");
});

test("avatar and scenario persist across create, edit, profile and chat", async ({ page }) => {
  const registered = await page.request.post("/api/v1/auth/register", {
    headers: { "X-Lumi-Request": "1" },
    data: { email: "browser@example.com", username: "browser_user", name: "Browser User", password: "BrowserTest123!", plan: "free" },
  });
  expect(registered.ok()).toBeTruthy();
  await page.goto("/create");
  const voiceSelect = page.getByLabel("Giọng đọc", { exact: false });
  await expect(voiceSelect.locator("option")).toHaveCount(33);
  await voiceSelect.selectOption("gemini-sulafat");
  await expect(page.getByTestId("voice-description")).toContainText("Giọng ấm áp");
  await expect(page.getByTestId("voice-description")).toContainText("A warm voice");
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/avatar.png");
  await expect(page.locator('img[src^="/api/v1/avatars/"]').first()).toBeVisible();
  await page.locator("#f-name").fill(profile.name);
  await page.locator("#f-tagline").fill(profile.tagline);
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.locator("#f-description").fill(profile.description);
  await page.locator("#f-persona").fill(profile.persona);
  await page.locator("#f-scenario").fill(profile.scenario);
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.locator("#f-greeting").fill(profile.greeting);
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.getByRole("button", { name: "Fantasy", exact: true }).click();
  await page.getByRole("button", { name: "Cho nhân vật ra đời" }).click();
  await expect(page).toHaveURL(/\/character\/u-/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.locator('img[src^="/api/v1/avatars/"]').first()).toBeVisible();
  await page.goto(`/create?edit=${id}`);
  await expect(page.getByLabel("Giọng đọc", { exact: false })).toHaveValue("gemini-sulafat");
  await page.getByLabel("Giọng đọc", { exact: false }).selectOption("gemini-achird");
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await expect(page.locator("#f-scenario")).toHaveValue(profile.scenario);
  await page.locator("#f-scenario").fill("A calm morning in a floating observatory.");
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page).toHaveURL(`/character/${id}`);
  const saved = await page.request.get(`/api/v1/characters/${id}`);
  expect((await saved.json()).scenario).toBe("A calm morning in a floating observatory.");
  await page.goto(`/chat/${id}`);
  await expect(page.locator('img[src^="/api/v1/avatars/"]').first()).toBeVisible();
  await expect(page.getByTestId("voice-description")).toContainText("A friendly voice");
  const chatVoice = page.getByLabel("Giọng đọc", { exact: true });
  await expect(chatVoice.locator("option")).toHaveCount(34);
  await chatVoice.selectOption("gemini-zephyr");
  await expect(page.getByTestId("voice-description")).toContainText("Giọng tươi sáng");
  await expect(page.getByTestId("voice-description")).toContainText("A bright voice");
});

test("moderation UI previews a pending public image and scenario", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/register", { headers: { "X-Lumi-Request": "1" }, data: {
    email: "pending@example.com", username: "pending_user", name: "Pending User", password: "BrowserTest123!",
  } })).ok()).toBeTruthy();
  const uploaded = await page.request.post("/api/v1/avatars", { headers: { "X-Lumi-Request": "1" }, multipart: {
    file: { name: "avatar.png", mimeType: "image/png", buffer: await readFile("tests/fixtures/avatar.png") },
  } });
  expect(uploaded.ok()).toBeTruthy();
  const avatar = await uploaded.json();
  const created = await page.request.post("/api/v1/characters", { headers: { "X-Lumi-Request": "1" }, data: { ...profile, avatar_id: avatar.avatar_id, visibility: "public" } });
  expect(created.ok()).toBeTruthy();
  expect((await page.request.post("/api/v1/auth/login", { headers: { "X-Lumi-Request": "1" }, data: { email: "moderator@example.com", password: "BrowserTest123!" } })).ok()).toBeTruthy();
  await page.goto("/admin");
  const card = page.locator("section").filter({ hasText: profile.name }).filter({ hasText: "pending" });
  await card.getByRole("button", { name: "Xem hồ sơ & ảnh" }).click();
  await expect(card.getByText(profile.scenario, { exact: false })).toBeVisible();
  await expect(card.locator('img[src^="/api/v1/admin/avatars/"]')).toBeVisible();
});

test("an expired order still detects a late paid confirmation", async ({ page }) => {
  let paid = false;
  const order = { id: "late-order", invoice: "LUMI001", status: "expired", created_at: Date.now() - 16 * 60_000,
    expires_at: Date.now() - 60_000, paid_at: null, amount_vnd: 250000, list_price_vnd: 250000,
    discount_percent: 0, promo_code: null, qr_url: "/favicon.ico", bank: "TEST", account: "TEST", holder: "TEST", environment: "test" };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/billing/orders/late-order")) paid = true;
    const data = path.endsWith("/me") ? { ...user, plan: paid ? "premium" : null, can_use_features: paid } :
      path.endsWith("/plans") ? [{ code: "premium", price_vnd: 250000, enabled: true, discount_percent: 0, description: "Premium" }] :
      path.endsWith("/billing/history") ? [{ ...order, status: paid ? "paid" : "expired" }] :
      path.endsWith("/billing/orders/late-order") ? { ...order, status: "paid" } :
      path.endsWith("/billing/subscription") ? { plan: paid ? "premium" : null, ends_at: null, paid_until: null } : [];
    await route.fulfill({ json: data });
  });
  await page.goto("/billing");
  await expect(page.getByText("QR hết hạn", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Đã thanh toán", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
});

test("admin can edit bilingual descriptions with an empty native style and retain every voice option", async ({ page }) => {
  expect((await page.request.post("/api/v1/auth/login", {
    headers: { "X-Lumi-Request": "1" }, data: { email: "owner@example.com", password: "BrowserTest123!" },
  })).ok()).toBeTruthy();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Giọng đọc", exact: true }).click();
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: /^Zephyr/ }) });
  await expect(card.getByText("A bright voice", { exact: false })).toBeVisible();
  await card.getByRole("button", { name: "Chỉnh sửa" }).click();
  await expect(page.getByLabel("voice", { exact: true }).locator("option")).toHaveCount(30);
  await page.getByLabel("voice", { exact: true }).selectOption("Sulafat");
  await expect(page.getByLabel("style", { exact: true })).toHaveValue("");
  await page.getByLabel("Mô tả giọng (tiếng Việt)", { exact: true }).fill("Giọng ấm áp tùy chỉnh.");
  await page.getByLabel("Voice description (English)", { exact: true }).fill("A custom warm voice.");
  await page.getByLabel("Lý do (bắt buộc)", { exact: true }).fill("Verify native voice editing");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(card.getByText("A custom warm voice.", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Chỉnh sửa" }).click();
  const select = page.getByLabel("voice", { exact: true });
  await expect(select.locator("option")).toHaveCount(30);
  await expect(select.locator("option").filter({ hasText: /^Zephyr$/ })).toHaveCount(1);
});
