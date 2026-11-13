// Bundle the bench payload into ONE script (issue #9527). The same bytes run
// in every engine, so a difference between two engines is the engine's.
//
//   node docs/research/scripts/brain-bench/build.mjs <out.js>

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = process.argv[2];
if (!outfile) {
    console.error("usage: node build.mjs <out.js>");
    process.exit(2);
}

await build({
    entryPoints: [path.join(here, "entry.mjs")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    // No `keepNames`: its `__name` helper runs at every closure creation and
    // took 5–7% of a search in the profile. Nothing is minified, so function
    // names survive without it — and the app's own Worker chunk has no such
    // helper either.
    outfile,
    logLevel: "warning",
});
console.log(`built ${outfile}`);
