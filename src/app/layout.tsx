import { Providers } from "@/components/providers";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/components/i18n";
import { LANG_COOKIE, langFromHeader, parseLang } from "@/lib/i18n";
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

// Stage 5 completes the metadata (descriptions, Open Graph, canonical, JSON-LD).
export const metadata: Metadata = {
  title: { default: "TheAtlas Queue", template: "%s · TheAtlas Queue" },
  applicationName: "TheAtlas Queue",
  authors: [{ name: "Atlas Ata KAHRAMAN", url: "https://github.com/atlasatakahraman" }],
  formatDetection: { telephone: false },
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
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value) ?? langFromHeader(h.get("accept-language"));
  return (
    <html
      lang={lang}
      className={`${newsreader.variable} ${hanken.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider lang={lang}>
          <Providers nonce={nonce}>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
