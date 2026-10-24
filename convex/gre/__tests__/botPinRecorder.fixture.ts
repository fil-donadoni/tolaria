// Record mode for the Bot's derived-figure pins (issue #6690, ADR 0158 §3).
//
// A pin that stores a figure the engine computes (a search cost counter, a
// root digest, a leaf score) is a JSON fixture beside its test, never a
// literal in the test source: `bun run bot:refit` re-runs the pin tests with
// `RECORD_BOT_PINS=1`, each one hands its observed figures to a recorder, and
// the fixture is rewritten in one step with the weights it derives from.
//
// THE SECOND DOT IN `.fixture.ts` IS LOAD-BEARING: this module imports
// `node:fs`, and a Convex module may not (see
// `ai/__tests__/committedVerdictCorpus.fixture.ts`).
import { writeFileSync } from "node:fs";

/** True when the run is a `bot:refit` recording, not an assertion. */
export const RECORDING_BOT_PINS = process.env.RECORD_BOT_PINS === "1";

export type PinRecorder = {
    /** Remember `value` under `name` (a test in record mode asserts nothing). */
    set(name: string, value: unknown): void;
    /** Write the fixture, keys in the order `names` gives. Call once, after
     *  every test of the file ran. */
    flush(names: readonly string[]): void;
};

/** A recorder for the fixture at `path`; JSON, 4-space indent, final newline —
 *  the shape prettier leaves alone. */
export function pinRecorder(path: string): PinRecorder {
    const recorded = new Map<string, unknown>();
    return {
        set: (name, value) => {
            recorded.set(name, value);
        },
        flush: (names) => {
            const missing = names.filter((n) => !recorded.has(n));
            if (missing.length > 0) {
                throw new Error(
                    `${path}: nothing recorded for ${missing.join(", ")}`
                );
            }
            const out: Record<string, unknown> = {};
            for (const n of names) out[n] = recorded.get(n);
            writeFileSync(path, JSON.stringify(out, null, 4) + "\n");
        },
    };
}
