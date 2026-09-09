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
 */
export function buildDefine(): Record<string, string> {
    return {
        __BUILD_COMMIT__: JSON.stringify(buildCommit()),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    };
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
