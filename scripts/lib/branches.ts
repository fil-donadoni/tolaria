// The ONE place a branch name is resolved from (ADR 0116).
//
// Every script that fetches, rebases, diffs against, fast-forwards or refuses
// on a branch reads it from here; `.claude/hooks/deny-guard.sh` reads the same
// file with `jq`. `scripts/__tests__/branch-literals.test.ts` reds on an
// `origin/<name>` literal anywhere else under `scripts/` or `.claude/hooks/`,
// which is what makes "the base branch" a fact about `tolaria.config.json`
// rather than about 57 call sites (the count when this module was written).
//
// Zero imports beyond node builtins — `health-main.ts` and
// `bootstrap-worktree.ts` import this before `node_modules` may exist.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface BranchConfig {
    /** Integration branch: issue PRs target it, `land` merges into it. */
    base: string;
    /** Production branch: `release` fast-forwards it to a health-proven base tip. */
    release: string;
}

// Same derivation `land.ts` uses for REPO_ROOT: from this FILE's directory,
// not `import.meta.dir`, so the module loads under vitest as well as bun.
export const CONFIG_PATH = resolve(
    __dirname,
    "..",
    "..",
    "tolaria.config.json"
);

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Parse and validate a config document. Exported for the tests. */
export function parseBranchConfig(
    raw: string,
    source = CONFIG_PATH
): BranchConfig {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
    }
    const branches = (doc as { branches?: unknown })?.branches;
    if (!branches || typeof branches !== "object") {
        throw new Error(`${source}: missing "branches" object`);
    }
    const { base, release } = branches as Record<string, unknown>;
    for (const [key, value] of [
        ["base", base],
        ["release", release],
    ] as const) {
        if (typeof value !== "string" || !BRANCH_NAME.test(value)) {
            throw new Error(
                `${source}: branches.${key} must be a git branch name, got ${JSON.stringify(value)}`
            );
        }
    }
    if (base === release) {
        throw new Error(
            `${source}: branches.base and branches.release must differ (both ${JSON.stringify(base)}) — a release is a fast-forward from one to the other`
        );
    }
    return { base: base as string, release: release as string };
}

export function readBranchConfig(path = CONFIG_PATH): BranchConfig {
    return parseBranchConfig(readFileSync(path, "utf8"), path);
}

export const BRANCHES: BranchConfig = readBranchConfig();
export const BASE_BRANCH = BRANCHES.base;
export const RELEASE_BRANCH = BRANCHES.release;
export const ORIGIN_BASE = `origin/${BASE_BRANCH}`;
export const ORIGIN_RELEASE = `origin/${RELEASE_BRANCH}`;
