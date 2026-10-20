/**
 * Machine pins (issue #5590): every environment variable that overrides, for
 * one process, a decision a script takes from THIS machine — its platform,
 * its load, its slice of `tolaria.config.json` (which runner it is, which
 * store it writes). Topology B' (ADR 0154) runs the
 * same tree on two machines that answer those differently, so a test that
 * spawns a script without a pin passes on one and reds on the other: issue
 * #5465's walk test landed green on the MacBook and went RED on the Huawei.
 *
 * `vitest.setup.node.ts` applies every pin's test value with `??=`, so every
 * script a test spawns inherits it; a test that wants another machine sets
 * the variable itself. `scripts/__tests__/machine-pins.test.ts` refuses a
 * `process.platform` read in `scripts/**` that names neither a pin here nor a
 * mechanics reason.
 *
 * Dependency-free: the test setup imports it.
 */
export const MACHINE_PINS = {
    // Machine admission (issue #4966): a calm machine instead of the real
    // one — a suite run on a saturated machine must neither wait on it nor
    // pass because of it.
    TOLARIA_MACHINE_PROBE: JSON.stringify({
        load1: 0,
        swapUsedMb: 0,
        pressure: 1,
        reclaimableMb: 16_384,
        sessions: [],
    }),
    // The land-runner (issue #5469): runs nowhere — no test merges.
    TOLARIA_LAND_RUNNER_PLATFORM: "",
} as const;

export type MachinePin = keyof typeof MACHINE_PINS;

/** Set every pin `env` does not already carry. */
export function applyMachinePins(env: NodeJS.ProcessEnv = process.env): void {
    for (const [name, value] of Object.entries(MACHINE_PINS))
        env[name] ??= value;
}
