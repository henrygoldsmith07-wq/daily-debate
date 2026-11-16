import type { MetadataRoute } from "next";

// Installable web app: needed for push on iOS (Safari only delivers Web Push
// to a site added to the Home Screen) and gives everyone a home-screen icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daily Debate",
    short_name: "Debate",
    description: "One motion a day. Fix one weakness. Prove it later.",
    start_url: "/?src=pwa",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
