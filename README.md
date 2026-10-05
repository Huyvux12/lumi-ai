# PersonaX

Ứng dụng nhập vai nhân vật với Next.js 16 / React 19 và backend Python FastAPI. Backend lưu tài khoản, nhân vật, hội thoại, đơn thanh toán và usage vào database; frontend gọi cùng origin qua `/api/v1`.

## Những phần đã triển khai

- Đăng ký/đăng nhập với Argon2, session cookie HttpOnly, xác minh email, đặt lại mật khẩu, MFA TOTP và thu hồi phiên.
- Nhân vật riêng tư/công khai chờ duyệt; catalog seed giữ URL cũ của 26 nhân vật và 7 bối cảnh. Giao diện lấy hồ sơ và số hội thoại từ API.
- Lịch sử hội thoại theo tài khoản, phân trang, cuộc trò chuyện mới, tạo lại phản hồi, hủy và idempotency. API SSE phát các sự kiện có cấu trúc sau khi LLM trả JSON hợp lệ.
- Free và Premium **250.000 VND / một tháng từ khi kích hoạt**, giữ billing anchor cho gia hạn ngày cuối tháng. Gia hạn sớm nối kỳ kế tiếp và không reset quota kỳ hiện tại.
- Hiển thị QR VietQR trong PersonaX; tự kiểm tra trạng thái đơn mỗi 3 giây. SePay bank webhook xác thực HMAC, chống cấp quyền trùng, kiểm tra tài khoản/số tiền/mã đơn; đối soát qua **SePay API v2**.
- Quota được reserve → commit/release ở backend và chỉ trả số liệu cho admin. Trang gói mô tả giới hạn bằng lời; không có số đã dùng/còn lại/reset trong public API.
- Groq STT: ghi âm hoặc tải tệp → giải mã WAV mono 16 kHz có giới hạn → nhận transcript tiếng Việt → người dùng sửa và tự gửi. Không tự gửi lời nói vào chat.
- Gemini 3.8 TTS: LLM chọn emotion, pace, delivery và vocal tags; backend kiểm tra allowlist. Chỉ các segment `dialogue` được đọc. `narration` không đi vào TTS. Stream PCM 16-bit LE, 24 kHz, mono; cache riêng theo người dùng và tin nhắn trong 24 giờ. Preset Kore/Puck; không có voice clone/design.
- Admin: tổng quan, người dùng, quota, khóa tài khoản/quyền, đơn/giao dịch/đối soát, phiên bản gói, prompt draft/publish/rollback/test API, preset giọng, duyệt/sửa catalog, bối cảnh, báo cáo và audit. Moderator chỉ quản lý catalog/báo cáo; owner cấp quyền và thay đổi gói.

## Chạy local

Cần Node 24+, Python 3.12+ và `ffmpeg` trong PATH. SQLite chỉ dùng phát triển; production dùng PostgreSQL và Redis.

Terminal 1:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
cp .env.example .env
python -m alembic upgrade head
python -m app.cli seed
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Terminal 2, từ gốc repo:

```bash
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1
```

Mở `http://localhost:3000`. Giữ `PUBLIC_APP_URL` khớp chính xác origin bạn mở (bao gồm hostname và port); nếu dùng `127.0.0.1`, sửa thành `http://127.0.0.1:3000`.

Muốn thử chat văn bản trước khi thêm key, đặt `DEMO_LLM=true` **chỉ local**. UI hiện nhãn demo. Cờ này không giả lập STT, TTS hoặc thanh toán. Thiếu cấu hình dịch vụ trả lỗi dễ hiểu, không phát sinh lời nói hoặc thanh toán giả trong app chính.

Tạo owner từ terminal backend:

```bash
python -m app.cli bootstrap-owner --email ban@example.com --username owner
```

Mật khẩu được nhập ẩn qua terminal. Không có mật khẩu admin mặc định và không tự nâng quyền tài khoản đã tồn tại. Đăng nhập rồi bật MFA trong Bảo mật tài khoản. Dev email ghi vào `.data/outbox/*.eml`; mở bằng ứng dụng email để giải mã nội dung. Production gửi SMTP, không công khai token/outbox qua API.

## Cấu hình dịch vụ

Tất cả key nằm trong `backend/.env` hoặc secret của máy chủ. Không dùng biến `NEXT_PUBLIC_*` cho credential.

| Dịch vụ | Biến cần đặt | Ghi chú |
| --- | --- | --- |
| Groq chat/STT | `GROQ_API_KEY` | `GROQ_LLM_MODEL=qwen/qwen3.8-27b`, STT `whisper-large-v3-turbo` |
| Gemini TTS bằng API key | `GOOGLE_API_KEY`, `GEMINI_TTS_AUTH_MODE=api_key` | Mặc định `gemini-3.8-flash-tts`, endpoint Vertex projectless theo tài liệu handoff |
| Gemini TTS bằng ADC | `GEMINI_TTS_AUTH_MODE=adc`, `GOOGLE_CLOUD_PROJECT` | Cấp Application Default Credentials cho service account có quyền gọi model |
| SePay | `SEPAY_ENV`, `SEPAY_WEBHOOK_SECRET`, `SEPAY_BANK_CODE`, `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_HOLDER` | `test` và `live` dùng database/order/event riêng theo môi trường; QR test có nhãn không chuyển tiền thật |
| Đối soát | `SEPAY_API_TOKEN` | API v2 sandbox khi `test`, production khi `live`; không dùng hosted gateway/IPN |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | SMTP STARTTLS; dùng hostname/from thuộc dịch vụ email của bạn |
| Production | `APP_ENV=production`, `AUTO_MIGRATE=false`, `PUBLIC_APP_URL=https://...`, `DATABASE_URL`, `REDIS_URL`, `MFA_ENCRYPTION_KEY` | PostgreSQL, Redis, HTTPS, MFA; không chấp nhận demo LLM |

Nếu giá trị env có khoảng trắng, đặt trong dấu nháy, ví dụ `SEPAY_ACCOUNT_HOLDER="TEN CHU TAI KHOAN"`.

### SePay QR và webhook

1. Cấu hình tài khoản nhận và tiền tố nội dung `LUMI` trong SePay. Mã chuyển khoản là `LUMI` + 16 ký tự hex; giữ nguyên trong QR.
2. Cấu hình webhook biến động số dư ở URL HTTPS công khai: `https://ten-mien-cua-ban/api/v1/payments/sepay/webhook`.
3. Chọn HMAC. Header: `X-SePay-Signature: sha256=<hex>` và `X-SePay-Timestamp: <Unix seconds>`. Chuỗi ký là `timestamp + "." + raw body`. Backend kiểm tra cửa sổ 5 phút trước khi parse JSON.
4. Backend chỉ kích hoạt khi tiền vào, đúng tài khoản, đúng số tiền snapshot và đúng mã đơn. Không cộng dồn nhiều giao dịch nhỏ. Tiền đến sau khi QR hết thời gian chờ vẫn có thể được xác nhận một lần nếu hợp lệ.
5. ACK `{"success": true}` sau commit bền vững. Event trùng không cấp thêm kỳ Premium. Giao dịch sai hoặc lần chuyển thứ hai được ghi để review.
6. `referenceCode` dùng chung để tránh ghi trùng giữa webhook ID số và lookup v2 ID UUID. Không thay transaction ID bằng order ID.
7. Chạy worker hoặc dùng nút Đối soát của admin:

```bash
python -m app.worker --once
python -m app.worker
```

Worker kiểm tra tối đa 100 đơn pending/review trong 7 ngày gần nhất mỗi lượt, có giới hạn tần suất gọi API. Đơn cũ hơn dùng thao tác đối soát từng đơn trong admin. Nên theo dõi backlog khi tải tăng. Đây là chuyển khoản chủ động, không tự động trừ tiền hàng tháng.

Nút **Ghi nhận hoàn tiền** chỉ ghi nhận khoản đã hoàn bên ngoài và thu hồi kỳ tương ứng; không chuyển tiền từ tài khoản ngân hàng. Khi thu hồi một kỳ gia hạn, các kỳ trả phí sau vẫn giữ lịch đã mua.

### Giọng nói và prompt

Dạng trả lời của LLM:

```json
{
  "schema_version": 1,
  "segments": [
    {"type": "narration", "text": "Cô quay lại, mỉm cười."},
    {"type": "dialogue", "text": "<giggle> Cậu đến rồi!", "emotion": "cheerful", "pace": "normal", "delivery": "normal"}
  ]
}
```

UI bỏ tag khỏi chữ hiển thị. TTS giữ tag trong lời thoại và thêm `speechMetadata.style` đã ánh xạ ở backend. Đầu ra sai schema/tag bị từ chối và không tự chuyển cả phần kể chuyện sang giọng đọc. Tối đa 2 tag/đoạn, 4 tag/lượt; admin bật/tắt từ catalog 40 tag.

TTS nhận **message ID thuộc tài khoản đang đăng nhập**, không nhận arbitrary text từ trình duyệt. Nghe lại cache không trừ thêm usage. Đổi giọng, dừng, reset hội thoại hoặc rời trang hủy audio và bỏ chunk cũ. Trần thời lượng audio được bảo vệ bởi reservation; audio vượt reservation sẽ bị ngắt để không vượt hạn mức.

Tokenizer Qwen được đóng gói từ [nguồn chính thức](https://huggingface.co/Qwen/Qwen3.8-27B/blob/72a217a/tokenizer.json), SHA256 `0997f410c57a1f4e53b09e4be8f4a172d90edd9564368fb0847030937229b9f3`. Backend đếm prompt/profile/scene/history bằng tokenizer này, chừa margin framing rồi bỏ cặp lịch sử cũ khi cần. Token trên hóa đơn lấy từ `usage` Groq trả về; framing phía provider có thể khác. Khi đổi sang dòng model khác, cần thay tokenizer/budget adapter tương ứng.

## Database và triển khai

Schema và migrations ở `backend/migrations`; seed idempotent ở `backend/app/seed.py`. Timestamp lưu dưới dạng Unix milliseconds UTC (để SQLite và PostgreSQL dùng cùng DTO); tính kỳ/ngày theo `Asia/Ho_Chi_Minh`. PostgreSQL khóa dòng user để serialize reserve/thanh toán/gia hạn, kèm unique constraints; SQLite dev serialize transaction bằng `BEGIN IMMEDIATE`.

Docker Compose cung cấp PostgreSQL 17, Redis 8, backend, frontend:

```bash
cp backend/.env.example .env.backend
# Điền cấu hình backend. Đặt POSTGRES_PASSWORD qua môi trường hoặc file .env ở gốc.
docker compose up --build -d
docker compose exec backend python -m app.cli bootstrap-owner --email ban@example.com --username owner
```

Có thể chạy worker cùng container backend bằng process manager hoặc thêm service worker riêng dùng cùng image/env/volume. PostgreSQL/Redis không công khai port trong Compose. Frontend và backend chỉ bind localhost. Production đặt reverse proxy HTTPS trước frontend, khai báo origin HTTPS, SMTP và khóa MFA riêng; chạy migration trước khi mở traffic. Dùng 1 backend worker cho bản đầu; row locks vẫn bảo vệ database nếu chạy nhiều process, nhưng hủy upstream tức thời chỉ đảm bảo trong process xử lý job. Audio/cache cần volume dùng chung nếu tăng số instance.

Reverse proxy phải giữ cookie, raw webhook body và SSE/audio streaming; tắt buffering cho `/api/v1/conversations/*/turns` và `/api/v1/speech/jobs/*/stream`. Đồng hồ máy chủ cần đồng bộ để HMAC timestamp hoạt động. Chỉ trust forwarded headers từ proxy của bạn; không mở backend trực tiếp ra Internet. Backup database và volume, giữ `MFA_ENCRYPTION_KEY` qua các lần triển khai.

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm run build
cd backend
python -m pytest -q
python -m alembic check
```

36 kiểm tra API chạy qua với database SQLite riêng từng test, HTTP transport mô phỏng provider và WAV được ffmpeg giải mã thật. Bao gồm isolation giữa người dùng, session/CSRF, reset/MFA, quota đồng thời, QR/HMAC/webhook trùng/sai, calendar month/renewal, snapshot gói, RBAC, prompt version/audit, STT, TTS dialogue-only/PCM/cache/cancel và lỗi provider. Migrations nâng cấp và `alembic check` đã qua. Frontend typecheck/lint/build đã qua. Kiểm tra HTTP thực tế qua Next rewrites cũng đã xác nhận cookie, chat SSE, PCM, QR/webhook, Premium, RBAC và logout bằng local mock harness (`scripts/check_bridge.py`).

Chưa thực hiện giao dịch tiền thật hay gọi Groq/Gemini bằng credential của dự án. Chưa chạy production PostgreSQL/Redis/Docker và chưa kiểm tra giao diện bằng browser trong môi trường làm việc này (localhost bị chặn). Trước launch, chạy các ca tích hợp với chính account SePay/Groq/Google, kiểm tra upload/ghi âm/audio trên thiết bị mục tiêu và đối chiếu chi phí thực tế. Model TTS/khả năng tài khoản phải khớp handoff của bạn.

Dữ liệu demo cũ trong localStorage không tự chuyển sang database; frontend không dùng nó làm quyền đăng nhập hoặc lịch sử. Draft tạo nhân vật được lưu riêng theo user ID trên trình duyệt. Bộ import dữ liệu cũ, streaming JSON incremental từ LLM, latency telemetry chi tiết, WAV fallback cho trình duyệt không có Web Audio và quy trình xóa tài khoản/retention sẽ cần bước tiếp theo nếu bạn muốn đưa toàn bộ checklist dài trong `plan.md` lên production.

## Tài liệu tích hợp

- [Groq Speech to Text](https://console.groq.com/docs/speech-to-text)
- [Groq Qwen 3.8](https://console.groq.com/docs/model/qwen/qwen3.8-27b)
- [SePay QR](https://developer.sepay.vn/vi/sepay-webhooks/tao-qr-va-form-thanh-toan)
- [SePay HMAC](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc)
- [SePay API v2 transactions](https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach)
- [SePay API v2 environments](https://developer.sepay.vn/en/sepay-api/v2/gioi-thieu)
- TTS bám tài liệu `gemini-3.8-tts-agent-handoff(1).md` được cung cấp trong phiên làm việc; không coi voice clone/design là tính năng được hỗ trợ.
