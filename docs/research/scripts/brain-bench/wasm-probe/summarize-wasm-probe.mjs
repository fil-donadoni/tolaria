// The probe-kernel bench, read (issue #10471): the tables of
// `docs/research/wasm-probe-kernel.md` from `run-wasm-probe.mjs`'s two
// outputs.
//
//   node summarize-wasm-probe.mjs <run.json> <anchor.json>
//
// The projection at the end is arithmetic on three inputs, all printed: the
// kernel's step ratios (this run), the real probe's own split on the same
// board shape (the anchor), and the probe's share of a whole iteration
// (`docs/research/rollout-policy-cost.md` § 1 and § 2, constants below).

import { readFileSync } from "node:fs";
import { median } from "../stats.mjs";
import { buildBoards } from "./boards.mjs";
import { createFlatKernel } from "./kernel-flat.mjs";
import {
    M_INSTANT,
    PL,
    PL_GY,
    PL_W,
    encodeBoard,
    encodeDefs,
    encodeMoves,
} from "./layout.mjs";

const [runPath, anchorPath] = process.argv.slice(2);
if (!runPath || !anchorPath) {
    console.error("usage: summarize-wasm-probe.mjs <run.json> <anchor.json>");
    process.exit(2);
}
const run = JSON.parse(readFileSync(runPath, "utf8"));
const anchor = JSON.parse(readFileSync(anchorPath, "utf8"));
const engines = Object.keys(run.versions);

const f = (x, digits = 2) => x.toFixed(digits);
const range = ({ median: m, min, max }, digits = 2) =>
    `${f(m, digits)} (${f(min, digits)}–${f(max, digits)})`;
const table = (head, rows) =>
    [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
const spread = (values) => ({
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
});

console.log(`## environment\n`);
for (const [name, r] of [
    ["run", run],
    ["anchor", anchor],
]) {
    console.log(
        `- ${name}: ${r.date}, ${r.machine}, node ${r.node}, load ${r.load.min}–${r.load.max}, ` +
            `${r.measuredRounds} measured rounds of ${r.sampleMs} ms samples; ` +
            Object.entries(r.versions)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")
    );
}
console.log(
    `- build: ${run.build.clang}, \`${run.build.clangFlags}\`; kernel.wasm ${run.build.wasm.bytes} bytes, ` +
        `sha256 ${run.build.wasm.sha256.slice(0, 16)}…; probe bundle ${run.build.probeBundleBytes} bytes`
);

console.log(`\n## boards\n`);
console.log(
    table(
        [
            "board",
            "permanents",
            "candidates",
            "library",
            "objects per clone (arm A)",
            "state (arms B, C)",
        ],
        run.boards.map((b) => [
            `\`${b.label}\``,
            b.permanents,
            b.candidates,
            b.library.join(" + "),
            b.cloneObjects,
            "3040 bytes",
        ])
    )
);

console.log(`\n## 1. microseconds per probe (median of the measured rounds)\n`);
console.log(
    table(
        [
            "board",
            ...engines.flatMap((e) => ["A", "B", "C"].map((a) => `${e} ${a}`)),
        ],
        run.boards.map((b, i) => [
            `\`${b.label}\``,
            ...engines.flatMap((e) => {
                const row = run.summary.nsPerProbe[e][i];
                return [f(row.A / 1000, 1), f(row.B / 1000), f(row.C / 1000)];
            }),
        ])
    )
);

console.log(`\n## 2. arm against arm (median over the six boards, range)\n`);
console.log(
    table(
        ["engine", "A ÷ B", "B ÷ C", "A ÷ C", "C, one call per probe ÷ C"],
        engines.map((e) => {
            const r = run.summary.ratios[e];
            return [
                e,
                range(r["A/B"], 1),
                range(r["B/C"]),
                range(r["A/C"], 1),
                range(r["Ccall/C"]),
            ];
        })
    )
);

console.log(`\n## 3. engine against ${engines[0]}, arm by arm\n`);
console.log(
    table(
        ["engines", "A", "B", "C"],
        Object.entries(run.summary.engines).map(([pair, r]) => [
            pair.replace("/", " ÷ "),
            range(r.A),
            range(r.B),
            range(r.C),
        ])
    )
);

console.log(
    `\n## 4. the kernel's split, % of a probe (median over the boards)\n`
);
const pct = (x) => f(100 * x, 0);
console.log(
    table(
        ["engine", "arm", "clone", "apply", "settle", "evaluate"],
        engines.flatMap((e) =>
            ["A", "B", "C"].map((arm) => {
                const s = run.summary.split[e][arm];
                return [
                    e,
                    arm,
                    pct(s.clone.median),
                    pct(s.apply.median),
                    pct(s.settle.median),
                    pct(s.evaluate.median),
                ];
            })
        )
    )
);
console.log(`\n### step against step (median over the boards, range)\n`);
console.log(
    table(
        ["engine", "arms", "clone + apply", "settle", "evaluate"],
        engines.flatMap((e) =>
            Object.entries(run.summary.stepRatios[e]).map(([pair, s]) => [
                e,
                pair.replace("/", " ÷ "),
                range(s["clone+apply"], 1),
                range(s.settle, 1),
                range(s.evaluate, 1),
            ])
        )
    )
);

console.log(`\n## 5. the anchor: arm A beside the engine's own probe\n`);
console.log(
    table(
        [
            "board",
            "permanents",
            "engine's candidates",
            "of them casts",
            "objects per clone, engine",
            "arm A",
        ],
        anchor.boards.map((b) => [
            `\`${b.label}\``,
            b.permanents,
            b.candidates,
            b.kinds["cast-spell"] ?? 0,
            b.cloneObjects,
            b.kernelCloneObjects,
        ])
    )
);
console.log("");
const anchorEngines = Object.keys(anchor.summary);
console.log(
    table(
        [
            "engine",
            "engine's probe, µs",
            "arm A, µs",
            "engine ÷ arm A",
            "clone, % of the engine's probe",
            "one SBA check, %",
            "one evaluation, %",
        ],
        anchorEngines.map((e) => {
            const rows = anchor.summary[e];
            const col = (k) => spread(rows.map((r) => r[k]));
            const share = (k) => {
                const s = col(k);
                return `${pct(s.median)} (${pct(s.min)}–${pct(s.max)})`;
            };
            return [
                e,
                range(col("realUsPerProbe"), 0),
                range(col("armAUsPerProbe"), 1),
                range(col("realOverA"), 1),
                share("cloneShare"),
                share("sbaShare"),
                share("evaluateShare"),
            ];
        })
    )
);

// ---------------------------------------------------------------------------
// The projection onto a whole iteration
// ---------------------------------------------------------------------------

/** The probes' share of a field search, lowest and highest of the four
 *  boards: today's policy (`rollout-policy-cost.md` § 1), and under `topk:3`
 *  (derived there from § 1's shares and § 2's time per iteration at 60
 *  iterations: 1 − (1 − share) ÷ ratio). */
const PROBE_SHARE = {
    "today's policy": [0.617, 0.726],
    "`topk:3`": [0.4, 0.49],
};
const iteration = (share, probeSpeedup) =>
    1 / (1 - share + share / probeSpeedup);

console.log(`\n## 6. the projection: a whole iteration, as a ceiling\n`);
console.log(
    `Probe speed-up by step: the engine's probe split as the anchor reads it ` +
        `(clone, evaluation, the rest), each step divided by the kernel's ratio ` +
        `for that step (the rest takes the settle step's).\n`
);
const rows = [];
for (const e of engines) {
    const a = anchor.summary[e];
    if (!a) continue;
    const clone = median(a.map((r) => r.cloneShare));
    const evaluate = median(a.map((r) => r.evaluateShare));
    const rest = 1 - clone - evaluate;
    const steps = run.summary.stepRatios[e];
    const speedup = (pairs) => {
        const ratio = (step) =>
            pairs.reduce((x, pair) => x * steps[pair][step].median, 1);
        return (
            1 /
            (clone / ratio("clone+apply") +
                evaluate / ratio("evaluate") +
                rest / ratio("settle"))
        );
    };
    const flat = speedup(["A/B"]);
    const wasm = speedup(["A/B", "B/C"]);
    for (const [policy, [low, high]] of Object.entries(PROBE_SHARE)) {
        const cell = (s) => `${f(iteration(low, s))}–${f(iteration(high, s))}×`;
        rows.push([
            e,
            policy,
            `${pct(low)}–${pct(high)}`,
            `${f(flat, 1)}×`,
            cell(flat),
            `${f(wasm, 1)}×`,
            cell(wasm),
            `${f(iteration(low, wasm) / iteration(low, flat))}–${f(iteration(high, wasm) / iteration(high, flat))}×`,
            cell(Infinity),
        ]);
    }
}
console.log(
    table(
        [
            "engine",
            "policy",
            "probes, % of an iteration",
            "probe, flat JS",
            "iteration, flat JS",
            "probe, WebAssembly",
            "iteration, WebAssembly",
            "WebAssembly ÷ flat JS, iteration",
            "iteration, a free probe",
        ],
        rows
    )
);

// ---------------------------------------------------------------------------
// The figures the note's prose quotes beside the tables
// ---------------------------------------------------------------------------

console.log(`\n## 7. figures the prose quotes\n`);

/** Per board, the median over the measured rounds of the rows `pick` keeps. */
const perBoard = (source, engine, pick) =>
    source.boards.map((_, b) =>
        median(
            source.rows
                .filter(
                    (r) =>
                        r.engine === engine &&
                        r.round > 0 &&
                        r.board === b &&
                        pick(r)
                )
                .map((r) => r.ns)
        )
    );
const span = (values, unit, digits) =>
    `${f(Math.min(...values) / unit, digits)}–${f(Math.max(...values) / unit, digits)}`;
console.log(
    table(
        [
            "engine",
            "clone, arm A, µs",
            "clone, arm B, ns",
            "clone, arm C, ns",
            "engine's clone, µs",
            "engine's evaluation, µs",
            "engine's probe, µs",
        ],
        engines.map((e) => {
            const clone = (arm) =>
                perBoard(run, e, (r) => r.arm === arm && r.phases === 1);
            const real = (kind) => perBoard(anchor, e, (r) => r.kind === kind);
            return [
                e,
                span(clone("A"), 1000, 1),
                span(clone("B"), 1, 0),
                span(clone("C"), 1, 0),
                span(real("clone"), 1000, 1),
                span(real("evaluate"), 1000, 0),
                span(real("real"), 1000, 0),
            ];
        })
    )
);

console.log(
    `\nThe engine's own probe, each engine over ${anchorEngines[0]} ` +
        `(per board, the median of the per-round ratios):\n`
);
for (const e of anchorEngines.slice(1)) {
    const ratios = anchor.boards.map((_, b) => {
        const per = [];
        for (let round = 1; round <= anchor.measuredRounds; round++) {
            const at = (engine) =>
                anchor.rows.find(
                    (r) =>
                        r.engine === engine &&
                        r.round === round &&
                        r.board === b &&
                        r.kind === "real"
                ).ns;
            per.push(at(e) / at(anchorEngines[0]));
        }
        return median(per);
    });
    console.log(
        `- ${e}: ${ratios.map((x) => f(x)).join(" ")} — ${range(spread(ratios))}`
    );
}

// What the settle step finds to do: a probe KILLS when its graveyards grow by
// more than the spell it cast. Read off arm B, which needs no browser.
const kills = buildBoards().map((board) => {
    const kernel = createFlatKernel(encodeDefs());
    kernel.load(encodeBoard(board), encodeMoves(board));
    const buried = (words) => words[PL + PL_GY] + words[PL + PL_W + PL_GY];
    const before = board.players.reduce((n, p) => n + p.graveyard.length, 0);
    return board.moves.filter(
        (m, i) =>
            buried(kernel.inspect(i)) -
                before -
                (m.kind === M_INSTANT ? 1 : 0) >
            0
    ).length;
});
console.log(
    `\nProbes whose settle step buries a permanent, per board: ${kills.join(" ")} ` +
        `(${kills.reduce((a, b) => a + b, 0)} of ${run.boards.reduce((n, b) => n + b.candidates, 0)}).`
);
