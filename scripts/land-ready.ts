#!/usr/bin/env bun
/**
 * `bun run land:ready <PR#>` — a session's LAST act: hand the
 * pushed PR to the land-runner. One verb, so the two halves never split:
 *
 *   1. the PR is labelled `ready-to-land` (and loses `land-failed`, so a
 *      repaired PR re-queues with the same command) and, when the Mergify
 *      queue refuses it, `merge:manual` — a marker `pr-refresh` reads; the
 *      queue lands every `ready-to-land` PR. The land-runner is retired: a
 *      PR the queue refuses (one touching `.github/` or `.mergify.yml`) is
 *      merged by the owner with `bun run merge:manual <PR#>`, which refuses
 *      until the PR's advisory lane is green on its up-to-date head;
 *   2. the claim journal gets the issue's `pr-open` row: the claim stands,
 *      but it holds no `sessions.cap` slot on this machine any more;
 *   3. the issue gets the `pr-open` label beside `in-progress`, so the board
 *      shows the hand-off (every release path removes it).
 *
 * BEFORE it queues, it runs the lane's seconds-cost steps on the PR's own
 * worktree (issue #5554, `lib/pre-queue-steps.ts`): a red step means the
 * PR carries an error the runner would only report as `land-failed`, minutes
 * later, to a session that has already exited. Red → exit 1, no label, no
 * `pr-open` row; fix it here. The announced, logged escape for a red that is
 * base's, not the PR's: `TOLARIA_PREQUEUE_RED_OK=1`.
 *
 * Issue #6620: the cheap tier (offline scripts, `isCheapStep`) runs first and
 * ALL of it, the body/diff refusals beside it, and one run names every red;
 * the tests behind a red cheap tier never start. The hand-off push retries a
 * transient rejection (3 attempts, never a non-fast-forward).
 *
 * It also runs `land`'s body/diff refusals FIRST (`pr-checks.ts`
 * — the same functions `land` calls, never a copy): a missing `check:ui`
 * receipt or preset scenario refuses here, with `land`'s own words, while the
 * session can still edit the PR body. No escape: a refusal is the PR's.
 *
 * BEFORE the pre-queue check it puts the derived whole-file state back
 * (ADR 0157 § Option 1b, issue #6248): the generators write the lockfile's
 * header hashes and `data/catalogue/*` locally — a worktree's tests need
 * fresh bytes — but the base writes them after each merge (`derive:sync`),
 * and a PR that still carries them collides with every other PR in the
 * queue. `restoreDerivedState` checks the catalogue files out at the
 * merge-base, rewrites the header hashes to the merge-base's (rows kept,
 * `lib/derived-in-pr.ts`), commits with `--no-verify` and pushes — the
 * hand-off push. Nothing carried = no commit. Either way the pre-queue
 * steps judge the tree as a DRAFT (`TOLARIA_TREE_ROLE=draft`, the queue's
 * own role, `handOff`) — a tree carrying nothing holds the
 * merge-base's derived state, never its own: `check:oracle` judges
 * rows per row — with the corpus cache, copied from the primary checkout
 * when the worktree lacks it — never the header the base owns.
 *
 * Refuses a PR that is not open or does not target the base branch — the
 * runner's `land` would refuse it anyway, an hour later, as a `land-failed`.
 * The decisions are `lib/land-runner.ts` and `lib/queue-claim.ts`; this file
 * is the I/O.
 */
import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
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
import { staleToolingRefusal } from "./lib/stale-tooling";
import { prOpenEditArgs, PR_OPEN_LABEL } from "./lib/claim-labels";
import { checkClaimGate, realClaimGateDeps } from "./lib/claim-gate";
import { DERIVED_PATHS, LOCKFILE_PATH } from "./lib/derive-sync";
import { TREE_ROLE_ENV, type TreeRole } from "./lib/derived-state";
import {
    pinnedSha,
    realCorpusSeedDeps,
    seedPinnedCorpus,
} from "./lib/corpus-cache";
import {
    carriesNothing,
    derivedCarried,
    handOff,
    derivedInDiffProblems,
    restoreHeaderHashes,
    RESTORE_COMMIT_SUBJECT,
    type DerivedCarried,
} from "./lib/derived-in-pr";
import { gh } from "./lib/gh";
import { issueOfBranch } from "./lib/issue-worktree";
import { MANUAL_LABEL } from "./lib/land-labels";
import {
    lastDequeueAt,
    needsDequeueRequeue,
    readBackVerdict,
    type PrComment,
} from "./lib/land-requeue";
import {
    bodyWithClosingRef,
    handsToQueue,
    FAILED_LABEL,
    labelArgs,
    READY_LABEL,
} from "./lib/land-runner";
import {
    gatePrOf,
    parseTrustedAuthors,
    MERGIFY_QUEUED_LABEL,
    REQUEUE_COMMENT,
    PR_FILES_JQ,
    prFilesApiPath,
    trustedAuthorStatus,
    type GateStatus,
    type RestPr,
} from "./lib/pr-gate";
import { isCheapStep, preQueueSteps } from "./lib/pre-queue-steps";
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
    /** Rebuild the derived whole-file state in the tested tree, as the
     *  queue's `check:lane --regenerate-derived` does (issue #6491); false =
     *  it could not be rebuilt. */
    regenerate: () => boolean;
    /** Put the derived paths back to `HEAD`, so the worktree stays clean. */
    restore: () => void;
}

/** The step id reported when the derived state could not be rebuilt. */
export const REGENERATE_STEP = "derive:regenerate";

/** What a red `derive:regenerate` asks of the session (issue #6620). */
export const REGENERATE_FIX =
    "if its output names `ready` rows without a card-index entry: `bun run oracle:index`, then `bun run derive:regenerate`, commit, push";

/**
 * Run the pre-queue steps. `failed` is the first red step's id (null when
 * green); `failedAll` every red of the cheap tier, in order (issue #6620).
 *
 * The cheap tier (`isCheapStep`: offline scripts, seconds each) runs FIRST and
 * runs ALL of it — a session fixes every finding once. A red there skips the
 * expensive tier (the tests) outright; a green cheap tier runs the rest
 * fail-fast, like the lane (`runPlan`). A failed `derive:regenerate` is the
 * first red, and the cheap tier still runs behind it: its findings do not
 * depend on the rebuilt bytes, and one run must name every error.
 */
export function runPreQueue(deps: PreQueueDeps): {
    failed: string | null;
    failedAll: string[];
    result: RunResult;
} {
    const { run, skip } = preQueueSteps(deps.plan, deps.added, deps.present);
    deps.log(
        `land:ready: pre-queue check — lane ${deps.plan.lane}, ${run.length} step(s): ${run.map((c) => c.id).join(", ")}`
    );
    for (const s of skip) deps.log(`  skip ${s.id}: ${s.reason}`);
    const cheap = run.filter(isCheapStep);
    const costly = run.filter((c) => !isCheapStep(c));
    const failedAll: string[] = [];
    const outcomes: RunResult["outcomes"] = [];
    let totalMs = 0;
    // Issue #6491: the lane was classified on the PR's own diff; the steps
    // run on a tree whose derived state is rebuilt, like the queue's draft
    // (`check:lane --regenerate-derived`) — never the merge-base's bytes.
    try {
        if (!deps.regenerate()) {
            deps.log(
                `land:ready: derive:regenerate failed — the derived state could not be rebuilt (${REGENERATE_FIX})`
            );
            failedAll.push(REGENERATE_STEP);
            outcomes.push({ id: REGENERATE_STEP, status: "fail", ms: 0 });
        }
        for (const check of cheap) {
            const r = deps.exec(check.command);
            totalMs += r.ms;
            outcomes.push({
                id: check.id,
                status: r.ok ? "pass" : "fail",
                ms: r.ms,
            });
            if (!r.ok) failedAll.push(check.id);
        }
        if (failedAll.length > 0) {
            for (const check of costly)
                outcomes.push({ id: check.id, status: "not-run", ms: 0 });
        } else {
            const rest = runPlan(
                { ...deps.plan, run: costly },
                deps.exec,
                () => undefined
            );
            outcomes.push(...rest.outcomes);
            totalMs += rest.totalMs;
            for (const o of rest.outcomes)
                if (o.status === "fail") failedAll.push(o.id);
        }
        return {
            failed: failedAll[0] ?? null,
            failedAll,
            result: { ok: failedAll.length === 0, outcomes, totalMs },
        };
    } finally {
        // A restore that throws must not replace the step's verdict.
        try {
            deps.restore();
        } catch (err) {
            deps.log(
                `land:ready: restoring the derived paths failed (${(err as Error).message}) — \`git checkout HEAD -- ${DERIVED_PATHS.join(" ")}\` before re-running`
            );
        }
    }
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

/** One command at the light tier; 77 aborts (re-issue), never reads as red.
 *  `role` is how the tree is judged (ADR 0157): always `draft`
 *  (`handOff`, issue #6348) — after the restore the derived state is the
 *  merge-base's, the base's to write, whether or not this run made the
 *  commit, and `check:oracle` judges rows per row. */
function execLight(
    command: string,
    cwd: string,
    role: TreeRole
): { ok: boolean; ms: number } {
    const t0 = Date.now();
    const r = spawnSync(
        "bun",
        [resolve(import.meta.dirname, "gate.ts"), "light", command],
        {
            stdio: "inherit",
            cwd,
            env: { ...process.env, [TREE_ROLE_ENV]: role },
        }
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

/** A push stderr that is a transient server-side rejection, not a diverged
 *  branch: retrying cannot fix a non-fast-forward (issue #6620). */
export function isTransientPushFailure(stderr: string): boolean {
    if (
        /non-fast-forward|\(fetch first\)|stale info|\(already exists\)/i.test(
            stderr
        )
    )
        return false;
    return /remote rejected|failed to push some refs|unexpected disconnect|timed out|could not read from remote/i.test(
        stderr
    );
}

/** Backoff between the 3 hand-off push attempts, ms (~7 s in all). */
export const PUSH_BACKOFF_MS: readonly number[] = [2000, 5000];

/**
 * Push with retries on a transient rejection. A non-fast-forward (or any
 * non-transient failure) returns at once with its stderr, so the caller's
 * refusal message stays what it was.
 */
export function pushWithRetry(
    push: () => { status: number | null; stderr: string },
    sleep: (ms: number) => void,
    log: (line: string) => void,
    backoffMs: readonly number[] = PUSH_BACKOFF_MS
): { status: number | null; stderr: string } {
    let r = push();
    for (const wait of backoffMs) {
        if (r.status === 0 || !isTransientPushFailure(r.stderr)) return r;
        log(
            `land:ready: transient push rejection — retrying in ${wait / 1000}s`
        );
        sleep(wait);
        r = push();
    }
    return r;
}

/** The git this restore needs — a seam for the test. */
export interface RestoreGit {
    /** `git <args>` in the worktree; throws on failure. */
    run: (args: string[]) => string;
    /** A file's text at a ref, or null when absent there. */
    show: (ref: string, path: string) => string | null;
}

/**
 * Put the derived state the PR carries back to the merge-base (ADR 0157
 * § Option 1b, issue #6248) and commit it: the catalogue files checked out
 * whole, the lockfile's header hashes rewritten over the PR's rows. Returns
 * what was carried (empty = no commit made). The push is the caller's.
 */
export function restoreDerivedState(
    cwd: string,
    base: string,
    git: RestoreGit,
    log: (line: string) => void
): DerivedCarried {
    const mergeBase = git.run(["merge-base", base, "HEAD"]).trim();
    const changed = git
        .run(["diff", "--name-only", mergeBase, "HEAD", "--", ...DERIVED_PATHS])
        .split("\n")
        .filter((p) => p !== "");
    const carried = derivedCarried({
        changed,
        lockfile: () => ({
            head: git.show("HEAD", LOCKFILE_PATH),
            base: git.show(mergeBase, LOCKFILE_PATH),
        }),
        subjectsTouching: (path) =>
            git
                .run(["log", "--format=%s", `${mergeBase}..HEAD`, "--", path])
                .split("\n")
                .filter((s) => s !== ""),
    });
    if (carriesNothing(carried)) {
        log(
            `land:ready: the PR carries no derived state (${changed.length === 0 ? "no derived path changed" : "lockfile rows only"})`
        );
        return carried;
    }
    log(
        `land:ready: restoring derived state to the merge-base ${mergeBase.slice(0, 10)} (ADR 0157):\n` +
            derivedInDiffProblems(carried)
                .map((p) => `  ${p}`)
                .join("\n")
    );
    if (carried.catalogue.length > 0)
        git.run(["checkout", mergeBase, "--", ...carried.catalogue]);
    if (carried.headerKeys.length > 0) {
        const base = git.show(mergeBase, LOCKFILE_PATH);
        if (base === null)
            throw new Error(`${LOCKFILE_PATH} is absent at the merge-base`);
        const path = resolve(cwd, LOCKFILE_PATH);
        writeFileSync(
            path,
            restoreHeaderHashes(readFileSync(path, "utf8"), base)
        );
        git.run(["add", "--", LOCKFILE_PATH]);
    }
    // `--no-verify`: the bytes are the merge-base's, not a human's, and the
    // pre-commit hook would lint a 20 MB generated file.
    git.run(["commit", "-q", "--no-verify", "-m", RESTORE_COMMIT_SUBJECT]);
    return carried;
}

const REAL_RESTORE_GIT: RestoreGit = {
    run: (args) => git(args),
    show: (ref, path) => {
        const r = spawnSync("git", ["show", `${ref}:${path}`], {
            encoding: "utf8",
            maxBuffer: 256 * 1024 * 1024,
        });
        return r.status === 0 ? r.stdout : null;
    },
};

/**
 * The hand-off push (ADR 0157): restore, commit, push to the PR's branch;
 * returns the head the queue will test — the new commit's, or the one the
 * session pushed when nothing was carried.
 */
function restoreAndPush(
    pr: number,
    headOid: string,
    branch: string
): { head: string; role: TreeRole } {
    assertPrWorktree(pr, headOid);
    git(["fetch", "-q", "origin", BASE_BRANCH]);
    // Issue #6341 — before any write: a worktree forked before the base moved
    // the land tooling would hand off with the OLD script and guard set.
    const forkPoint = git(["merge-base", "HEAD", ORIGIN_BASE]).trim();
    const stale = staleToolingRefusal(
        git(["diff", "--name-only", forkPoint, ORIGIN_BASE])
            .split("\n")
            .filter(Boolean),
        ORIGIN_BASE
    );
    if (stale !== null) throw new Error(stale);
    let carried: DerivedCarried;
    try {
        carried = restoreDerivedState(
            process.cwd(),
            ORIGIN_BASE,
            REAL_RESTORE_GIT,
            console.log
        );
    } catch (err) {
        // The tree was asserted clean at `headOid`: put it back there, so a
        // re-run does not die in `assertPrWorktree` on a half-made restore.
        spawnSync("git", ["reset", "-q", "--hard", headOid]);
        throw new Error(
            `derived-state restore failed (${(err as Error).message}) — worktree reset to ${headOid.slice(0, 10)}; fix and re-run`
        );
    }
    const decision = handOff(carried);
    if (!decision.commit) {
        ensureCorpusForDraft(process.cwd());
        return { head: headOid, role: decision.role };
    }
    const head = git(["rev-parse", "HEAD"]).trim();
    const pushed = pushWithRetry(
        () => {
            const r = spawnSync(
                "git",
                ["push", "-q", "origin", `HEAD:refs/heads/${branch}`],
                { encoding: "utf8" }
            );
            return { status: r.status, stderr: r.stderr ?? "" };
        },
        (ms) => void spawnSync("sleep", [String(ms / 1000)]),
        console.log
    );
    if (pushed.status !== 0)
        throw new Error(
            `the restore commit ${head.slice(0, 10)} could not be pushed to ${branch} (${
                pushed.stderr
                    .trim()
                    .split("\n")
                    .find((l) => l.startsWith("!") || l.startsWith("error")) ??
                "git printed no error"
            }) — it is on this branch locally: \`git push origin HEAD:${branch}\` (after a \`git pull --rebase\` if the remote moved), then re-run`
        );
    console.log(
        `land:ready: pushed ${head.slice(0, 10)} — \`${RESTORE_COMMIT_SUBJECT}\` (${carried.catalogue.length} catalogue file(s), header ${carried.headerKeys.join(", ") || "unchanged"})`
    );
    ensureCorpusForDraft(process.cwd());
    return { head, role: decision.role };
}

/**
 * A draft's `check:oracle` judges rows per row and REFUSES without the Card
 * Corpus cache (nothing would check the lockfile): one matching THIS tree's
 * pin is kept, copied from the primary checkout only when it matches, else
 * the pinned bulk is downloaded — the seeding `derive:sync` shares
 * (`lib/corpus-cache.ts`, issue #6381). None obtainable is said, and the
 * pre-queue step then names the fix (`bun run oracle:corpus`).
 */
function ensureCorpusForDraft(cwd: string): void {
    const seed = seedPinnedCorpus(
        cwd,
        primaryCheckout(cwd),
        pinnedSha(cwd),
        realCorpusSeedDeps
    );
    if (!seed.ok)
        console.log(
            `land:ready: ${seed.why} — the draft's check:oracle needs one (bun run oracle:corpus)`
        );
    else if (seed.how !== "kept")
        console.log(`land:ready: corpus cache ${seed.how} for the pin`);
}

function preQueueGate(
    pr: number,
    headOid: string,
    prBody: string,
    role: TreeRole
): void {
    assertPrWorktree(pr, headOid);
    const cwd = process.cwd();
    // Body/diff refusals are cheap: collected, not exited on, so one run names
    // them beside the pre-queue reds (issue #6620).
    const refusals = landRefusals({ cwd, prBody }, console.log);
    const all = changedPaths(ORIGIN_BASE, cwd, true);
    const present = changedPaths(ORIGIN_BASE, cwd, false);
    const plan = classifyLane(
        all,
        present,
        undefined,
        contentClasses(all, ORIGIN_BASE, cwd)
    );
    const t0 = Date.now();
    const { failed, failedAll, result } = runPreQueue({
        plan,
        present,
        added: addedPaths(ORIGIN_BASE, cwd),
        exec: (command) => execLight(command, cwd, role),
        log: console.log,
        regenerate: () =>
            execLight("bun run derive:regenerate", cwd, "draft").ok,
        restore: () => {
            git(["checkout", "-q", "HEAD", "--", ...DERIVED_PATHS]);
        },
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (refusals.length > 0) {
        for (const r of refusals) console.error(`✗ ${r}`);
        if (failedAll.length > 0)
            console.error(
                `✗ land:ready: red steps: ${failedAll.map((id) => `\`${id}\``).join(", ")} (${result.outcomes.map((o) => `${o.id}:${o.status}`).join(" ")}, ${seconds}s)`
            );
        console.error(
            `✗ land:ready: PR #${pr} NOT queued — \`land\` would refuse it. Fix the PR body or diff, push, re-run.`
        );
        process.exit(1);
    }
    if (failed === null) {
        console.log(`land:ready: pre-queue check green in ${seconds}s`);
        return;
    }
    if (process.env[PREQUEUE_ESCAPE_ENV] === "1") {
        const note = `land:ready: pre-queue check OVERRIDDEN (${PREQUEUE_ESCAPE_ENV}=1) — ${failedAll.map((id) => `\`${id}\``).join(", ")} red and queued anyway`;
        console.error(note);
        gh(["pr", "comment", String(pr), "--body", note]);
        return;
    }
    console.error(
        `✗ land:ready: ${failedAll.length} red step(s): ${failedAll.map((id) => `\`${id}\``).join(", ")} after ${seconds}s (${result.outcomes.map((o) => `${o.id}:${o.status}`).join(" ")}) — PR #${pr} NOT queued.\n` +
            (failedAll.includes(REGENERATE_STEP)
                ? `  ${REGENERATE_STEP}: ${REGENERATE_FIX}.\n`
                : "") +
            `  Fix them all in this session, commit, push, re-run. Only a red you KNOW is base's: ${PREQUEUE_ESCAPE_ENV}=1 bun run land:ready ${pr} (announced, commented on the PR).`
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

/** How long the read-back waits for Mergify's rules to act (they took ~40 s). */
const READ_BACK_WAIT_S = 75;
const READ_BACK_POLL_S = 15;

function prLabels(pr: number): string[] {
    const v = JSON.parse(
        gh(["pr", "view", String(pr), "--json", "labels"])
    ) as {
        labels: { name: string }[];
    };
    return v.labels.map((l) => l.name);
}

/**
 * After the label swap, a PR dequeued earlier on this very head is requeued
 * with Mergify's own command, then the labels are read back (issue #6163):
 * `land-failed` returning means the sticky dequeue rule fired again, and the
 * hand-off failed whatever the label swap reported.
 */
function requeueAndReadBack(
    pr: number,
    comments: PrComment[],
    headCommittedAt: string
): void {
    if (
        !needsDequeueRequeue({
            toQueue: true,
            lastDequeueAt: lastDequeueAt(comments),
            headCommittedAt,
        })
    )
        return;
    console.log(
        `land:ready: PR #${pr} was dequeued on this head — posting \`${REQUEUE_COMMENT}\` (Mergify's dequeue reason is sticky)`
    );
    gh(["pr", "comment", String(pr), "--body", REQUEUE_COMMENT]);
    for (let waited = 0; ; waited += READ_BACK_POLL_S) {
        const verdict = readBackVerdict(prLabels(pr));
        if (verdict === "relabelled-failed") {
            throw new Error(
                `PR #${pr} came back \`${FAILED_LABEL}\` — .mergify.yml's rule "a PR the queue rejects is a repair pick" fired on the sticky dequeue reason. Comment \`${REQUEUE_COMMENT}\` or push a new head, then re-run`
            );
        }
        if (verdict === "queued") return;
        if (waited >= READ_BACK_WAIT_S) {
            console.log(
                `land:ready: NOTE — PR #${pr} is not yet labelled \`${MERGIFY_QUEUED_LABEL}\` after ${waited}s; \`land-failed\` has not returned, confirm with \`gh pr view ${pr}\``
            );
            return;
        }
        spawnSync("sleep", [String(READ_BACK_POLL_S)]);
    }
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
            "state,headRefName,baseRefName,headRefOid,body,labels,closingIssuesReferences,comments,commits",
        ])
    ) as {
        state: string;
        headRefName: string;
        baseRefName: string;
        headRefOid: string;
        body: string;
        labels: { name: string }[];
        closingIssuesReferences: { number: number }[];
        comments: PrComment[];
        commits: { committedDate: string }[];
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
    const issue = issueOfBranch(view.headRefName);
    // The claim is checked before any label or journal write (issue #5996).
    if (issue !== null) {
        const refusal = checkClaimGate(
            issue,
            `land:ready ${pr}`,
            process.env,
            realClaimGateDeps(claimLedgerPath)
        );
        if (refusal !== null) {
            console.error(`✗ land:ready: ${refusal}`);
            process.exit(1);
        }
    }
    const { head, role } = restoreAndPush(
        pr,
        view.headRefOid,
        view.headRefName
    );
    preQueueGate(pr, head, view.body, role);
    if (issue !== null) {
        const body = bodyWithClosingRef(
            view.body,
            issue,
            view.closingIssuesReferences.map((r) => r.number)
        );
        if (body !== null) gh(["pr", "edit", String(pr), "--body", body]);
    }
    const admission = queueAdmission(pr);
    const toQueue = handsToQueue({ trustedAuthor: admission.state });
    gh(labelArgs.ready(pr, { manual: !toQueue }));
    if (toQueue)
        requeueAndReadBack(
            pr,
            view.comments,
            // The restore commit's date when one was pushed: the head the
            // queue tests is that one, not the session's.
            head === view.headRefOid
                ? (view.commits.at(-1)?.committedDate ?? "")
                : git(["log", "-1", "--format=%cI", "HEAD"]).trim()
        );

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
        (toQueue
            ? `land:ready: PR #${pr} labelled \`${READY_LABEL}\` — the Mergify queue lands it`
            : `land:ready: PR #${pr} labelled \`${READY_LABEL}\` + \`${MANUAL_LABEL}\` — the owner merges it with \`bun run merge:manual ${pr}\` once its advisory lane is green (the queue refuses it: ${admission.description}); the \`owner-merge\` run emails them`) +
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
