/**
 * The revert set of a culprit later commits depend on (issue #6766): the
 * culprit together with the later first-parent commits its revert conflicts
 * with, reverted newest first in one worktree, so one PR carries them.
 *
 * The set grows from the conflicts themselves: a revert step that does not
 * apply names its conflicting paths, and the OLDEST later commit (newer than
 * the one being reverted, not yet in the set) touching one of them joins the
 * set; the worktree is reset to the base and the whole set tried again. It ends
 * when every revert applies, when a conflict names no later commit to add
 * (the revert does not apply — the fixer's, ADR 0158 § 3), or when the set
 * passes `MAX_REVERT_SET` (the ladder stops, naming every commit in it).
 *
 * Git is the only I/O; the worktree is the caller's, checked out detached at
 * `base`, and is left with the set's revert commits on top when it applies.
 */
import { spawnSync } from "node:child_process";
import { prOfSubject } from "./health-bisect";
import { MAX_REVERT_SET, type RevertedCommit } from "./health-ladder";

/** One commit of a revert set, as the ladder's texts name it. */
export interface RevertCommit extends RevertedCommit {
    subject: string;
}

export type RevertPlan =
    /** Every revert applied: `set` newest first, the culprit last. */
    | { kind: "applies"; set: RevertCommit[] }
    /** A conflict no later commit explains: `set` is what was tried. */
    | { kind: "conflict"; set: RevertCommit[]; paths: string[] }
    /** The set grew past the cap: `set` names every commit it needs. */
    | { kind: "cap"; set: RevertCommit[] };

function git(args: string[], cwd: string): { ok: boolean; out: string } {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function must(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0)
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`
        );
    return (r.stdout ?? "").trim();
}

const lines = (s: string) => s.split("\n").filter(Boolean);

function commitOf(full: string, cwd: string): RevertCommit {
    const subject = must(["log", "-1", "--format=%s", full], cwd);
    return { sha: full.slice(0, 12), pr: prOfSubject(subject), full, subject };
}

/** The paths a commit changed against its first parent. */
function pathsOf(full: string, cwd: string): string[] {
    return lines(
        must(
            [
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                "-m",
                "--first-parent",
                full,
            ],
            cwd
        )
    );
}

/** Revert `set` (newest first) on `base` in `wt`: null when every revert
 *  applied, else the commit that did not and its conflicting paths. */
function tryRevert(
    set: readonly RevertCommit[],
    base: string,
    wt: string
): { at: RevertCommit; paths: string[] } | null {
    must(["reset", "--hard", "--quiet", base], wt);
    for (const c of set) {
        const r = spawnSync("git", ["revert", "--no-edit", c.full], {
            cwd: wt,
            encoding: "utf8",
        });
        if (r.status === 0) continue;
        const paths = lines(
            git(["diff", "--name-only", "--diff-filter=U"], wt).out
        );
        git(["revert", "--abort"], wt);
        must(["reset", "--hard", "--quiet", base], wt);
        // No conflicting path: not a dependency (an empty revert, an
        // identity error) — the caller's failed try, never a conflict.
        if (paths.length === 0)
            throw new Error(
                `git revert ${c.sha} failed with no conflict: ${`${r.stderr ?? ""}${r.stdout ?? ""}`.trim().slice(0, 200)}`
            );
        return { at: c, paths };
    }
    return null;
}

export function planRevertSet(input: {
    /** The detached worktree the reverts are made in. */
    wt: string;
    /** The culprit's full sha. */
    culprit: string;
    /** The commit the reverts go on top of (the base tip). */
    base: string;
    cap?: number;
}): RevertPlan {
    const { wt, base } = input;
    const cap = input.cap ?? MAX_REVERT_SET;
    // Later first-parent commits, newest first: the only ones a dependent
    // can be.
    const later = lines(
        must(["rev-list", "--first-parent", `${input.culprit}..${base}`], wt)
    );
    const touched = new Map<string, string[]>();
    const pathsAt = (full: string) => {
        let p = touched.get(full);
        if (p === undefined) touched.set(full, (p = pathsOf(full, wt)));
        return p;
    };
    const culprit = commitOf(input.culprit, wt);
    const dependents = new Set<string>();
    const setOf = () => [
        ...later.filter((s) => dependents.has(s)).map((s) => commitOf(s, wt)),
        culprit,
    ];
    for (;;) {
        const set = setOf();
        const failed = tryRevert(set, base, wt);
        if (failed === null) return { kind: "applies", set };
        const newer = later.slice(
            0,
            failed.at.full === culprit.full
                ? later.length
                : later.indexOf(failed.at.full)
        );
        const joining = newer.filter(
            (s) =>
                !dependents.has(s) &&
                pathsAt(s).some((p) => failed.paths.includes(p))
        );
        if (joining.length === 0)
            return { kind: "conflict", set, paths: failed.paths };
        // One at a time, the oldest first — the likeliest direct dependent:
        // a hot path (a lockfile, an index) must not pull in every later
        // commit that ever touched it.
        dependents.add(joining[joining.length - 1]);
        if (dependents.size + 1 > cap) return { kind: "cap", set: setOf() };
    }
}
