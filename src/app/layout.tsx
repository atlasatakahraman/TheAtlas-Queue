import { Providers } from "@/components/providers";
import type { Metadata } from "next";
import localFont from "next/font/local";
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

export const metadata: Metadata = {
  title: "TheAtlas — Queue",
  description:
    "League of Legends Şamata (ARAM Mayhem) 5v5 özel lobi yönetim paneli. Kick canlı yayın sohbetinden sıraya katılın.",
  keywords: [
    "League of Legends",
    "ARAM",
    "Şamata",
    "Queue",
    "Lobby",
    "Kick",
    "Atlas Ata KAHRAMAN",
    "TheAtlas",
  ],
  authors: [
    { name: "Atlas Ata KAHRAMAN", url: "https://github.com/atlasatakahraman" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${newsreader.variable} ${hanken.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
