import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { buildDefine } from "./scripts/lib/build-define";
import { cardSetsDevBundle } from "./scripts/lib/vite-card-sets-dev-bundle";
import { compiledShards } from "./scripts/lib/vite-compiled-shards";
import {
    brainWorkerChunk,
    workerSafePreloadDependencies,
} from "./scripts/lib/vite-brain-worker-chunk";
import {
    cardSetChunkName,
    setChunkName,
    setCodeOf,
} from "./scripts/lib/vite-card-set-chunks";

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
            // catalogue. `convex/cards/compiledPool.ts` imports the packed
            // corpus (`data/catalogue/packed-corpus.json`) at module load,
            // which is right on the SERVER (a Convex mutation cannot fetch)
            // and wrong in a browser bundle: its card data once landed (as
            // the literal pool) in BOTH the `card-catalogue` chunk and the
            // `brain.worker` bundle, on every cold load. Swapping the module
            // for an empty stub here takes it
            // out of both graphs (since issue #5617 the worker is a chunk of
            // this one build) — and the client fetches the compiled corpus as
            // immutable assets instead, decoding a block on first request
            // (`src/lib/catalogueArtifact.ts`, issues #4861, #5616).
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
            // Issue #5615 (PRD #5602, ADR 0113 Amendment V) — the same
            // asymmetry for the HAND-WRITTEN half. `convex/cards/setModules.ts`
            // imports every Set statically, right on the server; in a client
            // graph the swap installs a Set as one lazily imported chunk on
            // demand (`set-chunk-loader.ts`), so a game downloads the Sets of
            // its Definition Manifest and nothing else — in the page and in
            // the Brain worker alike, a chunk of the same build. Sound
            // while `catalogue.ts` is the module's one importer, pinned by
            // `scripts/__tests__/set-modules-client-seam.test.ts`.
            {
                find: /^\.\/setModules$/,
                replacement: path.resolve(
                    __dirname,
                    "src/lib/catalogue/set-modules.browser.ts"
                ),
            },
        ],
    },
    build: {
        // The Brain worker runs chunks of this build (issue #5617, below):
        // a Set chunk's `import()` must not preload through `document`.
        modulePreload: {
            resolveDependencies: workerSafePreloadDependencies,
        },
        rollupOptions: {
            output: {
                // The hand-written Set modules are ONE CHUNK PER SET
                // (`card-set-<code>`, issue #5615), each reached only through
                // the dynamic import in `src/lib/catalogue/set-chunk-loader.ts`
                // — so a game downloads the Sets of its Definition Manifest
                // and a release re-points only the chunks whose Sets changed.
                // Before issue #5615 every Set sat in one `card-catalogue`
                // chunk (~1.63 MB raw / 443 KB gzip) that the catalogue glue
                // imported statically. The asset-graph check keys on the
                // prefix (`scripts/lib/asset-graph.ts` → `SET_CHUNK_PREFIX`).
                // A chunk whose entry is a Set's barrel is named after the
                // Set too, should the bundler ever front a Set chunk with a
                // facade (`index.cards-<hash>.js`): the Set chunk's only
                // static importers stay Set chunks, and the asset-graph check
                // keys on one prefix.
                chunkFileNames: (chunk) => {
                    const set = chunk.facadeModuleId
                        ? setCodeOf(chunk.facadeModuleId)
                        : undefined;
                    return set === undefined
                        ? "assets/[name]-[hash].js"
                        : `assets/${setChunkName(set)}-[hash].js`;
                },
                codeSplitting: {
                    // A group captures ONLY the modules it tests, never their
                    // dependencies (issue #5615). With the default — each
                    // group also captures what its modules import — the first
                    // Set processed swallowed the helpers every Set shares
                    // (`convex/cards/abilities/**`, `gre/protection`, …) AND
                    // the catalogue glue, so one `card-set-*` chunk was the
                    // whole catalogue again. When the Sets were ONE chunk,
                    // turning this off split the shared helpers into a chunk
                    // that imported `card-catalogue` back, and a route could
                    // evaluate a set before its helper existed (issue #4854);
                    // a Set chunk is now reached only through `import()`, so
                    // nothing a helper chunk holds imports a Set chunk back
                    // (`chunksInStaticCycle`, `scripts/check-bundle-size.ts`).
                    // One-way chunk edges:
                    includeDependenciesRecursively: false,
                    //  - `card-registry` claims `convex/cards/registry.ts`
                    //    FIRST (higher priority) so the registry the sets
                    //    import — and the lobby's image helpers read — is
                    //    not absorbed into `card-catalogue`, which would make
                    //    the entry statically import the 475 KB catalogue
                    //    chunk for one `tryGetDefinition`;
                    //  - `card-set-<code>` takes one Set's modules and the
                    //    helpers only that Set reaches (`cardSetChunkName`);
                    //    what two Sets share (`drk` imports a `leg` helper)
                    //    stays in the Set that declares it, imported chunk to
                    //    chunk, and a helper many Sets share sits in a chunk
                    //    of its own that each imports one way.
                    groups: [
                        {
                            name: "card-registry",
                            test: /convex[\\/]cards[\\/]registry\.ts/,
                            priority: 20,
                        },
                        {
                            name: cardSetChunkName,
                            // Every engine module is a candidate; the name
                            // decides, by who imports it.
                            test: /convex[\\/]/,
                            priority: 10,
                        },
                    ],
                },
            },
        },
    },
    plugins: [
        // Issue #5616 (PRD #5602, ADR 0113 Amendment VI) — the COMPILED half
        // of the per-game delivery: the packed corpus is cut into one
        // content-addressed asset per first-printing Set at build time (no
        // second copy committed), plus the shard dictionary and the compiled
        // index; `virtual:compiled-shards` hands their URLs to the client's
        // loader. The dev server serves the same bytes from a middleware.
        compiledShards(),
        // Issue #5617 (PRD #5602, ADR 0113 Amendment VII) — the Brain worker
        // is an entry chunk of THIS build, not a build of its own: its engine
        // chunks, Set chunks and compiled shards are the URLs the page
        // already fetched, so a game against the Bot downloads them once.
        // `virtual:brain-worker-url` hands `brain-client.ts` its URL.
        brainWorkerChunk(),
        // Dev server only (issue #5597): the 1070 Set modules the catalogue
        // imports are served as ONE pre-bundled module instead of 1070
        // revalidated requests per graph — page and Brain worker alike. The
        // build already folds them into `card-catalogue` (below), so this
        // plugin does not run there, nor under vitest.
        cardSetsDevBundle(),
        // Issue #4854 — the same asymmetry as `./compiledPool` above, for the
        // ONE other `convex/` module the entry graph reaches that statically
        // imports the catalogue. `convex/formats.ts` imports `./cards` (the
        // server barrel, set modules included) only for the DEFAULT of
        // `validateDeck`'s `resolve` parameter; the label/id half of that
        // module is what the login page and the lobby read. The browser build
        // swaps the barrel for a late-bound stub
        // (`src/lib/catalogue/deck-card-meta.browser.ts`) that
        // `src/lib/catalogueArtifact.ts` binds to the real resolver once the
        // catalogue loads — so a gated surface keeps today's default, and the
        // lobby, which never loads the catalogue, derives no legality at all
        // (`userDecks.listMine` attaches it server-side). A plugin, not an
        // alias, because the specifier `./cards` is spelled by other
        // `convex/` modules too and only this importer is meant. Pinned by
        // `scripts/__tests__/client-bundle-lazy-routes.test.ts`.
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
