# Product brief — AI Character Discovery & Roleplay Chat

## Sản phẩm
Xây dựng một web app để người dùng khám phá các nhân vật AI hư cấu, chọn một nhân vật và trò chuyện nhập vai với persona đó. Trải nghiệm chính là character discovery + character chat, theo cảm hứng UX của Character.AI.

## Visual source of truth
`reference/character-discovery.png` là screenshot trang Home/Discover. Tái hiện rõ cấu trúc và cảm giác của ảnh:
- Dark charcoal interface.
- Hàng “Dành cho bạn” với các character cards ngang.
- Carousel “Cảnh” với ảnh bìa dọc, kéo/scroll ngang.
- Các hàng “Nổi bật” và “Phổ biến”.
- Mỗi card cho thấy avatar/cover, tên nhân vật, creator, mô tả ngắn, tag nếu có và số lượt trò chuyện.
- Spacing dày vừa phải, chữ sáng rõ, artwork là trọng tâm.

## User journeys tối thiểu
1. Mở Home/Discover và lướt các rail.
2. Tìm kiếm/lọc hoặc mở một scene/category.
3. Chọn character → xem hồ sơ/persona, mô tả và nút chat.
4. Bắt đầu cuộc trò chuyện và gửi/nhận tin nhắn theo persona.
5. Quay lại khám phá; navigation và các CTA chính hoạt động.

## Ranh giới
- Đây không phải landing page doanh nghiệp.
- Đây không phải desktop pet, VTuber/Live2D stage, visual novel/galgame toàn màn hình hay game 3D. Có thể dùng animation/UI motion nhẹ, nhưng discovery và chat vẫn là sản phẩm cốt lõi.
- Không lấy screenshot/repo khác làm codebase sản phẩm. Các repo trong `RESOURCES.txt` chỉ là skill, component, docs hoặc visual reference.
- Không dùng lại tên, hình, logo hoặc nhân vật có bản quyền trong screenshot. Tạo dữ liệu và artwork demo hư cấu, nhất quán.
- Không tự dựng auth, database, billing, moderation backend, hay LLM API nếu repo chưa có yêu cầu/cấu hình. Nếu chưa có backend, làm frontend demo chạy được và cô lập mock adapter để tích hợp thật sau.
- Giao diện ưu tiên tiếng Việt ở navigation/section labels như ảnh; character bios có thể dùng ngôn ngữ phù hợp với nội dung demo.

## Thứ tự ưu tiên
1. Home/Discover đúng product và gần screenshot.
2. Character detail và roleplay chat flow rõ ràng.
3. Responsive, tương tác, accessibility và visual QA.
4. Animation/3D chỉ thêm khi hỗ trợ trải nghiệm trên; không để effect làm lu mờ character discovery.
