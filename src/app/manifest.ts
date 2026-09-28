import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TheAtlas Queue",
    short_name: "Queue",
    start_url: "/",
    display: "standalone",
    background_color: "#131210",
    theme_color: "#131210",
    icons: [
      { src: "/TheAtlasW2048.png", sizes: "2048x2048", type: "image/png" },
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
  };
}
