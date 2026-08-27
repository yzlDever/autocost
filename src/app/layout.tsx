import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Cost",
  description: "A basic Next.js starter deployed on Vercel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

