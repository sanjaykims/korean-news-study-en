import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Korean News Study",
  description: "Learn Korean through JTBC News — Real broadcast, real language",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
