// Bundle the bench payload into ONE script (issue #9527). The same bytes run
// in every engine, so a difference between two engines is the engine's.
//
//   node docs/research/scripts/brain-bench/build.mjs <out.js>

import { fileURLToPath } from "node:url";
import path from "node:path";
import { bundleBench } from "./bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = process.argv[2];
if (!outfile) {
    console.error("usage: node build.mjs <out.js>");
    process.exit(2);
}

await bundleBench(path.join(here, "entry.mjs"), outfile);
console.log(`built ${outfile}`);
