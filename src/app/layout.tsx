import "server-only";
import { PREFS_SCRIPT } from "@/components/prefs";
import { Providers } from "@/components/providers";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { I18nProvider } from "@/components/i18n";
import { requestLang, SITE } from "@/lib/server/site";
import "./globals.css";

// OFL 1.1 faces, the same three TheAtlas ships (DESIGN.md § Type). Self-hosted and preloaded.
const newsreader = localFont({
  variable: "--font-newsreader",
  src: [
    { path: "./fonts/Newsreader-Variable.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Newsreader-Variable-Italic.woff2", weight: "400", style: "italic" },
  ],
});
const hanken = localFont({
  variable: "--font-hanken",
  src: [
    { path: "./fonts/HankenGrotesk-Variable.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/HankenGrotesk-Variable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
});
const jetbrains = localFont({
  variable: "--font-jetbrains",
  src: [
    { path: "./fonts/JetBrainsMono-Variable.woff2", weight: "100 800", style: "normal" },
    { path: "./fonts/JetBrainsMono-Variable-Italic.woff2", weight: "100 800", style: "italic" },
  ],
});

// DESIGN.md § Metadata and SEO → Every page. Pages add their title, description, canonical and
// Open Graph image; nothing is hand-written into <head>.
const AUTHOR = { name: "Atlas Ata KAHRAMAN", url: "https://github.com/atlasatakahraman" };
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "TheAtlas Queue", template: "%s · TheAtlas Queue" },
  applicationName: "TheAtlas Queue",
  authors: [AUTHOR],
  creator: AUTHOR.name,
  publisher: AUTHOR.name,
  openGraph: { siteName: "TheAtlas Queue", type: "website" },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/favicon.ico", apple: "/TheAtlasB2048.png" },
  formatDetection: { telephone: false },
};

// Zoom is never disabled; the browser chrome takes the floor's colour.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#131210" },
    { media: "(prefers-color-scheme: light)", color: "#f4f0e6" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce CSP (src/proxy.ts) needs every page rendered per request: a prerendered page
  // carries no nonce, and strict-dynamic would block all of its scripts. Reading the
  // header opts every page into dynamic rendering and hands next-themes its nonce.
  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;
  const lang = await requestLang();
  return (
    <html
      lang={lang}
      data-scroll-behavior="smooth"
      className={`${newsreader.variable} ${hanken.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Animations and Notifications (per browser) before the first paint, so an entrance
            the viewer turned off never starts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      {/* The browser scrolls the page (D18): its keys, find-in-page and scroll restoration work. */}
      <body className="flex min-h-dvh flex-col">
        <I18nProvider lang={lang}>
          <Providers nonce={nonce}>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
