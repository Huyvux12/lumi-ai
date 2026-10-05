# 01 — Khảo sát workspace, cài skills/MCP, rồi dừng

Bắt đầu bằng việc kiểm tra workspace: `pwd`, file cấu hình, git status/diff, framework, package manager, các skill/MCP hiện có. Nếu có project, bảo toàn cấu trúc và thay đổi đang làm. Nếu thư mục trống, chỉ khởi tạo scaffold cần thiết để Claude Code có workspace dự án; chưa build UI.

## Cài đặt agent skills
- Cài project-scoped những skill phù hợp trong `RESOURCES.txt`: frontend design, UI/UX, React best practices, motion/animation.
- Dùng cách cài chính chủ hiện tại. Nếu repo có hướng dẫn Claude Code/plugin/skills CLI, theo hướng dẫn của repo; không tự đoán lệnh cài cũ.
- Tối thiểu ưu tiên `frontend-design`, `ui-ux-pro-max`, `web-design-guidelines` hoặc tương đương phù hợp. Cài Motion AI Kit nếu installer hiện tại hỗ trợ Claude Code. Đọc nội dung skill đã cài để xác nhận vị trí và cách gọi.

## Cài MCP (project-scoped nếu hỗ trợ)
Cấu hình bộ tối thiểu giúp lấy docs và kiểm thử trình duyệt: Context7, Playwright MCP, shadcn MCP; Motion MCP/AI Kit và 21st.dev/Magic UI MCP nếu hiện còn được hỗ trợ và có ích. Chrome DevTools MCP là tùy chọn bổ sung. Figma MCP chỉ cần nếu có file Figma. Kiểm tra cấu hình tồn tại để không tạo bản sao.

MCP servers có thể yêu cầu restart VS Code/Claude Code. Cài và cấu hình trước, đừng bắt đầu build giao diện trước lần restart.

## Repos/component references
- Đọc `RESOURCES.txt`; không clone hàng loạt. Chỉ clone/read tài liệu hoặc thêm registry component được chọn. ThreeUI bắt buộc phải khảo sát README/license và chọn component thích hợp; không tải cả hệ sinh thái khi không cần.
- Không cài đồng thời nhiều thư viện animation làm cùng một việc. Dự kiến Motion là mặc định cho React UI; GSAP chỉ nếu cần choreography/scroll scene; Rive/Lottie cho assets hoạt họa; Three.js/R3F chỉ nếu có visual 3D cụ thể.

## Checkpoint & stop condition
Khi cài xong:
1. Tạo `PROMPT_PROGRESS.md` ở workspace root với: workspace/project đã phát hiện, skills cài (tên, nguồn, đường dẫn), MCP cấu hình (tên, scope, file cấu hình), repo/docs đã đọc, thao tác thất bại và cách xử lý, lệnh restart/kiểm tra cần làm, những thứ chưa cài và lý do.
2. Xác nhận các file cấu hình không chứa secrets. Không đưa token vào checkpoint.
3. Chưa cài app runtime dependencies trừ những dependency đã tồn tại; chưa viết giao diện.
4. In ra ngắn gọn những gì đã cài, vị trí `PROMPT_PROGRESS.md`, rồi **DỪNG HẲN**. Chờ người dùng restart VS Code và gửi tiếp prompt 02. Không tự chạy các bước sau trong cùng lượt.
