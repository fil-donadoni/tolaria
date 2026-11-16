// The bench bundle's esbuild options, in ONE place (issue #9527, issue
// #10023): `build.mjs` bundles the working tree with them and `compare.mjs`
// bundles a base and a head with them, so every bundle the bench reads was
// built the same way.

import { build } from "esbuild";

/** Bundle `entry` (an `entry.mjs`) into the single script `outfile`. */
export async function bundleBench(entry, outfile) {
    await build({
        entryPoints: [entry],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2022",
        // No `keepNames`: its `__name` helper runs at every closure creation
        // and took 5–7% of a search in the profile. Nothing is minified, so
        // function names survive without it — and the app's own Worker chunk
        // has no such helper either.
        outfile,
        logLevel: "warning",
    });
}
