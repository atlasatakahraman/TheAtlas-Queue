import "server-only";
import type { Metadata } from "next";
import { OverlayView } from "@/components/overlay/overlay-view";
import { overlaySnapshot } from "@/lib/server/overlay";

type Props = { params: Promise<{ key: string }> };

// Never indexed; the key is the page's secret, so the title names nothing.
export const metadata: Metadata = { title: "Overlay", robots: { index: false, follow: false } };

// /overlay/<key> (DESIGN.md § /overlay/<key>): an OBS browser source. An unknown or rotated key
// renders transparent and empty, never an error on stream.
export default async function OverlayPage({ params }: Props) {
  const { key } = await params;
  const snap = await overlaySnapshot(key);
  return <OverlayView overlayKey={key} initial={snap} />;
}
