import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "The Gathering",
    short_name: "The Gathering",
    description: "The Gathering church community app.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F4ED",
    theme_color: "#F7F4ED",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
