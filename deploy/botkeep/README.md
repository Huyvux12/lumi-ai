# PersonaX / Lumi-AI — Botkeep Founder Free

Nhánh **Botkeep**, ba workload: **Node.js 24 frontend + Python 3.12 backend + PostgreSQL**.
Không dùng Docker Compose, Redis hoặc worker thanh toán. Đây là demo công khai, không phải cấu hình production nhận tiền.

## Tài nguyên

Founder Free công bố tổng **2 GB RAM, 1,5 vCore, 2 GB disk, 5 slots**. Tổng dùng chung cả tài khoản.
Mức phân bổ ban đầu đề xuất (không phải số đo RAM thực tế):

| Workload | RAM | CPU | Disk |
| --- | --- | --- | --- |
| Frontend Node.js | 512 MB | 0,5 vCore | 512 MB |
| Backend Python | 768 MB | 0,5 vCore | 768 MB |
| PostgreSQL | 512 MB | 0,5 vCore | 512 MB |
| Phần chưa phân bổ | 256 MB | 0 | 256 MB |

Kiểm tra Plans and billing và minimum allocation của từng profile; form hiện tại có thể yêu cầu điều chỉnh.
Hai slot còn lại không có thêm tài nguyên. Workload đã stop vẫn giữ allocation.
Free thường 1 GB/2 slots không đủ cho cách chia ba workload này.

## 1. Lấy ZIP đã build

Mỗi push vào `Botkeep` tự chạy **Actions → Botkeep Founder Free packages**.
Mở run thành công, tải artifact **botkeep-founder-free**, giải nén artifact ngoài trên máy:

- `personax-botkeep-frontend.zip`: frontend standalone đã build, có đúng dependencies cần chạy.
- `personax-botkeep-backend.zip`: source Python, migrations, catalog, tokenizer và dependencies manifest.
- `sizes.json`: dung lượng ZIP và dung lượng giải nén, chưa bao gồm packages Python/database.
- `README.md`: hướng dẫn này.

**Không upload cả artifact ngoài vào một workload.** Chọn ZIP frontend/backend tương ứng.
Workflow chỉ đóng gói và kiểm tra; không tự đăng nhập hay deploy lên tài khoản Botkeep.
Workflow mới trên nhánh chưa merge vào default branch có thể chưa có nút Run workflow; push vào nhánh vẫn chạy tự động.

## 2. Tạo PostgreSQL

Tạo workload PostgreSQL từ managed profile. Mở Database, lấy host/port/user/password/database và cấu hình TLS đúng như panel.
Backend dùng URL `postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE`. Percent-encode ký tự đặc biệt trong user/password.
Không tự thêm `sslmode=require` vào URL asyncpg; nếu panel yêu cầu TLS, dùng cấu hình driver tương ứng, ví dụ `?ssl=require`.
Không giả định PostgreSQL nghe trên localhost, port 5432 hay hỗ trợ hostname Docker `postgres`.
Kiểm tra địa chỉ do panel cấp có thể kết nối từ workload Python.

## 3. Tạo backend Python

Chọn Python **3.12 hoặc bản tương thích**, source ZIP `personax-botkeep-backend.zip`, start command:

```text
python botkeep_start.py
```

Hoặc source GitHub: repo `Huyvux12/lumi-ai`, branch `Botkeep`, project root `backend`, cùng start command.
`requirements.txt` cài project với `constraints-botkeep.txt`, không cài pytest/ruff. Nếu profile chưa tự cài, dùng Console:

```bash
python -m pip install --no-cache-dir -r requirements.txt
```

Tạo HTTPS alias cho backend trong **Domains**, ghi lại URL. Dùng **Network** để lấy port được cấp.
`SERVER_PORT` phải là port đó; startup bind `0.0.0.0` và chỉ chạy một Uvicorn worker.

Nhập Environment theo `backend.env.example`:

| Biến | Giá trị |
| --- | --- |
| `APP_ENV` | `botkeep-demo` |
| `AUTO_MIGRATE` | `false` — startup chạy Alembic trước khi mở port |
| `PUBLIC_APP_URL` | Origin HTTPS của **frontend**, không phải backend; không có path |
| `DATABASE_URL` | URL PostgreSQL của panel |
| `MFA_ENCRYPTION_KEY` | Khóa Fernet riêng, giữ ổn định qua mọi lần deploy |
| `DEMO_OWNER_EMAIL` | Email owner riêng, ví dụ `demo-owner@example.com` |
| `DEMO_OWNER_PASSWORD` | Secret riêng 16–128 ký tự |
| `DATA_DIR` | `.data`, hoặc đường dẫn persistent được panel xác nhận |
| `AUDIO_CACHE_TTL_SECONDS` | `3600` |
| `SEPAY_ENV` | `test` |
| `REDIS_URL` | Để trống |

Tạo khóa/mật khẩu **trên máy của bạn**, sao chép vào Environment; không commit hoặc chia sẻ kết quả:

```bash
python -c "import base64,secrets; print('MFA_ENCRYPTION_KEY='+base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()); print('DEMO_OWNER_PASSWORD='+secrets.token_urlsafe(32))"
```

Sau khi có HTTPS frontend ở bước 4, điền đúng `PUBLIC_APP_URL` rồi start/restart backend.
Mỗi lần start: validate cấu hình → migrate → tạo owner một lần → seed catalog khi API khởi động.
Đổi secret `DEMO_OWNER_PASSWORD` sau bootstrap không đổi mật khẩu đã lưu. Owner username là `botkeep_owner`.

## 4. Tạo frontend Node.js

Chọn Node.js **24**, source ZIP `personax-botkeep-frontend.zip`, start command:

```text
npm start
```

Không chạy `npm ci` hoặc `next build` trên Botkeep. Root package không có dependencies cần tải;
dependencies đã trace nằm trong `runtime/node_modules`, an toàn trước `npm install` ở root.
Giữ nguyên thư mục `runtime/`, kể cả `.next/` và node_modules bên trong.

Environment: `PYTHON_API_URL=https://BACKEND-DOMAIN` và `SERVER_PORT` được Network cấp.
Tạo HTTPS alias trong Domains; dùng chính origin này làm `PUBLIC_APP_URL` của backend.
Start frontend. Launcher đọc `.env` của Botkeep, sửa hai rewrites trong manifest của Next **16.3.8**,
rồi chạy standalone cùng process trên `0.0.0.0:SERVER_PORT`. Thay URL backend chỉ cần restart,
không phải build lại. Dùng HTTPS cho endpoint giữa hai workload; không tắt kiểm tra certificate.

## 5. Kiểm tra demo

1. Mở `https://FRONTEND/health`: phải trả `{"status":"ok"}` sau kiểm tra database.
2. Đăng ký, đăng nhập, chọn nhân vật, tạo hội thoại và gửi tin nhắn.
3. Không có `GROQ_API_KEY`: phản hồi mẫu có nhãn demo. Có key: gọi Groq thật; lỗi provider không đổi sang mẫu.
4. Đăng nhập owner, bật MFA trong Bảo mật tài khoản, mở Quản trị.
5. Restart backend và frontend; tài khoản, MFA, hội thoại phải còn trong PostgreSQL.
6. Kiểm tra Console và RAM/disk thực tế; việc panel chấp nhận deploy không chứng minh app đã sẵn sàng.

Email và thanh toán bị tắt. Không yêu cầu xác minh email để thử chat; email đăng ký chưa được xác minh.
Không nhập SePay live; cấu hình đó bị từ chối. Rate limit ở bộ nhớ, reset khi restart, chỉ phù hợp một worker demo.
Catalog 26 nhân vật/7 bối cảnh tự seed idempotent; không tạo quyền Premium giả hay giao dịch ngân hàng giả.

## Giọng nói và storage

`GROQ_API_KEY` bật chat thật/STT; `GOOGLE_API_KEY` và model TTS tài khoản hỗ trợ bật giọng đọc thật.
STT cần `ffmpeg` trong PATH. Botkeep không đảm bảo quyền apt/root; nếu runtime thiếu binary,
API trả lỗi rõ và nhập văn bản vẫn hoạt động. Không chạy `apt install` trong startup.
TTS không cần ffmpeg nhưng vẫn cần quyền gọi model của Google. Chi phí API độc lập với hosting.

Cache audio ở `DATA_DIR/audio`, xóa sau một giờ theo cấu hình (cleanup mỗi 30 giây), **không có trần tổng byte**.
PCM 24 kHz/16-bit/mono chiếm khoảng 2,88 MB/phút; nhiều lượt TTS có thể làm đầy disk trước khi hết TTL.
Ban đầu demo text trước, sau đó bật giọng nói khi đã theo dõi disk. Không tải model ML/torch/CUDA lên host.
`sizes.json` chỉ đo code/artifact; giới hạn tổng 2 GB vẫn phải tính virtualenv/packages, cache, dữ liệu PostgreSQL và backups.

## Cập nhật / backup / xử lý lỗi

- Source GitHub backend: dùng tab GitHub để apply revision, rồi restart. Nút redeploy không tự pull code mới.
- Frontend: tải artifact của commit mới, dừng workload rồi thay runtime bằng ZIP mới; giữ Environment.
- Trước migration/update: backup PostgreSQL độc lập. Dừng database trước backup/restore theo hướng dẫn Botkeep.
- `ORIGIN_REJECTED`: sửa `PUBLIC_APP_URL` khớp HTTPS frontend đang mở.
- `SERVER_PORT` error: dùng đúng port Network cấp cho **từng** workload.
- `/health` 502: kiểm tra backend, database, PYTHON_API_URL, Domains và khả năng kết nối giữa workload.
- `Unexpected Next rewrite manifest`: build lại bằng version đang pin; không sửa thủ công manifest để bỏ kiểm tra.
- Không có artifact: mở Actions log; ZIP chỉ được upload khi build và HTTP smoke test qua.

## Build / kiểm tra ở ngoài Botkeep

```bash
npm ci
NEXT_OUTPUT_STANDALONE=1 NEXT_PUBLIC_HOSTED_DEMO=true NEXT_TELEMETRY_DISABLED=1 npm run build
python deploy/botkeep/package.py
python scripts/check_botkeep_frontend.py
python -m pytest backend/tests -q
```

Smoke test dùng ZIP thật, backend HTTP mock: port/origin cấu hình runtime, install ở root, cookie/CSRF header,
raw JSON, SSE không buffering, PCM, static assets và nhãn demo. Backend tests kiểm tra hosted security và bootstrap.
Workflow còn chạy ZIP frontend + backend native với PostgreSQL thật trên GitHub Actions, kiểm tra migration, signup, chat SSE và owner MFA qua proxy.
Các kiểm tra local/CI không xác nhận mạng/TLS, profile minimum, ffmpeg hoặc tài nguyên thực tế trong tài khoản Botkeep.

Tài liệu: [Hosting](https://botkeep.cloud/docs/hosting), [Python](https://botkeep.cloud/docs/python),
[Node.js](https://botkeep.cloud/docs/nodejs), [GitHub](https://botkeep.cloud/docs/github),
[ZIP](https://botkeep.cloud/docs/zip), [FAQ](https://botkeep.cloud/faq), [Founder Free](https://botkeep.cloud/).
