import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "이윤호 · 진수빈 결혼식",
  description: "2026년 3월 28일",
  openGraph: {
    title: "이윤호 · 진수빈 결혼식",
    description: "2026년 3월 28일",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-stone-50 text-stone-800 antialiased">{children}</body>
    </html>
  );
}
