// `configureVitest` is vitest's augmentation of Vite's `Plugin` type.
/// <reference types="vitest/config" />
import type { Plugin } from "vite";

/**
 * vitest's experimental filesystem module cache, behind a flag (issue #4488).
 *
 * `experimental.fsModuleCache` persists each transformed module to disk, so a
 * later vitest invocation reads the transform back instead of re-running
 * Vite's pipeline on it. The spike asked whether that cuts the ~176 s of
 * `transform` the four suites measured (2026-09-24). Verdict: DROP from every
 * gate, `health` included — the numbers and why are in
 * `docs/agents/quality-gates.md` § Filesystem module cache.
 *
 * OFF by default, and no script sets it: it is a manual knob kept for the one
 * re-measurement the verdict names (a stable gate-worktree path).
 * `TOLARIA_VITEST_FS_CACHE=<dir> bun run test` turns it on, keeping the cache
 * in `<dir>`. A path and not a boolean because vitest's default location
 * (`node_modules/.experimental-vitest-cache`) lives inside the worktree, and a
 * gate worktree is deleted at the end of its run.
 */
export const VITEST_FS_CACHE_ENV = "TOLARIA_VITEST_FS_CACHE";

export function fsModuleCacheOptions(env: NodeJS.ProcessEnv): {
    experimental?: { fsModuleCache: true; fsModuleCachePath: string };
} {
    const dir = env[VITEST_FS_CACHE_ENV];
    if (!dir) return {};
    return { experimental: { fsModuleCache: true, fsModuleCachePath: dir } };
}

/**
 * The cache key vitest hashes is the module id, its source, NODE_ENV and a
 * digest of the Vite config — plugin NAMES, not their options. `define` is a
 * plugin option, so a module that reads `__BUILD_COMMIT__` would be served
 * from cache with the PREVIOUS commit baked in whenever its own source did
 * not change. This generator adds the define values to the key of exactly
 * the modules that mention one, so every other module keeps its hit.
 */
export function defineCacheKeyPlugin(define: Record<string, string>): Plugin {
    const keys = Object.keys(define);
    const salt = JSON.stringify(define);
    return {
        name: "tolaria:define-cache-key",
        configureVitest(ctx) {
            ctx.experimental_defineCacheKeyGenerator(({ sourceCode }) =>
                keys.some((k) => sourceCode.includes(k)) ? salt : ""
            );
        },
    };
}
