/**
 * Issue #8939 — an opponent's decision node selects by the statistics of the
 * option set it holds in the world (`opponentOptionView`, `search.ts`), never
 * by statistics pooled across worlds that differ in what it holds.
 *
 * Pooled, the opponent's `pass` also collected the worlds where passing was
 * its only move: holding Counterspell half the time, it countered the first
 * spell in every counter world and never let Demonic Consultation resolve to
 * counter Thassa's Oracle — so the Bot sequenced Consultation first.
 *
 * The position is the blade entry's own; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { findBladeScenario, runBladeScenario } from "../ai/blade";

const ORACLE_FIRST =
    "Oracle combo: casts Thassa's Oracle before Demonic Consultation into a possible counterspell";
const EITHER_ORDER =
    "Oracle combo: either order when the decklist holds no counterspell";

function run(label: string) {
    const entry = findBladeScenario(label);
    if (!entry) throw new Error(`No blade entry "${label}"`);
    return runBladeScenario(entry);
}

describe("opponent option-set statistics (issue #8939)", () => {
    it("casts Thassa's Oracle first into an opponent who may hold a counterspell", () => {
        const result = run(ORACLE_FIRST);
        expect(result.failureMessage).toBe("");
        expect(result.seeds.map((s) => s.mechanism)).toEqual(
            result.seeds.map(() => "mean-reward")
        );
    });

    it("still casts either half when the decklist holds no counterspell", () => {
        expect(run(EITHER_ORDER).failureMessage).toBe("");
    });
});
