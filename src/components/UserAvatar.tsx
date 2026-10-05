import { initials } from "@/lib/auth";

export function UserAvatar({
  name,
  hue,
  className = "size-9 text-sm",
  glow = false,
}: {
  name: string;
  hue: number;
  className?: string;
  glow?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-bold text-black ${className}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 90% 78%), hsl(${(hue + 50) % 360} 85% 62%))`,
        boxShadow: glow ? `0 0 0 3px rgb(0 0 0 / 0.5), 0 0 40px 4px hsl(${hue} 90% 65% / 0.55)` : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}
