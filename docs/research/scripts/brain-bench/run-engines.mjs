// The Brain lab bench under a JS runtime with a CPU clock (issue #9527):
// Node is V8, Bun is JavaScriptCore.
//
//   node docs/research/scripts/brain-bench/run-engines.mjs <bundle.js> <out.json>
//   bun  docs/research/scripts/brain-bench/run-engines.mjs <bundle.js> <out.json>
//
// Two phases, both on the process CPU clock so machine load does not move
// them:
//
//   cost   every position searched ONCE at the default preset's iteration
//          count with no time cap: what a full-budget decision costs here.
//   curve  every position searched at each preset's real budget (iterations
//          AND time cap) on a clock running K times faster, for each K: what a
//          device K times slower than this core completes.

import { writeFileSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [bundle, out] = process.argv.slice(2);
if (!bundle || !out) {
    console.error("usage: run-engines.mjs <bundle.js> <out.json>");
    process.exit(2);
}

await import(pathToFileURL(path.resolve(bundle)).href);
const bench = globalThis.__brainBench;

const SCALES = [1, 2, 4, 6, 10, 20];
const PRESETS = ["medium", "expert"];
const runtime =
    typeof Bun !== "undefined"
        ? `bun ${Bun.version} (JavaScriptCore)`
        : `node ${process.version} (V8 ${process.versions.v8})`;

const load = () => Number(loadavg()[0].toFixed(2));

// Warm the JIT the way a game does before its first hard decision: a Worker
// has answered a few consults by then. Discarded.
for (const index of [0, 1, 3, 4]) {
    bench.run(index, { iterations: 200, clock: "cpu" });
}

const started = Date.now();
const cost = [];
for (let index = 0; index < bench.count; index++) {
    const row = bench.run(index, {
        iterations: bench.budgets.expert.iterations,
        clock: "cpu",
    });
    cost.push({ ...row, load: load() });
    process.stderr.write(`cost ${index + 1}/${bench.count}\r`);
}

const curve = [];
for (const preset of PRESETS) {
    const budget = bench.budgets[preset];
    for (const scale of SCALES) {
        for (let index = 0; index < bench.count; index++) {
            const row = bench.run(index, {
                iterations: budget.iterations,
                timeMs: budget.timeMs,
                clock: "cpu",
                scale,
            });
            curve.push({ preset, scale, ...row, load: load() });
        }
        process.stderr.write(`curve ${preset} x${scale}        \r`);
    }
}

writeFileSync(
    out,
    JSON.stringify(
        {
            runtime,
            cpu: cpus()[0]?.model ?? "unknown",
            cores: cpus().length,
            seconds: Math.round((Date.now() - started) / 1000),
            budgets: bench.budgets,
            scales: SCALES,
            cost,
            curve,
        },
        null,
        1
    )
);
console.log(`\n${runtime}: wrote ${out}`);
