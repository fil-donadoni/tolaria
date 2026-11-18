// Where one search's time goes in JavaScriptCore (issue #10123): JSC's own
// sampling profiler over the bench bundle under Bun, folded into the SAME
// buckets as `profile.mjs` (V8) and `profile-gecko.mjs` (SpiderMonkey).
//
//   bun docs/research/scripts/brain-bench/profile-jsc.mjs <bundle.js> <out.json> [--iterations N] [--interval µs] <position>...
//
// A position is a blade index or a field fixture's path (`field-position.mjs`).
// One cold `bun` per position, as `profile.mjs` spawns one cold `node`.
//
// Why `bun:jsc`'s `profile()` and not `bun --cpu-prof`: Bun 1.3.9's
// `.cpuprofile` keeps one sample every ~4 ms at a 500 µs request, each
// weighted by the gap to the previous one (up to 200 ms), so a few samples
// carry most of the time. `profile()` hands back every stack JSC sampled, each
// frame with its JIT tier; at the default 100 µs request JSC takes about one a
// millisecond (it suspends the thread to walk the stack). Every sample weighs
// the SAME, as in JSC's own reports: they come at a steady wall-clock pace,
// and a preempted thread is sampled where it stood.
//
// Only the samples UNDER `searchWithTrace` count; each goes to the INNERMOST
// bucket function on its stack (`buckets.mjs`).
//
// GC: JSC collects concurrently, and its sampler never shows the collector on
// the JS thread's stack. The child runs with `BUN_JSC_logGC=1`; the pauses JSC
// logs (`p=`: time the JS thread was stopped) are summed over the whole run,
// as V8's `gc` is the whole run's collection, and reported as a share of the
// search's wall time beside the buckets.
//
// Tiers: the innermost frame's category — `LLInt` (interpreter), `Baseline`,
// `DFG`, `FTL` (JSC's optimising tiers, in order), `host` (a C++ built-in:
// `Map`, `Set`, `includes`, `copyDataProperties`, …).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    BUCKETS,
    INCLUSIVE,
    SEARCH,
    isBladeIndex,
    parseProfileArgs,
} from "./buckets.mjs";

if (typeof Bun === "undefined") {
    console.error("profile-jsc.mjs runs under bun: it profiles JavaScriptCore");
    process.exit(2);
}

const TIERS = {
    LLInt: "LLInt",
    Baseline: "Baseline",
    DFG: "DFG",
    FTL: "FTL",
};

/** Fold JSC stack traces (innermost frame first) into the buckets. */
function fold(traces) {
    const buckets = Object.fromEntries(
        [...BUCKETS.map(([name]) => name), "other"].map((n) => [n, 0])
    );
    const tiers = Object.fromEntries(
        [...Object.values(TIERS), "host"].map((n) => [n, 0])
    );
    const functions = new Map();
    const inclusive = new Map();
    let total = 0;
    for (const trace of traces) {
        // Cut the stack at the outermost search frame: what calls the search
        // (Bun's module `evaluate`, `profile`) is not the search.
        const outermost = trace.frames.findLastIndex((f) =>
            SEARCH.test(f.name)
        );
        if (outermost === -1) continue;
        const frames = trace.frames.slice(0, outermost + 1);
        total += 1;
        const hit = frames
            .map((f) => BUCKETS.find(([, pattern]) => pattern.test(f.name)))
            .find(Boolean);
        buckets[hit ? hit[0] : "other"] += 1;
        const top = frames[0];
        tiers[TIERS[top.category] ?? "host"] += 1;
        const name = top.name || "(anonymous)";
        functions.set(name, (functions.get(name) ?? 0) + 1);
        const onStack = new Set(frames.map((f) => f.name.replace(/\d+$/, "")));
        for (const fn of INCLUSIVE) {
            if (onStack.has(fn)) {
                inclusive.set(fn, (inclusive.get(fn) ?? 0) + 1);
            }
        }
    }
    const share = (n) => Number(((100 * n) / total).toFixed(1));
    const shares = (record) =>
        Object.fromEntries(
            Object.entries(record).map(([name, n]) => [name, share(n)])
        );
    return {
        samples: total,
        shares: shares(buckets),
        tiers: shares(tiers),
        inclusive: Object.fromEntries(
            INCLUSIVE.map((fn) => [fn, share(inclusive.get(fn) ?? 0)])
        ),
        topSelf: [...functions.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([fn, n]) => ({ name: fn, share: share(n) })),
    };
}

/** The pauses `BUN_JSC_logGC=1` printed: count and milliseconds, by kind. */
function gcPauses(log) {
    const gc = { eden: 0, full: 0, pauseMs: 0 };
    for (const line of log.split("\n")) {
        const m = line.match(/=> (Eden|Full)Collection.* p=([\d.]+)ms/);
        if (!m) continue;
        gc[m[1] === "Eden" ? "eden" : "full"] += 1;
        gc.pauseMs += Number(m[2]);
    }
    gc.pauseMs = Number(gc.pauseMs.toFixed(1));
    return gc;
}

if (process.argv[2] === "--child") {
    const [, , , bundle, position, iterations, interval] = process.argv;
    const { profile } = await import("bun:jsc");
    await import(pathToFileURL(path.resolve(bundle)).href);
    const options = { iterations: Number(iterations), clock: "cpu" };
    let row;
    const result = await profile(
        () => {
            row = isBladeIndex(position)
                ? globalThis.__brainBench.run(Number(position), options)
                : globalThis.__brainBench.runField(
                      JSON.parse(readFileSync(position, "utf8")),
                      options
                  );
        },
        Number(interval)
    );
    console.log(JSON.stringify({ ...row, ...fold(result.stackTraces.traces) }));
    process.exit(0);
}

const argv = process.argv.slice(2);
const intervalAt = argv.indexOf("--interval");
const interval = intervalAt === -1 ? 100 : Number(argv[intervalAt + 1]);
if (intervalAt !== -1) argv.splice(intervalAt, 2);
const {
    bundle,
    out,
    iterations: ITERATIONS,
    positions,
} = parseProfileArgs(argv, "profile-jsc.mjs");

const self = fileURLToPath(import.meta.url);
const results = [];
for (const position of positions) {
    const run = spawnSync(
        process.execPath,
        [
            self,
            "--child",
            bundle,
            position,
            String(ITERATIONS),
            String(interval),
        ],
        {
            encoding: "utf8",
            maxBuffer: 1 << 28,
            env: { ...process.env, BUN_JSC_logGC: "1" },
        }
    );
    if (run.status !== 0) {
        console.error(run.stderr.split("\n").slice(-20).join("\n"));
        process.exit(1);
    }
    const lines = run.stdout.trim().split("\n");
    const row = JSON.parse(lines.findLast((l) => l.startsWith("{")));
    const gc = gcPauses(`${run.stdout}\n${run.stderr}`);
    results.push({
        ...row,
        gc: { ...gc, shareOfWall: Number(((100 * gc.pauseMs) / row.wallMs).toFixed(1)) },
    });
    process.stderr.write(`profiled ${position}\n`);
}

writeFileSync(
    out,
    JSON.stringify(
        {
            runtime: `bun ${Bun.version} (JavaScriptCore)`,
            iterations: ITERATIONS,
            intervalMicros: interval,
            results,
        },
        null,
        1
    )
);
console.log(`wrote ${out}`);
