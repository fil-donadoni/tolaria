#!/usr/bin/env bun
// `bun run afk:pass` — one `/next-ticket` pass as a job (issue #5650, PRD
// #5620, ADR 0156 Amendment I § The pass is dispatched, not just triggered).
//
// Run by `.github/workflows/afk-pass.yml` on a `pass` runner, as the owner's
// user, in the job worktree; `afk-dispatch.yml` dispatched it with the issue
// (`AFK_ISSUE`), the tier (`AFK_MODEL`) and `AFK_RESUME`, and already holds
// the claim. Every decision is `lib/afk-pass.ts`'s; this file only acts:
//
//   1. launches `claude -p "/next-ticket N"` (`--resume` for a dead pass's
//      work) in the loop's environment — `TOLARIA_LOOP_DRAIN`, the run id, a
//      fresh session id, the tier, the owner's permission mode — bounded by
//      `AFK_PASS_TIMEOUT_MIN`, its output kept ON THE MACHINE (§ Public logs);
//   2. reads what it left: the issue's PR and labels, its transcripts' tokens
//      and usage-limit fact, the result's cost;
//   3. pushes a stopped pass's work to its branch, so the next dispatch
//      resumes it;
//   4. writes the `PassRecord` (`AFK_RECORD_DIR/record.json`, ALWAYS — the
//      dispatcher holds on a finished run without one) and the job summary,
//      then exits 0 for a hand-off, a close, an abort or a usage limit and 1
//      otherwise.
//
// Nothing here prints Claude output, an issue body or a token.

import {
    appendFileSync,
    closeSync,
    createReadStream,
    existsSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { execFileSync, spawnSync } from "node:child_process";
import { gh } from "./lib/gh";
import { sanitizeHost } from "./lib/github-runner";
import { parseUsageLine, type UsageRecord } from "./lib/usage-window";
import { DEFAULT_PROJECTS_DIR } from "./usage-window";
import { quietLogPath } from "./health-fix";
import { hostOfRunnerName, type OpenPr } from "./lib/afk-dispatch";
import {
    issuePr,
    outcomeExitCode,
    parsePassInputs,
    passClaudeArgs,
    passOutcome,
    passPermissionArgs,
    passRecord,
    passRunId,
    passTimeoutMin,
    passTokens,
    resultCost,
    summaryLines,
    usageLimitLine,
    usageLimitResetIso,
    wipAction,
    wipCommitMessage,
    type PassInputs,
    type PassOutcome,
    type RecordInput,
    type UsageLimitHit,
} from "./lib/afk-pass";

function say(line: string): void {
    console.log(`afk-pass: ${line}`);
}

function firstLine(err: unknown): string {
    return ((err as Error)?.message ?? String(err)).split("\n")[0];
}

/** The session's transcripts: `<projects>/<slug>/<sid>.jsonl` and every
 *  `.jsonl` under `<projects>/<slug>/<sid>/` (its subagents). Any slug: the
 *  job worktree's path names its own. */
function sessionTranscripts(projectsDir: string, sessionId: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
        }
    };
    let slugs: string[] = [];
    try {
        slugs = readdirSync(projectsDir);
    } catch {
        return out;
    }
    for (const slug of slugs) {
        const main = join(projectsDir, slug, `${sessionId}.jsonl`);
        if (existsSync(main)) out.push(main);
        const sub = join(projectsDir, slug, sessionId);
        try {
            if (statSync(sub).isDirectory()) walk(sub);
        } catch {
            // no subagents
        }
    }
    return out;
}

async function readTranscripts(
    files: readonly string[]
): Promise<{ usage: UsageRecord[]; limits: UsageLimitHit[] }> {
    const usage: UsageRecord[] = [];
    const limits: UsageLimitHit[] = [];
    for (const file of files) {
        const rl = createInterface({
            input: createReadStream(file, { encoding: "utf8" }),
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            const u = parseUsageLine(line);
            if (u) usage.push(u);
            const l = usageLimitLine(line);
            if (l) limits.push(l);
        }
    }
    return { usage, limits };
}

function openPrs(): OpenPr[] {
    const rows = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "number,headRefName,labels",
        ])
    ) as { number: number; headRefName: string; labels: { name: string }[] }[];
    return rows.map((r) => ({
        number: r.number,
        headRefName: r.headRefName,
        labels: r.labels.map((l) => l.name),
    }));
}

function issueState(issue: number): { closed: boolean; labels: string[] } {
    const raw = JSON.parse(
        gh(["issue", "view", String(issue), "--json", "state,labels"])
    ) as { state: string; labels: { name: string }[] };
    return {
        closed: raw.state === "CLOSED",
        labels: raw.labels.map((l) => l.name),
    };
}

function git(args: string[]): string {
    return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

/** Push a stopped pass's work to its branch (`wipAction` decides). */
function pushWip(outcome: PassOutcome, issue: number): void {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirty = git(["status", "--porcelain"]) !== "";
    let unpushed = true;
    try {
        unpushed =
            git(["rev-list", "--count", `origin/${branch}..HEAD`]) !== "0";
    } catch {
        // no remote branch yet: everything is unpushed
    }
    const act = wipAction({ outcome, issue, branch, dirty, unpushed });
    if (act.kind === "none") {
        say(`no WIP push (${act.why})`);
        return;
    }
    if (act.commit) {
        git(["add", "-A"]);
        // --no-verify: a hook that refuses a half-done tree must not keep
        // the work on a disk that dies with the job.
        git(["commit", "--no-verify", "-m", wipCommitMessage(outcome, issue)]);
    }
    // --no-verify on the push too: `.husky/pre-push` checks the format of
    // the pushed files, and a stopped pass's edits are not formatted — a
    // refused push loses the work with the worktree. `wipAction` already
    // limits the target to the issue's own branch.
    git(["push", "--no-verify", "origin", `HEAD:refs/heads/${act.branch}`]);
    say(
        `pushed the pass's work to ${act.branch}${act.commit ? " (wip commit)" : ""}`
    );
}

function writeRecord(dir: string, input: RecordInput): void {
    const rec = passRecord(input);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, "record.json"),
        `${JSON.stringify(rec, null, 2)}\n`
    );
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) {
        try {
            appendFileSync(file, summaryLines(rec).join("\n"));
        } catch {
            // A summary that cannot be written is not a reason to fail.
        }
    }
    say(
        `issue #${rec.issue} — outcome ${rec.outcome}, PR ${rec.pr === null ? "none" : `#${rec.pr}`}, ${rec.durationS} s${rec.usageLimitResetAt ? `, usage limit resets ${rec.usageLimitResetAt}` : ""}`
    );
}

/** Where the record goes: the workflow's upload step reads this directory. */
function recordDirOf(): string {
    return (
        process.env.AFK_RECORD_DIR ??
        join(process.env.RUNNER_TEMP ?? ".", "afk-pass-record")
    );
}

/** The machine, by its runner's name (`<host>-pass-<n>`), as the
 *  dispatcher reads it. */
function thisHost(): string {
    return (
        hostOfRunnerName(process.env.RUNNER_NAME ?? "") ??
        sanitizeHost(hostname())
    );
}

/** Launch the pass; its stdout (the JSON result) and stderr stay on disk. */
function runPass(
    p: PassInputs,
    sessionId: string,
    timeoutMin: number,
    extra: readonly string[]
): { exitCode: number | null; timedOut: boolean; stdout: string } {
    const out = quietLogPath(process.env, `afk-pass-${p.issue}`);
    const err = out.replace(/\.log$/, ".stderr.log");
    mkdirSync(dirname(out), { recursive: true });
    const fdOut = openSync(out, "a");
    const fdErr = openSync(err, "a");
    say(
        `pass for issue #${p.issue} on tier ${p.model}${p.resume ? " (resume)" : ""}, bound ${timeoutMin} min, session ${sessionId}`
    );
    const spawned = spawnSync("claude", passClaudeArgs(p, sessionId, extra), {
        stdio: ["ignore", fdOut, fdErr],
        timeout: timeoutMin * 60_000,
        killSignal: "SIGTERM",
        env: {
            ...process.env,
            // The loop's environment (scripts/loop-drain.sh): the pass is
            // already driven (the skill's hand-off detaches no driver), and
            // the session-origin hook books it under this run.
            TOLARIA_LOOP_DRAIN: "1",
            TOLARIA_LOOP_RUN_ID: passRunId(process.env),
            // `claude -p` must not end its turn waiting on background work.
            CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0",
        },
    });
    closeSync(fdOut);
    closeSync(fdErr);
    const timedOut =
        spawned.error !== undefined &&
        (spawned.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    say(
        `claude exited ${spawned.status ?? spawned.signal ?? "?"}${timedOut ? " (past its bound)" : ""} — its output is kept on the machine under the job log directory (${relative(dirname(dirname(out)), out)}), not in this log`
    );
    let stdout = "";
    try {
        stdout = readFileSync(out, "utf8");
    } catch {
        stdout = "";
    }
    return { exitCode: spawned.status, timedOut, stdout };
}

async function main(): Promise<number> {
    const startedMs = Date.now();
    const recordDir = recordDirOf();
    const host = thisHost();
    const issueGuess = Number(process.env.AFK_ISSUE) || 0;

    let p: PassInputs;
    let extra: string[];
    try {
        p = parsePassInputs(process.env);
        extra = passPermissionArgs(process.env.AFK_PASS_CLAUDE_ARGS);
    } catch (err) {
        say(`refusing the dispatch: ${firstLine(err)}`);
        writeRecord(recordDir, {
            issue: issueGuess,
            pr: null,
            outcome: "setup-failed",
            host,
            startedMs,
            endedMs: Date.now(),
            models: {},
            costUsd: null,
            usageLimitResetAt: null,
        });
        return 1;
    }

    const sessionId = randomUUID();
    const run = runPass(
        p,
        sessionId,
        passTimeoutMin(process.env.AFK_PASS_TIMEOUT_MIN),
        extra
    );
    const endedMs = Date.now();

    const { usage, limits } = await readTranscripts(
        sessionTranscripts(DEFAULT_PROJECTS_DIR, sessionId)
    );
    const resetAt = usageLimitResetIso(limits, endedMs);

    // Unread GitHub facts are no outcome: the run fails, the claim stands,
    // and the dispatcher resumes or releases it from what it reads itself.
    let pr: OpenPr | null = null;
    let outcome: PassOutcome;
    let stateRead = false;
    try {
        pr = issuePr(p.issue, openPrs());
        const st = issueState(p.issue);
        outcome = passOutcome({
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            usageLimited: limits.length > 0,
            pr,
            issueClosed: st.closed,
            labels: st.labels,
        });
        stateRead = true;
    } catch (err) {
        say(`the issue's state could not be read: ${firstLine(err)}`);
        outcome = run.timedOut ? "timeout" : "error";
    }

    // Unread, the pass may have handed off: a WIP commit would land on a PR
    // already in the queue. Its branch holds whatever the session pushed.
    if (stateRead)
        try {
            pushWip(outcome, p.issue);
        } catch (err) {
            say(`the WIP push failed: ${firstLine(err)}`);
        }
    else say("no WIP push (the issue's state is unknown)");

    writeRecord(recordDir, {
        issue: p.issue,
        pr: pr?.number ?? null,
        outcome,
        host,
        startedMs,
        endedMs,
        models: passTokens(usage),
        costUsd: resultCost(run.stdout),
        usageLimitResetAt: resetAt,
    });
    return outcomeExitCode(outcome);
}

if (import.meta.main) {
    const startedMs = Date.now();
    main()
        .then((code) => process.exit(code))
        .catch((err: unknown) => {
            console.error(`afk-pass: ${firstLine(err)}`);
            // A finished run without a record holds the dispatcher
            // (`records-unknown`): leave one, whatever broke.
            const dir = recordDirOf();
            if (!existsSync(join(dir, "record.json")))
                try {
                    writeRecord(dir, {
                        issue: Number(process.env.AFK_ISSUE) || 0,
                        pr: null,
                        outcome: "error",
                        host: thisHost(),
                        startedMs,
                        endedMs: Date.now(),
                        models: {},
                        costUsd: null,
                        usageLimitResetAt: null,
                    });
                } catch {
                    // nothing more to try
                }
            process.exit(1);
        });
}
