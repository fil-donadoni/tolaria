import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
    // PROTOTYPE (/prototype/board): proxy Scryfall through the dev origin so
    // the WebGL variant can upload textures. The cross-origin CDN + the
    // card-image service worker otherwise yield opaque responses that taint
    // WebGL. Remove together with the prototype.
    server: {
        proxy: {
            "/scryfall-proxy": {
                target: "https://cards.scryfall.io",
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/scryfall-proxy/, ""),
            },
        },
    },
    resolve: {
        alias: {
            "~": path.resolve(__dirname, "src"),
            "@": path.resolve(__dirname, "src"),
            "@convex": path.resolve(__dirname, "convex"),
        },
    },
    plugins: [
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] } as Parameters<
            typeof babel
        >[0]),
    ],
});
