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
        // React Compiler runs through Babel. Scope it to `src/` — the plugin's
        // default `include` is "every .ts/.tsx", and the preset's own filter
        // (`code: /\b[A-Z]|\buse/`) matches almost any file, so without this
        // Babel also parses the `convex/` engine modules the frontend imports
        // (ADR 0074). Those have no components or hooks, so the work is pure
        // waste — and the two biggest (`gre/state.ts`, `cards/types.ts`) blow
        // past Babel's 500 KB code-generator limit and log a deopt notice on
        // every build.
        babel({
            include: [/[\\/]src[\\/].*\.[jt]sx?(?:$|\?)/],
            exclude: [/[\\/]node_modules[\\/]/],
            presets: [reactCompilerPreset()],
        } as Parameters<typeof babel>[0]),
    ],
});
