import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "야오팡 뉴스 스터디",
  description: "JTBC 뉴스로 배우는 한국어 — 한자어 브릿지 학습",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
