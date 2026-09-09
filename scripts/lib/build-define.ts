import { execSync } from "child_process";

/**
 * Build-identity constants injected into the bundle by the bundler (issue
 * #3256).
 *
 * A bug report that cannot say WHICH BUILD produced it costs a maintainer the
 * most expensive kind of guess: the Brain-Worker investigation behind this
 * change had to infer the reporter's build from the report's date against a
 * merge that had moved the Worker's module graph. A commit is certain, instant,
 * and the highest-value field per byte in the whole payload.
 *
 * Injected at build time rather than read at runtime for two reasons: the
 * client has no way to know its own commit, and a value the client could
 * compute is a value the client could get wrong.
 *
 * Shared by `vite.config.ts` and `vitest.config.ts` — the test suite asserts
 * these are present and non-empty, and it can only do that if the test build
 * defines them the same way the shipped build does.
 *
 * DETERMINISTIC on purpose: both values are derived from the commit, never from
 * the wall clock. A `define` map that changes on every config load changes the
 * dependency-optimizer's cache key on every load with it, and a timestamp that
 * says when the bundler happened to start says nothing a maintainer can act on
 * — the commit's own date does.
 */
export function buildDefine(): Record<string, string> {
    const { commit, committedAt } = buildIdentity();
    return {
        __BUILD_COMMIT__: JSON.stringify(commit),
        __BUILD_COMMIT_AT__: JSON.stringify(committedAt),
    };
}

/** Memoised per process: `vitest` loads this config once, but a watch-mode
 *  reload must not pay for another `git` spawn or produce a different map. */
let cached: { commit: string; committedAt: string } | undefined;

function buildIdentity(): { commit: string; committedAt: string } {
    if (cached) return cached;
    cached = {
        commit: buildCommit(),
        committedAt: commitDate(),
    };
    return cached;
}

/** The commit's own author date, ISO-8601. `"unknown"` when there is no git —
 *  never a blank, and never `Date.now()`, which would be a timestamp about the
 *  BUILD MACHINE dressed up as one about the code. */
function commitDate(): string {
    const fromEnv = process.env.VITE_BUILD_COMMIT_AT?.trim();
    if (fromEnv) return fromEnv;
    try {
        return execSync("git show -s --format=%cI HEAD", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "unknown";
    }
}

/**
 * The commit the bundle was built from. `VITE_BUILD_COMMIT` wins when set (a
 * CI or container build has no `.git`), then git itself, then the literal
 * `"unknown"` — never an empty string, so a consumer can print the field
 * verbatim and a missing value reads as missing rather than as a blank.
 */
function buildCommit(): string {
    const fromEnv = process.env.VITE_BUILD_COMMIT?.trim();
    if (fromEnv) return fromEnv;
    try {
        return execSync("git rev-parse --short HEAD", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "unknown";
    }
}
