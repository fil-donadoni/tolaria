/**
 * Issue #10403: at five life, facing three attackers and an opponent with a
 * Pyrite Spellbomb on the battlefield, the Bot blocks all three (CR 510.1b,
 * 120.3a). The entry is the blade suite's; this file runs it alone so its
 * proof-of-failure (the runner's budget cut to the field's ~12 root visits)
 * finishes in seconds rather than a blade shard.
 */

import { describe, expect, it } from "vitest";
import { findBladeScenario, runBladeScenario } from "..";

const LABEL =
    "lethal reach: blocks every attacker at 5 life against an on-board Pyrite Spellbomb";

describe("blocks into on-board burn reach at the production budget (issue #10403)", () => {
    it("declares Pyromancer, Ivora and the Giant, Hullbreacher blocked, on every seed", () => {
        const entry = findBladeScenario(LABEL);
        if (!entry) throw new Error(`No blade entry "${LABEL}"`);
        const result = runBladeScenario(entry);
        expect(result.failureMessage).toBe("");
        expect(result.ok).toBe(true);
    });
});
