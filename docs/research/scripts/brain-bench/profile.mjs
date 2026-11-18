// Where one search's time goes (issue #9527): a V8 CPU profile of the bundle
// searching one position, folded into five buckets.
//
//   node docs/research/scripts/brain-bench/profile.mjs <bundle.js> <out.json> [--iterations N] <position>...
//
// A position is a blade index, or the path of a field fixture
// (`field-position.mjs`, issue #10122). `profile-gecko.mjs` folds a Firefox
// profile into the same buckets (`buckets.mjs`).
//
// Only the samples UNDER `searchWithTrace` count: loading the bundle and
// building the position are not the search. Each sample goes to the INNERMOST
// enclosing bucket function on its stack, so the buckets partition the search:
// a clone made while enumerating moves is cloning, not enumeration.
//
// The buckets and their meaning: `buckets.mjs`.
//
// The shares are sampled, so they hold under machine load: a preempted thread
// is sampled where it stood.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    BUCKETS,
    INCLUSIVE,
    SEARCH,
    inclusiveAll,
    isBladeIndex,
    parseProfileArgs,
} from "./buckets.mjs";

if (process.argv[2] === "--child") {
    const [, , , bundle, position, iterations] = process.argv;
    await import(pathToFileURL(path.resolve(bundle)).href);
    const options = { iterations: Number(iterations), clock: "cpu" };
    const row = isBladeIndex(position)
        ? globalThis.__brainBench.run(Number(position), options)
        : globalThis.__brainBench.runField(
              JSON.parse(readFileSync(position, "utf8")),
              options
          );
    console.log(JSON.stringify(row));
    process.exit(0);
}

const {
    bundle,
    out,
    iterations: ITERATIONS,
    positions: indexes,
} = parseProfileArgs(process.argv.slice(2), "profile.mjs");

function fold(profile) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const node of profile.nodes) {
        for (const child of node.children ?? []) parent.set(child, node.id);
    }
    const self = new Map();
    profile.samples.forEach((id, i) => {
        self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
    });

    const buckets = Object.fromEntries(
        [...BUCKETS.map(([name]) => name), "gc", "other"].map((n) => [n, 0])
    );
    const functions = new Map();
    const inclusive = new Map();
    const everyInclusive = new Map();
    let total = 0;
    for (const [id, micros] of self) {
        const name = byId.get(id).callFrame.functionName || "(anonymous)";
        // Walk to the root once: is this sample inside the search, and what
        // is the innermost bucket function on the way?
        if (name === "(garbage collector)") {
            buckets.gc += micros;
            total += micros;
            continue;
        }
        let inSearch = false;
        let bucket = null;
        const onStack = new Set();
        for (let at = id; at !== undefined; at = parent.get(at)) {
            const fn = byId.get(at).callFrame.functionName;
            if (bucket === null) {
                const hit = BUCKETS.find(([, pattern]) => pattern.test(fn));
                if (hit) bucket = hit[0];
            }
            onStack.add(fn.replace(/\d+$/, ""));
            if (SEARCH.test(fn)) inSearch = true;
        }
        if (!inSearch) continue;
        total += micros;
        buckets[bucket ?? "other"] += micros;
        functions.set(name, (functions.get(name) ?? 0) + micros);
        for (const fn of INCLUSIVE) {
            if (onStack.has(fn)) {
                inclusive.set(fn, (inclusive.get(fn) ?? 0) + micros);
            }
        }
        for (const fn of onStack) {
            everyInclusive.set(fn, (everyInclusive.get(fn) ?? 0) + micros);
        }
    }
    const share = (micros) => Number(((100 * micros) / total).toFixed(1));
    return {
        searchMs: Math.round(total / 1000),
        shares: Object.fromEntries(
            Object.entries(buckets).map(([name, micros]) => [
                name,
                share(micros),
            ])
        ),
        inclusive: Object.fromEntries(
            INCLUSIVE.map((fn) => [fn, share(inclusive.get(fn) ?? 0)])
        ),
        inclusiveAll: inclusiveAll(everyInclusive, share),
        topSelf: [...functions.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([name, micros]) => ({ name, share: share(micros) })),
    };
}

const self = fileURLToPath(import.meta.url);
const results = [];
for (const index of indexes) {
    const dir = mkdtempSync(path.join(tmpdir(), "brain-prof-"));
    const run = spawnSync(
        process.execPath,
        [
            "--cpu-prof",
            `--cpu-prof-dir=${dir}`,
            "--cpu-prof-interval=500",
            self,
            "--child",
            bundle,
            index,
            String(ITERATIONS),
        ],
        { encoding: "utf8", maxBuffer: 1 << 26 }
    );
    if (run.status !== 0) {
        console.error(run.stderr);
        process.exit(1);
    }
    const file = readdirSync(dir).find((f) => f.endsWith(".cpuprofile"));
    const profile = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    const row = JSON.parse(run.stdout.trim().split("\n").pop());
    results.push({ ...row, ...fold(profile) });
    process.stderr.write(`profiled ${index}\n`);
}

writeFileSync(
    out,
    JSON.stringify({ iterations: ITERATIONS, results }, null, 1)
);
console.log(`wrote ${out}`);
