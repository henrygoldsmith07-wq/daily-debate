import { ImageResponse } from "next/og";
import { parseShareQuery, type RoundMark } from "@/lib/shareCard";

// Open Graph image for a shared result: the day number, the side and the
// squares, drawn as plain shapes (no emoji font fetch). Only parsed codes are
// rendered — no text from the URL ever reaches the image.

const COLOR: Record<RoundMark, string> = { answered: "#22c55e", partial: "#eab308", dropped: "#ef4444", none: "#3f3f46" };

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const card = parseShareQuery(params) ?? { side: "for" as const, marks: [], repaired: false };
  const heading = card.dayNumber ? `Daily Debate #${card.dayNumber}` : "Daily Debate";
  const side = card.side === "for" ? "Argued For" : "Argued Against";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 88px",
          background: "#0f1115",
          color: "#f4f4f5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>{heading}</div>
        <div style={{ display: "flex", fontSize: 36, color: "#a1a1aa", marginTop: 12 }}>{side}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 56 }}>
          {card.marks.map((mark, index) => (
            <div key={index} style={{ width: 96, height: 96, borderRadius: 16, background: COLOR[mark] }} />
          ))}
        </div>
        <div style={{ display: "flex", fontSize: 34, marginTop: 56, color: card.repaired ? "#22c55e" : "#a1a1aa" }}>
          {card.repaired ? "Weakness repaired ✓" : "Repair still to do"}
        </div>
        <div style={{ display: "flex", fontSize: 28, marginTop: "auto", color: "#71717a" }}>
          One motion a day · fix one weakness · prove it later
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: { "Cache-Control": "public, max-age=86400, immutable" },
    },
  );
}
