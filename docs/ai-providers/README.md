# Nhà cung cấp AI

Mở **Quản trị → AI & vận hành → Nhà cung cấp AI** (`/admin?tab=providers`).
Admin/owner chọn LLM và STT độc lập; production yêu cầu phiên đã xác minh MFA.
Moderator không được truy cập.

- LLM: Groq mặc định hoặc tối đa 50 cấu hình OpenAI-compatible.
- STT: Groq Whisper hoặc Deepgram Nova-3 (`language=vi`, `smart_format=true`).
- TTS: Gemini tiếp tục đọc các đoạn dialogue đã được kiểm tra.

Chạy `cd backend && uv run --locked python -m alembic upgrade head` trước triển
khai. Migration `c1d82e4f630a` tạo `ai_settings` và `llm_profiles`, giữ Groq mặc định.
Migration `d4e93a7c512b` thêm bảng `provider_credentials` lưu khóa mã hóa.
Seed không ghi đè lựa chọn hoặc khóa đã lưu. Mỗi yêu cầu chốt nguồn, model, khóa và giá trước
khi gọi dịch vụ; thay đổi chỉ ảnh hưởng yêu cầu mới. Không tự đổi nguồn khi lỗi.
Không cho xóa cấu hình LLM đang hoạt động.

## Khóa và endpoint

### Nhập khóa tại admin

Owner mở mục **Khóa API** trong trang Nhà cung cấp AI để nhập/thay Groq,
Deepgram hoặc thêm tên khóa OpenAI-compatible. Không thêm bước xác minh MFA
riêng cho tính năng này; phân quyền và chính sách đăng nhập quản trị hiện có
vẫn áp dụng. Admin thường chỉ chọn/thử provider, không đọc metadata khóa hay
thêm/thay/xóa khóa. Moderator không truy cập cấu hình provider.

- Ô nhập có dạng mật khẩu, được xóa ngay khi gửi và không được lưu vào browser
  storage. Không có API đọc lại khóa đầy đủ. Chỉ owner thấy bốn ký tự cuối của
  khóa nhập qua admin; khóa server chỉ hiện trạng thái đã cấu hình.
- Khóa admin ưu tiên hơn khóa server cùng tên. Groq dùng chung khóa cho LLM và
  Whisper; Deepgram có khóa riêng. Tên khóa compatible dùng chung cho những
  profile tham chiếu tên đó. Danh sách hiển thị cấu hình sử dụng và nguồn đang dùng.
- Khóa mới có hiệu lực cho yêu cầu mới, không cần restart; yêu cầu đang xử lý
  giữ snapshot khóa cũ. Lưu khóa không tự chọn provider. Dùng nút thử LLM/STT
  bên dưới để kiểm tra bằng provider thật, có thể phát sinh phí.
- Xóa khóa admin có xác nhận rõ việc quay về khóa server. Nếu không có khóa
  server và nguồn đang hoạt động phụ thuộc khóa đó, hệ thống chặn xóa; đổi
  nguồn trước hoặc thay khóa. Khóa server không thể bị xóa từ giao diện.
- Thao tác dùng version chung để ngăn ghi đè thay đổi của owner/admin khác,
  giới hạn 10 lần ghi/xóa mỗi 5 phút cho mỗi owner. Audit lưu người thực hiện,
  thời điểm, tên khóa và loại thao tác; không lưu plaintext hay request body.
- Tối đa 50 khóa compatible lưu tại admin. API key dài 8–8192 ký tự ASCII hiển
  thị, không có khoảng trắng/control characters. Dữ liệu lỗi không echo khóa.

Backend mã hóa Fernet có xác thực và ràng buộc ciphertext với tên khóa. Mặc định
khóa mã hóa được dẫn xuất riêng từ master server (`MFA_ENCRYPTION_KEY` nếu có,
hoặc file private `DATA_DIR/mfa.key` được tự tạo ở môi trường local). Việc này
không yêu cầu thiết lập MFA trên tài khoản. Các bản mã không thể dùng như secret
MFA. Có thể đặt master riêng qua `AI_CREDENTIAL_ENCRYPTION_KEY` (Fernet key)
hoặc `credential_encryption_key` trong `AI_PROVIDER_CONFIG_JSON`; biến riêng
được ưu tiên. Cùng một master phải được dùng cho mọi backend instance.

**Sao lưu master ngoài database** và giữ volume `DATA_DIR` nếu dùng file local.
Không đổi master tùy tiện: khóa đã lưu sẽ không giải mã được sau khi đổi/mất
master; khôi phục master hoặc nhập lại API key qua owner. Lỗi giải mã trả 503,
không âm thầm dùng khóa server. Không đưa master vào Git, FE hoặc database.
Migration downgrade xóa kho khóa admin, giữ nguyên profile, lựa chọn và user;
nên xuất bản sao lưu database/master trước khi downgrade.

### Khóa từ cấu hình server

Các biến cũ vẫn được hỗ trợ. Trong `.env.backend` (Compose) hoặc `backend/.env`
(local), cấu hình:

```dotenv
DEEPGRAM_API_KEY=<deepgram-key>
LLM_API_KEYS_JSON='{"openai":"<openai-key>","router":"<openrouter-key>"}'
LLM_ALLOWED_HOSTS=api.openai.com,openrouter.ai,api.groq.com
```

Restart backend khi thay khóa server/allowlist. Sau đó admin thêm, sửa, thử và chọn các
profile mà không cần restart tiếp. Tên khóa `groq` tham chiếu `GROQ_API_KEY`.
Groq mặc định vẫn dùng `GROQ_LLM_MODEL` và `GROQ_STT_MODEL` như trước.

Endpoint tùy chỉnh phải dùng HTTPS cổng 443, hostname nằm trong allowlist, không
chứa thông tin đăng nhập, query, fragment hoặc IP literal. Backend kiểm tra DNS
khi lưu/kích hoạt và khi gọi; chặn mọi kết quả phân giải không công khai, ghim IP
đã kiểm tra, giữ Host/TLS SNI gốc, không theo redirect. Client này không đi qua
proxy từ biến môi trường để tránh proxy phân giải lại hostname sau kiểm tra.
Backend cần đường HTTPS outbound trực tiếp tới provider tương ứng.

Chỉ nhập plaintext vào ô API key riêng; không đặt khóa vào `NEXT_PUBLIC_*`,
base URL, tên profile, lý do thao tác hoặc Git. Có thể lưu
profile dùng tên khóa đã đăng ký nhưng còn trống; không thể kích hoạt nguồn mới
thiếu khóa. Tên khóa chưa đăng ký bị từ chối.

## Cấu hình LLM

| Trường | OpenAI | OpenRouter |
| --- | --- | --- |
| Base URL | `https://api.openai.com/v1` | `https://openrouter.ai/api/v1` |
| Model | Model được phép trong tài khoản, ví dụ `gpt-4o-mini` | Model được phép trong tài khoản, ví dụ `openai/gpt-4o-mini` |
| Tên khóa | `openai` | `router` |

Backend nối `/chat/completions` vào base URL. Adapter dùng Chat Completions không
stream token upstream; SSE của ứng dụng giữ nguyên hợp đồng các event theo segment.
Model chỉ hỗ trợ Responses API nằm ngoài phạm vi adapter này.

Chọn theo khả năng model:

- `json_object`, JSON Schema strict, hoặc JSON theo prompt. Mọi kết quả đều phải
  vượt qua kiểm tra schema lời dẫn/lời thoại và vocal tags trước khi lưu hoặc đọc.
- `max_tokens` hoặc `max_completion_tokens` cho giới hạn đầu ra.
- Temperature/reasoning effort để trống nghĩa là không gửi tham số đó.
- Bộ đếm token: `o200k_base` cho GPT-4o/o-series; `cl100k_base` cho GPT-4/3.5;
  Qwen cho model Qwen; UTF-8 là ước lượng bảo thủ khi không có tokenizer phù hợp.

Vocabulary Qwen/OpenAI được đóng gói sẵn; không tải mạng ở runtime. Hai file
OpenAI được kiểm tra SHA-256 chính thức, tương ứng tiktoken 0.14.0. Dữ liệu BPE
được lấy qua gói MIT js-tiktoken 1.0.21 rồi tái tạo và đối chiếu đúng hash từ
OpenAI tiktoken; regex và special tokens dùng định nghĩa chính thức của tiktoken.
Xem [TIKTOKEN-LICENSE.txt](../../backend/app/seed/TIKTOKEN-LICENSE.txt).
Framing có thể khác giữa các provider; số token dịch vụ báo là nguồn đối chiếu hóa đơn.

## Giá và usage

Giá USD / một triệu token vào và ra là giá tham chiếu do admin khai báo. Để trống
cả hai nếu chưa biết; 0 nghĩa là admin xác nhận giá 0, không phải chưa biết.
Usage lưu provider, profile, model, token và giá tại thời điểm xử lý. Đổi giá
profile không tính lại lịch sử. Dashboard hiển thị tổng chi phí đã biết và số
lượt LLM hoàn tất chưa định giá; dữ liệu cũ dùng giá Qwen tham chiếu và được ghi
chú riêng. Ước tính chưa gồm STT/TTS và có thể chưa gồm các lần thử thất bại phía
provider; cần đối chiếu hóa đơn thực tế.

## Thử nguồn

- Thử LLM dùng Kaito Kid và system prompt đang xuất bản; hiển thị kết quả sau khi
  kiểm tra schema. Thử STT bằng ghi âm hoặc tải tệp tối đa 30 giây / 5 MB.
- Audio được giải mã WAV mono 16 kHz; thời lượng dựa vào mẫu đã giải mã.
- Mỗi admin tối đa 5 lần thử/phút, một lần thử đang chạy. Phép thử vẫn gọi dịch vụ
  thật khi demo local bật, không thay nguồn và không trừ quota cá nhân. Provider
  có thể tính phí; usage/audit phép thử vẫn được lưu.
- Lỗi/hủy giải phóng reservation. Nội dung tin nhắn thử, transcript, khóa và lỗi
  thô của provider không được chép vào audit.

## AWS ECS

`AIProviderSecretArn` mặc định trống, nên deployment cũ không phải thêm key mới
vào secret cũ. Có thể nhập khóa provider trực tiếp ở admin, dùng master
đang có của backend. Nếu muốn quản lý khóa qua server hoặc đặt master riêng,
tạo secret riêng chứa toàn bộ JSON object:

```json
{
  "deepgram_api_key": "<deepgram-key>",
  "llm_api_keys": {"openai": "<openai-key>", "router": "<openrouter-key>"},
  "llm_allowed_hosts": ["api.openai.com", "openrouter.ai", "api.groq.com"]
}
```

Đưa ARN vào `AIProviderSecretArn`. Stack cấp execution role quyền đọc đúng ARN,
đưa toàn bộ secret vào `AI_PROVIDER_CONFIG_JSON` của backend/migration task.
`DEEPGRAM_API_KEY`, `LLM_API_KEYS_JSON`, `LLM_ALLOWED_HOSTS` nếu có sẽ ưu tiên hơn
JSON chung. Dùng AWS-managed KMS key hoặc cùng CMK với backend secret; nếu khác,
cần cấp quyền decrypt tương ứng. Frontend không nhận secret môi trường. Rotation khóa môi trường/master cần
restart task; thay API key trong admin không cần restart. Khi đặt master riêng,
thêm `credential_encryption_key` vào JSON này và lưu bền vững trước khi nhập khóa
đầu tiên. Đổi master sau đó cần kế hoạch mã hóa lại hoặc nhập lại các khóa đã lưu.

## Kiểm thử và ảnh minh họa

Backend tests dùng HTTP mock: auth/payload STT, JSON modes, tokenizer, quota, lỗi,
rate limit, timeout, đổi nguồn khi đang xử lý, giá lịch sử, DNS pinning, MFA/CSRF
và pipeline Nova-3 → LLM-compatible → Gemini TTS. Kho khóa được kiểm thử phân
quyền owner không thêm MFA, ciphertext/suffix/audit, đổi khóa, fallback khi xóa,
chống ghi đè version, CSRF và lỗi giải mã; migration giữ profile/user qua upgrade. Browser tests đi qua API thật
của test harness; provider và DNS ngoài được mock. Muốn xác minh chất lượng,
chi phí/độ trễ thực tế, cấu hình khóa thật rồi dùng các nút thử.

Ảnh dưới đây dùng dữ liệu kiểm thử:

![Nhà cung cấp AI trên desktop](desktop.png)

![Nhà cung cấp AI trên mobile](mobile.png)
