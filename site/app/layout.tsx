import type { Metadata } from "next";
import "./globals.css";
import "./storefront.css";
import "./site-chrome.css";
import PwaSupport from './pwa-support';
import {SITE_URL, openGraph, siteDescription, siteTitle} from './site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: siteTitle,
  description: siteDescription,
  openGraph,
  twitter: {card: 'summary_large_image', title: siteTitle, description: siteDescription, images: ['/og-image.png']},
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap"/>
      </head>
      <body className="antialiased">{children}<PwaSupport/></body>
    </html>
  );
}
