import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Open Graph images (DESIGN.md § Open Graph images): 1200×630 in Mürekkep with the house faces.
// next/og reads TTF, not WOFF2, so src/app/fonts/og holds static Latin cuts of the same OFL faces.
export const OG_SIZE = { width: 1200, height: 630 };
const INK = { floor: "#131210", text: "#efe9dc", muted: "#a39c8b", gold: "#e9c46a", teal: "#6cc3b6", orange: "#f0a35e" };
const font = (f: string) => readFile(join(process.cwd(), "src/app/fonts/og", f));

// Words come from the label dictionary (the caller translates); the wordmark is the name.
export async function ogImage({ title, teams, foot }: { title?: string; teams?: { a: string; vs: string; b: string }; foot: string }) {
  const [serif, italic, sans] = await Promise.all([font("Newsreader-Display.ttf"), font("Newsreader-DisplayItalic.ttf"), font("HankenGrotesk-Medium.ttf")]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: INK.floor, color: INK.text, fontFamily: "Hanken" }}>
        {/* The wordmark up top when a title takes the middle; home's is the middle. */}
        <div style={{ display: "flex", fontFamily: "Newsreader", fontSize: 44, opacity: title ? 1 : 0 }}>
          TheAtlas&nbsp;<span style={{ fontStyle: "italic", color: INK.gold }}>Queue</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontFamily: "Newsreader", fontSize: title ? 96 : 120, lineHeight: 1.05 }}>
            {title ?? (
              <span style={{ display: "flex" }}>
                TheAtlas&nbsp;<span style={{ fontStyle: "italic", color: INK.gold }}>Queue</span>
              </span>
            )}
          </div>
          {teams && (
            <div style={{ display: "flex", gap: 24, fontFamily: "Newsreader", fontSize: 48 }}>
              <span style={{ color: INK.teal }}>{teams.a}</span>
              <span style={{ color: INK.muted, fontStyle: "italic", fontSize: 36, alignSelf: "center" }}>{teams.vs}</span>
              <span style={{ color: INK.orange }}>{teams.b}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: INK.muted }}>{foot}</div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Newsreader", data: serif, style: "normal", weight: 400 },
        { name: "Newsreader", data: italic, style: "italic", weight: 400 },
        { name: "Hanken", data: sans, style: "normal", weight: 500 },
      ],
    },
  );
}
