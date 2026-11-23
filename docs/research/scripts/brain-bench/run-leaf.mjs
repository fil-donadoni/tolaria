// Leaf-parallel search in one thread (issue #10450): the checks, the
// hand-off cost in V8, and the quality of the batch rule on the blade.
//
//   node docs/research/scripts/brain-bench/run-leaf.mjs build <bundle.js>
//   node docs/research/scripts/brain-bench/run-leaf.mjs check <bundle.js> <plain.js> <out.json> \
//        [--positions 0,11,40,54] [--iterations 150] [--field <fixture.json>]...
//   node docs/research/scripts/brain-bench/run-leaf.mjs handoff <bundle.js> <out.json> \
//        [--positions 0,11,40,54] [--iterations 200] [--field <fixture.json>]... [--field-iterations 30]
//   node docs/research/scripts/brain-bench/run-leaf.mjs blade <bundle.js> <out.jsonl> \
//        --arms base,k0s,k2,k3,k4[,k4@time=2.9]... [--budget declared|<N>] [--seeds first|all] \
//        [--every 1] [--slice 1/1]
//
// `check` proves the seam before anything is read off it, on bench positions
// and field boards: the leaf bundle with no hook installed picks the move
// the plain bundle (`build.mjs`) picks; K = 1 grows exactly the tree of
// K = 0 seeded (same settle hash); at K = 2–4 every rollout run from a
// structured clone of the world and from the replayed seed and path returns
// what the coordinator's own world returns (`localExecutor`'s `check`); and a
// fixed (seed, K) repeated gives the same settle hash and move.
//
// `handoff` prints, per position, the per-rollout costs of the two transports
// (`entry-leaf.mjs`'s `handoff`) against the rollout itself.
//
// `blade` runs each sampled `must` entry (its first declared seed, or every
// declared seed) under each arm — no clock: every arm is deterministic:
//   - `base`: today's search, no seam;
//   - `k0s`: the seam at K = 0 — today's search on re-seeded dice, the noise
//     control;
//   - `kN`: N leaves in flight, at the same iterations;
//   - `kN@time=F`: N leaves in flight at F × the iterations, F the measured
//     throughput of N helpers over one Worker (`run-leaf-browsers.mjs`).
// `--budget` sets the iterations: each entry's declared budget, or N for all.

import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleBench } from "./bundle.mjs";
import { median, percentile } from "./stats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [command, bundle, ...rest] = process.argv.slice(2);

if (command === "build" && bundle) {
    mkdirSync(path.dirname(path.resolve(bundle)), { recursive: true });
    await bundleBench(path.join(here, "entry-leaf.mjs"), bundle, {
        leafHook: true,
    });
    console.log(`built ${bundle}`);
    process.exit(0);
}

function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}
function options(name) {
    return rest.flatMap((v, i) => (rest[i - 1] === `--${name}` ? [v] : []));
}
const load = () => Number(loadavg()[0].toFixed(1));
const positionsOpt = () =>
    option("positions", "0,11,40,54").split(",").map(Number);
const fixtures = () =>
    options("field").map((file) => JSON.parse(readFileSync(file, "utf8")));

if (command === "check") {
    const [plainPath, out] = rest.filter(
        (v, i) => !v.startsWith("--") && !rest[i - 1]?.startsWith("--")
    );
    // The plain bundle first: both define `globalThis.__brainBench`.
    await import(pathToFileURL(path.resolve(plainPath)).href);
    const plain = globalThis.__brainBench;
    delete globalThis.__brainBench;
    await import(pathToFileURL(path.resolve(bundle)).href);
    const bench = globalThis.__brainBench;
    const iterations = Number(option("iterations", "150"));
    const fieldIterations = Number(option("field-iterations", "12"));
    const targets = [
        ...positionsOpt().map((i) => ({ kind: "blade", i, iterations })),
        ...fixtures().map((f) => ({
            kind: "field",
            f,
            iterations: fieldIterations,
        })),
    ];
    const rows = [];
    let failures = 0;
    for (const t of targets) {
        const opts = { iterations: t.iterations, seed: 0xb1ade };
        const search = (b, cfg) =>
            t.kind === "blade"
                ? b === plain
                    ? plain.run(t.i, opts)
                    : bench.leaf.run(t.i, opts, cfg)
                : b === plain
                  ? plain.runField(t.f, opts)
                  : bench.leaf.runField(t.f, opts, cfg);
        const p = search(plain);
        const unhooked = search(bench, { K: "base" });
        const k0s = search(bench, { K: 0 });
        const k1 = search(bench, { K: 1 });
        const row = {
            target: t.kind === "blade" ? t.i : t.f.label,
            plainMove: p.move,
            unhookedMove: unhooked.move,
            k0s: { move: k0s.move, settle: k0s.settle },
            k1: { move: k1.move, settle: k1.settle },
            k: {},
        };
        const fail = (why) => {
            failures++;
            row.failures = [...(row.failures ?? []), why];
        };
        if (p.move !== unhooked.move || p.completed !== unhooked.completed) {
            fail("no hook ≠ plain");
        }
        if (k0s.settle.hash !== k1.settle.hash || k0s.move !== k1.move) {
            fail("K=1 ≠ K=0 seeded");
        }
        for (const K of [2, 3, 4]) {
            const checked = search(bench, { K, check: true });
            const again = search(bench, { K });
            const replay = search(bench, { K, transport: "replay" });
            row.k[K] = {
                move: checked.move,
                settle: checked.settle,
                again: again.settle.hash,
                replay: replay.settle.hash,
            };
            if (
                again.settle.hash !== checked.settle.hash ||
                again.move !== checked.move ||
                replay.settle.hash !== checked.settle.hash
            ) {
                fail(`K=${K} not reproducible`);
            }
        }
        rows.push(row);
        process.stderr.write(
            `checked ${row.target}${row.failures ? " FAIL " + row.failures.join("; ") : ""}\n`
        );
    }
    writeFileSync(out, JSON.stringify({ failures, rows }, null, 1));
    console.log(
        `wrote ${out}: ${failures} failure(s) over ${rows.length} targets`
    );
    process.exit(failures === 0 ? 0 : 1);
}

await import(pathToFileURL(path.resolve(bundle)).href);
const bench = globalThis.__brainBench;

if (command === "handoff") {
    const [out] = rest.filter(
        (v, i) => !v.startsWith("--") && !rest[i - 1]?.startsWith("--")
    );
    const iterations = Number(option("iterations", "200"));
    const fieldIterations = Number(option("field-iterations", "30"));
    const rows = [];
    const fold = (r) => {
        const pick = (k) => r.leaves.map((l) => l[k]);
        const q = (k) => ({
            p10: percentile(pick(k), 10),
            median: median(pick(k)),
            p90: percentile(pick(k), 90),
        });
        return {
            label: r.label,
            permanents: r.permanents,
            completed: r.completed,
            leaves: r.leaves.length,
            rootCloneMs: r.rootCloneMs,
            rootBytes: r.rootBytes,
            cloneMs: q("cloneMs"),
            replayMs: q("replayMs"),
            rolloutMs: q("rolloutMs"),
            bytes: q("bytes"),
            pathLength: q("pathLength"),
            load: load(),
        };
    };
    for (const i of positionsOpt()) {
        bench.leaf.handoff(i, iterations); // warm-up
        rows.push({
            kind: "blade",
            index: i,
            ...fold(bench.leaf.handoff(i, iterations)),
        });
        process.stderr.write(`handoff ${i}\n`);
    }
    for (const f of fixtures()) {
        bench.leaf.handoff(f, 6); // warm-up
        rows.push({
            kind: "field",
            ...fold(bench.leaf.handoff(f, fieldIterations)),
        });
        process.stderr.write(`handoff ${f.label}\n`);
    }
    writeFileSync(
        out,
        JSON.stringify({ engine: `node ${process.version}`, rows }, null, 1)
    );
    console.log(`wrote ${out}`);
    process.exit(0);
}

if (command === "blade") {
    const [out] = rest.filter(
        (v, i) => !v.startsWith("--") && !rest[i - 1]?.startsWith("--")
    );
    const arms = option("arms", "base,k0s,k2,k4")
        .split(",")
        .map((name) => {
            if (name === "base") return { name, K: "base", factor: 1 };
            const m = /^k(\d+)(s)?(?:@time=([\d.]+))?$/.exec(name);
            if (!m) throw new Error(`bad arm ${name}`);
            return { name, K: Number(m[1]), factor: m[3] ? Number(m[3]) : 1 };
        });
    const budget = option("budget", "declared");
    const seedsMode = option("seeds", "first");
    const every = Number(option("every", "1"));
    const [sliceIndex, sliceCount] = option("slice", "1/1")
        .split("/")
        .map(Number);
    const jobs = bench.leaf
        .entries()
        .filter((_, i) => i % every === 0)
        .flatMap((e) =>
            (seedsMode === "all"
                ? (e.seeds ?? [0xb1ade])
                : [e.seeds?.[0] ?? 0xb1ade]
            ).map((seed) => ({ ...e, seed }))
        )
        .filter((_, i) => i % sliceCount === sliceIndex - 1);
    writeFileSync(out, "");
    const started = Date.now();
    for (const [j, entry] of jobs.entries()) {
        const T = budget === "declared" ? entry.iterations : Number(budget);
        const row = {
            index: entry.index,
            label: entry.label,
            seed: entry.seed,
            T,
            arms: {},
            load: load(),
        };
        for (const arm of arms) {
            const iterations = Math.max(1, Math.round(T * arm.factor));
            const r = bench.leaf.blade(entry.index, {
                iterations,
                seed: entry.seed,
                K: arm.K,
            });
            row.arms[arm.name] = {
                ok: r.ok,
                move: r.move,
                iterations,
                rollouts: r.settle?.settled ?? null,
            };
        }
        appendFileSync(out, JSON.stringify(row) + "\n");
        process.stderr.write(
            `[${sliceIndex}/${sliceCount}] ${j + 1}/${jobs.length} ${Math.round((Date.now() - started) / 1000)}s\n`
        );
    }
    console.log(`wrote ${out}: ${jobs.length} jobs`);
    process.exit(0);
}

console.error("usage: run-leaf.mjs build|check|handoff|blade …");
process.exit(2);
