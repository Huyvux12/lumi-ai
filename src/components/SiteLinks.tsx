import Link from "next/link";
import { FACEBOOK_PAGE_URL } from "@/lib/site";

export function SiteLinks({
  className = "",
  onNavigate,
  termsInNewTab = false,
}: {
  className?: string;
  onNavigate?: () => void;
  termsInNewTab?: boolean;
}) {
  return (
    <nav
      aria-label="Điều khoản và liên hệ"
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-fg-2 ${className}`}
    >
      <Link
        href="/terms"
        onClick={onNavigate}
        target={termsInNewTab ? "_blank" : undefined}
        rel={termsInNewTab ? "noopener noreferrer" : undefined}
        className="rounded py-1 underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Điều khoản sử dụng
        {termsInNewTab && <span className="sr-only"> (mở trong tab mới)</span>}
      </Link>
      <a
        href={FACEBOOK_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded py-1 underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Facebook
        <span className="sr-only"> (mở trong tab mới)</span>
      </a>
    </nav>
  );
}
