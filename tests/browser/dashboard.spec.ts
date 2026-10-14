import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, role = "owner") {
  const result = await page.request.post("/api/v1/auth/login", {
    headers: { "X-Lumi-Request": "1" },
    data: { email: `${role}@example.com`, password: "BrowserTest123!" },
  });
  expect(result.ok()).toBeTruthy();
}

function fixture(days: number) {
  const end = new Date("2026-10-14T12:00:00+07:00");
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - days + index + 1);
    return {
      date: date.toISOString().slice(0, 10),
      revenue_vnd: ((index % 4) + 1) * 250000,
      chat_turns: index * 3 + 8,
      stt_requests: (index % 5) + 1,
      tts_requests: (index % 9) + 3,
    };
  });
  return {
    scope: "admin",
    generated_at: end.getTime(),
    period: {
      days,
      start: dates[0].date,
      end: dates.at(-1)!.date,
      timezone: "Asia/Ho_Chi_Minh",
    },
    metrics: {
      revenue_vnd: dates.reduce((sum, day) => sum + day.revenue_vnd, 0),
      new_users: days * 8,
      active_users: days * 5,
      total_users: 1280,
      premium_users: 86,
    },
    previous: {
      revenue_vnd: Math.round(
        dates.reduce((sum, day) => sum + day.revenue_vnd, 0) * 0.8,
      ),
      new_users: days * 7,
      active_users: days * 4,
    },
    series: dates,
    queue: { characters_pending: 3, reports_open: 2, payments_review: 1 },
    usage: {
      chat_turns: dates.reduce((sum, day) => sum + day.chat_turns, 0),
      stt_requests: dates.reduce((sum, day) => sum + day.stt_requests, 0),
      tts_requests: dates.reduce((sum, day) => sum + day.tts_requests, 0),
      stt_ms: 1200000,
      tts_ms: 2400000,
      released_requests: 3,
      input_tokens: 160000,
      output_tokens: 42000,
      llm_estimated_usd: 0.296,
    },
    services: {
      groq: true,
      tts: true,
      sepay: false,
      sepay_environment: "test",
      demo_llm: false,
    },
    activity: [
      "character.moderate",
      "voice.update",
      "order.reconcile",
      "catalog.update",
      "report.close",
    ].map((action, i) => ({
      id: `test-audit-${i}`,
      action,
      target: ["kaito-kid", "gemini-kore", "LUMI-TEST", "conan", "report-test"][
        i
      ],
      actor: "review_owner",
      created_at: end.getTime() - i * 600000,
    })),
  };
}

test("overview filters and navigation survive reload and browser back", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/v1/admin/dashboard?**", (route) =>
    route.fulfill({
      json: fixture(
        Number(new URL(route.request().url()).searchParams.get("days")),
      ),
    }),
  );
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Doanh thu theo ngày" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "7 ngày", exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByTestId("metric-Người dùng mới")).toHaveText("56");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "7 ngày", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Người dùng & quota", exact: true })
    .click();
  await expect(page).toHaveURL(/tab=users/);
  await expect(
    page.getByRole("columnheader", { name: "Tài khoản" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("metric-Người dùng mới")).toHaveText("56");
  await page.getByRole("button", { name: "90 ngày", exact: true }).click();
  await expect(page.getByTestId("metric-Người dùng mới")).toHaveText("720");
  await page.getByRole("button", { name: /^Nhân vật chờ duyệt/ }).click();
  await expect(page).toHaveURL(/tab=characters/);
  await expect(
    page.getByRole("button", { name: "Nhân vật", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("charts expose daily values to keyboard users and mobile menu stays usable", async ({
  page,
}) => {
  await login(page);
  await page.route("**/api/v1/admin/dashboard?**", (route) =>
    route.fulfill({ json: fixture(7) }),
  );
  await page.goto("/admin?days=7");
  const chart = page.getByRole("group", {
    name: "Doanh thu theo ngày",
    exact: true,
  });
  const first = chart.getByRole("button").first();
  await first.focus();
  await expect(first).toBeFocused();
  await first.press("ArrowRight");
  await expect(chart.getByRole("button").nth(1)).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("dashboard-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Mở menu quản trị" }).click();
  const menu = page.getByRole("dialog", { name: "Menu quản trị" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Nhật ký", exact: true }).click();
  await expect(menu).not.toBeVisible();
  await expect(page).toHaveURL(/tab=audit/);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});

test("moderator overview has queues without business data or forbidden navigation", async ({
  page,
}) => {
  await login(page, "moderator");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/admin/")) requests.push(request.url());
  });
  await page.goto("/admin?tab=orders");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cần xử lý" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Thanh toán", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Doanh thu", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Chi phí LLM ước tính", { exact: true }),
  ).toHaveCount(0);
  expect(requests.some((url) => url.includes("/moderation-dashboard"))).toBe(
    true,
  );
  expect(requests.some((url) => url.includes("/dashboard?"))).toBe(false);
});

test("empty data and a failed refresh show honest states and can recover", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await expect(page.getByText("Chưa có doanh thu trong kỳ này")).toBeVisible();
  await page.route("**/api/v1/admin/dashboard?**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "TEST_UNAVAILABLE",
        message: "Không thể tải số liệu thử nghiệm",
      },
    }),
  );
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Không thể tải số liệu thử nghiệm" }),
  ).toBeVisible();
  await expect(page.getByTestId("admin-dashboard")).toHaveCount(0);
  await page.unroute("**/api/v1/admin/dashboard?**");
  await page.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
});
