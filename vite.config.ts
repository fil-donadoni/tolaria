import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { buildDefine } from "./scripts/lib/build-define";

// https://vite.dev/config/
export default defineConfig({
    // Build identity, stamped into the bundle so a bug report can say WHICH
    // BUILD produced it (issue #3256). Shared with `vitest.config.ts` so the
    // guarding test sees the same substitution the shipped bundle does.
    define: buildDefine(),
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
                codeSplitting: {
                    // OFF on purpose (issue #4854). By default a group also
                    // swallows every module its members import, so
                    // `convex/cards/registry.ts` — which the sets import and
                    // the lobby's image helpers read — was absorbed into
                    // `card-catalogue`, and the entry statically imported the
                    // 475 KB catalogue chunk for one `tryGetDefinition`. With
                    // it off the chunk holds the set modules and nothing else;
                    // what they share stays a plain shared chunk.
                    includeDependenciesRecursively: false,
                    groups: [
                        {
                            name: "card-catalogue",
                            test: /convex[\\/]cards[\\/]sets[\\/]/,
                        },
                        // The rules engine, named so the built-asset-graph
                        // guard can say "no engine chunk is reachable from
                        // the login page or the lobby"
                        // (`scripts/__tests__/client-bundle-lazy-routes.test.ts`).
                        // The two leaves the lobby chrome reads stay out:
                        // they import nothing from the engine.
                        {
                            name: "engine",
                            test: /convex[\\/]gre[\\/](?!manaColors\.ts|difficulty\.ts)/,
                        },
                    ],
                },
            },
        },
    },
    plugins: [
        // Issue #4854 — the same asymmetry as `./compiledPool` above, for the
        // ONE other `convex/` module the entry graph reaches that statically
        // imports the catalogue. `convex/formats.ts` imports `./cards` (the
        // server barrel, set modules included) only for the DEFAULT of
        // `validateDeck`'s `resolve` parameter; the label/id half of that
        // module is what the login page and the lobby read. Every client
        // caller of `validateDeck` injects its own resolver, so the browser
        // build swaps the barrel for a stub that refuses to be called. A
        // plugin, not an alias, because the specifier `./cards` is spelled
        // by other `convex/` modules too and only this importer is meant.
        // Pinned by `scripts/__tests__/client-bundle-lazy-routes.test.ts`.
        {
            name: "formats-cards-browser-seam",
            enforce: "pre",
            resolveId(source, importer) {
                if (
                    source === "./cards" &&
                    importer !== undefined &&
                    importer
                        .replaceAll("\\", "/")
                        .endsWith("/convex/formats.ts")
                ) {
                    return path.resolve(
                        __dirname,
                        "src/lib/catalogue/deck-card-meta.browser.ts"
                    );
                }
                return null;
            },
        },
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
