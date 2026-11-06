// "Spells you cast from anywhere other than your hand cost {N} less to cast"
// (issue #7642) — CR 601.2f: a cost reduction; CR 601.2a: the zone is the one
// the spell moves out of as it is proposed.
//
// The golden compiles a REAL corpus row and pins the WHOLE definition; the
// refusals pin the neighbours the rule must not read; the behaviour block runs
// the rebuilt effect through the one collector, `getCostModifiers`, over every
// zone a card can be announced from. The full path (gate, Bot enumeration,
// payment) is `gre/__tests__/nonHandCastCostReduction.bot.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCostModifiers } from "../../gre/state";

const SAGE: OracleCard = {
    oracleId: "fc74f6a6-9064-4e1b-8dc1-446192bbc448",
    name: "Sage of the Beyond",
    manaCost: "{5}{U}{U}",
    typeLine: "Creature — Spirit Giant",
    oracleText:
        "Flying\nSpells you cast from anywhere other than your hand cost {2} less to cast.\nForetell {4}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)",
    power: "5",
    toughness: "5",
};

describe("non-hand cast cost reduction — golden", () => {
    it("compiles the whole Sage of the Beyond (CR 601.2f / 601.2a)", () => {
        const outcome = compileCard(SAGE);
        expect(outcome.state, JSON.stringify(outcome)).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Sage of the Beyond",
                types: ["Creature"],
                subtypes: ["Spirit", "Giant"],
                manaCost: { X: 5, U: 2 },
                power: 5,
                toughness: 5,
                oracleText: SAGE.oracleText,
                staticAbilities: ["flying"],
                compiledStaticEffects: [
                    {
                        kind: "cost-modifier",
                        spells: { controller: "you" },
                        onlyOutsideAnnouncersHand: true,
                        reduction: 2,
                    },
                ],
                foretell: { X: 4, U: 1 },
            })
        );
    });
});

describe("non-hand cast cost reduction — refused neighbours", () => {
    const line = (oracleText: string): OracleCard => ({
        oracleId: "neighbour",
        name: "Neighbour",
        manaCost: "{2}",
        typeLine: "Enchantment",
        oracleText,
    });
    const refused = (oracleText: string) =>
        expect(compileCard(line(oracleText)).state).toBe("unparsed");

    it("REFUSES an increase: no card prints it, the rule has no fixture for it", () => {
        refused(
            "Spells you cast from anywhere other than your hand cost {1} more to cast."
        );
    });

    it("REFUSES a class of spells in front of the sentence", () => {
        refused(
            "Creature spells you cast from anywhere other than your hand cost {1} less to cast."
        );
    });

    it("REFUSES a named zone in place of the negated hand", () => {
        refused("Spells you cast from your graveyard cost {1} less to cast.");
    });

    it("REFUSES an opponent's casts", () => {
        refused(
            "Spells your opponents cast from anywhere other than their hands cost {1} less to cast."
        );
    });
});

const SPELL: CardDefinition = {
    id: "non-hand-reduction-spell",
    name: "Non-Hand Reduction Spell",
    rarity: "common",
    types: ["Instant"],
    manaCost: { X: 3, R: 1 },
};

function asDefinition(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error("unparsed");
    return { ...outcome.definition, id: card.oracleId, rarity: "common" };
}

/** The reduction p1's Sage gives `announcerId` for the spell in `owner`'s
 *  `zone`. The card names its zone owner as controller, as a card in a pile
 *  always does until it is cast. */
function reductionFor(
    zone: "hand" | "graveyard" | "exile" | "library",
    owner: "p1" | "p2",
    announcerId: "p1" | "p2" = "p1"
): number {
    const sage = asDefinition(SAGE);
    return withTemporaryDefinition(sage, () =>
        withTemporaryDefinition(SPELL, () => {
            const spell = makeInstance(SPELL.id, {
                id: "spell",
                controllerId: owner,
                ownerId: owner,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [makeInstance(sage.id, { id: "sage" })],
                        ...(owner === "p1" ? { [zone]: [spell] } : {}),
                    }),
                    makePlayer("p2", owner === "p2" ? { [zone]: [spell] } : {}),
                ],
            });
            return getCostModifiers(
                state,
                spell,
                "spell",
                undefined,
                announcerId
            ).reductionGeneric;
        })
    );
}

describe("non-hand cast cost reduction — the collector, zone by zone", () => {
    it("does not reduce a cast from your own hand (CR 601.2a)", () => {
        expect(reductionFor("hand", "p1")).toBe(0);
    });

    it("reduces a cast from your graveyard, exile and library top", () => {
        expect(reductionFor("graveyard", "p1")).toBe(2);
        expect(reductionFor("exile", "p1")).toBe(2);
        expect(reductionFor("library", "p1")).toBe(2);
    });

    it("reduces a cast from an OPPONENT's hand: it is not your hand", () => {
        expect(reductionFor("hand", "p2")).toBe(2);
    });

    it("reduces your cast out of an opponent's exile, whose card still names them (CR 601.2a)", () => {
        expect(reductionFor("exile", "p2")).toBe(2);
    });

    it("does not reduce an opponent's cast of your exiled card: not a spell YOU cast", () => {
        expect(reductionFor("exile", "p1", "p2")).toBe(0);
    });
});
