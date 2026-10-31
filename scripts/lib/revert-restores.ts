/**
 * Does a tree restore paths to the parent of the commits it reverts? The one
 * predicate behind two exemptions (ADR 0156 Amendment II, issue #6071; issue
 * #7658):
 *
 *  - `check:ui`'s — a ladder revert owes no walk when every DOM-reachable
 *    changed path is back to its culprit's parent (`landingRestoresParent`,
 *    `scripts/ui-gate/verify-receipt.ts`, which passes only those paths);
 *  - the lane's — a **pure revert** (`pureRevertOf`: every changed path,
 *    whatever its class) runs the short `revert` lane (`check:lane`).
 *
 * Both say the same thing: these files return to bytes that already landed
 * through the gate; nothing else is claimed. Git is the only I/O, and any
 * read that fails answers "not restored": the exemption is lost, never
 * granted.
 */
import { execFileSync } from "node:child_process";

function gitIn(root: string): (args: string[]) => string | null {
    return (args) => {
        try {
            return execFileSync("git", args, {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                maxBuffer: 64 * 1024 * 1024,
            }).trim();
        } catch {
            return null;
        }
    };
}

/**
 * Does the tree at `root` (its HEAD) restore every one of `paths` to the
 * parent of the reverted commits? Each commit must be in HEAD's history — a
 * revert of a commit that never landed proves nothing — and each path's blob
 * at HEAD must equal its blob at the parent of the OLDEST reverted commit
 * touching it (a revert set, issue #6766: the culprit and the later commits
 * reverted with it), absent on both sides counting as equal; a path none of
 * them touched loses it. No commit → false; no path → true (the caller
 * decides whether an empty set may be exempt).
 */
export function restoresParent(
    reverted: string | readonly string[],
    paths: readonly string[],
    root: string
): boolean {
    const commits = typeof reverted === "string" ? [reverted] : reverted;
    if (commits.length === 0) return false;
    const git = gitIn(root);
    const own = new Map<string, Set<string>>();
    for (const c of commits) {
        if (git(["merge-base", "--is-ancestor", c, "HEAD"]) === null)
            return false;
        if (git(["rev-parse", "--verify", `${c}^`]) === null) return false;
        // Only the reverted commits' own paths: a PR that restores some
        // other file to an old state is not this revert.
        const touched = git([
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            `${c}^`,
            c,
        ]);
        if (touched === null) return false;
        own.set(c, new Set(touched.split("\n").filter(Boolean)));
    }
    const isAncestor = (a: string, b: string) =>
        git(["merge-base", "--is-ancestor", a, b]) !== null;
    // `ls-tree` prints nothing for an absent path and fails on a git error:
    // absent on both sides is equal, an error on both sides is not.
    const blob = (rev: string, p: string) => git(["ls-tree", rev, "--", p]);
    return paths.every((p) => {
        const touching = commits.filter((c) => own.get(c)?.has(p));
        const oldest = touching.find((c) =>
            touching.every((o) => o === c || isAncestor(c, o))
        );
        if (oldest === undefined) return false;
        const head = blob("HEAD", p);
        const parent = blob(`${oldest}^`, p);
        return head !== null && parent !== null && head === parent;
    });
}

const REVERTS_COMMIT = /^This reverts commit ([0-9a-f]{40})\b/gm;

/**
 * The full shas the `This reverts commit <sha>` lines of `messages` name —
 * the line `git revert` writes, and the RED ladder's revert set carries one
 * per commit (`health-revert-set.ts`, `git revert --no-edit`). In first-seen
 * order, without repeats. Pure.
 */
export function revertedCommitsInMessages(messages: string): string[] {
    return [
        ...new Set([...messages.matchAll(REVERTS_COMMIT)].map((m) => m[1])),
    ];
}

/**
 * Is the diff `base...HEAD` at `root` a **pure revert** (issue #7658)? The
 * commits of the branch (`base..HEAD`) name the reverted commits, and every
 * changed path — `changed`, deleted ones included — is byte-identical to its
 * culprit's parent (`restoresParent`). A hand edit on the branch, on a path
 * the culprit touched or on any other, loses it. Returns the reverted shas,
 * or null when the diff is not a pure revert or anything cannot be read.
 *
 * Read from git, never a PR body: the queue's draft carries Mergify's body,
 * and the revert commits survive its rebase with their messages.
 */
export function pureRevertOf(
    base: string,
    root: string,
    changed: readonly string[]
): string[] | null {
    if (changed.length === 0) return null;
    const log = gitIn(root)(["log", "--format=%B", `${base}..HEAD`]);
    if (log === null) return null;
    const reverted = revertedCommitsInMessages(log);
    if (reverted.length === 0) return null;
    return restoresParent(reverted, changed, root) ? reverted : null;
}
