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
//                                  inside another Claude session. Waived by
//                                  `--headless` (issue #5589): the session
//                                  is `claude -p` on `/health-fix <sha>
//                                  --headless`, where ambiguity is `stuck`
//                                  instead of a question.
//
// Headless is the unattended loop's repair (`loop-drain.sh` step 2b): it
// asks `--plan <sha> --attempts N` first (`loopFixDecision`), and every
// attempt is recorded on the verdict's pivot (`lib/health-fix-attempts.ts`)
// — `attempting` before the spawn, the parsed verdict after — so the other
// machine sees what was tried and never tries it again.
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
//
// `ladder` (issue #5646) is the RED ladder's last rungs as a job
// (`health-fix.yml`): it reads the standing RED's facts off the pivot, asks
// `ladderRung` (`lib/health-ladder.ts`) for the next rung, and acts on it —
// a headless fixer attempt, the revert (`health-revert.ts`), or the stop's
// one `ready-for-human` issue. Exit 1 only when it stops (the one email).

import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { laddered } from "./lib/health-bisect";
import type { HealthStatus } from "./lib/health-verdict";
import { OVER_CAP_ENV } from "./lib/machine-admission";
import {
    fixAttemptStore,
    LOOP_FIX_ATTEMPTS,
    loopFixDecision,
    type FixAttemptStore,
    type FixRung,
    type LoopFixDecision,
} from "./lib/health-fix-attempts";
import {
    ESCALATION_LABEL,
    escalationBody,
    escalationTitle,
    FIX_ATTEMPT_TIMEOUT_MS,
    hostOfRunnerName,
    ladderRung,
    MAX_HOPS,
    mayRedispatch,
    revertRecordOf,
    REVERT_UNRECORDED,
    walkEpisode,
    type LadderFacts,
    type RevertPr,
} from "./lib/health-ladder";
import { closingIssueRefs } from "./lib/red-land-gate";
import { pivotRepairIssues, recordPivotRepairIssue } from "./lib/health-pivot";
import { FAILED_LABEL } from "./lib/land-labels";
import { primaryCheckout } from "./lib/primary-checkout";
import {
    evidenceStore,
    HISTORY_DEPTH,
    lineageBlocks,
    machineName,
    readVerdictLineage,
    verdictStore,
    type VerdictStore,
} from "./lib/health-verdict-store";

/** Health telemetry directory, relative to the primary checkout. */
export const HEALTH_DIR = join(".claude", "telemetry", "health");
/** The fixer's return channel, beside `last.json` and the `RED` marker. */
export const VERDICT_FILE = "fix-verdict.json";
/** How long a headless fixer may run before it is killed (issue #5589) —
 *  the RED ladder's bound on one attempt (issue #5646). */
export const HEADLESS_TIMEOUT_MS = FIX_ATTEMPT_TIMEOUT_MS;
/** What to type when there is no terminal to spawn into. */
export const MANUAL_COMMAND = "bun run health:fix";

/** The record `health-main.ts` writes to `last.json`. */
export interface HealthRecord {
    sha: string;
    status: HealthStatus;
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
    /** `--headless` (issue #5589): no human is expected — the fixer's
     *  ambiguity is `stuck`, so no terminal is needed. */
    headless?: boolean;
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
    const { redMarker, last, tip, interactive, headless } = input;
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
    if (!interactive && !headless) {
        return {
            kind: "refuse",
            reason: `stdin is not a terminal — a fixer would grill into a void. Run '${MANUAL_COMMAND}' from a terminal, or '${MANUAL_COMMAND} --headless' unattended`,
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

/** The argv that spawns the fixer session on the skill: interactive, or
 *  `claude -p` on the skill's headless mode with the caller's extra flags
 *  (the loop's `--claude-args`: permission mode, model). */
export function claudeArgs(
    sha: string,
    opts: { headless?: boolean; extra?: readonly string[] } = {}
): string[] {
    if (!opts.headless) return [`/health-fix ${sha}`];
    return ["-p", `/health-fix ${sha} --headless`, ...(opts.extra ?? [])];
}

/** `--claude-args="<flags>"`: passed to `claude` (headless only), split on
 *  whitespace — the same word-splitting `loop-drain.sh` gives its own
 *  unquoted `$CLAUDE_ARGS`. */
export function extraClaudeArgs(argv: readonly string[]): string[] {
    const a = argv.find((x) => x.startsWith("--claude-args="));
    return a
        ? a.slice("--claude-args=".length).split(/\s+/).filter(Boolean)
        : [];
}

/** `--plan <sha> --attempts N`: the loop's decision for a standing RED, one
 *  line — `attempt`, `wait: <why>` or `stop: <why>`. Exported for tests. */
export function planLine(
    store: () => FixAttemptStore,
    sha: string,
    attemptsThisRun: number,
    now = Date.now()
): string {
    let d: LoopFixDecision;
    try {
        d = loopFixDecision({
            record: store().read(sha),
            attemptsThisRun,
            max: LOOP_FIX_ATTEMPTS,
            now,
        });
    } catch (err) {
        d = loopFixDecision({
            record: null,
            error: (err as Error).message,
            attemptsThisRun,
            max: LOOP_FIX_ATTEMPTS,
            now,
        });
    }
    return d.kind === "attempt" ? "attempt" : `${d.kind}: ${d.why}`;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
    const i = argv.indexOf(flag);
    const v = i === -1 ? undefined : argv[i + 1];
    return v && !v.startsWith("-") ? v : undefined;
}

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
}

/**
 * The RED this script would fix, read through the verdict store (issue
 * #5462): the `RED` marker and `last.json` on the file backend, the base
 * branch's `health` commit statuses on the github one — so a RED the other
 * machine found is fixed from here. An AMBER lineage (a proved repair landed)
 * is not RED: nothing to fix while health confirms. An unreadable store reads
 * as no RED, with the reason, like every other reader.
 *
 * Exported for direct testing; `store` is injectable for the same reason.
 */
export function readRedFromStore(store: () => VerdictStore): {
    redMarker: boolean;
    last: HealthRecord | null;
    error?: string;
} {
    const lineage = readVerdictLineage(store);
    const v = lineage.verdict;
    return {
        redMarker: lineageBlocks(lineage.kind),
        last: v
            ? {
                  sha: v.sha,
                  status: v.status === "amber" ? "green" : v.status,
                  failedStep: v.step,
                  log: v.log,
              }
            : null,
        ...(lineage.error ? { error: lineage.error } : {}),
    };
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

const FULL_SHA = /^[0-9a-f]{40}$/;

/** `repair-issue --issue=<N>` — `/health-fix` § 3: the issue it opened for the
 *  standing RED, so `land` recognises the PR that closes it as a repair
 *  (issue #4964). Recorded on the pivot, which both machines read. */
function repairIssueMain(args: readonly string[], cwd: string): number {
    const raw = args.find((a) => a.startsWith("--issue="))?.slice(8);
    const issue = Number(raw);
    if (!Number.isInteger(issue) || issue <= 0) {
        console.error(
            `health:fix: repair-issue needs --issue=<N>, got ${JSON.stringify(raw)}`
        );
        return 2;
    }
    const note = recordPivotRepairIssue(cwd, issue);
    console.log(
        note ??
            `health:fix: issue #${issue} not recorded — no RED stands on the pivot`
    );
    return 0;
}

/** `amber --sha=<tip> --repair-of=<red sha>` — a PROVED repair landed (issue
 *  #5462): its lane ran the failing tests the RED verdict names, and they
 *  passed. The lineage turns AMBER at the tip the repair created — picks and
 *  landings resume, the next health run confirms (GREEN clears it) or refutes
 *  (the SECOND RED). Non-gating: the PR is merged whatever happens here. */
function amberMain(args: readonly string[], cwd: string): number {
    const sha = args.find((a) => a.startsWith("--sha="))?.slice(6);
    const repairOf = args.find((a) => a.startsWith("--repair-of="))?.slice(12);
    if (!sha || !FULL_SHA.test(sha) || !repairOf || !FULL_SHA.test(repairOf)) {
        console.error(
            "health:fix: amber needs --sha=<40-hex tip> and --repair-of=<40-hex RED sha>"
        );
        return 2;
    }
    try {
        const out = verdictStore(cwd).write({
            sha,
            status: "amber",
            repairOf,
            machine: machineName(),
            at: new Date().toISOString(),
        });
        console.log(
            out.written
                ? `health:fix: lineage AMBER @ ${sha.slice(0, 8)} — repair of RED @ ${repairOf.slice(0, 8)} proved; picks and landings resume, health confirms`
                : `health:fix: AMBER not written — ${out.reason}`
        );
    } catch (err) {
        console.error(
            `health:fix: AMBER not written — the verdict store failed: ${String(err)}`
        );
    }
    return 0;
}

function main(): void {
    const cwd = process.cwd();
    const argv = process.argv.slice(2);
    const own = argv;
    if (own[0] === "ladder") process.exit(ladderMain(own.slice(1)));
    if (own[0] === "repair-issue")
        process.exit(repairIssueMain(own.slice(1), cwd));
    if (own[0] === "amber") process.exit(amberMain(own.slice(1), cwd));
    // `host`: this runner's machine, for a dispatch that must come back to
    // it (`health.yml` → `health-fix.yml`); empty off a runner.
    if (own[0] === "host") {
        console.log(hostOfRunnerName(process.env.RUNNER_NAME) ?? "");
        return;
    }
    if (own.includes("--plan")) {
        const sha = flagValue(own, "--plan");
        const attempts = Number(flagValue(own, "--attempts") ?? "0");
        if (!sha || !Number.isInteger(attempts) || attempts < 0) {
            console.error("health:fix: usage: --plan <sha> [--attempts <n>]");
            process.exit(2);
        }
        console.log(planLine(() => fixAttemptStore(cwd), sha, attempts));
        return;
    }
    const headless = own.includes("--headless");
    // Same test `release.ts` uses: `--git-common-dir` is relative only in the
    // primary checkout, and the health telemetry lives there.
    if (git(["rev-parse", "--git-common-dir"], cwd) !== ".git") {
        console.error(
            "health:fix: run from the primary checkout (the health verdict lives there)"
        );
        process.exit(2);
    }

    // On the file backend the marker is a local file, so the common case —
    // nothing red — is decided without a network round-trip. A green tree
    // must not pay for machinery it does not need.
    const red = readRedFromStore(() => verdictStore(cwd));
    if (red.error)
        console.error(
            `health:fix: the health verdict store could not be read — ${red.error}`
        );
    if (red.redMarker) git(["fetch", "origin", BASE_BRANCH, "-q"], cwd);
    const tip = git(["rev-parse", ORIGIN_BASE], cwd);

    const decision = spawnDecision({
        redMarker: red.redMarker,
        last: red.last,
        tip,
        interactive: process.stdin.isTTY === true,
        headless,
    });

    if (decision.kind === "refuse") {
        console.log(`health:fix: ${decision.reason}`);
        // Nothing red is the ordinary state, not a failure.
        process.exit(decision.nothingToFix ? 0 : 1);
    }

    const verdict = runFixer({
        cwd,
        sha: decision.sha,
        failedStep: decision.failedStep,
        headless,
        extra: extraClaudeArgs(argv),
    });
    if (verdict === null || verdict.outcome !== "landed") process.exit(1);
}

/** Where a job's quiet fixer writes its transcript: `run-quiet.sh`'s
 *  directory, so the public log never carries it (ADR 0156 Amendment I §
 *  Public logs). Exported for tests. */
export function quietLogPath(
    env: NodeJS.ProcessEnv,
    name: string,
    home = homedir()
): string {
    const dir =
        env.TOLARIA_JOB_LOG_DIR ?? join(home, ".cache", "tolaria", "jobs");
    return join(
        dir,
        `${env.GITHUB_RUN_ID ?? "local"}-${env.GITHUB_RUN_ATTEMPT ?? "0"}`,
        `${name}.log`
    );
}

/**
 * One fixer session on `sha`, recorded on the pivot before and after: the
 * spawn, the verdict file read back fail-closed, the outcome printed. Null
 * when the attempt could not be recorded unattended (a second fixer
 * elsewhere is the failure that prevents) — nothing was spawned.
 */
function runFixer(input: {
    cwd: string;
    sha: string;
    failedStep?: string;
    headless: boolean;
    extra: readonly string[];
    /** The ladder's rung and attempt; a hand or loop run names none. */
    rung?: { rung: FixRung; attempt: number };
    /** A job's fixer: its transcript goes to `quietLogPath`, not stdout. */
    quiet?: boolean;
}): FixVerdict | null {
    const { cwd, sha, headless } = input;
    console.log(
        `health:fix: spawning a fixer session for ${sha.slice(0, 8)}${input.failedStep ? ` (red at ${input.failedStep})` : ""}${input.rung ? ` — ladder attempt ${input.rung.attempt}` : ""}`
    );
    // A verdict left by an EARLIER round about this same sha would otherwise
    // be read as this round's answer.
    rmSync(verdictPath(cwd), { force: true });

    // The attempt, on the pivot BEFORE the spawn (issue #5589): the other
    // machine must see it is being tried. Unattended, a record that cannot
    // be written is a refusal — a second fixer elsewhere is the failure it
    // prevents; a human at a terminal is warned and goes on.
    const attempts = fixAttemptStore(cwd);
    const record = (
        outcome: "attempting" | "landed" | "stuck",
        extra: { pr?: number; note?: string } = {}
    ): string | null => {
        try {
            attempts.write({
                sha,
                outcome,
                ...(input.rung ?? {}),
                machine: machineName(),
                at: new Date().toISOString(),
                ...extra,
            });
            return null;
        } catch (err) {
            return (err as Error).message;
        }
    };
    const unrecorded = record("attempting", {
        note: headless ? "headless" : "interactive",
    });
    if (unrecorded !== null) {
        console.error(
            `health:fix: the fix attempt could not be recorded on the pivot — ${unrecorded}`
        );
        if (headless) return null;
    }

    const quietLog = input.quiet
        ? quietLogPath(process.env, `health-fix-${input.rung?.attempt ?? 1}`)
        : null;
    let fd: number | null = null;
    if (quietLog !== null) {
        mkdirSync(join(quietLog, ".."), { recursive: true });
        fd = openSync(quietLog, "a");
    }
    // stdio inherited: the session is genuinely interactive, which is the
    // whole point of the TTY refusal above.
    // The fixer is admitted past the session cap (issue #4966): a RED tip is
    // repaired FIRST, and a repair refused because three sessions are stacking
    // work on that tip is the cap defeating its own purpose. The hook
    // announces and logs the override like any other.
    const spawned = spawnSync(
        "claude",
        claudeArgs(sha, { headless, extra: input.extra }),
        {
            stdio:
                fd !== null
                    ? ["ignore", fd, fd]
                    : headless
                      ? ["ignore", "inherit", "inherit"]
                      : "inherit",
            // Unattended, a hung session must not hold the loop forever: past
            // the bound it is killed, writes no verdict, and reads `stuck`.
            ...(headless ? { timeout: HEADLESS_TIMEOUT_MS } : {}),
            cwd,
            env: {
                ...process.env,
                [OVER_CAP_ENV]: "1",
                // `claude -p` must not end its turn waiting on background
                // work, as the loop's own passes (`loop-drain.sh`).
                ...(headless
                    ? { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0" }
                    : {}),
            },
        }
    );
    if (fd !== null) {
        closeSync(fd);
        console.log(
            `health:fix: the fixer exited ${spawned.status ?? spawned.signal} — its output is kept at ${quietLog}, not in this log`
        );
    }

    let verdict = parseVerdict(readVerdictFile(cwd), sha);
    if (verdict.outcome === "stuck" && spawned.error)
        verdict = {
            ...verdict,
            note: `${verdict.note} (the session was ended: ${spawned.error.message})`,
        };
    const unrecordedOutcome = record(verdict.outcome, {
        pr: verdict.pr,
        note: verdict.note,
    });
    if (unrecordedOutcome !== null)
        console.error(
            `health:fix: the fix outcome could not be recorded on the pivot — ${unrecordedOutcome}`
        );
    if (verdict.outcome === "landed") {
        console.log(
            `health:fix: LANDED @ ${verdict.sha.slice(0, 8)}${verdict.pr ? ` (PR #${verdict.pr})` : ""}${verdict.note ? ` — ${verdict.note}` : ""}`
        );
        return verdict;
    }
    console.error(
        `health:fix: STUCK @ ${verdict.sha.slice(0, 8)}${verdict.pr ? ` (PR #${verdict.pr})` : ""} — ${verdict.note}`
    );
    return verdict;
}

function gh(args: string[], cwd: string): { ok: boolean; out: string } {
    const r = spawnSync("gh", args, { cwd, encoding: "utf8" });
    return {
        ok: r.status === 0,
        out: r.status === 0 ? (r.stdout ?? "") : (r.stderr ?? "").trim(),
    };
}

/** The open escalation issue for `red`, by exact title, or null. */
function escalationIssue(cwd: string, red: string): number | null {
    const title = escalationTitle(red);
    const r = gh(
        [
            "issue",
            "list",
            "--state",
            "open",
            "--label",
            ESCALATION_LABEL,
            "--search",
            `"${title}" in:title`,
            "--json",
            "number,title",
            "--limit",
            "20",
        ],
        cwd
    );
    if (!r.ok) throw new Error(`gh issue list failed: ${r.out}`);
    const list = JSON.parse(r.out || "[]") as {
        number: number;
        title: string;
    }[];
    return list.find((i) => i.title === title)?.number ?? null;
}

function revertPrState(cwd: string, pr: number): RevertPr {
    const r = gh(["pr", "view", String(pr), "--json", "state,labels"], cwd);
    if (!r.ok) throw new Error(`gh pr view ${pr} failed: ${r.out}`);
    const doc = JSON.parse(r.out) as {
        state: string;
        labels: { name: string }[];
    };
    const state = doc.state.toLowerCase();
    return {
        number: pr,
        state: state === "merged" || state === "closed" ? state : "open",
        landFailed: doc.labels.some((l) => l.name === FAILED_LABEL),
    };
}

/**
 * The facts `ladderRung` decides on, read off the pivot. Every read that
 * fails lands in `error`, which waits: an outage never files an escalation.
 * The walk is `walkEpisode`'s (pure, tested); this is its I/O.
 */
export function readLadderFacts(cwd: string, tip: string): LadderFacts {
    const now = Date.now();
    const empty: LadderFacts = {
        red: null,
        secondRed: false,
        tip,
        laddered: false,
        episode: [],
        revertPr: null,
        escalated: null,
        now,
    };
    const lineage = readVerdictLineage(() => verdictStore(cwd));
    if (lineage.error) return { ...empty, error: lineage.error };
    if (!lineageBlocks(lineage.kind) || !lineage.verdict) return empty;
    const red = lineage.verdict.sha;
    try {
        const verdicts = verdictStore(cwd);
        const evidence = evidenceStore(cwd);
        const attempts = fixAttemptStore(cwd);
        const ancestors = git(
            ["rev-list", "--first-parent", `--max-count=${HISTORY_DEPTH}`, red],
            cwd
        )
            .split("\n")
            .filter(Boolean);
        const { episode, standingEvidence } = walkEpisode(ancestors, {
            status: (sha) =>
                sha === red ? "red" : (verdicts.read(sha)?.status ?? null),
            attempt: (sha) => attempts.read(sha),
            evidence: (sha) => evidence.read(sha),
        });
        const revert = revertRecordOf(episode);
        return {
            ...empty,
            red,
            secondRed: lineage.kind === "second-red",
            laddered: laddered(standingEvidence),
            episode,
            revertPr:
                revert?.pr !== undefined ? revertPrState(cwd, revert.pr) : null,
            escalated: escalationIssue(cwd, red),
        };
    } catch (e) {
        return { ...empty, red, error: (e as Error).message };
    }
}

function runUrl(): string | undefined {
    const {
        GITHUB_SERVER_URL: s,
        GITHUB_REPOSITORY: r,
        GITHUB_RUN_ID: id,
    } = process.env;
    return s && r && id ? `${s}/${r}/actions/runs/${id}` : undefined;
}

/** Tells the job to dispatch the ladder again — the rung just tried is over
 *  and recorded, the next is the next run's — within `MAX_HOPS`. */
function redispatch(hop: number): void {
    if (!mayRedispatch(hop)) {
        console.error(
            `health:fix ladder: hop ${hop} is the chain's last (${MAX_HOPS}) — no further dispatch; health's next run asks again`
        );
        return;
    }
    const out = process.env.GITHUB_OUTPUT;
    if (out) appendFileSync(out, `redispatch=true\nhop=${hop + 1}\n`);
    console.log("health:fix ladder: the next rung is the next run's");
}

/**
 * A stuck attempt's repair PRs leave the queue: an open PR closing one of
 * the RED's declared repair issues is admitted under RED, and the next
 * rung (attempt 2, the revert) must not land beside it. Never fatal.
 */
function withdrawRepairPrs(cwd: string, attempt: number): void {
    const issues = pivotRepairIssues(cwd);
    if (issues.length === 0) return;
    const list = gh(
        [
            "pr",
            "list",
            "--state",
            "open",
            "--base",
            BASE_BRANCH,
            "--json",
            "number,body",
            "--limit",
            "100",
        ],
        cwd
    );
    if (!list.ok) {
        console.error(
            `health:fix ladder: the repair PRs could not be listed — ${list.out}`
        );
        return;
    }
    const prs = JSON.parse(list.out || "[]") as {
        number: number;
        body: string | null;
    }[];
    for (const pr of prs) {
        if (!closingIssueRefs(pr.body ?? "").some((n) => issues.includes(n)))
            continue;
        const closed = gh(
            [
                "pr",
                "close",
                String(pr.number),
                "--comment",
                `Closed by the RED ladder: fixer attempt ${attempt} ended stuck, and the next rung must not land beside this repair.`,
            ],
            cwd
        );
        console.log(
            closed.ok
                ? `health:fix ladder: withdrew PR #${pr.number} from the queue`
                : `health:fix ladder: PR #${pr.number} could not be closed — ${closed.out}`
        );
    }
}

/**
 * `health:fix ladder [--dry-run] [--claude-args="…"]` — one rung of the RED
 * ladder (issue #5646). Exit 1 ONLY for the stop (the one email); every
 * other rung, and any unexpected error (read as `wait`), exits 0.
 * `LADDER_HOP` is the run's place in a `Next rung` chain.
 */
function ladderMain(argv: readonly string[]): number {
    try {
        return ladderRun(argv);
    } catch (e) {
        console.error(
            `health:fix ladder: wait — the run failed before a rung (${(e as Error).message}); health's next run asks again`
        );
        return 0;
    }
}

function ladderRun(argv: readonly string[]): number {
    const cwd = primaryCheckout(process.cwd());
    const dryRun = argv.includes("--dry-run");
    const hop = Number(process.env.LADDER_HOP || "0");
    git(["fetch", "--no-tags", "--quiet", "origin", BASE_BRANCH], cwd);
    const tip = git(["rev-parse", ORIGIN_BASE], cwd);
    const facts = readLadderFacts(cwd, tip);
    const rung = ladderRung(facts);
    const label =
        rung.kind === "fix" || rung.kind === "revert"
            ? `${rung.kind} (attempt ${rung.attempt})`
            : rung.kind;
    console.log(`health:fix ladder: ${label} — ${rung.why}`);
    // `health.yml` asks with `--dry-run` whether a ladder run is owed.
    if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `rung=${rung.kind}\n`);
    if (rung.kind === "none" || rung.kind === "wait" || rung.kind === "hold")
        return 0;
    if (dryRun) {
        console.log("health:fix ladder: (dry run) nothing acted on");
        return 0;
    }
    const red = facts.red as string;
    if (rung.kind === "fix") {
        const verdict = runFixer({
            cwd,
            sha: red,
            headless: true,
            extra: extraClaudeArgs(argv),
            rung: { rung: "fix", attempt: rung.attempt },
            quiet: process.env.GITHUB_ACTIONS === "true",
        });
        // Not recorded: nothing changed on the pivot, so a re-dispatch
        // would take the same rung — health's next run asks again.
        if (verdict === null) return 0;
        if (verdict.outcome !== "landed") {
            withdrawRepairPrs(cwd, rung.attempt);
            redispatch(hop);
        }
        return 0;
    }
    if (rung.kind === "revert") {
        const r = spawnSync(
            "bun",
            [
                join(import.meta.dir, "health-revert.ts"),
                "--sha",
                red,
                "--culprit",
                rung.culprit.sha,
                "--attempt",
                String(rung.attempt),
                "--why",
                rung.why,
            ],
            { cwd, stdio: "inherit", env: process.env }
        );
        // 0: queued — the queue and health decide next. 4: nothing recorded.
        // Otherwise (3 conflict, 1 a failed try) the record says what
        // happened and the next run decides on it.
        if (r.status !== 0 && r.status !== REVERT_UNRECORDED) redispatch(hop);
        return 0;
    }
    // stop — the marker first (a failed filing still emails once), then one
    // `ready-for-human` issue, one failed run.
    try {
        fixAttemptStore(cwd).write({
            sha: red,
            outcome: "stuck",
            rung: "stop",
            attempt: 1,
            machine: machineName(),
            at: new Date().toISOString(),
            note: rung.why.slice(0, 80),
        });
    } catch (e) {
        console.error(
            `health:fix ladder: the stop marker could not be recorded — ${(e as Error).message}`
        );
    }
    const title = escalationTitle(red);
    let evidence: string | null = null;
    try {
        evidence = evidenceStore(cwd).read(red);
    } catch {
        evidence = null;
    }
    const filed = gh(
        [
            "issue",
            "create",
            "--title",
            title,
            "--body",
            escalationBody({ red, why: rung.why, evidence, runUrl: runUrl() }),
            "--label",
            ESCALATION_LABEL,
            "--label",
            "bug",
            "--label",
            "area:workflow",
        ],
        cwd
    );
    console.error(
        filed.ok
            ? `health:fix ladder: STOPPED — filed ${filed.out.trim()}`
            : `health:fix ladder: STOPPED — the escalation issue could not be filed: ${filed.out}`
    );
    return 1;
}

if (import.meta.main) {
    main();
}
