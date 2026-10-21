/**
 * A commit built on a SCRATCH INDEX — never the checkout's index or working
 * tree (issue #5933): `read-tree <base>` into a temporary `GIT_INDEX_FILE`,
 * the given blobs written over it, `write-tree`, `commit-tree -p <base>`.
 * The checkout is exactly as it was whether or not the commit is pushed, so
 * a run killed at any point strands nothing for the next run to build on.
 *
 * Written inside `gaps-sync.ts`'s `commitAndPushAllowlist` for the one
 * allowlist file; extracted when `derive:sync` (ADR 0157 § Option 1b, issue
 * #6247) became the second base writer, with FIVE files per commit. The blobs
 * are the caller's: `hash-object -w --stdin` for text it holds,
 * `hash-object -w <file>` for a regenerated file on disk.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One git invocation, as `spawnSync` answers it. */
export interface GitOutcome {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/** Runs `git <args>` in the repository, with an optional environment. */
export type ScratchGit = (
    args: string[],
    opts?: { env?: NodeJS.ProcessEnv }
) => GitOutcome;

/** A path to record in the commit, and the blob (already in the object
 *  store) to record there. */
export interface ScratchFile {
    readonly path: string;
    readonly blob: string;
}

/**
 * The commit's sha, or the failing git step's stderr. `base` is the parent
 * and the tree every path not in `files` is read from.
 */
export function commitOnScratchIndex(
    git: ScratchGit,
    base: string,
    files: ReadonlyArray<ScratchFile>,
    subject: string
): { readonly sha: string } | { readonly error: string } {
    const scratch = mkdtempSync(join(tmpdir(), "scratch-index-"));
    try {
        const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
        const steps: GitOutcome[] = [git(["read-tree", base], { env })];
        for (const f of files)
            steps.push(
                git(
                    [
                        "update-index",
                        "--add",
                        "--cacheinfo",
                        `100644,${f.blob},${f.path}`,
                    ],
                    { env }
                )
            );
        const tree = git(["write-tree"], { env });
        steps.push(tree);
        const commit =
            tree.status === 0
                ? git([
                      "commit-tree",
                      tree.stdout.trim(),
                      "-p",
                      base,
                      "-m",
                      subject,
                  ])
                : tree;
        steps.push(commit);
        const failed = steps.find((r) => r.status !== 0);
        if (failed !== undefined) return { error: failed.stderr.trim() };
        return { sha: commit.stdout.trim() };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}
