// Totals of the structural gold harness over the hand-written catalogue.
//
//   bun docs/research/scripts/capability-derivation/gold-stats.mjs /tmp/gold.json
import { getAllRawCards } from "../../../../convex/cards/catalogue";
import { runGoldHarness } from "../../../../convex/oracle/gold";
import { writeFileSync } from "node:fs";
const r = runGoldHarness(getAllRawCards());
const { mismatches, incomparable, ...rest } = r;
console.log(JSON.stringify(rest, null, 1).slice(0, 3000));
console.log(
    "mismatches",
    mismatches?.length,
    "incomparable",
    incomparable?.length
);
writeFileSync(
    process.argv[2],
    JSON.stringify({ mismatches, incomparable }, null, 1)
);
let T = { total: 0, accepted: 0, equal: 0, incomparable: 0 };
for (const b of Object.values(r.buckets))
    for (const k of Object.keys(T)) T[k] += b[k];
console.log("TOTAL", T);
