#!/usr/bin/env bun
/**
 * Bot-vs-bot strength ladder — `bun run ladder` (issue #1924, decision #1895).
 *
 * Standalone CLI on purpose: NEVER a vitest test, never in CI, never in the
 * gate suites. vitest buffers/swallows stdout — the exact cause of the 4-hour
 * silent corpus run of 2026-07-29 — while a CLI streams one line per game.
 *
 * What a run is: an in-process A/B between `control` (production search
 * defaults) and `candidate` (one named config variant, see
 * convex/gre/ai/searchVariant.ts) over the pairing registry
 * (scripts/lib/ladder/pairings.ts), paired games (same shuffles, agents
 * swapped), fixed 400-iteration budget, seeds derived from --baseSeed.
 * Same command + same baseSeed → bit-identical result.
 *
 * A run with NO --variant is a different thing and is worth naming: it
 * returns exactly 50% BY ARITHMETIC, because both seats then run the same
 * config and a pair's two orientations are the same game with the candidate
 * label moved. Use it as a determinism / seat-attribution self-test and as a
 * corpus generator — never as a noise-floor measurement, and never as the
 * baseline a candidate's win rate is judged against. That baseline is the
 * `placebo` variant (searchVariant.ts), which changes no decision rule but
 * does perturb the search, so its spread from 50% is the real noise floor.
 *
 * Output: live line per game on stdout + incremental JSONL under ladder-runs/
 * (gitignored; reproducible from baseSeed, and reused as the calibration /
 * fitting corpus — decision #1895 §4). Crash-safe: resume an interrupted run
 * with --resume <file> and it plays exactly the missing games.
 *
 * Machine isolation: a run holds the heavy-tier gate mutex (scripts/gate.ts),
 * so concurrent suites queue instead of stealing cores; gate.ts heartbeats the
 * lock so a multi-hour hold is never pruned as stale. Launch long runs only in
 * isolated situations (decision #1895 §3).
 *
 * Usage:
 *   bun run ladder [--tier smoke|decision] [--baseSeed N] [--variant name]
 *   bun run ladder [--workers N]              # default: ncpu - 1, min 1
 *   bun run ladder [--orientations 1]         # corpus mode, null runs only:
 *                                             # skip the bit-identical replay
 *                                             # of each pair, half the cost
 *   bun run ladder [--pairings deckA:deckB,...] | [--dynamics tag,...] | [--rung R1,...]
 *   bun run ladder --resume ladder-runs/<file>.jsonl
 *   (--iterations N exists for NON-STANDARD dev shakeouts only — a verdict
 *    quoted in a PR must come from the fixed production budget.)
 *
 * Parallelism (issue #2681): up to `--workers N` OS processes (default
 * ncpu - 1) each play a static round-robin slice of the plan and stream
 * results back over stdio; this process is the SOLE writer of the run file.
 * `--workers 1` is the plain sequential loop, byte-for-byte as before.
 *
 * Pairing/dynamics/rung filter (issue #2681, `--rung` added in #2689):
 * `--pairings`/`--dynamics`/`--rung` — mutually exclusive, at most one —
 * restrict the run to a subset of `LADDER_PAIRINGS` rows WITHOUT
 * renumbering them — seeds and gameIndex are always derived from the row's
 * index in the FULL registry (scripts/lib/ladder/filter.ts +
 * plan.ts:filterGamePlan), so a filtered run's records are exactly the
 * matching subset of an unfiltered run's. The header records the filter;
 * `--resume` validates it.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { cpus } from "node:os";
import { join, resolve } from "node:path";

import { LADDER_PAIRINGS } from "./lib/ladder/pairings";
import { parseFilterArg, selectPairingIndices } from "./lib/ladder/filter";
import {
    buildGamePlan,
    buildHeader,
    filterGamePlan,
    orientationZeroOnly,
    headerMismatches,
    parseRunFile,
    remainingGames,
    LADDER_ITERATIONS,
    TIER_SEEDS,
    toGameRecordFields,
    type LadderGameRecord,
    type LadderRunHeader,
    type LadderTier,
} from "./lib/ladder/plan";
import { runWorkerPool, type WorkerResult } from "./lib/ladder/pool";
import {
    formatLiveLine,
    formatVerdictBlock,
    summarizeRun,
    wilson,
} from "./lib/ladder/verdict";
import { LADDER_VARIANTS } from "../convex/gre/ai/searchVariant";
import { playLadderGame } from "../src/lib/ai/selfplay/ladder";

const REPO_ROOT = resolve(import.meta.dir, "..");
const RUNS_DIR = join(REPO_ROOT, "ladder-runs");
const WORKER_SCRIPT = join(REPO_ROOT, "scripts", "lib", "ladder", "worker.ts");

// ── args ────────────────────────────────────────────────────────────────────
function fail(msg: string): never {
    console.error(`ladder: ${msg}`);
    process.exit(2);
}

function parseArgs(argv: string[]) {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const m =
            /^--(tier|baseSeed|variant|resume|iterations|pairings|dynamics|rung|workers|orientations)$/.exec(
                argv[i]
            );
        if (!m) fail(`unknown argument "${argv[i]}" (see file header)`);
        const v = argv[++i];
        if (v === undefined) fail(`--${m[1]} needs a value`);
        out[m[1]] = v;
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));

// ── gate mutex ──────────────────────────────────────────────────────────────
// Re-exec under the heavy tier so the machine-wide mutex + heartbeat wrap the
// whole run. TOLARIA_ALLOW_FULL_SUITE bypasses the issue-worktree guard: that
// guard exists to stop redundant FULL-SUITE runs (re-paid at the merge-train),
// while a ladder run is unique work an agent legitimately launches from its
// feature worktree.
if (process.env.TOLARIA_GATE_HELD !== "1") {
    const inner = [
        "bun",
        join("scripts", "ladder.ts"),
        ...process.argv.slice(2),
    ]
        .map((a) => `'${a.replace(/'/g, "'\\''")}'`)
        .join(" ");
    const r = spawnSync(
        "bun",
        [join(REPO_ROOT, "scripts", "gate.ts"), "heavy", inner],
        {
            stdio: "inherit",
            cwd: REPO_ROOT,
            env: { ...process.env, TOLARIA_ALLOW_FULL_SUITE: "1" },
        }
    );
    process.exit(r.status ?? 1);
}

// ── config (fresh run vs resume) ────────────────────────────────────────────
let header: LadderRunHeader;
let priorRecords: LadderGameRecord[] = [];
let runFile: string;

if (args.resume) {
    for (const k of [
        "tier",
        "baseSeed",
        "variant",
        "iterations",
        "pairings",
        "dynamics",
        "rung",
    ] as const) {
        if (args[k] !== undefined)
            fail(`--${k} conflicts with --resume (config comes from the file)`);
    }
    runFile = resolve(args.resume);
    const parsed = parseRunFile(readFileSync(runFile, "utf8").split("\n"));
    header = parsed.header;
    priorRecords = parsed.records;
    // The registry must still match the file — a resumed run is the SAME
    // experiment, and headerMismatches also guards a registry (and filter)
    // drift. The filter itself comes from the FILE, not re-specified.
    const expected = buildHeader(
        header.tier,
        header.baseSeed,
        header.variant,
        header.iterations,
        LADDER_PAIRINGS,
        header.filter ?? null
    );
    const mismatches = headerMismatches(header, expected);
    if (mismatches.length > 0)
        fail(`cannot resume — config drift:\n  ${mismatches.join("\n  ")}`);
    console.log(
        `resuming ${runFile}: ${priorRecords.length}/${header.totalGames} games already played`
    );
} else {
    const tier = (args.tier ?? "smoke") as LadderTier;
    if (!(tier in TIER_SEEDS)) fail(`--tier must be smoke|decision`);
    const baseSeed = Number(args.baseSeed ?? 1);
    if (!Number.isInteger(baseSeed)) fail(`--baseSeed must be an integer`);
    const variant = args.variant ?? null;
    if (variant !== null && !(variant in LADDER_VARIANTS))
        fail(
            `unknown variant "${variant}" — registered: ${
                Object.keys(LADDER_VARIANTS).join(", ") || "(none yet)"
            }`
        );
    const iterations = Number(args.iterations ?? LADDER_ITERATIONS);
    if (!Number.isInteger(iterations) || iterations < 1)
        fail(`--iterations must be a positive integer`);
    if (iterations !== LADDER_ITERATIONS)
        console.log(
            `⚠ NON-STANDARD run: ${iterations} iterations (production budget is ${LADDER_ITERATIONS}) — not valid for a PR verdict`
        );

    const filterFlagsSet = [
        args.pairings !== undefined,
        args.dynamics !== undefined,
        args.rung !== undefined,
    ].filter(Boolean).length;
    if (filterFlagsSet > 1)
        fail("--pairings, --dynamics and --rung are mutually exclusive");
    let filter: ReturnType<typeof parseFilterArg> | null = null;
    try {
        filter =
            args.pairings !== undefined
                ? parseFilterArg("pairings", args.pairings)
                : args.dynamics !== undefined
                  ? parseFilterArg("dynamics", args.dynamics)
                  : args.rung !== undefined
                    ? parseFilterArg("rung", args.rung)
                    : null;
        if (filter) selectPairingIndices(LADDER_PAIRINGS, filter); // throws on a typo
    } catch (e) {
        fail((e as Error).message);
    }

    // Corpus mode (issue #1929): a null run's second orientation is a
    // bit-identical replay, so for corpus GENERATION it is half the machine
    // time for zero information. Refused with a variant, where the two
    // orientations are genuinely different games and the pairing is the
    // variance reduction the whole A/B design rests on.
    const orientations = Number(args.orientations ?? 2);
    if (orientations !== 1 && orientations !== 2)
        fail(`--orientations must be 1 or 2`);
    if (orientations === 1 && variant !== null)
        fail(
            `--orientations 1 is corpus mode and only valid for a null run;` +
                ` --variant ${variant} needs both orientations (paired A/B)`
        );

    header = buildHeader(
        tier,
        baseSeed,
        variant,
        iterations,
        LADDER_PAIRINGS,
        filter,
        orientations
    );
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    runFile = join(
        RUNS_DIR,
        `${stamp}-s${baseSeed}-${tier}${variant ? `-${variant}` : ""}.jsonl`
    );
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(runFile, JSON.stringify(header) + "\n");
}

const candidate = header.variant ? LADDER_VARIANTS[header.variant] : null;
if (header.variant && !candidate)
    fail(`variant "${header.variant}" is no longer in LADDER_VARIANTS`);

const workers =
    args.workers !== undefined
        ? Number(args.workers)
        : Math.max(1, cpus().length - 1);
if (!Number.isInteger(workers) || workers < 1)
    fail(`--workers must be a positive integer`);

// ── run ─────────────────────────────────────────────────────────────────────
// `buildGamePlan` ALWAYS runs over the full registry so seeds and gameIndex
// are derived exactly as an unfiltered run would derive them; a filter only
// trims the resulting plan afterward (plan.ts:filterGamePlan), so a filtered
// run's game records are the exact matching subset of an unfiltered run's
// (issue #2681).
const fullPlan = buildGamePlan(
    LADDER_PAIRINGS,
    TIER_SEEDS[header.tier],
    header.baseSeed
);
const allowedIndices = selectPairingIndices(
    LADDER_PAIRINGS,
    header.filter ?? null
);
const orientations = header.orientations ?? 2;
const plan =
    orientations === 1
        ? orientationZeroOnly(filterGamePlan(fullPlan, allowedIndices))
        : filterGamePlan(fullPlan, allowedIndices);
const todo = remainingGames(plan, priorRecords);

console.log(
    `ladder ${header.tier}: ${plan.length} games` +
        ` (${allowedIndices.size}/${LADDER_PAIRINGS.length} pairings` +
        (header.filter
            ? ` [--${header.filter.kind} ${header.filter.values.join(",")}]`
            : "") +
        ` × ${orientations} seat order${orientations === 1 ? "" : "s"}` +
        ` × ${TIER_SEEDS[header.tier]} seeds)` +
        (orientations === 1 ? ` [corpus mode: no paired replay]` : "") +
        ` · candidate=${header.variant ?? "control (null run)"}` +
        ` · baseSeed=${header.baseSeed} · ${header.iterations} iterations` +
        ` · workers=${workers}` +
        `\n→ ${runFile}\n`
);

const records: LadderGameRecord[] = [...priorRecords];
let candWins = records.filter((r) => r.candidateWon === true).length;
let decisive = records.filter((r) => r.candidateWon !== null).length;

/** Append one finished game + emit its live line — the SINGLE funnel both
 *  the sequential path and the parallel worker pool feed through, so file
 *  content and live output stay identical regardless of how a game was
 *  played (issue #2681: this process is the run file's sole writer). */
function applyRecord(partial: WorkerResult): void {
    const record: LadderGameRecord = { kind: "game", ...partial };
    appendFileSync(runFile, JSON.stringify(record) + "\n");
    records.push(record);
    if (record.candidateWon !== null) {
        decisive++;
        if (record.candidateWon) candWins++;
    }
    console.log(
        formatLiveLine(
            record,
            records.length,
            plan.length,
            wilson(candWins, decisive)
        )
    );
}

if (workers === 1) {
    // Plain sequential loop — byte-for-byte the original behaviour.
    for (const g of todo) {
        const t0 = Date.now();
        const outcome = playLadderGame(
            {
                deckSeat0: g.deckSeat0,
                deckSeat1: g.deckSeat1,
                seed: g.seed,
                candidateSeat: g.candidateSeat,
                iterations: header.iterations,
            },
            candidate
        );
        applyRecord(toGameRecordFields(g, outcome, Date.now() - t0));
    }
} else {
    // Workers inherit TOLARIA_GATE_HELD=1 from this process's own env (set by
    // gate.ts on the child it spawned above) — they never touch gate.ts
    // themselves, so one run still holds exactly one gate mutex (issue #2681
    // acceptance: "one run = one hold").
    try {
        await runWorkerPool({
            tasks: todo,
            workers,
            variant: header.variant,
            iterations: header.iterations,
            workerScript: WORKER_SCRIPT,
            onResult: applyRecord,
        });
    } catch (e) {
        console.error(`ladder: ${(e as Error).message}`);
    }
}

// ── report ──────────────────────────────────────────────────────────────────
const summary = summarizeRun(records, LADDER_PAIRINGS);
console.log("\n" + formatVerdictBlock(summary, header) + "\n");
console.log(`raw corpus: ${runFile}`);
if (records.length < plan.length) {
    console.log(
        `⚠ incomplete run (${records.length}/${plan.length}) — finish it with:\n  bun run ladder --resume ${runFile}`
    );
    process.exit(1);
}
