import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "日々の余白 | プライベート日記",
  description: "日々の言葉を、静かに残すクラウド日記。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
