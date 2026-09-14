#!/usr/bin/env bun
/**
 * `bun run smoke:tier1` — the Premodern Tier 1 Bot liveness smoke (issue #2719,
 * PRD #2693 M1 acceptance criterion 3).
 *
 * Plays one full headless Bot-vs-Bot game for every pair of DISTINCT canonical
 * Tier 1 lists (`data/premodern-tier1-decks.json`) and asserts that every game
 * ended as MTG rather than on a harness guard. The rationale for "liveness, not
 * strength, and not a blade entry" is in `scripts/lib/tier1-smoke.ts`; this file
 * is the run.
 *
 * A CLI and NEVER a vitest test, for the reason `scripts/ladder.ts` states in
 * its own header: vitest buffers stdout, so a 20-minute run would print nothing
 * until it ended. It streams one line per finished game instead, and prints the
 * receipt a PR pastes.
 *
 * NOT A GATE. It needs ~20 CPU-minutes and it is a liveness probe over the
 * whole pool, not a per-diff check — the same posture `ladder` takes. `land`
 * asks for nothing here; the PR's receipt is the enforcement.
 *
 * Determinism: the plan, the seeds and the iteration budget are all fixed
 * (`SMOKE_ITERATIONS` / `SMOKE_BASE_SEED`), so the same command prints the same
 * outcomes on any machine. `--iterations` exists for a dev shakeout; a receipt
 * quoted in a PR comes from the default budget.
 *
 * Usage:
 *   bun run smoke:tier1
 *   bun run smoke:tier1 --workers 4          # default: min(ncpu - 1, 4)
 *   bun run smoke:tier1 --decks goblin,aluren   # only pairs naming these
 *   bun run smoke:tier1 --iterations 20         # dev shakeout, not a receipt
 *   bun run smoke:tier1 --timeout 300           # per-game wall-clock kill
 *
 * Parallelism is one OS PROCESS per game — never same-process concurrency. The
 * engine carries module-level cells the search installs and clears around a
 * call (`setSearchVariant`, the choice-candidate memo, dominance scoping: see
 * `scripts/lib/ladder/pool.ts`), and two interleaved games in one process could
 * race them. A child per game also means an illegal move that crashes the
 * engine takes down exactly one game, which is what makes `crash` reportable
 * rather than fatal.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join } from "node:path";

import { tryGetCardByName } from "../convex/cards/index";
import { createInitialGameState } from "../convex/gre";
import { deckToPlayerInput } from "../src/lib/ai/selfplay/decks";
import { runHeadlessGame } from "../src/lib/ai/selfplay/playGame";
import { buildPresetPayload } from "./lib/preset-deck-seed";
import { parseTier1Decks, type Tier1Deck } from "./lib/tier1-decks";
import {
    CRASH_REASON,
    filterPairs,
    isFreeze,
    smokePairs,
    smokeRow,
    smokeSeed,
    smokeVerdict,
    summarize,
    SMOKE_BASE_SEED,
    SMOKE_ITERATIONS,
    SMOKE_TIMEOUT_SECONDS,
    TIMEOUT_REASON,
    type SmokePair,
    type SmokeResult,
} from "./lib/tier1-smoke";

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

function fail(message: string): never {
    console.error(`smoke:tier1: ${message}`);
    process.exit(1);
}

function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) fail(`unexpected argument \`${arg}\``);
        const eq = arg.indexOf("=");
        if (eq !== -1) out[arg.slice(2, eq)] = arg.slice(eq + 1);
        else out[arg.slice(2)] = argv[++i] ?? "";
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const iterations = Number(args.iterations ?? SMOKE_ITERATIONS);
const baseSeed = Number(args.baseSeed ?? SMOKE_BASE_SEED);
const timeoutSeconds = Number(args.timeout ?? SMOKE_TIMEOUT_SECONDS);
if (!Number.isInteger(iterations) || iterations < 1)
    fail("--iterations must be a positive integer");
if (!Number.isInteger(baseSeed)) fail("--baseSeed must be an integer");
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    fail("--timeout must be a positive number of seconds");

// ── the canonical lists, resolved through the registry seam ─────────────────
// The SAME builder the seeder uses (`buildPresetPayload`): names resolve
// through `tryGetCardByName`, and the list is validated legal in Premodern
// before a game is played. A list that cannot be built is a stop, never a
// skipped row — a smoke that quietly played five of six decks would report a
// pool it never covered.
const file = parseTier1Decks(
    readFileSync(join(REPO_ROOT, "data", "premodern-tier1-decks.json"), "utf8")
);

function seatable(deck: Tier1Deck) {
    const built = buildPresetPayload(
        deck,
        "premodern",
        file.source.suppliedOn,
        tryGetCardByName
    );
    if (!built.payload)
        fail(`${deck.slug} does not build: ${built.problems.join("; ")}`);
    return {
        id: deck.slug,
        name: built.payload.name,
        format: built.payload.format,
        cards: built.payload.cards,
    };
}

const decksBySlug = new Map(file.decks.map((d) => [d.slug, d]));
const plan = smokePairs(file.decks.map((d) => d.slug));

// ── child mode: one game, one JSON line ─────────────────────────────────────
function playOne(pair: SmokePair): SmokeResult {
    const a = decksBySlug.get(pair.deckSeat0);
    const b = decksBySlug.get(pair.deckSeat1);
    if (!a || !b) fail(`unknown deck in pair ${pair.index}`);
    const seed = smokeSeed(baseSeed, pair.index);
    const started = Date.now();
    try {
        const state = createInitialGameState(
            [
                deckToPlayerInput(seatable(a), 0, "S0"),
                deckToPlayerInput(seatable(b), 1, "S1"),
            ],
            seed
        );
        const result = runHeadlessGame(
            state,
            { id: "S0", budget: { iterations } },
            { id: "S1", budget: { iterations } },
            seed
        );
        return {
            ...pair,
            reason: result.reason,
            turns: result.turns,
            plies: result.plies,
            winner: result.winnerId,
            ...(result.unhandledExpectedInput === undefined
                ? {}
                : { unhandledExpectedInput: result.unhandledExpectedInput }),
            seconds: (Date.now() - started) / 1000,
        };
    } catch (err) {
        // The "no illegal move" half: `applyMoveInSearch` on the CHOSEN move is
        // the one call the harness does not guard, so an illegal move arrives
        // here as a throw. Reported, never swallowed — `isFreeze` counts it.
        return {
            ...pair,
            reason: CRASH_REASON,
            turns: 0,
            plies: 0,
            winner: null,
            error: (err as Error).message,
            seconds: (Date.now() - started) / 1000,
        };
    }
}

if (args.game !== undefined) {
    const index = Number(args.game);
    const pair = plan.find((p) => p.index === index);
    if (!pair) fail(`no game with index ${index}`);
    process.stdout.write(JSON.stringify(playOne(pair)) + "\n");
    process.exit(0);
}

// ── gate mutex ──────────────────────────────────────────────────────────────
// Re-exec under the heavy tier so the machine-wide mutex + heartbeat wrap the
// whole run: this burns every core for ~20 minutes and must not race a suite.
// `TOLARIA_ALLOW_FULL_SUITE` bypasses the issue-worktree guard for the reason
// `ladder.ts` gives — that guard stops redundant FULL-SUITE runs, and a smoke
// run is unique work launched from a feature worktree on purpose.
if (process.env.TOLARIA_GATE_HELD !== "1") {
    const inner = [
        "bun",
        join("scripts", "tier1-smoke.ts"),
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

// ── parent: run the matrix ──────────────────────────────────────────────────
const wanted = (args.decks ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
for (const slug of wanted) {
    if (!decksBySlug.has(slug))
        fail(`--decks names \`${slug}\`, which is not a canonical list`);
}
const selected = filterPairs(plan, wanted);

const workers = Math.max(
    1,
    Number(args.workers ?? Math.min(Math.max(cpus().length - 1, 1), 4))
);

console.log(
    `smoke:tier1 — ${selected.length} games over ${file.decks.length} lists, ` +
        `iterations=${iterations}, baseSeed=${baseSeed}, workers=${workers}, ` +
        `timeout=${timeoutSeconds}s\n`
);

function runChild(pair: SmokePair): Promise<SmokeResult> {
    return new Promise((resolve) => {
        const child = spawn(
            "bun",
            [
                join(REPO_ROOT, "scripts", "tier1-smoke.ts"),
                "--game",
                String(pair.index),
                "--iterations",
                String(iterations),
                "--baseSeed",
                String(baseSeed),
            ],
            { cwd: REPO_ROOT, env: { ...process.env, TOLARIA_GATE_HELD: "1" } }
        );
        let out = "";
        let err = "";
        let timedOut = false;
        const started = Date.now();
        // The parent's kill, never the game's own clock — see
        // `SMOKE_TIMEOUT_SECONDS`. `SIGKILL` rather than a polite signal: the
        // child is inside a synchronous ISMCTS search and would not observe a
        // handler until it returned, which is the thing that is not happening.
        const killer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutSeconds * 1000);
        child.stdout.on("data", (d) => (out += String(d)));
        child.stderr.on("data", (d) => (err += String(d)));
        child.on("close", (code) => {
            clearTimeout(killer);
            if (timedOut) {
                resolve({
                    ...pair,
                    reason: TIMEOUT_REASON,
                    turns: 0,
                    plies: 0,
                    winner: null,
                    error: `no result in ${timeoutSeconds}s`,
                    seconds: (Date.now() - started) / 1000,
                });
                return;
            }
            const line = out.trim().split("\n").pop() ?? "";
            try {
                resolve(JSON.parse(line) as SmokeResult);
            } catch {
                // A child that died without printing its line is itself the
                // finding — an engine crash hard enough to take the process
                // down. Reported as a FREEZE row so the matrix still completes
                // and the receipt names the matchup, rather than an unhandled
                // rejection ending the run at game 3 of 15.
                resolve({
                    ...pair,
                    reason: CRASH_REASON,
                    turns: 0,
                    plies: 0,
                    winner: null,
                    error: `child exited ${code}: ${err.trim().slice(-300)}`,
                    seconds: 0,
                });
            }
        });
    });
}

const results: SmokeResult[] = [];
const queue = [...selected];

async function worker(): Promise<void> {
    for (;;) {
        const pair = queue.shift();
        if (!pair) return;
        const result = await runChild(pair);
        results.push(result);
        console.log(smokeRow(result));
    }
}

await Promise.all(Array.from({ length: workers }, () => worker()));

results.sort((a, b) => a.index - b.index);
const summary = summarize(results);
console.log("\n" + smokeVerdict(summary, iterations, baseSeed));
process.exit(results.some((r) => isFreeze(r.reason)) ? 1 : 0);
