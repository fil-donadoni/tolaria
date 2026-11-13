// One-shot mana sources in the Limited mana-base model (issue #9337): a card
// that sacrifices itself for mana (CR 602.1, 701.21; a mana ability, CR
// 605.1a) pays one pip once, so it counts as half a source of its colours in
// Castability, Fixing Value, the third-colour gate and the audit's
// castability, never as a permanent source like a land or a Mox.
import { describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import { manaValue } from "../../gre/constants";
import {
    ONE_SHOT_SOURCE_WEIGHT,
    scoreCandidate,
    sourceCountsByColor,
    type CardEvalMeta,
    type PickTermKey,
} from "../botDrafter";
import { hypergeometricAtLeast, pipCastability } from "../castability";
import { limitedSourceColors, oneShotSourceColors } from "../manaSourceColors";

const def = (name: string) => tryGetDefinition(getCardByName(name).id)!;

/** The meta every Limited producer builds (`limitedEvents.ts`,
 *  `draftLabCardMeta.ts`), from the real definition. */
function metaOf(name: string): CardEvalMeta {
    const d = def(name);
    return {
        cardId: d.id,
        colors: getCardColorIdentity(d),
        manaValue: manaValue(d.manaCost),
        rarity: d.rarity,
        pips: getPipCountsFromCost(d.manaCost),
        producedColors: limitedSourceColors(d),
        oneShotColors: oneShotSourceColors(d),
    };
}

function termValue(
    candidate: CardEvalMeta,
    pool: readonly CardEvalMeta[],
    term: PickTermKey
): number {
    const found = scoreCandidate(candidate, pool, null).terms.find(
        (t) => t.term === term
    );
    if (!found) throw new Error(`no ${term} term`);
    return found.value;
}

const petal = metaOf("Lotus Petal");
const pearl = metaOf("Mox Pearl");
const lions = metaOf("Savannah Lions");

describe("one-shot mana sources (issue #9337)", () => {
    it("a card that sacrifices itself for mana is a one-shot source of every colour it makes that way", () => {
        expect(oneShotSourceColors(def("Lotus Petal"))).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
        expect(oneShotSourceColors(def("Black Lotus"))).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
        // Its {T}: Add {C} keeps it, but {C} is no colour: every colour it
        // makes, it makes by sacrificing itself.
        expect(oneShotSourceColors(def("Archaeological Dig"))).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
    });

    it("a land, a Mox and a fetch land are permanent sources", () => {
        expect(oneShotSourceColors(def("Mox Pearl"))).toEqual([]);
        expect(oneShotSourceColors(def("Underground Sea"))).toEqual([]);
        // A fetch land sacrifices itself, but for a land that stays.
        expect(oneShotSourceColors(def("Polluted Delta"))).toEqual([]);
    });

    it("counts a one-shot source as a fraction of a permanent one", () => {
        expect(ONE_SHOT_SOURCE_WEIGHT).toBeGreaterThan(0);
        expect(ONE_SHOT_SOURCE_WEIGHT).toBeLessThan(1);
        const counts = sourceCountsByColor([pearl, petal]);
        expect(counts.W).toBe(1 + ONE_SHOT_SOURCE_WEIGHT);
        expect(counts.U).toBe(ONE_SHOT_SOURCE_WEIGHT);
    });

    it("Castability reads a Pool holding a one-shot source as less castable than one holding a Mox", () => {
        const doubleWhite: CardEvalMeta = { ...lions, pips: { W: 2 } };
        expect(
            termValue(doubleWhite, [pearl, petal], "castability")
        ).toBeLessThan(termValue(doubleWhite, [pearl, pearl], "castability"));
    });

    it("Fixing Value credits a one-shot source less than a permanent source of the same colour", () => {
        const pool = [lions, lions, lions, lions];
        const petalFix = termValue(petal, pool, "fixingValue");
        const pearlFix = termValue(pearl, pool, "fixingValue");
        expect(petalFix).toBeGreaterThan(0);
        expect(petalFix).toBeCloseTo(pearlFix * ONE_SHOT_SOURCE_WEIGHT);
    });

    it("the castability model interpolates a fractional source count", () => {
        const at = (s: number) => hypergeometricAtLeast(40, s, 8, 1);
        expect(at(7.5)).toBeCloseTo((at(7) + at(8)) / 2);
        expect(at(7)).toBeLessThan(at(7.5));
        expect(at(7.5)).toBeLessThan(at(8));
        expect(pipCastability({ W: 1 }, 2, 40, { W: 7.5 })).toBeCloseTo(
            (pipCastability({ W: 1 }, 2, 40, { W: 7 }) +
                pipCastability({ W: 1 }, 2, 40, { W: 8 })) /
                2
        );
    });
});
