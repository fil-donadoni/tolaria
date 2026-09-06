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
        alias: [
            { find: "~", replacement: path.resolve(__dirname, "src") },
            { find: "@", replacement: path.resolve(__dirname, "src") },
            // Client-safe entry: drops the catalogue (~1.63 MB raw) from the
            // main bundle. The full catalogue is in `convex/cards/catalogue.ts`,
            // imported only by pages that need it (deck builder, game board).
            // The exact-regex anchor keeps `@convex/cards/catalogue` and
            // `@convex/cards/types` routing through the normal `@convex` fallback.
            {
                find: /^@convex\/cards$/,
                replacement: path.resolve(__dirname, "convex/cards/client.ts"),
            },
            {
                find: "@convex",
                replacement: path.resolve(__dirname, "convex"),
            },
            // ADR 0113 §2, issue #3053 — the asymmetric delivery of the card
            // catalogue. `convex/cards/compiledPool.ts` imports
            // `data/oracle-compiled-pool.json` at module load, which is right
            // on the SERVER (a Convex mutation cannot fetch) and wrong in a
            // browser: it landed the same ~1.6 MB of card data in BOTH the
            // `card-catalogue` chunk and the `brain.worker` bundle, on every
            // cold load. Swapping the module for an empty array here takes it
            // out of both graphs — `resolve` is shared with the worker build,
            // unlike `plugins` — and the client fetches the merged,
            // content-addressed artifact instead
            // (`src/lib/catalogueArtifact.ts`).
            //
            // The `find` matches the RELATIVE specifier because that is what
            // `convex/cards/catalogue.ts` writes (a `convex/` module cannot
            // use the `@convex` alias — the Convex bundler does not know it).
            // So the alias is only sound while that file is the module's one
            // importer, which is pinned by
            // `scripts/__tests__/compiled-pool-client-seam.test.ts`.
            {
                find: /^\.\/compiledPool$/,
                replacement: path.resolve(
                    __dirname,
                    "src/lib/catalogue/compiled-pool.browser.ts"
                ),
            },
        ],
    },
    build: {
        rollupOptions: {
            output: {
                // Extract the card-catalogue set modules (~1872 definitions,
                // ~1.63 MB raw / 431 KB gzip) into a dedicated chunk so the
                // main bundle drops them. The chunk is cached independently
                // from the app code and is referenced by the catalogue glue
                // module (`convex/cards/catalogue.ts`).
                manualChunks(id) {
                    if (id.includes("convex/cards/sets/")) {
                        return "card-catalogue";
                    }
                },
            },
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
