/**
 * Blade SEQUENCE entries (issue #10470, ADR 0185) — `sequence.ts`. Two
 * consecutive Bot decisions through the live Brain request path, the second
 * on the tree the first kept, asserted with and without it. `must` only:
 * a stretch run skips them.
 */

import { describe, expect, it } from "vitest";
import { runBladeSequence } from "../sequence";
import { BLADE_SEQUENCES } from "../sequences";

const tier = process.env.BLADE_TIER ?? "must";

describe.runIf(tier === "must")("blade sequences (tree reuse)", () => {
    for (const entry of BLADE_SEQUENCES) {
        it(entry.label, () => {
            const result = runBladeSequence(entry);
            expect(result.failureMessage).toBe("");
            expect(result.ok).toBe(true);
        });
    }
});
