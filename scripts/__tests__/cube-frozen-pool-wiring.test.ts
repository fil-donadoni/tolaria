// Source guard: every draft-engine entry point the Limited mutations call
// MUST be handed the cube pool frozen on the event (ADR 0062).
//
// Why a source guard and not a behavior test. `startDraft`/`applyPick`/
// `runBotAutoPicks` take `cubePool` as an OPTIONAL trailing parameter (the
// per-set path has no pool, and making it required would touch ~100 call
// sites). Optional means a future edit can silently drop it at one call site,
// and the resulting bug is invisible to every unit test: the deal only breaks
// when the LIVE card registry changes BETWEEN two mutation invocations of the
// same draft — a cube card implemented and deployed mid-draft. That is exactly
// how the shipped bug happened (a real 7-seat cube draft dealt 43 duplicate
// cards across its 315), and no in-process test can reproduce a redeploy.
//
// The behavioral half of this invariant lives in
// `convex/__tests__/limitedEvents.test.ts` ("Vintage Cube singleton across the
// whole event") and `convex/limited/__tests__/draftEngine.test.ts`; this file
// only pins the wiring those tests assume.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Files whose calls into the draft engine deal real, persisted packs. */
const DEALING_MODULES = [
    "convex/limitedEvents.ts",
    "src/lib/limited/draftLabEngine.ts",
    "src/lib/limited/draftReplayEngine.ts",
];

const ENTRY_POINTS = ["startDraft", "applyPick", "runBotAutoPicks"] as const;

/** Every argument list passed to `name(` in `source`, as raw text. Matches the
 *  project's formatting (prettier breaks these calls across lines and closes
 *  them on their own `);` line), which is enforced by `check:all`. */
function callArgumentLists(source: string, name: string): string[] {
    const pattern = new RegExp(`\\b${name}\\(\\n([\\s\\S]*?)\\n\\s*\\);`, "g");
    return [...source.matchAll(pattern)].map((m) => m[1]);
}

describe("cube frozen-pool wiring (ADR 0062)", () => {
    for (const modulePath of DEALING_MODULES) {
        const source = readFileSync(
            resolve(process.cwd(), modulePath),
            "utf-8"
        );

        for (const entry of ENTRY_POINTS) {
            const calls = callArgumentLists(source, entry);
            if (calls.length === 0) continue;

            it(`${modulePath} passes a frozen cube pool to every ${entry}() call`, () => {
                for (const args of calls) {
                    expect(
                        args,
                        `A ${entry}() call in ${modulePath} does not pass a cube pool. A cube draft deals every round from ONE seeded shuffle of the pool frozen at start; re-deriving it per round re-deals cards seats have already picked.`
                    ).toMatch(/cubePool/);
                }
            });
        }
    }

    it("still finds the call sites it is guarding (the regex has not rotted)", () => {
        // A silently non-matching regex would make every assertion above
        // vacuous — pin that the guard sees the mutations it exists for.
        const source = readFileSync(
            resolve(process.cwd(), "convex/limitedEvents.ts"),
            "utf-8"
        );
        expect(
            callArgumentLists(source, "startDraft").length
        ).toBeGreaterThanOrEqual(1);
        expect(
            callArgumentLists(source, "applyPick").length
        ).toBeGreaterThanOrEqual(2);
        expect(
            callArgumentLists(source, "runBotAutoPicks").length
        ).toBeGreaterThanOrEqual(3);
    });
});
