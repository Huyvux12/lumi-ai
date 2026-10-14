import { test, expect, type Page } from "@playwright/test";

const headers = { "X-Lumi-Request": "1" };
async function register(page: Page, name: string) {
  const response = await page.request.post("/api/v1/auth/register", {
    headers,
    data: {
      email: `${name}@example.com`,
      username: name,
      name: "Feedback User",
      password: "BrowserTest123!",
    },
  });
  expect(response.ok()).toBeTruthy();
}
async function loginOwner(page: Page) {
  await page.goto("/login?next=/admin");
  await page.locator("input[type=email]").fill("owner@example.com");
  await page.locator("input[type=password]").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("user feedback travels through the real admin inbox without leaking internal notes", async ({
  page,
  browser,
}) => {
  await register(page, "feedback_flow");
  await page.goto("/feedback?compose=1");
  await page
    .getByLabel("Tiêu đề", { exact: true })
    .fill("Ảnh minh họa chưa hiển thị");
  await page
    .getByLabel("Nội dung", { exact: true })
    .fill(
      "Mở trang nhân vật trên điện thoại, ảnh không hiển thị dù đã tải lại.",
    );
  await page.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
  await expect(page).toHaveURL(/feedback=/);
  const ident = new URL(page.url()).searchParams.get("feedback")!;
  await expect(
    page.getByRole("heading", { name: "Ảnh minh họa chưa hiển thị" }),
  ).toBeVisible();
  await expect(page.getByText(/FB-[A-F0-9]{12}/)).toBeVisible();

  const ownerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3001",
  });
  try {
    const owner = await ownerContext.newPage();
    await loginOwner(owner);
    await owner
      .getByRole("button", { name: /^Phản hồi mới từ người dùng/ })
      .click();
    await owner
      .getByLabel("Tìm mã hoặc tiêu đề")
      .fill("Ảnh minh họa chưa hiển thị");
    await owner.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await owner
      .getByRole("button", { name: /Ảnh minh họa chưa hiển thị/ })
      .click();
    await expect(owner).toHaveURL(new RegExp(ident));
    await owner.getByLabel("Ghi chú nội bộ", { exact: false }).check();
    await owner
      .getByLabel("Nội dung ghi chú", { exact: true })
      .fill("PRIVATE_NOTE_FOR_ADMINS_ONLY");
    await owner
      .getByRole("button", { name: "Lưu ghi chú", exact: true })
      .click();
    await expect(
      owner.getByText("PRIVATE_NOTE_FOR_ADMINS_ONLY", { exact: true }),
    ).toBeVisible();
    await owner.getByLabel("Trạng thái xử lý").selectOption("reviewing");
    await owner.getByLabel("Mức ưu tiên").selectOption("high");
    await owner
      .getByLabel("Người xử lý")
      .selectOption({ label: "Review Owner (@review_owner)" });
    await owner
      .getByLabel("Lời giải thích công khai", { exact: false })
      .fill("Đã tiếp nhận và đang kiểm tra lỗi hiển thị.");
    await owner.getByRole("button", { name: "Lưu xử lý", exact: true }).click();
    await expect(
      owner.getByText("Đã tiếp nhận và đang kiểm tra lỗi hiển thị.", {
        exact: true,
      }),
    ).toBeVisible();
    await owner.screenshot({
      path: test.info().outputPath("feedback-admin.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Phản hồi của tôi", exact: true })
      .click();
    await expect(
      page.getByText("Có cập nhật mới", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Ảnh minh họa chưa hiển thị/ })
      .click();
    await expect(
      page.getByText("Đã tiếp nhận và đang kiểm tra lỗi hiển thị.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("PRIVATE_NOTE_FOR_ADMINS_ONLY")).toHaveCount(0);
    await page
      .getByLabel("Nội dung trao đổi", { exact: true })
      .fill("Mình dùng Chrome trên Android, vẫn còn lỗi.");
    await page
      .getByRole("button", { name: "Gửi trao đổi", exact: true })
      .click();
    await expect(
      page.getByText("Mình dùng Chrome trên Android, vẫn còn lỗi.", {
        exact: true,
      }),
    ).toBeVisible();

    await owner
      .getByRole("button", { name: "Tải lại phản hồi", exact: true })
      .click();
    await expect(
      owner.getByText("Mình dùng Chrome trên Android, vẫn còn lỗi.", {
        exact: true,
      }),
    ).toBeVisible();
    await owner.getByLabel("Trạng thái xử lý").selectOption("resolved");
    await owner
      .getByLabel("Lời giải thích công khai", { exact: false })
      .fill("Đã sửa lỗi hiển thị ảnh và kiểm thử trên điện thoại.");
    await owner.getByRole("button", { name: "Lưu xử lý", exact: true }).click();
    await expect(
      owner.getByText("Đã sửa lỗi hiển thị ảnh và kiểm thử trên điện thoại.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Tải lại phản hồi", exact: true })
      .click();
    await expect(
      page.getByText("Đã sửa lỗi hiển thị ảnh và kiểm thử trên điện thoại.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Gửi trao đổi", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Phản hồi của tôi", exact: true })
      .click();
    await expect(
      page.getByText("Có cập nhật mới", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await ownerContext.close();
  }
});

test("mobile compose asks for page context consent and preserves drafts after a failed reply", async ({
  page,
}) => {
  await register(page, "feedback_mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/feedback?compose=1&from=" +
      encodeURIComponent("/character/kaito-kid?token=private#secret"),
  );
  const checkbox = page.getByLabel("Đính kèm đường dẫn trang", {
    exact: false,
  });
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText(/Trang liên quan:.*private/)).toHaveCount(0);
  await checkbox.check();
  await page
    .getByRole("combobox", { name: "Loại phản hồi", exact: true })
    .selectOption("feature");
  await page
    .getByLabel("Tiêu đề", { exact: true })
    .fill("Bổ sung chế độ giao diện sáng");
  await page
    .getByLabel("Nội dung", { exact: true })
    .fill("Mình muốn có chế độ sáng để đọc nội dung dễ hơn vào ban ngày.");
  await page.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
  await expect(
    page.getByText("Trang liên quan: /character/kaito-kid", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/v1/feedback/*/messages", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "TEST_UNAVAILABLE", message: "Gửi trao đổi tạm gián đoạn" },
    }),
  );
  await page
    .getByLabel("Nội dung trao đổi", { exact: true })
    .fill("Góp ý thêm: cho phép chọn theo hệ thống.");
  await page.getByRole("button", { name: "Gửi trao đổi", exact: true }).click();
  await expect(page.getByTestId("user-feedback").getByRole("alert")).toHaveText(
    "Gửi trao đổi tạm gián đoạn",
  );
  await expect(
    page.getByLabel("Nội dung trao đổi", { exact: true }),
  ).toHaveValue("Góp ý thêm: cho phép chọn theo hệ thống.");
  await page.unroute("**/api/v1/feedback/*/messages");
  await page.getByRole("button", { name: "Gửi trao đổi", exact: true }).click();
  await expect(
    page.getByText("Góp ý thêm: cho phép chọn theo hệ thống.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("feedback-mobile.png"),
    fullPage: true,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Phản hồi của tôi", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Loại phản hồi", exact: true })
    .selectOption("bug");
  await expect(
    page.getByText("Không có phản hồi phù hợp", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Loại phản hồi", exact: true })
    .selectOption("feature");
  await expect(page).toHaveURL(/kind=feature/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Bổ sung chế độ giao diện sáng/ }),
  ).toBeVisible();
});

test("moderator cannot access the feedback inbox and anonymous users must log in", async ({
  page,
}) => {
  await page.goto("/feedback");
  await expect(
    page.getByRole("link", { name: "Đăng nhập để gửi và theo dõi phản hồi" }),
  ).toBeVisible();
  await page.goto("/login?next=/admin");
  await page.locator("input[type=email]").fill("moderator@example.com");
  await page.locator("input[type=password]").fill("BrowserTest123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3001/admin");
  await page.goto("/admin?tab=feedback");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Phản hồi người dùng", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/v1/admin/feedback")).status()).toBe(403);
});
