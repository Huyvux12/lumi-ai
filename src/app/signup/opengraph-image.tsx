import { ImageResponse } from "next/og";

// Share image for invite links (/i/CODE redirects here) and the Facebook post banner.
export const alt = "PersonaX — Mời bạn bè, nhận 7 ngày Basic miễn phí";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Orb() {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: 300,
        height: 300,
        borderRadius: 300,
        background: "radial-gradient(circle at 35% 30%, #e0d4ff 0%, #a78bfa 45%, #6d4fe0 100%)",
        boxShadow: "0 0 120px 30px rgba(167,139,250,0.45)",
      }}
    >
      <div style={{ position: "absolute", left: 92, top: 120, width: 34, height: 44, borderRadius: 30, background: "#1b1530" }} />
      <div style={{ position: "absolute", left: 174, top: 120, width: 34, height: 44, borderRadius: 30, background: "#1b1530" }} />
      <div style={{ position: "absolute", left: 102, top: 126, width: 11, height: 11, borderRadius: 11, background: "#fff" }} />
      <div style={{ position: "absolute", left: 184, top: 126, width: 11, height: 11, borderRadius: 11, background: "#fff" }} />
      <div style={{ position: "absolute", left: 62, top: 178, width: 40, height: 22, borderRadius: 20, background: "rgba(244,114,182,0.55)" }} />
      <div style={{ position: "absolute", left: 198, top: 178, width: 40, height: 22, borderRadius: 20, background: "rgba(244,114,182,0.55)" }} />
      <div
        style={{
          position: "absolute",
          left: 128,
          top: 182,
          width: 44,
          height: 22,
          borderBottomLeftRadius: 22,
          borderBottomRightRadius: 22,
          border: "6px solid #1b1530",
          borderTop: "none",
        }}
      />
    </div>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: "linear-gradient(135deg, #0b0a14 0%, #1d1538 55%, #3a1c4a 100%)",
          color: "#f4f2ff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 34, letterSpacing: -0.5 }}>
            <div style={{ width: 30, height: 30, borderRadius: 30, marginRight: 14, background: "linear-gradient(135deg, #8ab4ff, #c084fc)" }} />
            <div style={{ display: "flex" }}>PersonaX</div>
          </div>
          <div style={{ display: "flex", marginTop: 34, fontSize: 60, lineHeight: 1.12, letterSpacing: -1.5 }}>
            Mời bạn bè, nhận Basic miễn phí
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 30, lineHeight: 1.35, color: "#c9c4e0" }}>
            Trò chuyện với nhân vật AI bằng tiếng Việt, nghe nhân vật nói bằng giọng thật.
          </div>
          <div style={{ display: "flex", marginTop: 34, gap: 18 }}>
            <div
              style={{
                display: "flex",
                padding: "16px 24px",
                borderRadius: 22,
                fontSize: 26,
                whiteSpace: "nowrap",
                background: "linear-gradient(90deg, #8ab4ff, #c084fc, #f472b6)",
                color: "#120f1f",
              }}
            >
              Bạn bè: 7 ngày Basic
            </div>
            <div
              style={{
                display: "flex",
                padding: "16px 24px",
                borderRadius: 22,
                fontSize: 26,
                whiteSpace: "nowrap",
                border: "2px solid rgba(255,255,255,0.25)",
              }}
            >
              Mời 3 bạn: 1 tháng Basic
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 34, fontSize: 26, color: "#a7a1c2" }}>
            Đăng ký tại personaxai.tech
          </div>
        </div>
        <Orb />
      </div>
    ),
    size,
  );
}
