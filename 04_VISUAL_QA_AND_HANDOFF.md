# 04 — Kiểm thử giao diện, sửa lỗi, bàn giao

1. Khởi chạy app bằng script phù hợp. Dùng Playwright MCP/Browser nếu khả dụng; nếu không, dùng Playwright CLI/browser đã có trong project. Chụp hoặc xem trang ở desktop rộng (khoảng 1440×900), tablet và mobile. Không tuyên bố đã kiểm tra browser nếu chưa thực sự mở app.
2. So với `reference/character-discovery.png`: bố cục rails, kích thước/crop cards, độ tương phản, mật độ, typography, spacing. Sửa các sai lệch nhìn thấy được; ưu tiên toàn trang thay vì polish một nút.
3. Tương tác thử: nav, search/filter, rail scroll/buttons, character card/detail, bắt đầu chat, gửi tin nhắn demo, modal/menu nếu có. Test keyboard focus/tab/enter/escape và reduced-motion.
4. Xem console/runtime errors, broken images, overflow ngang, layout shift. Sửa lỗi thực tế; không chỉ tắt log.
5. Chạy scripts phù hợp: typecheck, lint, build và tests sẵn có. Không thêm bộ test lớn chỉ để kiểm tra hình thức. Ghi lệnh và kết quả thật trong `PROMPT_PROGRESS.md`.
6. Bàn giao ngắn gọn: file/page chính đã tạo, cách chạy, chức năng demo, checks đã chạy, giới hạn còn lại. Không publish/deploy, không thêm secrets/API keys, không commit trừ khi người dùng yêu cầu.
