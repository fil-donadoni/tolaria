#!/usr/bin/env bun
/**
 * `bun run post-merge <sync|seed> --before <sha> --after <sha>` / `bun run
 * post-merge sweep` — what a push
 * to the base obliges on a machine (issue #5644, PRD #5620). `post-merge.yml`
 * runs it from a job worktree on every machine; both steps act on the
 * machine's PRIMARY checkout, never on the worktree they run from.
 *
 *   sync   fetch + fast-forward the primary checkout (on the MacBook
 *          `convex dev` serves the deployment from it) — to the PUSHED tip,
 *          and only when that tip is DERIVED-FRESH (`derive:sync --fresh` on
 *          the job worktree: lockfile header hashes and `data/catalogue/*`
 *          agree with the tree; ADR 0157 § Option 1b, issue #6247), so the
 *          deployment never serves a catalogue that disagrees with its
 *          source; a stale tip leaves the primary on the previous fresh one
 *          until the derive commit's own push — remove the worktree each
 *          merged PR left standing, ingest the telemetry.
 *   sweep  hourly, on every machine (issue #6083): remove the issue worktrees
 *          no merge will ever clean up — PR closed unmerged, or no PR, no
 *          claim and idle — by `wt:gc`'s classifier, `--issues-only`.
 *   seed   the `seed` machine only: fast-forward again (a no-op when `sync`
 *          already did), register each merged PR's `## Preset scenario`, and
 *          `seed:preset --all` when the push changed a card set.
 *
 * Every step is idempotent and runs even when an earlier one failed, except a
 * seed after a failed fast-forward (`seedPlan`). The exit code is 1 when any
 * step failed: in a job that is the red the owner sees — `land` hid the same
 * failures behind `; true` because a merge cannot be undone, a workflow can
 * simply be re-run.
 *
 * A PRIMARY THAT DIVERGED (issue #5873). Observed 2026-10-16: a `gaps:sync`
 * allowlist commit whose push lost a race stayed on the Huawei's primary, and
 * from then on every `sync` leg there failed, silently, for a day. Now the
 * fast-forward HEALS the one divergence that is the pipeline's own — local
 * commits that are all `gaps:sync` allowlist writes (`strandedAllowlistOnly`,
 * dropped with `reset --keep`; the next sync re-derives every number) — and
 * for any other divergence the leg goes red AND tells the owner through the
 * channel a RED uses (`lib/notify-owner.ts`), once per distinct failure
 * (`.claude/telemetry/post-merge/notice.json` beside the log remembers the
 * last one; a green leg clears it). What this leg cannot heal is the owner's
 * — nothing else on the machine depends on it: `housekeeping` and `nightly`
 * run on any lane runner and never touch the primary.
 *
 * The decisions are `lib/post-merge.ts`; this file is the I/O.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { ALLOWLIST_PATH } from "./check-gaps";
import { ALLOWLIST_COMMIT_SUBJECT } from "./gaps-sync";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { gh } from "./lib/gh";
import { forgetNotice, notifyOnce } from "./lib/notify-owner";
import {
    mergedPrNumbers,
    cwdInside,
    mergedWorktree,
    pushRange,
    seedPlan,
    syncNotice,
} from "./lib/post-merge";
import { primaryCheckout } from "./lib/primary-checkout";
import { gcLine, worktreeGc } from "./worktree-gc";

/** Wall for one child: a hung `convex` call must not hold the lane runner. */
const STEP_WALL_MS = 10 * 60_000;

/** Where the last notice sent for a red `sync` leg is remembered, relative
 *  to the primary checkout. */
export const NOTICE_FILE = join(
    ".claude",
    "telemetry",
    "post-merge",
    "notice.json"
);

function git(
    args: string[],
    cwd: string
): { ok: boolean; out: string; err: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return {
        ok: r.status === 0,
        out: (r.stdout ?? "").trim(),
        err: (r.stderr ?? "").trim(),
    };
}

function bun(args: string[], cwd: string): boolean {
    const r = spawnSync("bun", args, {
        cwd,
        stdio: "inherit",
        timeout: STEP_WALL_MS,
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    });
    return r.status === 0;
}

/**
 * The local commits a fast-forward refused on, when every one of them is a
 * `gaps:sync` allowlist write whose push lost a race — the one divergence
 * this script repairs (by dropping them: the next sync re-derives them).
 * Anything else, or nothing, is false. Pure.
 */
export function strandedAllowlistOnly(
    commits: ReadonlyArray<{ subject: string; files: string[] }>
): boolean {
    return (
        commits.length > 0 &&
        commits.every(
            (c) =>
                c.subject === ALLOWLIST_COMMIT_SUBJECT &&
                c.files.length === 1 &&
                c.files[0] === ALLOWLIST_PATH
        )
    );
}

/** The first non-blank line of git's stderr — its own reason. */
export function gitErrorLine(stderr: string): string {
    return (
        stderr
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l !== "") ?? "git printed no error"
    );
}

/**
 * Why a `merge --ff-only` was refused, for the red the owner reads (issue
 * #6018). "Diverged" only when HEAD really is not an ancestor of the base —
 * checked, never inferred from an empty local-commit list: a branch with no
 * commits of its own cannot diverge, and its refusal is git's (an untracked
 * file in the way, a dirty tree, a lock). Git's own line rides along always.
 * Pure.
 */
export function fastForwardRefusal(r: {
    gitError: string;
    headOnBase: boolean;
    local: ReadonlyArray<{ subject: string }>;
}): string {
    const why = `git: ${gitErrorLine(r.gitError)}`;
    if (r.headOnBase) return `no local commits, yet git refused (${why})`;
    const held =
        r.local.length === 0
            ? ""
            : `: it holds ${r.local.length} local commit(s) not on the base: ${r.local.map((c) => JSON.stringify(c.subject)).join(", ")}`;
    return `it diverged from the base${held} (${why})`;
}

/** The primary checkout's commits not on `target` (`origin/<base>`, or the
 *  tip a leg fast-forwards to), with their files. */
export function localCommits(
    primary: string,
    target: string = ORIGIN_BASE
): { subject: string; files: string[] }[] {
    const shas = git(["rev-list", `${target}..HEAD`], primary).out;
    return shas === ""
        ? []
        : shas.split("\n").map((sha) => ({
              subject: git(["log", "-1", "--format=%s", sha], primary).out,
              files: git(
                  ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
                  primary
              ).out.split("\n"),
          }));
}

/**
 * Fetch, then fast-forward the primary checkout to `target` — only when it
 * has the base branch checked out, and `--ff-only` on top: anything else
 * would move a branch of the owner's work in progress (the guard `land`
 * always had). A refusal over stranded `gaps:sync` commits alone is healed
 * (issue #5873): they are dropped and the fast-forward retried.
 *
 * `target` is the PUSHED tip a leg was dispatched for (ADR 0157, issue
 * #6247), never the latest `origin/<base>`: a leg moves the primary only to
 * a tip it has judged derived-fresh (`judgeTip`), and a later push's own leg
 * judges its own tip. A primary already past `target` is left where it is
 * (`--ff-only` on an ancestor is a no-op). The default is the base tip, for
 * a hand run.
 */
export function fastForward(
    primary: string,
    target: string = ORIGIN_BASE
): boolean {
    if (
        !git(["fetch", "--no-tags", "--quiet", "origin", BASE_BRANCH], primary)
            .ok
    ) {
        console.error("post-merge: could not fetch origin");
        return false;
    }
    const head = git(["symbolic-ref", "--quiet", "--short", "HEAD"], primary);
    if (head.out !== BASE_BRANCH) {
        console.error(
            `post-merge: ${primary} is on ${head.out || "a detached HEAD"}, not ${BASE_BRANCH} — left as it was`
        );
        return false;
    }
    const merged = git(["merge", "--ff-only", "--quiet", target], primary);
    if (merged.ok) return true;
    const local = localCommits(primary, target);
    if (strandedAllowlistOnly(local)) {
        if (
            git(["reset", "--keep", "--quiet", target], primary).ok &&
            git(["merge", "--ff-only", "--quiet", target], primary).ok
        ) {
            console.log(
                `post-merge: healed ${primary} — dropped ${local.length} stranded gaps:sync commit(s) (the next sync re-derives them)`
            );
            return true;
        }
        console.error(
            `post-merge: could not drop the stranded gaps:sync commit(s) in ${primary}`
        );
        return false;
    }
    console.error(
        `post-merge: could not fast-forward ${BASE_BRANCH} in ${primary} to ${target} — ${fastForwardRefusal(
            {
                gitError: merged.err,
                headOnBase: git(
                    ["merge-base", "--is-ancestor", "HEAD", target],
                    primary
                ).ok,
                local,
            }
        )} — pull it by hand`
    );
    return false;
}

/** This script's own tree — the job worktree, at the pushed tip. */
const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

/** Whether the pushed tip may be deployed (ADR 0157 § Option 1b,
 *  "Deployment"): `fresh` / `stale` by `derive:sync --fresh` on this tree;
 *  `unjudged` when this tree is not at that tip (a hand run from another
 *  checkout), which fast-forwards as before, saying so. */
export type TipJudgement =
    | { kind: "fresh" }
    | { kind: "stale"; why: string }
    | { kind: "unjudged"; why: string };

/**
 * Judge `sha` on THIS tree — the hashes and the catalogue generators can
 * speak only for the tree they are imported with, so a tree at another
 * commit cannot judge it. `derive:sync --fresh` is a second or so, offline.
 */
export function judgeTip(sha: string, root: string = ROOT): TipJudgement {
    const head = git(["rev-parse", "HEAD"], root).out;
    if (head !== sha)
        return {
            kind: "unjudged",
            why: `this tree is at ${head.slice(0, 10)}, not ${sha.slice(0, 10)}`,
        };
    const r = spawnSync("bun", ["scripts/derive-sync.ts", "--fresh"], {
        cwd: root,
        encoding: "utf8",
        timeout: STEP_WALL_MS,
        killSignal: "SIGKILL",
    });
    if (r.status === 0) return { kind: "fresh" };
    const last =
        `${r.stdout ?? ""}${r.stderr ?? ""}`
            .trim()
            .split("\n")
            .filter((l) => l.trim() !== "")
            .at(-1) ?? `exit ${r.status ?? r.signal ?? "?"}`;
    return { kind: "stale", why: last.replace(/^derive:sync: /, "") };
}

/** The line a leg prints for a tip it does not deploy. Pure. */
export function tipHeldLine(
    sha: string,
    primary: string,
    judged: TipJudgement
): string | null {
    if (judged.kind === "fresh") return null;
    if (judged.kind === "unjudged")
        return `post-merge: ${sha.slice(0, 10)} not judged derived-fresh (${judged.why}) — fast-forwarding regardless`;
    return `post-merge: ${sha.slice(0, 10)} is derived-stale (${judged.why}) — ${primary} stays on its previous tip until derive:sync lands (ADR 0157)`;
}

/** The I/O `removeMergedWorktree` does — a seam for the test. */
export interface MergedWorktreeIo {
    /** The PR's head branch, as `gh` prints it (trailing newline and all). */
    headOf: (pr: number) => string;
    exists: (path: string) => boolean;
    /** `lsof -a -d cwd -Fn` output. */
    cwds: () => string;
    git: (args: string[], cwd: string) => { ok: boolean };
    log: (line: string) => void;
}

const MERGED_WORKTREE_IO: MergedWorktreeIo = {
    headOf: (pr) =>
        gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "headRefName",
            "--jq",
            ".headRefName",
        ]),
    exists: existsSync,
    cwds: () =>
        spawnSync("lsof", ["-a", "-d", "cwd", "-Fn"], { encoding: "utf8" })
            .stdout ?? "",
    git,
    log: (line) => console.log(line),
};

/**
 * Remove the worktree a merged PR's session left standing. Every outcome is
 * a logged line (issue #6083): a branch naming no issue worktree used to be
 * a silent success, which hid that EVERY merge was skipped. false = a failed
 * lookup or removal, the leg's red.
 */
export function removeMergedWorktree(
    primary: string,
    pr: number,
    io: MergedWorktreeIo = MERGED_WORKTREE_IO
): boolean {
    let head: string;
    try {
        head = io.headOf(pr).trim();
    } catch (e) {
        console.error(`post-merge: PR #${pr}: ${(e as Error).message}`);
        return false;
    }
    const wt = mergedWorktree(primary, head);
    if (wt === null) {
        io.log(
            `post-merge: PR #${pr}: head branch ${JSON.stringify(head)} maps to no issue worktree — nothing to remove`
        );
        return true;
    }
    if (!io.exists(wt)) {
        io.git(["worktree", "prune"], primary);
        io.log(`post-merge: PR #${pr}: worktree ${wt} not on this machine`);
        return true;
    }
    if (cwdInside(io.cwds(), wt)) {
        io.log(
            `post-merge: PR #${pr}: worktree ${wt} is in use (land?) — left to its owner`
        );
        return true;
    }
    const removed = io.git(["worktree", "remove", "--force", wt], primary).ok;
    io.log(
        `post-merge: PR #${pr}: worktree ${wt} ${removed ? "removed" : "NOT removed"}`
    );
    return removed;
}

function readPush(before: string, after: string, primary: string) {
    const range = pushRange(before, after);
    const subjects = git(
        ["log", "--reverse", "--format=%s", range],
        primary
    ).out.split("\n");
    const files = git(["diff", "--name-only", range], primary)
        .out.split("\n")
        .filter(Boolean);
    return { prs: mergedPrNumbers(subjects), files };
}

/** The I/O `syncSteps` and `seed` reach past git — a seam for the test. */
export interface SyncIo {
    judge: (sha: string) => TipJudgement;
    ingest: (primary: string) => boolean;
    removeWorktree: (primary: string, pr: number) => boolean;
}

const SYNC_IO: SyncIo = {
    judge: judgeTip,
    ingest: (primary) =>
        bun(["scripts/telemetry-ingest.ts", "--quick"], primary),
    removeWorktree: removeMergedWorktree,
};

/**
 * The failing steps of a `sync`, by name — what the owner's notice lists. The
 * fast-forward goes to the pushed tip, and only when it is derived-fresh
 * (ADR 0157, issue #6247): a stale tip is held, said, and is not a failure —
 * the derive commit's own push brings a fresh tip within the housekeeping
 * window.
 */
export function syncSteps(
    primary: string,
    before: string,
    after: string,
    io: SyncIo = SYNC_IO
): string[] {
    const failed: string[] = [];
    const judged = io.judge(after);
    const held = tipHeldLine(after, primary, judged);
    if (held !== null) console.log(held);
    if (judged.kind === "stale")
        // Held, not moved — but the push's commits are still read below.
        git(["fetch", "--no-tags", "--quiet", "origin", BASE_BRANCH], primary);
    else if (!fastForward(primary, after))
        failed.push(`fast-forward of ${primary}`);
    const { prs } = readPush(before, after, primary);
    for (const pr of prs)
        if (!io.removeWorktree(primary, pr))
            failed.push(`worktree of PR #${pr}`);
    if (!io.ingest(primary)) failed.push("telemetry ingest");
    return failed;
}

/** Tell the owner about a red leg — once per distinct failure; a green leg
 *  forgets the last notice. */
function notice(primary: string, failed: readonly string[]): void {
    const path = join(primary, NOTICE_FILE);
    const n = syncNotice(failed, hostname());
    if (n === null) {
        forgetNotice(path);
        return;
    }
    if (notifyOnce(path, n.key, n.message, "Tolaria post-merge"))
        console.log(`post-merge: notifying the owner: ${n.message}`);
}

export function sync(primary: string, before: string, after: string): boolean {
    const failed = syncSteps(primary, before, after);
    notice(primary, failed);
    return failed.length === 0;
}

/**
 * The seed resolves card names against the primary's disk, so it needs the
 * primary AT the pushed tip — and the primary moves only to a derived-fresh
 * one (ADR 0157). A stale tip is therefore a red here, named: until issue
 * #6248 lands, PRs carry fresh derived state and a stale tip is a PR that
 * merged stale, worth the red; once they stop, the seed must wait for the
 * derive commit instead (issue #6248's to decide — see its note in the PR).
 */
export function seed(
    primary: string,
    before: string,
    after: string,
    io: Pick<SyncIo, "judge"> = SYNC_IO
): boolean {
    const judged = io.judge(after);
    const held = tipHeldLine(after, primary, judged);
    if (held !== null) console.log(held);
    const ff = judged.kind !== "stale" && fastForward(primary, after);
    const { prs, files } = readPush(before, after, primary);
    const plan = seedPlan(ff, prs, files);
    if (judged.kind === "stale")
        console.error(
            `post-merge: nothing seeded for PR(s) ${prs.map((p) => `#${p}`).join(" ") || "(none)"} — seed by hand (bun run seed:scenario <PR>) once derive:sync has landed`
        );
    if (!ff) return false;
    let ok = true;
    for (const pr of plan.scenarios)
        ok = bun(["scripts/seed-scenario.ts", String(pr)], primary) && ok;
    if (plan.presets)
        ok = bun(["scripts/seed-preset-deck.ts", "--all"], primary) && ok;
    return ok;
}

/**
 * The orphan sweep (issue #6083): every issue worktree on this machine,
 * classified by `wt:gc`, each listed with its verdict; the removable ones
 * removed. Red when the facts could not be read or a removal failed.
 */
export function sweep(primary: string): boolean {
    const rows = worktreeGc(primary, { apply: true, issuesOnly: true });
    if (rows === null) {
        console.error(
            "post-merge: sweep: could not read the PR lists or the claims — nothing removed"
        );
        return false;
    }
    for (const row of rows) console.log(gcLine(row, dirname(primary)));
    console.log(
        `post-merge: sweep: ${rows.length} issue worktree(s), ${rows.filter((r) => r.removed === true).length} removed`
    );
    return rows.every((r) => r.removed !== false);
}

function flag(argv: string[], name: string): string {
    const i = argv.indexOf(name);
    const v = i === -1 ? undefined : argv[i + 1];
    if (!v)
        throw new Error(
            `usage: bun run post-merge <sync|seed> --before <sha> --after <sha> (missing ${name})`
        );
    return v;
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const step = argv[0];
    if (step !== "sync" && step !== "seed" && step !== "sweep") {
        console.error(
            "usage: bun run post-merge <sync|seed> --before <sha> --after <sha> | sweep"
        );
        process.exit(2);
    }
    const primary = primaryCheckout();
    if (step === "sweep") process.exit(sweep(primary) ? 0 : 1);
    const run = step === "sync" ? sync : seed;
    process.exit(
        run(primary, flag(argv, "--before"), flag(argv, "--after")) ? 0 : 1
    );
}
