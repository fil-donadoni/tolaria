// The fitted latent weights are the ONLY price list (issue #3398, PRD #3397).
//
// The per-Op point constants `opValuers.ts` used to carry — `DESTROY_VALUE`,
// `EXILE_VALUE`, `COUNTER_VALUE`, `DAMAGE_PER_POINT`, `CARD_VALUE` and their
// siblings — were hand-picked once, reachable by no fit and movable by no
// board. They are DELETED, not renamed, and this guard is what keeps them
// deleted: reintroducing one is exactly how the ticket's model would rot back
// into a constant, silently and one Op at a time.
//
// Greps the SOURCE rather than asserting on behaviour, deliberately: a
// re-added constant that happens to equal today's weight changes no number and
// no test — the defect is that it is unreachable, not that it is wrong.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { FEATURE_BASIS } from "../featureBasis";
import { contextFreeGrounding } from "../grounding";

const OP_VALUERS_SOURCE = readFileSync(
    fileURLToPath(new URL("../opValuers.ts", import.meta.url)),
    "utf8"
);

/** The identifiers that became `EvalWeights.latent` entries. Each one is a
 *  DIMENSION price now, so its per-Op constant must not exist. */
const DELETED_CONSTANTS = [
    "DAMAGE_PER_POINT",
    "LIFE_PER_POINT",
    "CARD_VALUE",
    "DESTROY_VALUE",
    "EXILE_VALUE",
    "COUNTER_VALUE",
    "REANIMATE_VALUE",
    "HAND_RETURN_VALUE",
    "HAND_RETURN_SELF_COST",
    "TUCK_VALUE",
    "PUMP_PER_STAT",
    "TOKEN_DISCOUNT",
    "SAC_FORCED_VALUE",
    "RAMP_PER_MANA",
    "GRANT_ABILITY_VALUE",
    "GAIN_CONTROL_VALUE",
    "PREVENT_DAMAGE_FLAT_VALUE",
    "REGENERATE_VALUE",
    "ISLAND_SANCTUARY_PROTECTION_VALUE",
    "PROTECTION_FROM_EVERYTHING_VALUE",
    "SPELL_TO_LIBRARY_TOP_VALUE",
    "SPELL_TO_HAND_VALUE",
] as const;

describe("the deleted per-Op point constants stay deleted (issue #3398)", () => {
    for (const name of DELETED_CONSTANTS) {
        it(`does not DECLARE ${name} in opValuers.ts`, () => {
            // Declarations only — the prose above the table names several of
            // these to say what they were replaced BY, and a guard that
            // reddened on its own explanation would just get the explanation
            // deleted.
            expect(OP_VALUERS_SOURCE).not.toMatch(
                new RegExp(`^\\s*const ${name}\\b`, "m")
            );
        });
    }
});

describe("EvalWeights.latent is the complete fit surface (issue #3398)", () => {
    it("carries exactly one weight per FEATURE_BASIS dimension", () => {
        // A dimension with no weight is one no verdict can move — the gap
        // `DESTROY_VALUE` lived in (PRD #3397 story 11: lower removal without
        // lowering card draw).
        expect(Object.keys(DEFAULT_EVAL_WEIGHTS.latent).sort()).toEqual(
            [...FEATURE_BASIS].sort()
        );
    });

    it("is what a valuer reads — every dimension price reaches the grounding context", () => {
        const ctx = contextFreeGrounding();
        for (const feature of FEATURE_BASIS) {
            expect(ctx.latent.weights[feature]).toBe(
                DEFAULT_EVAL_WEIGHTS.latent[feature]
            );
        }
    });

    it("reports NOT measured with no board attached", () => {
        // The context-free lens must never claim a measurement: that flag is
        // what lifts the `base + MV` coverage floor, and lifting it without a
        // board would zero out every un-scriptable card in hand.
        expect(contextFreeGrounding().latent.measured()).toBe(false);
        expect(contextFreeGrounding().latent.victimUnits(0)).toBeUndefined();
    });
});
