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

## 1. Chọn source GitHub — không tải ZIP

Repo: **`Huyvux12/lumi-ai`**. Kết nối GitHub trong Botkeep và cấp App quyền cho repo này.
Mỗi push vào `Botkeep` tự chạy **Actions → Botkeep GitHub deploy**: build frontend standalone,
kiểm tra HTTP, chạy backend + PostgreSQL thật, rồi xuất bản frontend đã kiểm tra sang **`botkeep-frontend`**.
Chờ cả job **publish-frontend** thành công trước khi tạo/cập nhật workload frontend.

| Workload | Source | Branch | Project root | Start command |
| --- | --- | --- | --- | --- |
| Frontend Node.js 24 | GitHub `Huyvux12/lumi-ai` | `botkeep-frontend` | `/` (gốc repo) | `npm start` |
| Backend Python 3.12 | GitHub `Huyvux12/lumi-ai` | `Botkeep` | `backend` | `python botkeep_start.py` |
| PostgreSQL | Managed database profile | — | — | Profile quản lý |

**Không chọn nhánh `Botkeep` cho frontend:** đó là source đầy đủ, chưa phải runtime đã build.
Nhánh `botkeep-frontend` do Actions quản lý; sửa code trên `Botkeep`, không sửa tay nhánh runtime.
`BUILD.json` trên nhánh runtime ghi source commit để đối chiếu và rollback. Nhánh runtime giữ lịch sử cập nhật,
không chứa source history của ứng dụng; lần đầu là một commit độc lập, lần sau cập nhật fast-forward.
Dependencies Next standalone được commit riêng trong nhánh runtime có chủ đích; nhánh source không commit node_modules.

ZIP trong Actions chỉ dùng nội bộ giữa các job/cho kiểm tra, **không cần tải về hoặc upload lên Botkeep**.
Workflow không đăng nhập vào Botkeep. Botkeep lấy code từ hai nhánh theo cấu hình của bạn.
Workflow trên nhánh chưa merge vào default branch có thể chưa có nút Run workflow; push vẫn chạy tự động.

## 2. Tạo PostgreSQL

Tạo workload PostgreSQL từ managed profile. Mở Database, lấy host/port/user/password/database và cấu hình TLS đúng như panel.
Backend dùng URL `postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE`. Percent-encode ký tự đặc biệt trong user/password.
Không tự thêm `sslmode=require` vào URL asyncpg; nếu panel yêu cầu TLS, dùng cấu hình driver tương ứng, ví dụ `?ssl=require`.
Không giả định PostgreSQL nghe trên localhost, port 5432 hay hỗ trợ hostname Docker `postgres`.
Kiểm tra địa chỉ do panel cấp có thể kết nối từ workload Python.

## 3. Tạo backend Python

Chọn Python **3.12 hoặc bản tương thích**, source **GitHub**, repo `Huyvux12/lumi-ai`,
branch **`Botkeep`**, project root **`backend`**, start command:

```text
python botkeep_start.py
```

`requirements.txt` ở project root cài project với `constraints-botkeep.txt`, không cài pytest/ruff.
Kiểm tra bước dependency installation của profile đã chạy thành công trước khi Start.
Nếu profile yêu cầu install command, đặt `python -m pip install --no-cache-dir -r requirements.txt`
trong cấu hình cài dependencies. Console được tài liệu mô tả là nơi xem output; không giả định có shell/SSH để gõ lệnh.

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

Chọn Node.js **24**, source **GitHub**, repo `Huyvux12/lumi-ai`, branch **`botkeep-frontend`**,
project root **`/`** (gốc repo), start command:

```text
npm start
```

Không cấu hình `next build` trên Botkeep. `npm install`/`npm ci` ở project root đều nhẹ:
root package và lockfile không có dependencies cần tải;
dependencies đã trace nằm trong `runtime/node_modules`, an toàn trước `npm install` ở root.
Giữ nguyên thư mục `runtime/`, kể cả `.next/` và node_modules bên trong.

Environment: `PYTHON_API_URL=https://BACKEND-DOMAIN` và `SERVER_PORT` được Network cấp.
Tạo HTTPS alias trong Domains; dùng chính origin này làm `PUBLIC_APP_URL` của backend.
Start frontend. Launcher đọc `.env` của Botkeep, tạo bản sao `.next` trong thư mục tạm `.botkeep-runtime`
và sửa hai rewrites của Next **16.3.8** trong bản sao đó. Dependencies/public được liên kết tới runtime gốc,
không sao chép thêm toàn bộ node_modules. File được Git theo dõi giữ nguyên để apply revision mới.
Standalone chạy cùng process trên `0.0.0.0:SERVER_PORT`. Thay URL backend chỉ cần restart,
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
`sizes.json` trong Actions chỉ đo code/artifact; giới hạn tổng 2 GB vẫn phải tính virtualenv/packages, Git checkout/history, bản sao `.next` khi chạy (khoảng 7 MB nội dung ở build đã kiểm tra), cache, dữ liệu PostgreSQL và backups.
Nếu panel hỗ trợ shallow checkout, dùng nó cho nhánh runtime; theo dõi disk khi cập nhật nhiều lần.

## Cập nhật / backup / xử lý lỗi

- Sửa code và push vào `Botkeep`; chờ **Botkeep GitHub deploy** thành công, bao gồm **publish-frontend**.
- Trong tab GitHub của từng workload, preview/apply revision và restart. Frontend lấy `botkeep-frontend`; backend lấy `Botkeep`.
- Muốn cập nhật tự động: bật **push updates** hoặc **pull-on-start** cho từng workload; các tùy chọn này không bật mặc định. Nút restart đơn thuần không đảm bảo lấy revision mới.
- Vì backend là source branch, chưa bật auto-update backend nếu muốn chỉ apply code sau khi CI qua; chờ CI rồi apply hai workload theo thứ tự phù hợp với migration.
- Hai workload cập nhật riêng, không có bảo đảm zero downtime hoặc rollback database tự động. Giữ nguyên Environment/MFA key và persistent DATA_DIR khi cập nhật.
- Rollback frontend: chọn commit cũ trên `botkeep-frontend` trong GitHub tab nếu panel hỗ trợ chọn revision. Đối chiếu `BUILD.json` với source backend; database migration cần kế hoạch rollback/backup riêng.
- Trước migration/update: backup PostgreSQL độc lập. Dừng database trước backup/restore theo hướng dẫn Botkeep.
- `ORIGIN_REJECTED`: sửa `PUBLIC_APP_URL` khớp HTTPS frontend đang mở.
- `SERVER_PORT` error: dùng đúng port Network cấp cho **từng** workload.
- `/health` 502: kiểm tra backend, database, PYTHON_API_URL, Domains và khả năng kết nối giữa workload.
- `Unexpected Next rewrite manifest`: build lại bằng version đang pin; không sửa thủ công manifest để bỏ kiểm tra.
- Nhánh `botkeep-frontend` chưa xuất hiện/còn cũ: mở Actions log, xem job **publish-frontend**. Job chỉ chạy khi build, HTTP smoke test và native integration qua; bỏ qua build đã bị source commit mới thay thế.
- Publish báo permission denied: kiểm tra GitHub Actions policy/branch protection cho phép `GITHUB_TOKEN` có `contents: write`. Workflow chỉ cấp quyền ghi cho job publish, không cần PAT riêng.
- Publish từ chối nhánh không phải runtime: không dùng `botkeep-frontend` cho code viết tay; kiểm tra metadata trước khi sửa cấu hình.

## Build / kiểm tra ở ngoài Botkeep

```bash
npm ci
NEXT_OUTPUT_STANDALONE=1 NEXT_PUBLIC_HOSTED_DEMO=true NEXT_TELEMETRY_DISABLED=1 npm run build
python deploy/botkeep/package.py
python scripts/check_botkeep_frontend.py
python -m pytest backend/tests -q
```

Smoke test dùng runtime thật từ ZIP và Git tree, backend HTTP mock: port/origin cấu hình runtime, install ở root, cookie/CSRF header,
raw JSON, SSE không buffering, PCM, static assets và nhãn demo. Backend tests kiểm tra hosted security và bootstrap.
Workflow còn chạy frontend + backend native với PostgreSQL thật trên GitHub Actions, kiểm tra migration, signup, chat SSE và owner MFA qua proxy.
Publish job dựng Git tree mới, chạy HTTP smoke test trên đúng tree này rồi push fast-forward; dependency/dotfile bị Git ignore không thể âm thầm mất khỏi bản deploy.
Các kiểm tra local/CI không xác nhận mạng/TLS, profile minimum, ffmpeg hoặc tài nguyên thực tế trong tài khoản Botkeep.

Tài liệu: [Hosting](https://botkeep.cloud/docs/hosting), [Python](https://botkeep.cloud/docs/python),
[Node.js](https://botkeep.cloud/docs/nodejs), [GitHub](https://botkeep.cloud/docs/github),
[ZIP](https://botkeep.cloud/docs/zip), [FAQ](https://botkeep.cloud/faq), [Founder Free](https://botkeep.cloud/).
