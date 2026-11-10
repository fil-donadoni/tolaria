#!/usr/bin/env bun
/**
 * Draft Table Audit (issue #8894, PRD #8772): for each seed, eight Bots draft
 * the scope through the Draft Lab's synthetic engine and every seat is
 * Auto-Built; per deck it prints plan, colours, castability, curve, land
 * count, Capability pairs and the unreviewed share per layer, then the run's
 * aggregate and the Floors' verdict (`scripts/lib/draft-audit.ts`).
 *
 * Offline and deterministic: seed profile layers only, no DB, no clock.
 *
 * Run: bun run draft:audit -- --scope <scope> [--seeds <n>] [--quiet] [--json]
 *   --scope   a Pack Source key: `vintage-cube`, `lea`, `ice`, … (required)
 *   --seeds   tables drafted, seeds 1..n (default 8 — the Floors' baseline)
 *   --quiet   aggregate and verdict only, no per-deck line
 *   --json    the whole run as JSON on stdout (verdict still decides exit)
 *
 * Exit: 0 every Floor held (or none declared), 1 a Floor broken, 2 usage.
 */
import { execFileSync } from "node:child_process";
import {
    auditSeeds,
    checkFloors,
    DEFAULT_AUDIT_SEEDS,
    DRAFT_AUDIT_FLOORS,
    floorsExitCode,
    formatAggregate,
    formatDeckLine,
    formatVerdict,
    runDraftAudit,
} from "./lib/draft-audit";

function usage(message: string): never {
    console.error(`draft:audit: ${message}`);
    console.error(
        "usage: bun run draft:audit -- --scope <scope> [--seeds <n>] [--quiet] [--json]"
    );
    process.exit(2);
}

function flagValue(args: readonly string[], name: string): string | undefined {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
        usage(`${name} needs a value`);
    }
    return value;
}

function headSha(): string {
    try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
            encoding: "utf8",
        }).trim();
    } catch {
        return "unknown";
    }
}

const args = process.argv.slice(2);
const scope = flagValue(args, "--scope")?.toLowerCase();
if (!scope) usage("--scope is required");
const seedsRaw = flagValue(args, "--seeds");
const seedCount =
    seedsRaw === undefined ? DEFAULT_AUDIT_SEEDS : Number(seedsRaw);
if (!Number.isInteger(seedCount) || seedCount < 1) {
    usage(`--seeds must be a positive integer, got ${seedsRaw}`);
}

const started = performance.now();
let run;
try {
    run = runDraftAudit(scope, auditSeeds(seedCount));
} catch (err) {
    usage(
        `cannot draft scope "${scope}": ${err instanceof Error ? err.message : String(err)}`
    );
}
const seconds = (performance.now() - started) / 1000;
const floors = DRAFT_AUDIT_FLOORS[scope];
const verdicts = floors ? checkFloors(run.aggregate, floors) : null;

if (args.includes("--json")) {
    console.log(
        JSON.stringify({ sha: headSha(), seconds, ...run, verdicts }, null, 2)
    );
} else {
    if (!args.includes("--quiet")) {
        for (const deck of run.decks) console.log(formatDeckLine(deck));
        console.log("");
    }
    console.log(`draft:audit at ${headSha()} · ${seconds.toFixed(1)} s`);
    for (const line of formatAggregate(run)) console.log(line);
    for (const line of formatVerdict(scope, verdicts)) console.log(line);
}
process.exit(floorsExitCode(verdicts));
