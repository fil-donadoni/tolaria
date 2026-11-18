// Root-parallel quality (issue #10135): what a merged ensemble of N trees
// keeps of blade `must`, against one tree at the per-tree budget and at the
// ensemble's total.
//
//   node docs/research/scripts/brain-bench/run-ensemble.mjs build <bundle.js>
//   node docs/research/scripts/brain-bench/run-ensemble.mjs run <bundle.js> <out.jsonl> \
//        [--tier must] [--budgets 200,300,400] [--every 4] [--slice 1/4] [--repeat 5]
//        [--per-tree B]
//
// Each sampled entry, at its first declared seed and its declared budget T,
// runs five arms, all iterations-only (deterministic, no clock):
//
//   1x(T/4)  1x(T/2)  1x(T)    — one tree
//   2x(T/2)  4x(T/4)           — N trees merged at the root, N·(T/N) = T
//
// so an N-tree ensemble is read against one tree at the SAME TOTAL (1x(T),
// which passes by construction: T is the budget the entry is proven at) and
// against ONE of its own trees (1x(T/N)) — what a single Worker would have
// found in the same wall-clock time. Every `--repeat`-th job re-runs its
// ensemble arms: a fixed (seed, N) must reproduce its move.
//
// `--per-tree B` fixes the budget PER TREE instead — the iterations one
// Worker completes under the field's clock (`blade-at-field-budgets.md`: 71 in
// Gecko, 200 in WebKit, 313 in Chromium) — and asks what more Workers buy:
//
//   1x(B)  1x(2B)  1x(4B)      — one tree, at one, two, four Workers' worth
//   2x(B)  4x(B)               — two and four Workers, merged at the root
//   split2x(B)  split4x(B)     — the same Workers, each searching its own
//                                share of the root candidates (a root split)
//
// Every entry runs 1x(B), 4x(B) and both splits; 1x(2B), 1x(4B) and 2x(B)
// only where 1x(B) or 4x(B) is red (an entry green at both is where four
// copies neither win nor lose anything; one green at 1x(B) and red only at
// 2x(B) is not looked for). `--arms a,b` runs only the arms named.
//
// `--slice i/n` runs every n-th job from the i-th, so n processes share the
// sample; `summarize-ensemble.mjs` reads their files together.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleBench } from "./bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, bundle, out, ...rest] = process.argv.slice(2);

if (command === "build" && bundle) {
    mkdirSync(path.dirname(path.resolve(bundle)), { recursive: true });
    await bundleBench(path.join(here, "entry-ensemble.mjs"), bundle, {
        rootHook: true,
    });
    console.log(`built ${bundle}`);
    process.exit(0);
}
if (command !== "run" || !bundle || !out) {
    console.error(
        "usage: run-ensemble.mjs build <bundle.js> | run <bundle.js> <out.jsonl> [options]"
    );
    process.exit(2);
}

function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}
const tier = option("tier", "must");
const budgets = new Set(
    option("budgets", "200,300,400").split(",").map(Number)
);
const every = Number(option("every", "4"));
const [sliceIndex, sliceCount] = option("slice", "1/1").split("/").map(Number);
const repeat = Number(option("repeat", "5"));
const perTree = option("per-tree", null);
const only = option("arms", null)?.split(",") ?? null;

await import(pathToFileURL(path.resolve(bundle)).href);
const { ensemble } = globalThis.__brainBench;
const DEFAULT_SEED = 0xb1ade;

const sample = ensemble
    .entries(tier)
    .filter((e) => perTree !== null || budgets.has(e.iterations))
    .filter((_, i) => i % every === 0);
const jobs = sample.filter((_, i) => i % sliceCount === sliceIndex - 1);

const PER_TREE_ARMS = (B) => [
    { arm: "1x(B)", n: 1, iterations: B, always: true },
    { arm: "4x(B)", n: 4, iterations: B, always: true },
    { arm: "1x(2B)", n: 1, iterations: 2 * B },
    { arm: "1x(4B)", n: 1, iterations: 4 * B },
    { arm: "2x(B)", n: 2, iterations: B },
    { arm: "split2x(B)", n: 2, iterations: B, split: true, always: true },
    { arm: "split4x(B)", n: 4, iterations: B, split: true, always: true },
];
const ARMS = (T) => [
    { arm: "1x(T/4)", n: 1, iterations: T / 4 },
    { arm: "1x(T/2)", n: 1, iterations: T / 2 },
    { arm: "1x(T)", n: 1, iterations: T },
    { arm: "2x(T/2)", n: 2, iterations: T / 2 },
    { arm: "4x(T/4)", n: 4, iterations: T / 4 },
];

writeFileSync(out, "");
const started = Date.now();
for (const [j, entry] of jobs.entries()) {
    const seed = entry.seeds?.[0] ?? DEFAULT_SEED;
    const row = {
        tier,
        index: entry.index,
        label: entry.label,
        T: entry.iterations,
        mode: perTree === null ? "total" : "per-tree",
        B: perTree === null ? null : Number(perTree),
        seed,
        arms: {},
        load: Number(loadavg()[0].toFixed(1)),
    };
    const arms =
        perTree === null
            ? ARMS(entry.iterations)
            : PER_TREE_ARMS(Number(perTree));
    for (const a of arms) {
        if (only && !only.includes(a.arm)) continue;
        if (
            !a.always &&
            perTree !== null &&
            row.arms["1x(B)"]?.ok &&
            row.arms["4x(B)"]?.ok
        ) {
            continue;
        }
        const t0 = process.cpuUsage();
        const r = ensemble.blade(tier, entry.index, {
            iterations: a.iterations,
            n: a.n,
            seed,
            split: a.split,
        });
        const t = process.cpuUsage(t0);
        row.arms[a.arm] = { ...r, cpuMs: (t.user + t.system) / 1000 };
        if (a.n > 1 && j % repeat === 0) {
            const again = ensemble.blade(tier, entry.index, {
                iterations: a.iterations,
                n: a.n,
                seed,
                split: a.split,
            });
            row.arms[a.arm].repeatMove = again.move;
        }
    }
    appendFileSync(out, JSON.stringify(row) + "\n");
    process.stderr.write(
        `[${sliceIndex}/${sliceCount}] ${j + 1}/${jobs.length} ${Math.round((Date.now() - started) / 1000)}s\n`
    );
}
console.log(`wrote ${out}: ${jobs.length} entries`);
