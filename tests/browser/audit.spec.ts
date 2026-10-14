import { test, expect, type Page } from "@playwright/test";

const account = {
  id: "audit-account", email: "audit@example.com", name: "Audit", username: "audit", bio: "", hue: 265,
  interests: [], createdAt: 1, role: "user", email_verified: true, mfa_enabled: false,
  plan: "free", signup_plan: "free", has_plan: true, plan_enabled: true, can_use_features: true,
  plan_message: null, subscription_ends_at: null,
};

async function loginOwner(page: Page) {
  const result = await page.request.post("/api/v1/auth/login", {
    headers: { "X-Lumi-Request": "1" }, data: { email: "owner@example.com", password: "BrowserTest123!" },
  });
  expect(result.ok()).toBeTruthy();
}

async function mockChatAccount(page: Page) {
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: account }));
  await page.route(/\/api\/v1\/conversations(?:\?.*)?$/, (route) => route.fulfill({
    json: route.request().method() === "POST" ? { id: "audit-conversation" } : [],
  }));
}

test("draft preview works before tags and sends earlier turns", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/create");
  await page.getByRole("button", { name: "Thử trò chuyện ngay", exact: true }).click();
  await expect(page.getByLabel("Tin nhắn thử")).toHaveCount(0);
  await page.locator("#f-name").fill("Browser Preview Keeper");
  await page.locator("#f-tagline").fill("The keeper of a harbor library.");
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.locator("#f-description").fill("A thoughtful librarian looking for a missing book near the harbor.");
  await page.locator("#f-persona").fill("Friendly and observant. Speaks in gentle short sentences.");
  await page.getByRole("button", { name: "Tiếp theo" }).click();
  await page.locator("#f-greeting").fill("Come inside before the rain gets worse.");
  const input = page.getByLabel("Tin nhắn thử");
  await expect(input).toBeVisible();
  await input.fill("My name is BrowserAuditName");
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/chat/preview"));
  await input.locator("..").getByRole("button", { name: "Gửi", exact: true }).click();
  expect((await firstResponse).status()).toBe(200);
  await expect(input.locator("..").getByRole("button", { name: "Gửi" })).toBeDisabled();
  await input.fill("What is my name?");
  const secondRequest = page.waitForRequest((request) => request.url().endsWith("/chat/preview"));
  const secondResponse = page.waitForResponse((response) => response.url().endsWith("/chat/preview"));
  await input.locator("..").getByRole("button", { name: "Gửi", exact: true }).click();
  const sent = (await secondRequest).postDataJSON();
  expect(sent.character.tags).toEqual([]);
  expect(sent.history).toContainEqual({ role: "user", content: "My name is BrowserAuditName" });
  expect(sent.text).toBe("What is my name?");
  expect((await secondResponse).status()).toBe(200);
});

test("admin edits scenario, selects a voice preset and saves an empty seed", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Nhân vật", exact: true }).click();
  const card = page.locator("section").filter({ hasText: "Kaito Kid" }).filter({ hasText: "Chính thức" });
  await card.getByRole("button", { name: "Sửa hồ sơ", exact: true }).click();
  await page.getByLabel("scenario", { exact: true }).fill("A calm morning in the audit observatory.");
  await page.getByLabel("seed", { exact: true }).fill("");
  const voices = page.getByLabel("voice_id", { exact: true });
  await expect(voices.locator("option")).toHaveCount(33);
  await voices.selectOption("gemini-kore");
  await page.getByLabel("Lý do (bắt buộc)", { exact: true }).fill("Verify audited catalog fields");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByLabel("scenario", { exact: true })).toHaveCount(0);
  const saved = await (await page.request.get("/api/v1/characters/kaito-kid")).json();
  expect(saved.scenario).toBe("A calm morning in the audit observatory.");
  expect(saved.seed).toBe("");
  expect(saved.voice_id).toBe("gemini-kore");
});

test("report form requires five characters and clears its reason after success", async ({ page }) => {
  await loginOwner(page);
  await page.goto("/character/kaito-kid");
  await page.getByRole("button", { name: "Báo cáo nhân vật", exact: true }).click();
  const reason = page.getByLabel("Lý do", { exact: true });
  await expect(reason).toHaveAttribute("minlength", "5");
  await reason.fill("A valid browser report");
  await page.getByRole("button", { name: "Gửi báo cáo", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã gửi báo cáo." })).toBeVisible();
  await page.getByRole("button", { name: "Báo cáo nhân vật", exact: true }).click();
  await expect(reason).toHaveValue("");
});

test("failed empty replies do not render bubbles after reload", async ({ page }) => {
  await mockChatAccount(page);
  await page.route(/\/api\/v1\/conversations(?:\?.*)?$/, (route) => route.fulfill({ json: [
    { id: "audit-conversation", character_id: "kaito-kid", scene_id: null },
  ] }));
  await page.route("**/api/v1/conversations/audit-conversation/messages", (route) => route.fulfill({ json: [
    { id: "user-message", role: "user", status: "complete", content: "Hello", created_at: 1 },
    { id: "failed-message", role: "assistant", status: "failed", content: "", segments: [], created_at: 2 },
    { id: "recovered-message", role: "assistant", status: "complete", content: "Recovered reply", segments: [], created_at: 3 },
  ] }));
  await page.goto("/chat/kaito-kid");
  await expect(page.getByText("Recovered reply", { exact: true })).toBeVisible();
  await expect(page.locator("div.whitespace-pre-wrap.rounded-tl-sm")).toHaveCount(1);
  await page.reload();
  await expect(page.getByText("Recovered reply", { exact: true })).toBeVisible();
  await expect(page.locator("div.whitespace-pre-wrap.rounded-tl-sm")).toHaveCount(1);
});

test("scene carousel resolves a community portrait from the live catalog", async ({ page }) => {
  await page.context().addCookies([{ name: "rb_guest", value: "1", url: "http://127.0.0.1:3001" }]);
  await page.route("**/api/v1/scenes", (route) => route.fulfill({ json: [
    { id: "audit-scene", title: "Community audit scene", creator: "audit", hue: 265, characterIds: ["community-audit"] },
  ] }));
  await page.route("**/api/v1/characters?**", (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll("ids");
    return ids.includes("community-audit") ? route.fulfill({ json: [
      { id: "community-audit", name: "Audit", hue: 265, image: "/characters/conan.webp" },
    ] }) : route.continue();
  });
  await page.goto("/");
  const scene = page.getByRole("link").filter({ hasText: "Community audit scene" });
  await expect(scene.locator('img[src="/characters/conan.webp"]')).toBeVisible();
});

for (const failure of ["transcription", "chat"]) {
  test(`voice call stops real recording on ${failure} failure`, async ({ page }) => {
    await mockChatAccount(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.1;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await context.resume();
        gain.gain.setValueAtTime(0, context.currentTime + 0.7);
        Object.assign(window, { auditMicrophone: destination.stream });
        return destination.stream;
      } });
    });
    let transcriptions = 0;
    await page.route("**/api/v1/speech/transcriptions", (route) => {
      transcriptions++;
      return failure === "transcription"
        ? route.fulfill({ status: 503, json: { code: "PROVIDER_UNAVAILABLE", message: "Test speech provider unavailable" } })
        : route.fulfill({ json: { text: "Xin chào" } });
    });
    await page.route("**/api/v1/conversations/audit-conversation/turns", (route) => route.fulfill({
      status: 429, json: { code: "QUOTA_REACHED", message: "Test chat quota reached" },
    }));
    await page.goto("/chat/kaito-kid");
    await expect(page.getByRole("button", { name: "Gọi", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Gọi", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: failure === "transcription" ? "Test speech provider unavailable" : "Test chat quota reached" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Gọi", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const stream = (window as typeof window & { auditMicrophone: MediaStream }).auditMicrophone;
      return stream.getTracks().every((track) => track.readyState === "ended");
    })).toBe(true);
    expect(transcriptions).toBe(1);
  });
}
