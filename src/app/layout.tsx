import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SPRINT_ESTIMATE_MINUTES } from "@/lib/sprint";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Daily Debate",
    template: "%s · Daily Debate",
  },
  description:
    `A ${SPRINT_ESTIMATE_MINUTES}-minute debate gym for sharper claims, real evidence, and coaching you can use on the next round.`,
  keywords: ["debate", "critical thinking", "argument coaching", "evidence", "AI", "PvP", "gamification"],
  icons: { icon: "/logo.svg", apple: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Apply stored reader preferences before first paint. Without this, a
            reader who asked for larger text or high contrast sees one flash of
            the default rendering on every navigation. `beforeInteractive`
            runs before React hydrates; the class names match
            le-studio.css's opt-in accessibility blocks. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var raw=localStorage.getItem("daily-debate:reader-preferences");if(!raw)return;var k=["large-text","dyslexia","high-contrast","reduce-motion"];var v=JSON.parse(raw);if(!Array.isArray(v))return;var h=document.documentElement;for(var i=0;i<k.length;i++){if(v.indexOf(k[i])!==-1)h.classList.add(k[i]);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
