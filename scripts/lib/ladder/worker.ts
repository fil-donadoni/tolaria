#!/usr/bin/env bun
// Ladder worker process (issue #2681) — plays an assigned slice of the game
// plan in its OWN OS process. Never invoked directly; spawned by pool.ts,
// one per bucket of `scripts/ladder.ts`'s `--workers N`.
//
// Why a separate process rather than a same-process pool: `playLadderGame`'s
// only cross-call seam is `setSearchVariant` — a module-level cell in
// convex/gre/ai/searchVariant.ts — installed around each search call and
// cleared in a `finally`. Two games sharing a process could race that cell;
// two OS processes each get a fresh module instance, so they never can
// (pool.ts header comment has the full argument, including the other
// per-call-scoped module state this reasoning covers).
//
// Protocol (NDJSON over stdio, one writer overall — the PARENT):
//   stdin  — one JSON-encoded LadderGamePlan-shaped task per line; the
//            parent closes stdin once the bucket is fully sent.
//   stdout — one JSON WorkerResult per line, written the instant that game
//            finishes (never buffered to the end) so the parent's live
//            per-game output stays live under parallel execution too.
// Tasks are played ONE AT A TIME, in the order received.
import { createInterface } from "node:readline";
import { LADDER_VARIANTS } from "../../../convex/gre/ai/searchVariant";
import { playLadderGame } from "../../../src/lib/ai/selfplay/ladder";
import { toGameRecordFields, type LadderGamePlan } from "./plan";
import type { WorkerResult } from "./pool";

function fail(msg: string): never {
    console.error(`ladder-worker: ${msg}`);
    process.exit(2);
}

function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const m = /^--(variant|iterations)$/.exec(argv[i]);
        if (!m) fail(`unknown argument "${argv[i]}"`);
        const v = argv[++i];
        if (v === undefined) fail(`--${m[1]} needs a value`);
        out[m[1]] = v;
    }
    return out;
}

const args = parseArgs(process.argv.slice(2));
const variantName = args.variant === "__none__" ? null : (args.variant ?? null);
const candidate = variantName ? LADDER_VARIANTS[variantName] : null;
if (variantName && !candidate) fail(`unknown variant "${variantName}"`);
const iterationsArg = args.iterations;
if (iterationsArg === undefined) fail("--iterations is required");
const iterations = Number(iterationsArg);
if (!Number.isInteger(iterations) || iterations < 1)
    fail("--iterations must be a positive integer");

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
    if (!line.trim()) return;
    const task = JSON.parse(line) as LadderGamePlan;
    const t0 = Date.now();
    const outcome = playLadderGame(
        {
            deckSeat0: task.deckSeat0,
            deckSeat1: task.deckSeat1,
            seed: task.seed,
            candidateSeat: task.candidateSeat,
            iterations,
        },
        candidate
    );
    const result: WorkerResult = toGameRecordFields(
        task,
        outcome,
        Date.now() - t0
    );
    process.stdout.write(JSON.stringify(result) + "\n");
});
