import type { Metadata } from "next";
import "./globals.css";
import "./tacit.css";

export const metadata: Metadata = {
  title: "Tacit — Knowledge that stays",
  description: "Teach Remy how you work, or ask for guidance from a reviewed process.",
  icons: { icon: "/tacit-mark.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="tacit-app">{children}</body>
    </html>
  );
}
