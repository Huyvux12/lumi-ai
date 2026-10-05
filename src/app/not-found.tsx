import Link from "next/link";
import { Mascot } from "@/components/Mascot";

export default function NotFound() {
  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-3 overflow-hidden px-4 text-center">
      <div aria-hidden="true" className="absolute left-1/2 top-1/3 -z-10 size-[30rem] -translate-x-1/2 animate-breathe rounded-full bg-violet/20 blur-[100px]" />
      <p className="text-gradient text-8xl font-black tracking-tighter sm:text-9xl">404</p>
      <Mascot mood="sad" className="size-36 animate-float" />
      <h1 className="text-2xl font-semibold">PersonaX tìm mãi không thấy trang này</h1>
      <p className="text-fg-2">Nhân vật hoặc trang này không tồn tại — có lẽ nó đang ở một vũ trụ khác.</p>
      <Link href="/" className="btn-glow mt-3 rounded-full px-6 py-3 text-sm font-semibold">
        Về trang Khám phá
      </Link>
    </div>
  );
}
