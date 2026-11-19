/**
 * Counter-paced misdirection prune — the guard for the blade entry
 * "equipment: the equipped flyer attacks, not its bare twin" (issue #9977).
 *
 * An activation whose whole cost is removing counters from its own source
 * (CR 602.1a) is offered at every priority window of a subtree in which the
 * counters exist, every target variant with it. Below the root, the search
 * prunes the variants of such an activation aimed at the wrong side
 * (`isCounterPacedActivation` in `withoutMisdirectedVariants`, `search.ts`).
 * Without the prune, an Equipment's banked charge counters open "-1/-1 to
 * target creature" edges at the holder's own creatures, their visits drag the
 * mean of every line that banks the counters, and the Bot attacks with the
 * bare twin of the creature carrying the Jitte.
 *
 * Runs the registry entry at its own budget and seeds, so it reddens exactly
 * when the blade entry does — in the bot suite, at a cost of one entry rather
 * than a whole blade shard.
 */

import { describe, it, expect } from "vitest";
import { findBladeScenario, runBladeScenario } from "..";

const LABEL = "equipment: the equipped flyer attacks, not its bare twin";

describe("counter-paced misdirection prune (issue #9977)", () => {
    it("attacks with the creature carrying the Jitte", () => {
        const entry = findBladeScenario(LABEL);
        expect(entry, `blade entry "${LABEL}" must exist`).toBeDefined();
        const result = runBladeScenario(entry!);
        expect(result.ok, result.failureMessage).toBe(true);
    });
});
