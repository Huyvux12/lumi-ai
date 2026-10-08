export function RenderDemoNotice() {
  if (process.env.NEXT_PUBLIC_RENDER_DEMO !== "true") return null;
  return (
    <aside className="relative z-20 border-b border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm text-amber-100">
      Bản demo · Bạn có thể đăng ký và trò chuyện ngay. Phản hồi dùng mẫu khi AI
      chưa được kết nối. Email và thanh toán đã tắt; không chuyển tiền thật.
    </aside>
  );
}
