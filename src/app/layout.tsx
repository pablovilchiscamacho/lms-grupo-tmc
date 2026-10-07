import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Capacitación · Grupo TMC", template: "%s · Capacitación Grupo TMC" },
  description: "Plataforma de capacitación corporativa de Grupo TMC",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0f2a4a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-MX" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
