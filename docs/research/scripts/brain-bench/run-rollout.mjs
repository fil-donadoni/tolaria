// Rollout-policy cost and quality (issue #10134): what a cheaper greedy pick
// buys in CPU per iteration and loses in blade `must` decisions.
//
//   node docs/research/scripts/brain-bench/run-rollout.mjs build <bundle.js>
//   node docs/research/scripts/brain-bench/run-rollout.mjs counts <bundle.js> <out.json> \
//        [--iterations 400] [--policy base] [--field <fixture.json>]...
//   node docs/research/scripts/brain-bench/run-rollout.mjs speed <bundle.js> <out.json> \
//        --field <fixture.json> --policies base,topk:3,... [--iterations 20] [--rounds 2]
//   node docs/research/scripts/brain-bench/run-rollout.mjs blade <bundle.js> <out.jsonl> \
//        --policies base,topk:3,... [--budget declared|<N>] [--every 1] [--slice 1/1]
//        [--time-factors topk:3=1.8,...]
//
// `counts` searches every bench position (`entry.mjs`: the first 60 `must`
// entries) and each `--field` fixture once under one policy and prints the
// rollout counters: plies per rollout, candidates per played ply, greedy
// picks per iteration and their candidates (the probes), the memo key's
// recurrence under `memo-count`.
//
// `speed` searches one field fixture under every policy at a fixed iteration
// count on the process CPU clock, in interleaved rounds (the order rotating,
// one warm-up round discarded): the policy's CPU per iteration on a board the
// field Bot actually meets, paired with `base` round by round.
//
// `blade` runs each sampled `must` entry at its first declared seed (no
// clock: every arm is deterministic) under every policy at the SAME
// iterations — the declared budget, or `--budget N` for all (a field
// budget, `blade-at-field-budgets.md`) — then every non-base policy again at
// EQUAL TIME: the iterations it completes in the CPU time `base` would spend
// on the whole budget (T × base's CPU per COMPLETED iteration ÷ the
// policy's: a search stops early once its root is settled, so total CPU is
// not the measure; at most 20× the budget). The CPU includes the entry's
// build, which pulls the factor towards 1. Both CPU times are read in the same process, back to back,
// after one untimed warm-up search of the entry (an entry's first search runs
// 10–60% slower: its cards' code paths are cold), in an order that rotates
// by job so no policy always runs first.
// `--time-factors` fixes a policy's factor instead — the speed-up measured on
// FIELD boards (`fieldspeed`, the note § 1), where the field budget is spent:
// a blade board's few probes understate what a cheaper policy buys there.
// `--slice i/n` runs every n-th job from the i-th; `summarize-rollout.mjs`
// reads the files together.

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
const [command, bundle, out, ...rest] = process.argv.slice(2);

if (command === "build" && bundle) {
    mkdirSync(path.dirname(path.resolve(bundle)), { recursive: true });
    await bundleBench(path.join(here, "entry-rollout.mjs"), bundle, {
        rolloutHook: true,
    });
    console.log(`built ${bundle}`);
    process.exit(0);
}
if (!["counts", "speed", "blade"].includes(command) || !bundle || !out) {
    console.error(
        "usage: run-rollout.mjs build <bundle.js> | counts <bundle.js> <out.json> [options] | blade <bundle.js> <out.jsonl> [options]"
    );
    process.exit(2);
}

function option(name, fallback) {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? fallback : rest[i + 1];
}
function options(name) {
    return rest.flatMap((v, i) => (rest[i - 1] === `--${name}` ? [v] : []));
}

await import(pathToFileURL(path.resolve(bundle)).href);
const bench = globalThis.__brainBench;
const DEFAULT_SEED = 0xb1ade;
const MAX_EQUAL_TIME_FACTOR = 20;

const cpuMs = (t0) => {
    const t = process.cpuUsage(t0);
    return (t.user + t.system) / 1000;
};

/** One search's counters, folded to the numbers the note reads. */
function summarize(c) {
    return {
        rollouts: c.rollouts,
        pliesMedian: c.plies.length ? median(c.plies) : null,
        pliesP90: c.plies.length ? percentile(c.plies, 90) : null,
        pliesMax: c.plies.length ? Math.max(...c.plies) : null,
        pliesMean: c.rollouts
            ? (c.forcedPlies + c.playedPlies) / c.rollouts
            : null,
        forcedPlies: c.forcedPlies,
        playedPlies: c.playedPlies,
        candidatesPerPlayedPly: c.playedPlies
            ? c.playedCandidates / c.playedPlies
            : null,
        greedyPicks: c.greedyPicks,
        probes: c.greedyCandidates,
        candidatesPerGreedyPick: c.greedyPicks
            ? c.greedyCandidates / c.greedyPicks
            : null,
        probesSkipped: c.probesSkipped,
        memoKeys: c.memoKeys,
        memoExactHits: c.memoExactHits,
        memoPublicHits: c.memoPublicHits,
        memoServed: c.memoServed,
    };
}

if (command === "counts") {
    const iterations = Number(option("iterations", "400"));
    const policy = option("policy", "base");
    const rows = [];
    const searchOptions = { iterations, clock: "cpu" };
    for (let i = 0; i < bench.count; i++) {
        const r = bench.rollout.run(i, searchOptions, policy);
        rows.push({ ...r, counters: summarize(r.counters) });
        process.stderr.write(`counted ${i}\n`);
    }
    for (const file of options("field")) {
        const fixture = JSON.parse(readFileSync(file, "utf8"));
        const r = bench.rollout.runField(fixture, searchOptions, policy);
        rows.push({ ...r, counters: summarize(r.counters) });
        process.stderr.write(`counted ${fixture.label}\n`);
    }
    writeFileSync(out, JSON.stringify({ iterations, policy, rows }, null, 1));
    console.log(`wrote ${out}: ${rows.length} positions`);
    process.exit(0);
}

if (command === "speed") {
    const fixture = JSON.parse(readFileSync(option("field"), "utf8"));
    const iterations = Number(option("iterations", "20"));
    const rounds = Number(option("rounds", "2"));
    const list = option("policies", "base").split(",");
    const rows = [];
    for (let round = 0; round <= rounds; round++) {
        const order = list.map((_, i) => list[(i + round) % list.length]);
        for (const policy of order) {
            const t0 = process.cpuUsage();
            const r = bench.rollout.runField(
                fixture,
                { iterations, clock: "cpu" },
                policy
            );
            rows.push({
                round,
                policy,
                completed: r.completed,
                // The search's own CPU (`entry.mjs`), the fixture's
                // expansion left out.
                cpuMs: r.cpuMs ?? cpuMs(t0),
                move: r.move,
                counters: summarize(r.counters),
            });
        }
        process.stderr.write(`speed round ${round + 1}/${rounds + 1}\n`);
    }
    const ratios = Object.fromEntries(
        list.slice(1).map((policy) => {
            const per = [];
            for (let round = 1; round <= rounds; round++) {
                const at = (p) =>
                    rows.find((r) => r.round === round && r.policy === p);
                const b = at("base");
                const h = at(policy);
                per.push(h.cpuMs / h.completed / (b.cpuMs / b.completed));
            }
            return [policy, median(per)];
        })
    );
    writeFileSync(
        out,
        JSON.stringify(
            { field: fixture.label, iterations, rounds, ratios, rows },
            null,
            1
        )
    );
    console.log(JSON.stringify({ field: fixture.label, ratios }));
    process.exit(0);
}

const policies = option("policies", "base").split(",");
if (policies[0] !== "base") {
    console.error("blade: --policies must start with base");
    process.exit(2);
}
const budget = option("budget", "declared");
const timeFactors = Object.fromEntries(
    (option("time-factors", "") || "")
        .split(",")
        .filter(Boolean)
        .map((pair) => {
            const at = pair.lastIndexOf("=");
            return [pair.slice(0, at), Number(pair.slice(at + 1))];
        })
);
const every = Number(option("every", "1"));
const [sliceIndex, sliceCount] = option("slice", "1/1").split("/").map(Number);
const jobs = bench.rollout
    .entries()
    .filter((_, i) => i % every === 0)
    .filter((_, i) => i % sliceCount === sliceIndex - 1);

writeFileSync(out, "");
const started = Date.now();
for (const [j, entry] of jobs.entries()) {
    const seed = entry.seeds?.[0] ?? DEFAULT_SEED;
    const T = budget === "declared" ? entry.iterations : Number(budget);
    const row = {
        index: entry.index,
        label: entry.label,
        T,
        seed,
        arms: {},
        load: Number(loadavg()[0].toFixed(1)),
    };
    // The warm-up: untimed, its result unused.
    bench.rollout.blade(entry.index, { iterations: T, seed, policy: "base" });
    const order = policies.map((_, i) => policies[(i + j) % policies.length]);
    for (const policy of order) {
        const t0 = process.cpuUsage();
        const r = bench.rollout.blade(entry.index, {
            iterations: T,
            seed,
            policy,
        });
        row.arms[policy] = {
            ok: r.ok,
            move: r.move,
            cpuMs: cpuMs(t0),
            iterations: T,
            completed: r.completed,
            counters: summarize(r.counters),
        };
    }
    const base = row.arms.base;
    // A forced move (no search, no rollout) has no time to equalise.
    if (base.counters.rollouts > 0) {
        for (const policy of policies.slice(1)) {
            const arm = row.arms[policy];
            const factor =
                timeFactors[policy] ??
                Math.min(
                    MAX_EQUAL_TIME_FACTOR,
                    base.cpuMs /
                        Math.max(base.completed, 1) /
                        (Math.max(arm.cpuMs, 1e-3) / Math.max(arm.completed, 1))
                );
            const iterations = Math.max(1, Math.round(T * factor));
            const t0 = process.cpuUsage();
            const r = bench.rollout.blade(entry.index, {
                iterations,
                seed,
                policy,
            });
            row.arms[`${policy}@time`] = {
                ok: r.ok,
                move: r.move,
                cpuMs: cpuMs(t0),
                iterations,
                completed: r.completed,
            };
        }
    }
    appendFileSync(out, JSON.stringify(row) + "\n");
    process.stderr.write(
        `[${sliceIndex}/${sliceCount}] ${j + 1}/${jobs.length} ${Math.round((Date.now() - started) / 1000)}s\n`
    );
}
console.log(`wrote ${out}: ${jobs.length} entries`);
