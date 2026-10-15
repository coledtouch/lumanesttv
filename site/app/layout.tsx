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
        {/* Each self-hosted file is a variable font covering every weight the site uses. */}
        <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/>
        <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/>
      </head>
      <body className="antialiased">{children}<PwaSupport/></body>
    </html>
  );
}
