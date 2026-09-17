// `tolaria.config.json`, as code: the ONE place a branch name is resolved from
// (ADR 0116), and the one place the session cap is read from (ADR 0136 §7).
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

// ─────────────────────────────────────────────────────────────────────────────
// Session admission (ADR 0136 §7)
//
// The same document already answers "which branch?"; it now also answers "how
// many passes at once?". The two live together because they are the same KIND
// of fact — a repository-level workflow setting a human changes deliberately,
// read by scripts rather than written into them — and because this module is
// already the one reader every script trusts for that file.
//
// The cap is MEASURED, not chosen: PRs per hour by active sessions ran
// 0.59 (1) → 1.44 (3) → 1.19 (4), so three is the knee and a fourth session
// buys negative throughput. Moving it is a config edit plus the telemetry row
// that justifies it (`bun run telemetry:latency`); the derivation table lives
// in `docs/agents/quality-gates.md` § Session admission.
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionConfig {
    /** Live claims the queue admits at once. */
    cap: number;
}

/** Parse and validate the `sessions` block. Exported for the tests. */
export function parseSessionConfig(
    raw: string,
    source = CONFIG_PATH
): SessionConfig {
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch (e) {
        throw new Error(`${source}: not valid JSON — ${(e as Error).message}`);
    }
    const sessions = (doc as { sessions?: unknown })?.sessions;
    if (!sessions || typeof sessions !== "object") {
        throw new Error(`${source}: missing "sessions" object`);
    }
    const { cap } = sessions as Record<string, unknown>;
    // A cap of 0 admits nothing ever and a fractional one compares as garbage
    // against a claim COUNT — both would refuse every pick with a message that
    // reads like a live cap, which is the failure mode this validation exists
    // to make loud instead of silent.
    if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1) {
        throw new Error(
            `${source}: sessions.cap must be a positive integer, got ${JSON.stringify(cap)}`
        );
    }
    return { cap };
}

export function readSessionConfig(path = CONFIG_PATH): SessionConfig {
    return parseSessionConfig(readFileSync(path, "utf8"), path);
}

export const SESSIONS: SessionConfig = readSessionConfig();
export const SESSION_CAP = SESSIONS.cap;
