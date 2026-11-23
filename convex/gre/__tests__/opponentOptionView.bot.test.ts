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
import {
    bladeScenarioAtSeed,
    bladeScenarioSeeds,
    findBladeScenario,
    runBladeScenario,
} from "../ai/blade";
import type { BladeScenario } from "../ai/blade";

const ORACLE_FIRST =
    "Oracle combo: casts Thassa's Oracle before Demonic Consultation into a possible counterspell";
const EITHER_ORDER =
    "Oracle combo: either order when the decklist holds no counterspell";

function entry(label: string): BladeScenario {
    const found = findBladeScenario(label);
    if (!found) throw new Error(`No blade entry "${label}"`);
    return found;
}

// One case per seed: the Oracle-first seed
// loop in one `it` cost ~13 s idle and timed out at 60 s under a contended
// health gate.
describe("opponent option-set statistics (issue #8939)", () => {
    const oracleFirst = entry(ORACLE_FIRST);
    it.each(bladeScenarioSeeds(oracleFirst))(
        "casts Thassa's Oracle first into an opponent who may hold a counterspell (seed %i)",
        (seed) => {
            const result = runBladeScenario(
                bladeScenarioAtSeed(oracleFirst, seed)
            );
            expect(result.failureMessage).toBe("");
            expect(result.seeds.map((s) => s.mechanism)).toEqual([
                "mean-reward",
            ]);
        }
    );

    const eitherOrder = entry(EITHER_ORDER);
    it.each(bladeScenarioSeeds(eitherOrder))(
        "still casts either half when the decklist holds no counterspell (seed %i)",
        (seed) => {
            const result = runBladeScenario(
                bladeScenarioAtSeed(eitherOrder, seed)
            );
            expect(result.failureMessage).toBe("");
        }
    );
});
