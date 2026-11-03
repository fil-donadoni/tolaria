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
// Empty since the land-runner's `TOLARIA_LAND_RUNNER_PLATFORM` went with it
// (issue #5654); the next role decision a script takes from its host adds
// its pin here.
export const MACHINE_PINS = {} as const satisfies Readonly<
    Record<string, string>
>;

export type MachinePin = keyof typeof MACHINE_PINS;

/** Set every pin `env` does not already carry. */
export function applyMachinePins(env: NodeJS.ProcessEnv = process.env): void {
    for (const [name, value] of Object.entries(
        MACHINE_PINS as Readonly<Record<string, string>>
    ))
        env[name] ??= value;
}
