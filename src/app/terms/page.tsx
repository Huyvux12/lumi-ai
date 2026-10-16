import type { Metadata } from "next";
import Link from "next/link";
import { SiteLinks } from "@/components/SiteLinks";
import { FACEBOOK_PAGE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng | PersonaX",
  description: "Điều khoản sử dụng PersonaX: tài khoản, nội dung AI, quy tắc cộng đồng, gói dịch vụ, thanh toán và hỗ trợ.",
};

const sections = [
  {
    id: "pham-vi",
    title: "1. Phạm vi và chấp thuận",
    paragraphs: [
      "PersonaX là nền tảng khám phá, tạo nhân vật và trò chuyện nhập vai bằng trí tuệ nhân tạo. Điều khoản này áp dụng khi bạn truy cập, đăng ký tài khoản và sử dụng các tính năng của PersonaX.",
      "Hãy đọc điều khoản trước khi đăng ký hoặc mua gói dịch vụ. Chỉ sử dụng dịch vụ khi bạn có đủ năng lực giao kết theo pháp luật áp dụng; nếu cần người đại diện hoặc người giám hộ đồng ý, hãy có sự đồng ý đó trước khi đăng ký hoặc thanh toán.",
    ],
  },
  {
    id: "tai-khoan",
    title: "2. Tài khoản và bảo mật",
    paragraphs: [
      "Bạn cần cung cấp thông tin đăng ký chính xác, bảo vệ mật khẩu, mã xác minh và các phiên đăng nhập của mình. Không chia sẻ thông tin đăng nhập, sử dụng tài khoản của người khác khi chưa được phép hoặc giả mạo cá nhân, tổ chức.",
      "Nếu phát hiện truy cập bất thường, hãy đổi mật khẩu, thu hồi phiên đăng nhập trong phần bảo mật tài khoản và liên hệ hỗ trợ. Bạn có trách nhiệm với hoạt động do mình thực hiện; các sự cố truy cập trái phép cần được kiểm tra theo từng trường hợp.",
    ],
  },
  {
    id: "noi-dung-ai",
    title: "3. Đặc điểm của nội dung AI",
    paragraphs: [
      "Nhân vật, hội thoại và giọng nói trên PersonaX do AI tạo ra để phục vụ sáng tạo và giải trí. AI có thể trả lời sai, thiên lệch hoặc không phù hợp; lời nói của nhân vật không đại diện cho quan điểm hay cam kết của PersonaX hoặc tác giả nhân vật gốc.",
      "Không coi phản hồi AI là tư vấn y tế, pháp lý, tài chính hoặc chỉ dẫn chuyên môn. Bạn cần tự kiểm chứng thông tin trước khi sử dụng trong thực tế. Khi gặp nội dung có vấn đề, hãy báo cáo hoặc gửi phản hồi để được xem xét.",
    ],
  },
  {
    id: "quy-tac",
    title: "4. Quy tắc sử dụng",
    paragraphs: [
      "Không sử dụng PersonaX để thực hiện hành vi trái pháp luật, lừa đảo, quấy rối, đe dọa, kích động thù hận hoặc bạo lực; không tạo hay phát tán nội dung bóc lột tình dục, đặc biệt nội dung liên quan đến trẻ em.",
      "Không đăng dữ liệu cá nhân của người khác khi chưa có quyền, xâm phạm quyền riêng tư hoặc quyền sở hữu trí tuệ, mạo danh hay dùng hình ảnh và giọng nói nhằm gây hiểu lầm.",
      "Không phát tán mã độc, truy cập trái phép, can thiệp hệ thống, spam, tự động khai thác dịch vụ gây quá tải hoặc né tránh giới hạn sử dụng và thanh toán.",
    ],
  },
  {
    id: "so-huu",
    title: "5. Nội dung của bạn và quyền sở hữu trí tuệ",
    paragraphs: [
      "Bạn giữ các quyền hợp pháp đối với nội dung mình cung cấp và có trách nhiệm bảo đảm có quyền sử dụng văn bản, hình ảnh, hồ sơ nhân vật và tệp tải lên. Việc đăng nội dung không chuyển quyền sở hữu của bạn cho PersonaX.",
      "Bạn cho phép PersonaX xử lý, lưu trữ và hiển thị nội dung trong phạm vi cần thiết để cung cấp tính năng bạn sử dụng. Nội dung nhân vật được bạn chọn công khai có thể được người khác xem và tương tác sau khi được duyệt; hãy kiểm tra chế độ hiển thị trước khi đăng.",
      "Tên, hình ảnh và nhân vật thuộc bên thứ ba vẫn thuộc chủ sở hữu tương ứng. Việc xuất hiện trên PersonaX không hàm ý họ tài trợ, chứng thực hoặc liên kết với dịch vụ. Nếu cho rằng nội dung xâm phạm quyền của mình, hãy gửi thông tin và đường dẫn cho bộ phận hỗ trợ.",
    ],
  },
  {
    id: "du-lieu",
    title: "6. Dữ liệu khi sử dụng dịch vụ",
    paragraphs: [
      "PersonaX xử lý thông tin tài khoản, nhân vật, hội thoại, tệp và dữ liệu giao dịch cần thiết cho hoạt động đăng nhập, lưu lịch sử, cung cấp tính năng, bảo mật và hỗ trợ. Cookie phiên được sử dụng để duy trì đăng nhập.",
      "Khi bạn dùng tính năng AI, phần nội dung cần thiết cho yêu cầu có thể được gửi đến nhà cung cấp AI đang được cấu hình. Với giọng nói, dữ liệu âm thanh hoặc văn bản được xử lý để chuyển giọng nói thành chữ hoặc tạo âm thanh. Không gửi mật khẩu, mã OTP, khóa API hoặc thông tin nhạy cảm không cần thiết vào hội thoại.",
      "Bạn có thể liên hệ hỗ trợ để yêu cầu giải thích, truy cập, chỉnh sửa hoặc xóa dữ liệu cá nhân; yêu cầu được xem xét theo quyền của bạn và nghĩa vụ lưu trữ áp dụng. Liên kết Facebook mở dịch vụ bên thứ ba với chính sách riêng của họ.",
    ],
  },
  {
    id: "thanh-toan",
    title: "7. Gói dịch vụ, thanh toán và hoàn tiền",
    paragraphs: [
      "Tính năng, tình trạng mở bán, mức giá và ưu đãi của từng gói được hiển thị tại trang Gói & thanh toán. Kiểm tra gói, số tiền, mã ưu đãi và thông tin chuyển khoản trước khi xác nhận. Thông tin đã ghi nhận trên đơn hàng là căn cứ đối soát thanh toán.",
      "Premium được kích hoạt sau khi hệ thống xác nhận thanh toán hoặc xác nhận đơn giảm giá 100% hợp lệ. Kỳ sử dụng là một tháng từ thời điểm kích hoạt; gia hạn sớm nối tiếp kỳ đã mua. Thanh toán chuyển khoản do bạn chủ động thực hiện, không tự động trừ tiền hằng tháng.",
      "Giới hạn và khả năng cung cấp tính năng phụ thuộc gói đang áp dụng. Thay đổi giá hoặc ưu đãi cho đơn mới không làm thay đổi số tiền của đơn đã được tạo.",
      "Nếu chuyển nhầm, thanh toán trùng, chưa được kích hoạt hoặc có yêu cầu hoàn tiền, hãy gửi mã đơn và chứng từ đã che thông tin nhạy cảm qua kênh hỗ trợ. PersonaX kiểm tra từng trường hợp, thông báo hướng xử lý và thực hiện nghĩa vụ hoàn tiền theo thỏa thuận và pháp luật áp dụng. Không chia sẻ mật khẩu ngân hàng hay mã OTP.",
    ],
  },
  {
    id: "xu-ly",
    title: "8. Xử lý vi phạm và gián đoạn",
    paragraphs: [
      "PersonaX có thể hạn chế nội dung hoặc tài khoản khi có dấu hiệu vi phạm, rủi ro bảo mật hoặc yêu cầu hợp pháp. Phạm vi xử lý cần phù hợp với sự việc; bạn có thể liên hệ hỗ trợ để được giải thích và yêu cầu xem xét lại.",
      "Dịch vụ có thể gián đoạn do bảo trì, sự cố hệ thống hoặc nhà cung cấp. Khi sự cố ảnh hưởng quyền lợi đã thanh toán, hãy liên hệ để được kiểm tra và xử lý. Điều khoản này không loại trừ trách nhiệm của PersonaX hay hạn chế quyền của người tiêu dùng theo pháp luật áp dụng.",
    ],
  },
  {
    id: "thay-doi",
    title: "9. Thay đổi điều khoản và giải quyết tranh chấp",
    paragraphs: [
      "Phiên bản cập nhật sẽ được công bố tại trang này kèm ngày cập nhật. Thay đổi ảnh hưởng đáng kể đến quyền và nghĩa vụ sẽ được thông báo trước khi áp dụng và xin chấp thuận khi pháp luật yêu cầu; không tự ý áp dụng hồi tố làm giảm quyền lợi của đơn đã thanh toán.",
      "Khi có vướng mắc, bạn có thể gửi yêu cầu hỗ trợ để hai bên trao đổi và tìm cách giải quyết. Việc liên hệ hỗ trợ không hạn chế quyền khiếu nại, yêu cầu cơ quan có thẩm quyền giải quyết hoặc khởi kiện theo pháp luật Việt Nam.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8 sm:py-16">
      <Link href="/welcome" className="text-sm text-accent hover:underline">
        Về trang giới thiệu
      </Link>
      <header className="mb-8 mt-6">
        <p className="text-sm font-medium text-accent">PersonaX</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">Điều khoản sử dụng</h1>
        <p className="mt-4 text-sm text-fg-2">
          Cập nhật ngày <time dateTime="2026-10-16">16/10/2026</time>
        </p>
        <p className="mt-4 leading-7 text-fg-2">
          Những điều bạn cần biết để sử dụng PersonaX, sáng tạo nhân vật và trò chuyện cùng AI.
        </p>
      </header>

      <nav aria-label="Mục lục điều khoản" className="glass mb-8 rounded-2xl p-5 sm:p-6">
        <h2 className="mb-3 font-semibold">Mục lục</h2>
        <ol className="grid gap-3 text-sm sm:grid-cols-2">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-fg-2 hover:text-accent hover:underline">{section.title}</a>
            </li>
          ))}
          <li><a href="#lien-he" className="text-fg-2 hover:text-accent hover:underline">10. Liên hệ và hỗ trợ</a></li>
        </ol>
      </nav>

      <article className="glass space-y-8 rounded-3xl p-5 sm:p-8">
        {sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-24">
            <h2 id={`${section.id}-title`} className="mb-3 text-xl font-semibold">{section.title}</h2>
            <div className="space-y-3 leading-7 text-fg-2">
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.id === "thanh-toan" && (
                <p><Link href="/billing" className="text-accent hover:underline">Xem gói và thanh toán</Link></p>
              )}
            </div>
          </section>
        ))}
        <section id="lien-he" aria-labelledby="lien-he-title" className="scroll-mt-24">
          <h2 id="lien-he-title" className="mb-3 text-xl font-semibold">10. Liên hệ và hỗ trợ</h2>
          <p className="leading-7 text-fg-2">
            Gửi câu hỏi về điều khoản, dữ liệu, bản quyền hoặc thanh toán qua{" "}
            <a href={FACEBOOK_PAGE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              trang Facebook PersonaX<span className="sr-only"> (mở trong tab mới)</span>
            </a>
            {" "}hoặc mục <Link href="/feedback" className="text-accent hover:underline">Góp ý & hỗ trợ</Link> sau khi đăng nhập.
            Hãy gửi mã đơn hoặc đường dẫn liên quan để việc kiểm tra được thuận tiện.
          </p>
        </section>
      </article>
      <SiteLinks className="mt-8" />
    </div>
  );
}
