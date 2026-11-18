import type { Metadata, Viewport } from "next";

/**
 * Deliberately thin: each screen brings its own stylesheet/markup so the portal
 * and the test harness keep the exact look they had in the PHP build.
 */

export const metadata: Metadata = {
  title: "Voice portal — quick call, campaigns, recordings",
  description: "ElevenLabs agents: quick calls, spreadsheet campaigns and call recordings.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f4f7fb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
