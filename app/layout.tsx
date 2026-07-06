import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lumen — Your video's own tutor",
  description:
    "Upload an educational video and get a voice tutor that answers only from what the video actually teaches. Powered by Sarvam AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
