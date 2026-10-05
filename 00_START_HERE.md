# Character-style web app — prompt pack

## Cách dùng
1. Giải nén cả thư mục vào workspace dự án web bạn muốn Claude Code chỉnh sửa. Nếu chưa có project, giải nén vào thư mục trống và mở thư mục đó trong VS Code.
2. Đính kèm/đặt ảnh `reference/character-discovery.png` trong workspace để Claude có thể đọc. Nếu ảnh vẫn nằm ngoài workspace, bảo Claude đọc file đính kèm hiện có.
3. Trong Claude Code, gửi nguyên câu: **“Đọc `00_START_HERE.md` và làm đúng thứ tự các prompt trong folder này. Bắt đầu từ `01_INSTALL_AND_CHECKPOINT.md`. Tự cài các skill/tool trong danh sách phù hợp. Khi xong phần cài đặt, tạo checkpoint và dừng để tôi restart VS Code.”**
4. Claude sẽ cài cấu hình và dừng ở checkpoint. Restart VS Code (đóng/mở lại), mở lại cùng workspace và Claude Code, sau đó gửi: **“Đọc `02_RESUME_AFTER_RESTART.md` và tiếp tục từ checkpoint.”**
5. Claude tiếp tục design/build/QA đến hết `04_VISUAL_QA_AND_HANDOFF.md`.

## Quy tắc dự án
- Sản phẩm cần build được mô tả cụ thể ở `PRODUCT_BRIEF.md`; đọc file này trước mọi prompt khác. Đây là web app khám phá nhân vật AI và trò chuyện nhập vai, không phải landing page quảng bá.
- Làm trong workspace hiện tại; trước khi sửa hãy kiểm tra repo, package manager, framework và thay đổi chưa commit. Không ghi đè hay xóa công việc sẵn có.
- Ảnh tham chiếu thể hiện home/discovery: nền than đậm, các rail ngang, card nhân vật bo góc, carousel “Cảnh”, các rail “Nổi bật” và “Phổ biến”. Hãy tái tạo cấu trúc và cảm giác, không chép logo, tên nhân vật hay ảnh có bản quyền từ screenshot.
- Nếu workspace đã có stack, giữ stack đó. Nếu trống, dùng Next.js + React + TypeScript + Tailwind CSS. Chỉ thêm dependency cần cho tính năng thực sự được dùng.
- Không dừng ở bản thiết kế hay mockup tĩnh: làm UI chạy được, responsive, có tương tác thật và dữ liệu demo nhất quán.
- Tôn trọng reduced-motion, keyboard navigation, contrast, responsive, loading/empty/error states.
- Dùng placeholder/asset có quyền sử dụng rõ ràng; không tải ảnh nhân vật/anime có bản quyền từ web. Ưu tiên assets đã có trong repo hoặc ảnh placeholder/loremflickr/Unsplash source sau khi kiểm tra ổn định và giấy phép; nếu không, tạo gradient/illustration SVG đơn giản.
- Trước khi thêm bất kỳ skill/MCP/dependency nào, xác minh hướng dẫn và lệnh cài đặt mới nhất từ repo/website chính chủ bên `RESOURCES.txt`. Không chạy script lạ, không lộ token/API key, không sửa global config nếu cài project-scoped dùng được.
- Skills là hướng dẫn cho coding agent; component libraries/runtime packages là dependency của project; MCP là kết nối công cụ. Không nhầm ba loại này và không cài trùng chức năng.
- ThreeUI (`MengTo/threeui`) là resource người dùng yêu cầu. Đọc README, license, cách dùng và dependency trước; chỉ tích hợp component phù hợp. Không giả định mọi asset/pro component đều miễn phí.

## Trình tự bắt buộc
`01_INSTALL_AND_CHECKPOINT.md` → restart VS Code bởi người dùng → `02_RESUME_AFTER_RESTART.md` → `03_DESIGN_AND_BUILD.md` → `04_VISUAL_QA_AND_HANDOFF.md`.

`PRODUCT_BRIEF.md` là brief sản phẩm; `RESOURCES.txt` là danh mục URL repo/docs dạng plain text để tra cứu và chọn công cụ. Không cần cài mọi mục.
