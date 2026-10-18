#!/usr/bin/env bun
/**
 * `bun run land:ready <PR#>` — a session's LAST act (issue #5469): hand the
 * pushed PR to the land-runner. One verb, so the two halves never split:
 *
 *   1. the PR is labelled `ready-to-land` (and loses `land-failed`, so a
 *      repaired PR re-queues with the same command) and, when the Mergify
 *      queue admits its paths, `queue:shadow`: the queue lands it and the
 *      runner skips it (issue #5952). A PR touching `.github/` or
 *      `.mergify.yml` stays the runner's;
 *   2. the claim journal gets the issue's `pr-open` row: the claim stands,
 *      but it holds no `sessions.cap` slot on this machine any more;
 *   3. the issue gets the `pr-open` label beside `in-progress`, so the board
 *      shows the hand-off (issue #5562; every release path removes it).
 *
 * BEFORE it queues, it runs the lane's seconds-cost steps on the PR's own
 * worktree (issue #5554, `lib/pre-queue-steps.ts`): a red step means the
 * PR carries an error the runner would only report as `land-failed`, minutes
 * later, to a session that has already exited. Red → exit 1, no label, no
 * `pr-open` row; fix it here. The announced, logged escape for a red that is
 * base's, not the PR's: `TOLARIA_PREQUEUE_RED_OK=1`.
 *
 * It also runs `land`'s body/diff refusals FIRST (issue #5956, `pr-checks.ts`
 * — the same functions `land` calls, never a copy): a missing `check:ui`
 * receipt or preset scenario refuses here, with `land`'s own words, while the
 * session can still edit the PR body. No escape: a refusal is the PR's.
 *
 * Refuses a PR that is not open or does not target the base branch — the
 * runner's `land` would refuse it anyway, an hour later, as a `land-failed`.
 * The decisions are `lib/land-runner.ts` and `lib/queue-claim.ts`; this file
 * is the I/O.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import {
    addedPaths,
    changedPaths,
    classifyLane,
    contentClasses,
    runPlan,
    type LanePlan,
    type RunResult,
} from "./check-lane";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { prOpenEditArgs, PR_OPEN_LABEL } from "./lib/claim-labels";
import { gh } from "./lib/gh";
import { issueOfBranch } from "./lib/issue-worktree";
import { SHADOW_LABEL } from "./lib/land-labels";
import {
    bodyWithClosingRef,
    handsToQueue,
    labelArgs,
    READY_LABEL,
} from "./lib/land-runner";
import {
    gatePrOf,
    parseTrustedAuthors,
    PR_FILES_JQ,
    prFilesApiPath,
    trustedAuthorStatus,
    type GateStatus,
    type RestPr,
} from "./lib/pr-gate";
import { preQueueSteps } from "./lib/pre-queue-steps";
import { primaryCheckout } from "./lib/primary-checkout";
import { buildPrOpenRow } from "./lib/queue-claim";
import { claimLedgerPath } from "./loop-doctor";
import {
    PR_CHECK_NAMES,
    runPrCheck,
    type PrCheckContext,
    type PrCheckName,
    type PrCheckResult,
} from "./pr-checks";

/** The announced escape for a red that is base's, not the PR's. */
export const PREQUEUE_ESCAPE_ENV = "TOLARIA_PREQUEUE_RED_OK";

export interface PreQueueDeps {
    /** Run one command in the worktree; its output goes to the terminal. */
    exec: (command: string) => { ok: boolean; ms: number };
    log: (line: string) => void;
    /** The lane plan, the paths the diff adds, and those that still exist. */
    plan: LanePlan;
    added: string[];
    present: string[];
}

/**
 * Run the pre-queue steps. Returns the failing step's id, or null when green.
 * Fail-fast, like the lane (`runPlan`).
 */
export function runPreQueue(deps: PreQueueDeps): {
    failed: string | null;
    result: RunResult;
} {
    const { run, skip } = preQueueSteps(deps.plan, deps.added, deps.present);
    deps.log(
        `land:ready: pre-queue check — lane ${deps.plan.lane}, ${run.length} step(s): ${run.map((c) => c.id).join(", ")}`
    );
    for (const s of skip) deps.log(`  skip ${s.id}: ${s.reason}`);
    const result = runPlan({ ...deps.plan, run }, deps.exec, () => undefined);
    const failed = result.outcomes.find((o) => o.status === "fail");
    return { failed: failed?.id ?? null, result };
}

/**
 * `land`'s refusals of the PR's body and diff (issue #5956): every
 * `pr-checks` check, through `runPrCheck`. Returns each refusal as `land`
 * would print it (`land: refusing — <reason>`); empty = none. A note (a
 * check that could not decide) is logged, never a refusal.
 */
export function landRefusals(
    ctx: PrCheckContext,
    log: (line: string) => void,
    check: (
        name: PrCheckName,
        ctx: PrCheckContext
    ) => PrCheckResult = runPrCheck
): string[] {
    const refusals: string[] = [];
    for (const name of PR_CHECK_NAMES) {
        const r = check(name, ctx);
        if (r.note) log(`land:ready: ${name} — NOTE: ${r.note}`);
        if (r.refusal) refusals.push(`land: refusing — ${r.refusal}`);
    }
    return refusals;
}

/** `gate.ts` exit 77: INFRA, nothing ran — never a red step. */
const GATE_INFRA = 77;

/** One command at the light tier; 77 aborts (re-issue), never reads as red. */
function execLight(command: string, cwd: string): { ok: boolean; ms: number } {
    const t0 = Date.now();
    const r = spawnSync(
        "bun",
        [resolve(import.meta.dirname, "gate.ts"), "light", command],
        { stdio: "inherit", cwd }
    );
    if (r.status === GATE_INFRA) {
        throw new Error(
            `\`${command}\` exited ${GATE_INFRA} (machine saturated, nothing ran) — not a red step; re-issue land:ready`
        );
    }
    return { ok: r.status === 0, ms: Date.now() - t0 };
}

function git(args: string[]): string {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return r.stdout;
}

/** Refuse unless this shell is the PR's pushed, clean worktree. */
function assertPrWorktree(pr: number, headOid: string): void {
    const head = git(["rev-parse", "HEAD"]).trim();
    if (head !== headOid) {
        throw new Error(
            `HEAD ${head.slice(0, 9)} is not PR #${pr}'s pushed head ${headOid.slice(0, 9)} — run land:ready from the PR's worktree after \`git push\``
        );
    }
    if (git(["status", "--porcelain"]).trim() !== "") {
        throw new Error(
            "working tree is dirty — commit and push first, so the check describes the tree the runner will land"
        );
    }
}

function preQueueGate(pr: number, headOid: string, prBody: string): void {
    assertPrWorktree(pr, headOid);
    const cwd = process.cwd();
    const refusals = landRefusals({ cwd, prBody }, console.log);
    if (refusals.length > 0) {
        for (const r of refusals) console.error(`✗ ${r}`);
        console.error(
            `✗ land:ready: PR #${pr} NOT queued — \`land\` would refuse it. Fix the PR body or diff, push, re-run.`
        );
        process.exit(1);
    }
    const all = changedPaths(ORIGIN_BASE, cwd, true);
    const present = changedPaths(ORIGIN_BASE, cwd, false);
    const plan = classifyLane(
        all,
        present,
        undefined,
        contentClasses(all, ORIGIN_BASE, cwd)
    );
    const t0 = Date.now();
    const { failed, result } = runPreQueue({
        plan,
        present,
        added: addedPaths(ORIGIN_BASE, cwd),
        exec: (command) => execLight(command, cwd),
        log: console.log,
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (failed === null) {
        console.log(`land:ready: pre-queue check green in ${seconds}s`);
        return;
    }
    if (process.env[PREQUEUE_ESCAPE_ENV] === "1") {
        const note = `land:ready: pre-queue check OVERRIDDEN (${PREQUEUE_ESCAPE_ENV}=1) — \`${failed}\` is red and was queued anyway`;
        console.error(note);
        gh(["pr", "comment", String(pr), "--body", note]);
        return;
    }
    console.error(
        `✗ land:ready: \`${failed}\` is red after ${seconds}s (${result.outcomes.map((o) => `${o.id}:${o.status}`).join(" ")}) — PR #${pr} NOT queued.\n` +
            `  Fix it in this session, commit, push, re-run. Only a red you KNOW is base's: ${PREQUEUE_ESCAPE_ENV}=1 bun run land:ready ${pr} (announced, commented on the PR).`
    );
    process.exit(1);
}

/**
 * The PR's `trusted-author` verdict, computed here exactly as `pr-gate` posts
 * it (issue #5952): the queue admits only a green one. An unreadable
 * `TRUSTED_AUTHORS` trusts nobody, which hands the PR to the runner.
 */
function queueAdmission(pr: number): GateStatus {
    const repo = "{owner}/{repo}";
    const raw = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}`])) as RestPr;
    const files = gh([
        "api",
        "--paginate",
        prFilesApiPath(repo, pr),
        "--jq",
        PR_FILES_JQ,
    ])
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as string);
    let trusted: string[] = [];
    try {
        trusted = parseTrustedAuthors(
            gh(["variable", "get", "TRUSTED_AUTHORS"])
        );
    } catch {
        // Trusts nobody: the runner lands it.
    }
    return trustedAuthorStatus(gatePrOf(raw, files), trusted);
}

function main(): void {
    const numbers = process.argv.slice(2).filter((a) => /^#?\d+$/.test(a));
    if (numbers.length !== 1) {
        console.error("usage: bun run land:ready <PR#>");
        process.exit(2);
    }
    const pr = Number(numbers[0].replace(/^#/, ""));
    const view = JSON.parse(
        gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,headRefName,baseRefName,headRefOid,body,labels,closingIssuesReferences",
        ])
    ) as {
        state: string;
        headRefName: string;
        baseRefName: string;
        headRefOid: string;
        body: string;
        labels: { name: string }[];
        closingIssuesReferences: { number: number }[];
    };
    if (view.state !== "OPEN") {
        console.error(`✗ land:ready: PR #${pr} is ${view.state}, not OPEN`);
        process.exit(1);
    }
    if (view.baseRefName !== BASE_BRANCH) {
        console.error(
            `✗ land:ready: PR #${pr} targets \`${view.baseRefName}\`, not \`${BASE_BRANCH}\` — \`gh pr edit ${pr} --base ${BASE_BRANCH}\`, then re-run`
        );
        process.exit(1);
    }
    preQueueGate(pr, view.headRefOid, view.body);
    const issue = issueOfBranch(view.headRefName);
    if (issue !== null) {
        const body = bodyWithClosingRef(
            view.body,
            issue,
            view.closingIssuesReferences.map((r) => r.number)
        );
        if (body !== null) gh(["pr", "edit", String(pr), "--body", body]);
    }
    const admission = queueAdmission(pr);
    const shadow = handsToQueue({
        trustedAuthor: admission.state,
        labels: view.labels.map((l) => l.name),
    });
    gh(labelArgs.ready(pr, { shadow }));

    if (issue !== null) {
        gh(prOpenEditArgs(issue));
        const ledger = claimLedgerPath(
            process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout()
        );
        mkdirSync(dirname(ledger), { recursive: true });
        appendFileSync(
            ledger,
            JSON.stringify(
                buildPrOpenRow({
                    now: Math.floor(Date.now() / 1000),
                    session: process.env.CLAUDE_CODE_SESSION_ID ?? "",
                    issue,
                    pr,
                    host: hostname(),
                })
            ) + "\n"
        );
    }
    console.log(
        (shadow
            ? `land:ready: PR #${pr} labelled \`${READY_LABEL}\` + \`${SHADOW_LABEL}\` — the Mergify queue lands it`
            : `land:ready: PR #${pr} labelled \`${READY_LABEL}\` — the land-runner lands it (${admission.state === "success" ? "a PR the runner failed stays the runner's" : `the queue would refuse it: ${admission.description}`})`) +
            (issue === null
                ? ""
                : `; issue #${issue} labelled \`${PR_OPEN_LABEL}\`, its claim is now pr-open`)
    );
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(`✗ land:ready: ${(err as Error).message}`);
        process.exit(1);
    }
}
