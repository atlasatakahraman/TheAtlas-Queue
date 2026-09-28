import "server-only";
import { translate } from "@/lib/i18n";
import { OG_SIZE, ogImage } from "@/lib/server/og";

export const alt = "TheAtlas Queue";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogImage({ foot: translate("en", "home.tagline") });
}
