# 03 — Chốt design system và triển khai web

Đọc kỹ `PRODUCT_BRIEF.md` trước khi lập kế hoạch. Sản phẩm là một AI character discovery + roleplay chat web app. Ảnh đính kèm là giao diện trang Home/Discover cần tái hiện; không biến nó thành trang marketing, desktop pet, VTuber stage, visual novel 3D hoặc dashboard.

## 1. Audit trước khi sửa
Kiểm tra git diff, project structure, scripts, dev server và asset hiện có. Ghi nhận framework/version. Không xóa chức năng hay thay đổi ngoài scope.

## 2. Đọc ảnh và viết đặc tả ngắn
Dùng `reference/character-discovery.png` làm visual source of truth. Tạo `DESIGN_SYSTEM.md` và `UI_SPEC.md` trong repo trước khi implement. Ghi cụ thể:
- Dark charcoal canvas, gần đen nhưng phân cấp rõ; typography sans rõ nét; text chính/phụ, accent, border, spacing, radius, shadow.
- Trang discovery có top navigation phù hợp, tiêu đề/rail “Dành cho bạn”, rail “Cảnh” dạng carousel ngang, “Nổi bật”, “Phổ biến”; thẻ nhân vật có avatar/cover, tên, creator, mô tả, lượt chat và tag.
- Mật độ, chiều cao card, crop ảnh, khoảng cách hàng, responsive breakpoints, hover/focus/pressed/loading/empty behavior.
- Motion có chủ đích: card hover nhẹ, carousel có drag/keyboard, route/overlay transitions ngắn. Không animate mọi thứ đồng loạt; support `prefers-reduced-motion`.
- Screenshot là reference bố cục, không phải yêu cầu chép pixel tuyệt đối ở mọi viewport.

## 3. Implement end-to-end
Làm web app AI character discovery và roleplay chat. Ưu tiên Home/Discover giống cấu trúc trong ảnh; có search/filter/category, rail nhân vật đề xuất, carousel Cảnh, Nổi bật và Phổ biến. Khi mở một character, cung cấp hồ sơ/persona và hành động bắt đầu chat; màn chat phải trông như chat với một nhân vật có cá tính, không phải chatbot hỗ trợ chung. Nếu repo đã có backend/provider thật, tích hợp theo kiến trúc có sẵn. Nếu chưa có cấu hình backend/API key, làm luồng chat demo bằng dữ liệu/local mock, giữ ranh giới service rõ ràng để nối LLM sau; không bịa API hoặc yêu cầu/ghi secret. Dùng characters và scenes hư cấu, không dùng IP anime có bản quyền.

Dùng component architecture dễ sửa (AppShell/Navigation, CharacterRail, CharacterCard, SceneCarousel, Search, Detail/Chat). Không nhồi toàn bộ app vào một file. Thêm state/data cục bộ; không giả vờ có backend. Tất cả nút và affordance nhìn thấy được phải có hành vi, hoặc thể hiện rõ là disabled.

## 4. Chọn công cụ có chủ đích
- Cài component/runtime dependency phù hợp với repo sau khi đọc docs hiện hành.
- Có thể dùng Motion cho interactions/transitions; Embla hoặc native scroll-snap cho rail; shadcn/Radix primitives cho dialog/menu; Lucide icons; TanStack Query/Zustand chỉ nếu complexity thực sự cần.
- ThreeUI phải được khảo sát và thử dùng ít nhất một visual/component phù hợp nếu tương thích giấy phép, framework và performance. Nếu component quá nặng, paywalled hoặc không khớp UI, ghi lý do trong `PROMPT_PROGRESS.md` và làm UI tương ứng bằng CSS/Motion.
- Rive/Lottie/Live2D/Three.js/GSAP là tùy chọn theo visual requirement; không cài cho đủ danh sách. Không biến trang discovery thành màn 3D nặng nếu ảnh reference không cần.
- Dùng image optimization, lazy loading, fixed aspect ratio và graceful fallback. Tránh layout shift.

## 5. Hoàn thiện
Responsive desktop/tablet/mobile; semantic HTML; labels và keyboard; contrast; reduced motion; empty/loading/error states. Chạy app và kiểm tra compile/lint/typecheck phù hợp với project. Sau build chuyển sang prompt 04.
