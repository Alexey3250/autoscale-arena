import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Autoscale Arena — Live on Red Hat OpenShift",
  description:
    "Hold the button on your phone. Watch the OpenShift HPA spin up worker pods in real time, with live CPU utilization, cold-start latency, and scale history.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh bg-slate-950 text-white selection:bg-rose-500/40">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(238,0,0,0.18),_transparent_60%),radial-gradient(ellipse_at_bottom,_rgba(56,189,248,0.12),_transparent_55%)]" />
        {children}
      </body>
    </html>
  );
}
