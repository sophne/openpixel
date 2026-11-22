import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenPixel",
    short_name: "OpenPixel",
    description: "The agentic pixel editor for sprites and voxel worlds. Free and open source, for Mac, Windows and Linux.",
    start_url: "/",
    display: "browser",
    background_color: "#1e1e1e",
    theme_color: "#1e1e1e",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
