// Read `run-rollout.mjs blade` files together (issue #10134): per policy,
// the CPU it spends against `base` and the `must` decisions it flips, at
// equal iterations and at equal time.
//
//   node docs/research/scripts/brain-bench/summarize-rollout.mjs <a.jsonl> [<b.jsonl>...]
//
// A forced entry (no rollout in `base`: no search) is left out. A FLIP is an
// entry green under `base` and red under the policy; a FIX the reverse; NET
// is fixes − flips, the entries the policy gains over `base` (at a field
// budget `base` is red on some entries, so a policy can gain). The CPU ratio
// is policy ÷ base on the same entry, p10 / median / p90 over entries;
// `moved` is the share of entries where the policy picks another move than
// `base`.

import { readFileSync } from "node:fs";
import { median, percentile } from "./stats.mjs";

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error("usage: summarize-rollout.mjs <a.jsonl>...");
    process.exit(2);
}
const rows = files
    .flatMap((f) => readFileSync(f, "utf8").split("\n"))
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r) => r.arms.base.counters.rollouts > 0)
    .sort((a, b) => a.index - b.index);

const arms = Object.keys(rows[0]?.arms ?? {}).filter((a) => a !== "base");
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const spread = (values) =>
    `${fmt(percentile(values, 10))} / ${fmt(median(values))} / ${fmt(percentile(values, 90))}`;

const baseRed = rows.filter((r) => !r.arms.base.ok).length;
console.log(
    `${rows.length} searched entries, budget ${[...new Set(rows.map((r) => r.T))].join("/")}; base red: ${baseRed}`
);
console.log(
    "| arm | red | flips | fixes | net | moved | CPU ÷ base p10 / median / p90 | iterations ÷ T median |"
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
console.log(`| base | ${baseRed} | — | — | — | — | — | 1.00 |`);
const flipped = {};
const fixed = {};
for (const arm of arms) {
    const have = rows.filter((r) => r.arms[arm]);
    const red = have.filter((r) => !r.arms[arm].ok);
    const flips = have.filter((r) => r.arms.base.ok && !r.arms[arm].ok);
    const fixes = have.filter((r) => !r.arms.base.ok && r.arms[arm].ok);
    const moved = have.filter((r) => r.arms[arm].move !== r.arms.base.move);
    const cpu = have.map((r) => r.arms[arm].cpuMs / r.arms.base.cpuMs);
    const iters = have.map((r) => r.arms[arm].iterations / r.T);
    flipped[arm] = flips.map((r) => r.label);
    fixed[arm] = fixes.map((r) => r.label);
    const net = fixes.length - flips.length;
    console.log(
        `| ${arm} | ${red.length} | ${flips.length} | ${fixes.length} | ${net > 0 ? "+" : ""}${net} | ${fmt((100 * moved.length) / have.length, 0)}% | ${spread(cpu)} | ${fmt(median(iters))} |`
    );
}
console.log("\nflipped entries per arm:");
for (const arm of arms) {
    if (flipped[arm].length === 0) continue;
    console.log(`- ${arm}: ${flipped[arm].join(" · ")}`);
}
console.log("\nfixed entries per arm:");
for (const arm of arms) {
    if (fixed[arm].length === 0) continue;
    console.log(`- ${arm}: ${fixed[arm].join(" · ")}`);
}
