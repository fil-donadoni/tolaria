/**
 * `bun scripts/compiled-client-assets.ts <outDir>` — cut the client's compiled
 * assets (issue #5616, `./lib/compiled-shards.ts`) from the committed inputs
 * into `<outDir>`: `dictionary.json`, `index.json`, one `shard-<key>.json` per
 * first-printing Set, then `keys.json` (the shard keys) LAST, as the marker
 * that the cut is complete.
 *
 * A SEPARATE PROCESS on purpose: the Vite plugin that serves these
 * (`./lib/vite-compiled-shards.ts`) must not import the encoder, which reaches
 * `convex/cards/**` — in `vite.config.ts`'s static closure that put every
 * engine module in "the build configuration", so `check:ui` scoped every
 * engine diff to the full walk (`scripts/lib/ui-scope.ts`).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    PACKED_CORPUS_PATH,
    SHARD_DICTIONARY_PATH,
} from "./lib/compiled-asset-inputs";
import { compiledClientAssets } from "./lib/compiled-shards";

const outDir = process.argv[2];
if (!outDir) {
    console.error("usage: bun scripts/compiled-client-assets.ts <outDir>");
    process.exit(2);
}
const root = join(import.meta.dir, "..");
const assets = compiledClientAssets(
    readFileSync(join(root, PACKED_CORPUS_PATH), "utf8"),
    readFileSync(join(root, SHARD_DICTIONARY_PATH), "utf8")
);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "dictionary.json"), assets.dictionary);
writeFileSync(join(outDir, "index.json"), assets.index);
for (const [key, json] of assets.shards) {
    writeFileSync(join(outDir, `shard-${key}.json`), json);
}
writeFileSync(
    join(outDir, "keys.json"),
    JSON.stringify([...assets.shards.keys()])
);
