import type { Metadata } from "next";
import "./globals.css";
import "./storefront.css";
import PwaSupport from './pwa-support';

export const metadata: Metadata = {
  title: "LumaNest TV — Make yourself at home",
  description: "Choose your screens, find your plan, and settle in with LumaNest TV.",
  manifest: '/manifest.webmanifest',
  appleWebApp: {capable: true, statusBarStyle: 'black-translucent', title: 'LumaNest TV'},
  icons: {
    icon: "/pwa/icon.svg",
    shortcut: "/pwa/icon-192.png",
    apple: '/pwa/icon-180.png',
  },
};

export const viewport = {themeColor: '#141224'};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}<PwaSupport/></body>
    </html>
  );
}
