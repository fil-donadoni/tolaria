/**
 * vitest's experimental filesystem module cache — ON for a bare targeted run,
 * OFF in every gate (issue #4614, after issue #4488 measured and dropped it on
 * `health`).
 *
 * `experimental.fsModuleCache` persists each transformed module to disk, so a
 * later vitest invocation reads the transform back instead of re-running
 * Vite's pipeline on it. The cache key hashes the ABSOLUTE module id, so it
 * only pays inside one long-lived directory: an issue worktree's iteration
 * loop (`bunx vitest run <path>`, again and again — measured −50 % wall, the
 * catalogue transform 10–11 s → 3–4 s) and never a gate (`health` builds a
 * fresh worktree per tip, so every cycle is cold; a whole-project run would
 * write ~384 MB into the worktree for one read). The numbers are in
 * `docs/agents/quality-gates.md` § Filesystem module cache.
 *
 * `TOLARIA_VITEST_FS_CACHE`:
 *   unset / ""  → on, at vitest's default location
 *                 (`node_modules/.experimental-vitest-cache`): it lives and
 *                 dies with the worktree, `land` deletes it, nothing to prune;
 *   "0"         → off. `scripts/gate.ts` exports this for every tier it
 *                 fronts (`gateChildEnv`), so no gate ever types it;
 *   "<dir>"     → on, cached in `<dir>` — the manual knob a re-measurement
 *                 against a stable path would use.
 *
 * No cache-key plugin for `define`: vitest strips `define` from the Vite
 * config and assigns the values on `globalThis` at runtime, so a transform
 * never contains a define value (`__BUILD_COMMIT__` stays fresh on a new
 * commit — pinned by `vitest-fs-cache-invalidation.test.ts`).
 */
export const VITEST_FS_CACHE_ENV = "TOLARIA_VITEST_FS_CACHE";

/** The value that turns the cache off. */
export const VITEST_FS_CACHE_OFF = "0";

export function fsModuleCacheOptions(env: NodeJS.ProcessEnv): {
    experimental?: { fsModuleCache: true; fsModuleCachePath?: string };
} {
    const value = env[VITEST_FS_CACHE_ENV];
    if (value === VITEST_FS_CACHE_OFF) return {};
    if (!value) return { experimental: { fsModuleCache: true } };
    return { experimental: { fsModuleCache: true, fsModuleCachePath: value } };
}

/**
 * The environment `scripts/gate.ts` hands the command it fronts. Pure, so the
 * gate's contract is asserted without a subprocess:
 *
 *   - `TOLARIA_GATE_HELD=1` on the heavy tiers (a nested heavy call passes
 *     straight through);
 *   - `TOLARIA_VITEST_WORKERS` raised to the heavy worker count on the heavy
 *     tiers, unless the caller set it;
 *   - `TOLARIA_VITEST_FS_CACHE=0` on EVERY tier, unconditionally — a gate
 *     never reads or writes the module cache, whatever the caller's shell
 *     exported.
 */
export function gateChildEnv(
    env: NodeJS.ProcessEnv,
    heavy: boolean,
    heavyWorkers: number
): NodeJS.ProcessEnv {
    return {
        ...env,
        TOLARIA_GATE_HELD: heavy ? "1" : env.TOLARIA_GATE_HELD,
        TOLARIA_VITEST_WORKERS:
            env.TOLARIA_VITEST_WORKERS ??
            (heavy ? String(heavyWorkers) : undefined),
        [VITEST_FS_CACHE_ENV]: VITEST_FS_CACHE_OFF,
    };
}

/** What a native allocator prints just before aborting the process. */
const ALLOCATION_ABORT = /memory allocation of \d+ bytes failed/;

/**
 * Did a child vitest die of the machine rather than of its own verdict?
 * Returns the reason, or `null` when the child exited on its own.
 *
 * A child killed by a signal has `status === null`; a native (Rust-style)
 * allocation abort prints `memory allocation of N bytes failed` and dies the
 * same way, often AFTER its tests passed (issue #10656). Neither falsifies a
 * cache claim: nothing was proven, so the caller treats it like the gate's
 * exit-77 INFRA — retry, then skip — never as a pass and never as a red
 * assertion. A child that exits with a number, however non-zero, has given a
 * verdict and is never infra.
 */
export function childInfraDeath(
    status: number | null,
    out: string
): string | null {
    if (status === null) return "child vitest killed by a signal";
    if (status !== 0 && ALLOCATION_ABORT.test(out))
        return "child vitest hit a native allocation abort";
    return null;
}
