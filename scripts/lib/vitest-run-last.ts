/**
 * The files a vitest run puts LAST in their project (issue #7584): the RED
 * ladder names a failing file here so, in one `isolate: false` worker, every
 * other file of its project — the polluter of a cross-file leak included —
 * runs before it, whatever the duration cache says. Read by
 * `lib/vitest-sequencer.ts`; unset, the order is unchanged. Node builtins
 * only: the ladder and the sequencer both import it.
 */

/** Comma-separated paths, relative to the vitest root. */
export const RUN_LAST_ENV = "TOLARIA_VITEST_RUN_LAST";

/** The paths `RUN_LAST_ENV` names in `env`. */
export function runLastFiles(
    env: Readonly<Record<string, string | undefined>>
): Set<string> {
    return new Set(
        (env[RUN_LAST_ENV] ?? "")
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
    );
}
