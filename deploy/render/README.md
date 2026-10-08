# PersonaX trên Render Free

[Deploy to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FHuyvux12%2Flumi-ai%2Ftree%2Frender-deploy)

## Tạo bản demo

1. Trong Render chọn **New → Blueprint** (không chọn Web Service riêng lẻ).
2. Kết nối repo `Huyvux12/lumi-ai`, chọn nhánh **render-deploy**, Blueprint path `render.yaml`.
3. Kiểm tra hai tài nguyên đều có plan **Free**, rồi chọn **Deploy Blueprint**.
4. Đợi database và web service deploy xong, mở URL HTTPS của `personax-demo`.
5. Đăng ký tài khoản bất kỳ và thử chat. Không cần nhập API key để chạy giao diện và phản hồi mẫu.

Render đọc `render.yaml` để tạo **một Web Service Docker và một PostgreSQL Free**, cùng region Singapore. Docker chạy Next.js standalone và FastAPI một worker; backend chỉ nghe `127.0.0.1:8000`, frontend nghe `$PORT`. Proxy giữ cùng origin cho cookie và SSE. Migrations, catalog seed và owner bootstrap chạy tự động. Các commit mới trên nhánh này tự deploy.

`PUBLIC_APP_URL` mặc định lấy từ `RENDER_EXTERNAL_URL`, nên không phải đoán tên miền trước lần deploy đầu. Khi dùng domain riêng, đặt `PUBLIC_APP_URL=https://domain-cua-ban` rồi redeploy.

## Admin

- Email: `demo-owner@example.com`.
- Mật khẩu: Render → `personax-demo` → **Environment** → xem giá trị **DEMO_OWNER_PASSWORD** tự sinh. Không có mật khẩu mặc định trong repo hoặc logs.
- Đăng nhập, vào **Hồ sơ → Bảo mật tài khoản**, bật MFA bằng Authenticator rồi mở **Quản trị**.
- Giữ nguyên `MFA_ENCRYPTION_KEY` qua các lần redeploy để giải mã khóa MFA đã lưu.
- Owner được tạo một lần. Restart không đổi mật khẩu, MFA hoặc quyền. Đổi biến `DEMO_OWNER_PASSWORD` sau khi tạo tài khoản không thay mật khẩu đã lưu. `DEMO_OWNER_EMAIL` phải giữ nguyên sau lần bootstrap đầu.

## Kết nối AI thật (tùy chọn)

Thêm secret vào **Environment** của web service rồi **Save, rebuild, and deploy**:

| Biến | Mục đích |
| --- | --- |
| `GROQ_API_KEY` | Chat thật và speech-to-text |
| `GROQ_LLM_MODEL` | Model chat tài khoản Groq hỗ trợ; mặc định theo repo |
| `GROQ_STT_MODEL` | Mặc định `whisper-large-v3-turbo` |
| `GOOGLE_API_KEY` | Gemini TTS, cần tài khoản có quyền dùng model cấu hình |
| `GEMINI_TTS_MODEL` | Model TTS tài khoản Google hỗ trợ; mặc định theo repo |

Khi chưa có `GROQ_API_KEY`, chat trả **phản hồi mẫu cố định**, có nhãn demo trong stream. Khi có key, backend tự gọi Groq. Key sai hoặc model không có quyền sẽ trả lỗi, không âm thầm đổi sang mẫu. STT/TTS không giả lập; thiếu key sẽ báo chưa cấu hình. Chi phí/quota của provider độc lập với Render Free.

## Phạm vi demo và giới hạn

- `APP_ENV=render-demo` là chế độ demo công khai: vẫn dùng cookie Secure/HttpOnly, kiểm tra origin/CSRF, hash mật khẩu, quyền người dùng và MFA cho staff. PostgreSQL và khóa MFA bền vững là bắt buộc.
- Không gửi email, không yêu cầu xác minh email trước chat; địa chỉ email đăng ký **chưa được xác minh**. Quên mật khẩu/xác minh email bị tắt và giao diện thông báo rõ.
- Không nhận thanh toán: tạo QR và webhook SePay bị tắt, `SEPAY_ENV=live` bị từ chối. Trang gói chỉ dùng xem giao diện. Không có worker thanh toán.
- Không cần Redis cho một worker demo. Rate limit nằm trong bộ nhớ và reset khi process khởi động lại; demo không dành cho vận hành production hoặc nhiều instance.
- Render Free ngủ sau 15 phút không có truy cập; lần mở tiếp theo có thể đợi khoảng 1 phút. Không thêm dịch vụ ping giữ máy thức.
- 750 giờ Free mỗi workspace/tháng, cùng hạn mức băng thông/build của workspace. Blueprint chỉ tạo một web service.
- PostgreSQL Free có 1 GB, hết hạn sau **30 ngày**, không có backup tự động. Export dữ liệu trước hạn nếu cần giữ; hết hạn app sẽ không hoạt động cho tới khi database được thay hoặc nâng cấp.
- Dữ liệu tài khoản/nhân vật/hội thoại nằm trong PostgreSQL. Upload tạm, cache audio nằm trên filesystem tạm và mất khi ngủ/restart/redeploy; tạo lại audio nếu cache không còn. Không gắn persistent disk trả phí.
- Container đặt Node heap tối đa 192 MB để chừa RAM cho Python. Đây không phải giới hạn tổng RAM của app; Free tier phù hợp ít người thử đồng thời, cần theo dõi memory trên Render khi dùng giọng nói/AI thật.

## Xác minh và xử lý lỗi

- `/health` đi qua frontend tới backend và kiểm tra database. Render dùng đường dẫn này để xác nhận service sẵn sàng.
- `Database connection failed`: kiểm tra database Free đã hết hạn hay chưa và service cùng region.
- `ORIGIN_REJECTED`: `PUBLIC_APP_URL` phải khớp URL HTTPS bạn đang mở.
- Backend hoặc frontend chết sẽ dừng cả container để Render khởi động lại, tránh frontend sống trong khi API hỏng.
- Đây là cấu hình dành riêng cho nhánh demo; Docker/Compose production cũ vẫn dùng các file gốc.

Tài liệu Render: [Blueprint](https://render.com/docs/blueprint-spec), [Free instances](https://render.com/docs/free), [Default environment variables](https://render.com/docs/environment-variables).
