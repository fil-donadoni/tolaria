// Where one search's time goes (issue #9527): a V8 CPU profile of the bundle
// searching one position, folded into five buckets.
//
//   node docs/research/scripts/brain-bench/profile.mjs <bundle.js> <out.json> <index>...
//
// Only the samples UNDER `searchWithTrace` count: loading the bundle and
// building the position are not the search. Each sample goes to the INNERMOST
// enclosing bucket function on its stack, so the buckets partition the search:
// a clone made while enumerating moves is cloning, not enumeration.
//
//   clone        cloneGameState / cloneValue — copying the state
//   determinize  determinize — sampling the hidden cards
//   enumerate    enumerateMoves — the legal moves
//   apply        applyMoveInSearch / applyMoveForSearch — a move through the
//                real engine (resolution, state-based actions, triggers, layers)
//   evaluate     evaluate — the leaf heuristic
//   gc           the garbage collector. V8 reports it outside any stack, so
//                this is the whole run's collection, charged to the search
//   other        the search loop itself and everything not named above
//
// The shares are sampled, so they hold under machine load: a preempted thread
// is sampled where it stood.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ITERATIONS = 1320;

if (process.argv[2] === "--child") {
    const [, , , bundle, index] = process.argv;
    await import(pathToFileURL(path.resolve(bundle)).href);
    const row = globalThis.__brainBench.run(Number(index), {
        iterations: ITERATIONS,
        clock: "cpu",
    });
    console.log(JSON.stringify(row));
    process.exit(0);
}

const [bundle, out, ...indexes] = process.argv.slice(2);
if (!bundle || !out || indexes.length === 0) {
    console.error("usage: profile.mjs <bundle.js> <out.json> <index>...");
    process.exit(2);
}

const BUCKETS = [
    ["clone", /^(cloneGameState|cloneValue)\d*$/],
    ["determinize", /^determinize\d*$/],
    ["enumerate", /^enumerateMoves\d*$/],
    ["apply", /^(applyMoveInSearch|applyMoveForSearch)\d*$/],
    ["evaluate", /^evaluate\d*$/],
];
const SEARCH = /^searchWithTrace\d*$/;

/** Engine functions worth an INCLUSIVE share of their own: everything that
 *  ran while one of them was on the stack. These overlap each other and the
 *  buckets; they say what a rewrite of one piece could at most win back. */
const INCLUSIVE = [
    "cloneValue",
    "enumerateMoves",
    "getLegalActions",
    "applyMoveInSearch",
    "checkStateBasedActions",
    "collectTriggers",
    "deriveBoardWithSources",
    "evaluate",
    "determinize",
];

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
