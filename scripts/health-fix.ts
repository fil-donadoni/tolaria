#!/usr/bin/env bun
// `bun run health:fix` — hand a RED base tip to a fixer session (PRD issue
// #3197).
//
// `health-main.ts` leaves a durable RED verdict when the full offline gate
// fails on the base tip (ADR 0116): `last.json` plus the `RED` marker. That
// verdict is where the workflow used to end — a log path and five manual
// steps. This script is the entry point that turns it into a repair: it
// decides whether spawning a fixer is safe, spawns an INTERACTIVE Claude
// session on the `/health-fix` skill, and reads back the verdict that
// session was required to leave behind.
//
// Five refusals, each with its own one-line reason:
//
//   - no `RED` marker            — nothing to fix; this is the common case,
//                                  and it costs nothing: the marker is a
//                                  local file and no fetch is paid for a
//                                  tree with nothing wrong with it
//   - no health record at all    — a marker with no `last.json` behind it
//                                  says nothing about WHAT is red
//   - the health record is not   — the marker is about another tree state;
//     about the base tip           fixing this tip is not what it asked for
//   - the record about the tip   — a RUNNING record means another gate has
//     is not RED                   the sha and must not be raced; a GREEN
//                                  one means the marker is stale
//   - stdin is not a TTY         — no human to grill, so a spawned session
//                                  would block on its first question. This
//                                  closes an OBSERVED hole: the session that
//                                  found issue #3187 ran `release` from
//                                  inside another Claude session.
//
// The return channel is a FILE, not an exit code: an interactive `claude`
// exits 0 whatever happened inside it, so `/health-fix` writes
// `fix-verdict.json` beside `last.json` as its last act. Everything that is
// not an unambiguous `landed` about the sha we asked about reads as `stuck`
// — no file, unparsable JSON, an unknown outcome, a verdict about another
// sha. Fail-closed, because the failure mode of the alternative is promoting
// a tip nobody fixed.
//
// Exit code: 0 when there is nothing to fix or the fixer landed its repair;
// 1 on any refusal and on any `stuck` verdict.
//
// `release`'s loop around this (issue #3201) and the skill itself (issue
// #3200) import what is defined here.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";

/** Health telemetry directory, relative to the primary checkout. */
export const HEALTH_DIR = join(".claude", "telemetry", "health");
/** The fixer's return channel, beside `last.json` and the `RED` marker. */
export const VERDICT_FILE = "fix-verdict.json";
/** What to type when there is no terminal to spawn into. */
export const MANUAL_COMMAND = "bun run health:fix";

/** The record `health-main.ts` writes to `last.json`. */
export interface HealthRecord {
    sha: string;
    status: "running" | "green" | "red";
    failedStep?: string;
    log?: string;
}

/** The record `/health-fix` writes to `fix-verdict.json` as its last act. */
export interface FixVerdict {
    /** The sha the session was asked about. */
    sha: string;
    outcome: "landed" | "stuck";
    /** The PR that carried the repair, when there is one. */
    pr?: number;
    note?: string;
}

export type SpawnDecision =
    | { kind: "spawn"; sha: string; failedStep?: string }
    /** `nothingToFix` separates "the tree is fine" from "I declined": only
     *  the former is an exit 0, and a caller must not have to sniff the
     *  reason string to tell them apart. */
    | { kind: "refuse"; reason: string; nothingToFix: boolean };

export interface SpawnInputs {
    /** Is the durable `RED` marker present? */
    redMarker: boolean;
    /** The last health record, or null when none was ever written. */
    last: HealthRecord | null;
    /** The tip we are being asked to fix. */
    tip: string;
    /** Is stdin a terminal — i.e. is there a human to grill? */
    interactive: boolean;
}

export function verdictPath(root: string): string {
    return join(root, HEALTH_DIR, VERDICT_FILE);
}

/**
 * The whole spawn decision, pure so every branch is enumerable in a test
 * rather than reachable only by running a real gate.
 *
 * Order is deliberate: a tree with nothing red gets "nothing to fix" even
 * with no terminal, because telling a cron job to open a terminal for a
 * green tree would be noise. The TTY check comes last, when there is
 * genuinely something a human would be asked about.
 */
export function spawnDecision(input: SpawnInputs): SpawnDecision {
    const { redMarker, last, tip, interactive } = input;
    if (!redMarker) {
        return {
            kind: "refuse",
            reason: `no RED marker — nothing to fix at ${tip.slice(0, 8)}`,
            nothingToFix: true,
        };
    }
    if (last === null) {
        return {
            kind: "refuse",
            reason: "a RED marker exists but no health record was written — run 'bun run health' first",
            nothingToFix: false,
        };
    }
    if (last.sha !== tip) {
        return {
            kind: "refuse",
            reason: `health record is about ${last.sha.slice(0, 8)}, not the base tip ${tip.slice(0, 8)}`,
            nothingToFix: false,
        };
    }
    if (last.status !== "red") {
        return {
            kind: "refuse",
            reason: `health record for ${tip.slice(0, 8)} is ${last.status.toUpperCase()}, not RED — nothing to fix`,
            nothingToFix: false,
        };
    }
    if (!interactive) {
        return {
            kind: "refuse",
            reason: `stdin is not a terminal — a fixer would grill into a void. Run '${MANUAL_COMMAND}' from a terminal`,
            nothingToFix: false,
        };
    }
    return { kind: "spawn", sha: tip, failedStep: last.failedStep };
}

/**
 * Parse the fixer's verdict, fail-closed. Anything that is not an
 * unambiguous `landed` about `expectedSha` is `stuck` — the note says which
 * of the failure shapes it was, because "stuck" with no reason is what a
 * maintainer would have to reconstruct by hand.
 */
export function parseVerdict(
    raw: string | null,
    expectedSha: string
): FixVerdict {
    const stuck = (note: string): FixVerdict => ({
        sha: expectedSha,
        outcome: "stuck",
        note,
    });
    if (raw === null) return stuck("the fixer wrote no verdict file");

    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch {
        return stuck("the verdict file is not valid JSON");
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        return stuck("the verdict file is not a JSON object");
    }
    const record = doc as Record<string, unknown>;
    if (typeof record.sha !== "string" || record.sha.length === 0) {
        return stuck("the verdict names no sha");
    }
    if (record.sha !== expectedSha) {
        return stuck(
            `the verdict is about ${record.sha.slice(0, 8)}, not ${expectedSha.slice(0, 8)}`
        );
    }
    const note = typeof record.note === "string" ? record.note : undefined;
    const pr = typeof record.pr === "number" ? record.pr : undefined;
    if (record.outcome === "stuck") {
        return {
            sha: expectedSha,
            outcome: "stuck",
            pr,
            note: note ?? "the fixer declared itself stuck",
        };
    }
    if (record.outcome !== "landed") {
        return stuck(
            `the verdict outcome is ${JSON.stringify(record.outcome)}, which is not 'landed'`
        );
    }
    return { sha: expectedSha, outcome: "landed", pr, note };
}

/** The argv that spawns the fixer session on the skill. */
export function claudeArgs(sha: string): string[] {
    return [`/health-fix ${sha}`];
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

function readHealthRecord(root: string): HealthRecord | null {
    const p = join(root, HEALTH_DIR, "last.json");
    if (!existsSync(p)) return null;
    try {
        return JSON.parse(readFileSync(p, "utf8")) as HealthRecord;
    } catch {
        return null;
    }
}

function readVerdictFile(root: string): string | null {
    const p = verdictPath(root);
    if (!existsSync(p)) return null;
    try {
        return readFileSync(p, "utf8");
    } catch {
        return null;
    }
}

function main(): void {
    const cwd = process.cwd();
    // Same test `release.ts` uses: `--git-common-dir` is relative only in the
    // primary checkout, and the health telemetry lives there.
    if (git(["rev-parse", "--git-common-dir"], cwd) !== ".git") {
        console.error(
            "health:fix: run from the primary checkout (the health verdict lives there)"
        );
        process.exit(2);
    }

    // The marker is a local file, so the common case — nothing red — is
    // decided without a network round-trip. A green tree must not pay for
    // machinery it does not need.
    const redMarker = existsSync(join(cwd, HEALTH_DIR, "RED"));
    if (redMarker) git(["fetch", "origin", BASE_BRANCH, "-q"], cwd);
    const tip = git(["rev-parse", ORIGIN_BASE], cwd);

    const decision = spawnDecision({
        redMarker,
        last: readHealthRecord(cwd),
        tip,
        interactive: process.stdin.isTTY === true,
    });

    if (decision.kind === "refuse") {
        console.log(`health:fix: ${decision.reason}`);
        // Nothing red is the ordinary state, not a failure.
        process.exit(decision.nothingToFix ? 0 : 1);
    }

    console.log(
        `health:fix: spawning a fixer session for ${decision.sha.slice(0, 8)}${decision.failedStep ? ` (red at ${decision.failedStep})` : ""}`
    );
    // A verdict left by an EARLIER round about this same sha would otherwise
    // be read as this round's answer.
    rmSync(verdictPath(cwd), { force: true });

    // stdio inherited: the session is genuinely interactive, which is the
    // whole point of the TTY refusal above.
    spawnSync("claude", claudeArgs(decision.sha), { stdio: "inherit", cwd });

    const verdict = parseVerdict(readVerdictFile(cwd), decision.sha);
    if (verdict.outcome === "landed") {
        console.log(
            `health:fix: LANDED @ ${verdict.sha.slice(0, 8)}${verdict.pr ? ` (PR #${verdict.pr})` : ""}${verdict.note ? ` — ${verdict.note}` : ""}`
        );
        return;
    }
    console.error(
        `health:fix: STUCK @ ${verdict.sha.slice(0, 8)}${verdict.pr ? ` (PR #${verdict.pr})` : ""} — ${verdict.note}`
    );
    process.exit(1);
}

if (import.meta.main) {
    main();
}
