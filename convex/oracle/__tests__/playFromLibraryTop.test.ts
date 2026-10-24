// "You may play lands and cast spells from the top of your library" as a
// static clause (CR 305.1 land play, CR 601.3 casting permission) — Future
// Sight, Magus of the Future, Experimental Frenzy, One with the Multiverse.
//
//  1. GOLDEN — the sentence reads to `play-from-library-top`, lowers to the
//     two card-level permissions, and compiles whole on a card printing only it.
//  2. REFUSALS — the land-only wording (Courser of Kruphix) and the pay-life
//     rider (Bolas's Citadel) are neighbours the rule must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { lowerStaticClause } from "../lowerStatic";
import { oracleCard, parseContext } from "./oracle.fixture";

const SENTENCE =
    "You may play lands and cast spells from the top of your library.";

describe("play lands and cast spells from the top of your library (CR 305.1, CR 601.3)", () => {
    it("the sentence reads to the permission clause", () => {
        const parsed = staticSlot.run(SENTENCE, parseContext());
        expect(parsed.ok).toBe(true);
        if (!parsed.ok || parsed.value.kind !== "static")
            throw new Error("not a static clause");
        expect(parsed.value.clause).toEqual({ kind: "play-from-library-top" });
    });

    it("lowers to the land and spell permissions with no cost replacement", () => {
        expect(
            lowerStaticClause(
                { kind: "play-from-library-top" },
                SENTENCE,
                (suffix) => `x-${suffix}`
            )
        ).toEqual({ ok: true, lowered: { playsFromLibraryTop: true } });
    });

    it("compiles whole on a card printing only the sentence (Future Sight's line)", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "93a0e938-b916-47ec-9803-369e885e253c",
                name: "Future Sight",
                manaCost: "{2}{U}{U}{U}",
                typeLine: "Enchantment",
                oracleText: SENTENCE,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const def = sortKeys(outcome.definition) as Record<string, unknown>;
        expect(def.playsLandsFromTopOfLibrary).toBe(true);
        expect(def.castsSpellsFromTopOfLibrary).toEqual({});
    });

    it.each([
        [
            "land-only wording (Courser of Kruphix)",
            "You may play lands from the top of your library.",
        ],
        [
            "pay-life rider (Bolas's Citadel)",
            "You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.",
        ],
        [
            "an opponent's library",
            "You may play lands and cast spells from the top of target opponent's library.",
        ],
    ])("refuses %s", (_label, line) => {
        expect(staticSlot.run(line, parseContext()).ok).toBe(false);
    });
});
