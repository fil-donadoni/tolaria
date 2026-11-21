/**
 * Issue #10422: on the issue #10403 report board with only Candelabra of
 * Tawnos removed, the Bot blocks all three attackers rather than leaving
 * Hullbreacher unblocked into the attacker's on-board Pyrite Spellbomb
 * (CR 120.3a, 704.5a). The entry is the blade suite's; this file runs it
 * alone so its proof-of-failure (`activatedDamageReach` cut out of
 * `lethalUnblockedDelta`) finishes in seconds rather than a blade shard.
 */

import { describe, expect, it } from "vitest";
import { findBladeScenario, runBladeScenario } from "..";

const LABEL =
    "lethal reach: the full report board blocks every attacker into an on-board Pyrite Spellbomb";

describe("blocks out of on-board activated burn reach (issue #10422)", () => {
    it("declares Pyromancer, Ivora and the Giant, Hullbreacher blocked, on every seed", () => {
        const entry = findBladeScenario(LABEL);
        if (!entry) throw new Error(`No blade entry "${LABEL}"`);
        const result = runBladeScenario(entry);
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
        // Five seeds at 400 iterations: ~37 s alone, more beside a sibling.
    }, 300_000);
});
