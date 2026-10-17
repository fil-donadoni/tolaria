/**
 * `bun scripts/compiled-client-assets.ts <outDir>` — cut the client's compiled
 * assets (issue #5616, `./lib/compiled-shards.ts`) from the committed inputs
 * into `<outDir>`: `dictionary.json`, `index.json`, one `shard-<key>.json` per
 * first-printing Set, `keys.json` (the shard keys), and `inputs.sha256` — the
 * hash of the bytes it READ, which the plugin checks against the bytes it
 * hashed (`inputsHash`), so a corpus regenerated mid-build is refused rather
 * than emitted under the wrong name.
 *
 * A SEPARATE PROCESS on purpose: the Vite plugin that serves these
 * (`./lib/vite-compiled-shards.ts`) must not import the encoder, which reaches
 * `convex/cards/**` — in `vite.config.ts`'s static closure that put every
 * engine module in "the build configuration", so `check:ui` scoped every
 * engine diff to the full walk (`scripts/lib/ui-scope.ts`).
 */
import { createHash } from "node:crypto";
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
const packed = readFileSync(join(root, PACKED_CORPUS_PATH), "utf8");
const dictionary = readFileSync(join(root, SHARD_DICTIONARY_PATH), "utf8");
const assets = compiledClientAssets(packed, dictionary);
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
writeFileSync(
    join(outDir, "inputs.sha256"),
    createHash("sha256")
        .update(packed)
        .update("\0")
        .update(dictionary)
        .digest("hex")
);
