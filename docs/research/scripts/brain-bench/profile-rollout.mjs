// Where an iteration's time goes, by PHASE of the iteration (issue #10134):
// a V8 CPU profile of the rollout bundle (`run-rollout.mjs build`, no policy
// installed, so today's search) searching one position, folded by the
// rollout's own structure instead of `buckets.mjs`'s engine functions.
//
//   node docs/research/scripts/brain-bench/profile-rollout.mjs <rollout-bundle.js> <out.json> [--iterations N] <position>...
//
// A position is a blade index, or the path of a field fixture. The child
// process is `profile.mjs --child`, unchanged. Each sample under
// `searchWithTrace` goes to:
//
//   descent   not under `rollout`: tree selection and expansion,
//             determinization, the root's and the tree's own moves and priors
//   probes    under the greedy pick `selectRolloutMove`: a clone, apply,
//             settle and evaluate per candidate (the policy's probes)
//   apply     the rollout applying the move it chose (or a forced pass)
//   enumerate the rollout enumerating a ply's legal moves
//   filters   the rollout's move filters and its epsilon test (the sacrifice
//             and exchange predicates, `rolloutEpsilonFor`, ...)
//   leaf      `scoreLeaf`: the evaluation closing the rollout
//   advance   `advanceToDecision` / `onlyPassIsLegal`: forced answers and
//             the pass test
//   rollout   anything else under `rollout`
//   gc        the whole run's garbage collection (V8 reports it outside any
//             stack), charged to the search as `profile.mjs` does
//
// `descentInclusive` then opens the descent: every function's INCLUSIVE
// share of the search over the descent's samples alone (overlapping, as
// `buckets.mjs`'s inclusive shares do), the top 20.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH, parseProfileArgs } from "./buckets.mjs";

const { bundle, out, iterations, positions } = parseProfileArgs(
    process.argv.slice(2),
    "profile-rollout.mjs"
);

const ROLLOUT = /^(__rolloutInner|rollout)\d*$/;
const CALLEE_BUCKETS = [
    ["probes", /^(__selectRolloutMoveInner|selectRolloutMove)\d*$/],
    ["apply", /^applyMoveInSearch\d*$/],
    ["enumerate", /^enumerateMoves\d*$/],
    ["leaf", /^scoreLeaf\d*$/],
    ["advance", /^(advanceToDecision|onlyPassIsLegal)\d*$/],
    [
        "filters",
        /^(is[A-Z]\w*|flipsStepTargetGate|armedStepTargetGates|rolloutEpsilonFor|newManaCensusMemo)\d*$/,
    ],
];
const NAMES = ["descent", ...CALLEE_BUCKETS.map(([n]) => n), "rollout", "gc"];

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
    const buckets = Object.fromEntries(NAMES.map((n) => [n, 0]));
    const descentInclusive = new Map();
    let total = 0;
    for (const [id, micros] of self) {
        const name = byId.get(id).callFrame.functionName;
        if (name === "(garbage collector)") {
            buckets.gc += micros;
            total += micros;
            continue;
        }
        // Walk to the root: inside the search? Inside a rollout, and through
        // which of the rollout's direct callees?
        let inSearch = false;
        let callee = null;
        let inRollout = false;
        let below = null;
        const onStack = new Set();
        for (let at = id; at !== undefined; at = parent.get(at)) {
            const fn = byId.get(at).callFrame.functionName;
            onStack.add(fn.replace(/\d+$/, ""));
            if (!inRollout && ROLLOUT.test(fn)) {
                inRollout = true;
                callee = below;
            }
            if (SEARCH.test(fn)) inSearch = true;
            below = fn;
        }
        if (!inSearch) continue;
        total += micros;
        if (!inRollout) {
            buckets.descent += micros;
            for (const fn of onStack) {
                descentInclusive.set(
                    fn,
                    (descentInclusive.get(fn) ?? 0) + micros
                );
            }
            continue;
        }
        const hit =
            callee &&
            CALLEE_BUCKETS.find(([, pattern]) => pattern.test(callee));
        buckets[hit ? hit[0] : "rollout"] += micros;
    }
    return {
        searchMs: Math.round(total / 1000),
        shares: Object.fromEntries(
            NAMES.map((n) => [
                n,
                Number(((100 * buckets[n]) / total).toFixed(1)),
            ])
        ),
        descentInclusive: Object.fromEntries(
            [...descentInclusive.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([fn, n]) => [fn, Number(((100 * n) / total).toFixed(1))])
        ),
    };
}

const profileScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "profile.mjs"
);
const results = [];
for (const position of positions) {
    const dir = mkdtempSync(path.join(tmpdir(), "brain-prof-"));
    const run = spawnSync(
        process.execPath,
        [
            "--cpu-prof",
            `--cpu-prof-dir=${dir}`,
            "--cpu-prof-interval=500",
            profileScript,
            "--child",
            bundle,
            position,
            String(iterations),
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
    process.stderr.write(`profiled ${position}\n`);
}

writeFileSync(out, JSON.stringify({ iterations, results }, null, 1));
console.log(`wrote ${out}`);
