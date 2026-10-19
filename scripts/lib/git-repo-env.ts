/**
 * The git environment variables that point a git process at a REPOSITORY
 * other than the one its working directory names (issue #6017).
 *
 * A git hook running in a linked worktree inherits
 * `GIT_DIR=<primary>/.git/worktrees/<name>`. Any process it starts — a gate, a
 * test suite, a test's throwaway `git init` — inherits it too, and a
 * `git init` (bare or not) under an inherited `GIT_DIR` re-initialises THAT
 * repository instead of creating a new one: with `GIT_DIR` set and no
 * `GIT_WORK_TREE`, git writes `core.bare = true` into the shared config, and
 * the primary checkout plus every worktree stop working
 * (`fatal: this operation must be run in a work tree`). Observed on
 * 2026-10-19; 23 of 27 git-initialising test files reproduced it.
 *
 * Scrubbing them restores the only discovery a test should rely on: the
 * working directory it ran git in.
 */
export const GIT_REPO_ENV_KEYS = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
] as const;

/** Delete every {@link GIT_REPO_ENV_KEYS} entry from `env`, in place. */
export function scrubGitRepoEnv(env: NodeJS.ProcessEnv = process.env): void {
    for (const key of GIT_REPO_ENV_KEYS) delete env[key];
}
