import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "姚芳新闻学习",
  description: "通过JTBC新闻学韩语 — 汉字词桥梁学习法",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
