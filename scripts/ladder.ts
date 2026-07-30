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
 *   bun run ladder --resume ladder-runs/<file>.jsonl
 *   (--iterations N exists for NON-STANDARD dev shakeouts only — a verdict
 *    quoted in a PR must come from the fixed production budget.)
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { LADDER_PAIRINGS } from "./lib/ladder/pairings";
import {
    buildGamePlan,
    buildHeader,
    headerMismatches,
    parseRunFile,
    remainingGames,
    LADDER_ITERATIONS,
    TIER_SEEDS,
    type LadderGameRecord,
    type LadderRunHeader,
    type LadderTier,
} from "./lib/ladder/plan";
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

// ── args ────────────────────────────────────────────────────────────────────
function fail(msg: string): never {
    console.error(`ladder: ${msg}`);
    process.exit(2);
}

function parseArgs(argv: string[]) {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const m = /^--(tier|baseSeed|variant|resume|iterations)$/.exec(argv[i]);
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
    for (const k of ["tier", "baseSeed", "variant", "iterations"] as const) {
        if (args[k] !== undefined)
            fail(`--${k} conflicts with --resume (config comes from the file)`);
    }
    runFile = resolve(args.resume);
    const parsed = parseRunFile(readFileSync(runFile, "utf8").split("\n"));
    header = parsed.header;
    priorRecords = parsed.records;
    // The registry must still match the file — a resumed run is the SAME
    // experiment, and headerMismatches also guards a registry drift.
    const expected = buildHeader(
        header.tier,
        header.baseSeed,
        header.variant,
        header.iterations,
        LADDER_PAIRINGS
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

    header = buildHeader(tier, baseSeed, variant, iterations, LADDER_PAIRINGS);
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

// ── run ─────────────────────────────────────────────────────────────────────
const plan = buildGamePlan(
    LADDER_PAIRINGS,
    TIER_SEEDS[header.tier],
    header.baseSeed
);
const todo = remainingGames(plan, priorRecords);

console.log(
    `ladder ${header.tier}: ${plan.length} games` +
        ` (${LADDER_PAIRINGS.length} pairings × 2 seat orders × ${TIER_SEEDS[header.tier]} seeds)` +
        ` · candidate=${header.variant ?? "control (null run)"}` +
        ` · baseSeed=${header.baseSeed} · ${header.iterations} iterations` +
        `\n→ ${runFile}\n`
);

const records: LadderGameRecord[] = [...priorRecords];
let candWins = records.filter((r) => r.candidateWon === true).length;
let decisive = records.filter((r) => r.candidateWon !== null).length;

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
    const record: LadderGameRecord = {
        kind: "game",
        gameIndex: g.gameIndex,
        pairingIndex: g.pairingIndex,
        seedIndex: g.seedIndex,
        orientation: g.orientation,
        deckSeat0: g.deckSeat0,
        deckSeat1: g.deckSeat1,
        seed: g.seed,
        candidateSeat: g.candidateSeat,
        winnerSeat: outcome.winnerSeat,
        candidateWon: outcome.candidateWon,
        reason: outcome.reason,
        turns: outcome.turns,
        plies: outcome.plies,
        ms: Date.now() - t0,
    };
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
