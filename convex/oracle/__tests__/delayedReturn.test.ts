// Delayed return of an object at the beginning of the next end or cleanup step
// (CR 603.7a, issue #5255).
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition: the source itself returned at the cleanup step
//     (Thawing Glaciers), and an exiled card returned from "it" (Voidwalk).
//     Rakalite, Liberate and Dragon Mask are `GOLDEN_FIXTURES` rows.
//  2. REFUSALS — the riders and sites the rule does not read stay unparsed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const THAWING_GLACIERS = oracleCard({
    oracleId: "397facec-f473-45a5-a4ce-02cb56e7bfab",
    name: "Thawing Glaciers",
    manaCost: "",
    typeLine: "Land",
    oracleText:
        "{1}, {T}: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. Return this land to its owner's hand at the beginning of the next cleanup step.",
    power: undefined,
    toughness: undefined,
});

const VOIDWALK = oracleCard({
    oracleId: "611d0e10-e767-4e66-b1f1-02f1624fab2b",
    name: "Voidwalk",
    manaCost: "{3}{U}",
    typeLine: "Sorcery",
    oracleText:
        "Exile target creature. Return it to the battlefield under its owner's control at the beginning of the next end step.",
    power: undefined,
    toughness: undefined,
});

const TIME_TWIST = oracleCard({
    oracleId: "c878bdc0-d697-4a2f-bba5-758b27f4247a",
    name: "Teferi's Time Twist",
    manaCost: "{1}{U}",
    typeLine: "Instant",
    oracleText:
        "Exile target permanent you control. Return that card to the battlefield under its owner's control at the beginning of the next end step. If it enters as a creature, it enters with an additional +1/+1 counter on it.",
    power: undefined,
    toughness: undefined,
});

const SCARAB_GOD = oracleCard({
    oracleId: "f4f414ef-84a2-4694-9e98-51bee4576c84",
    name: "The Scarab God",
    manaCost: "{3}{U}{B}",
    typeLine: "Legendary Creature — God",
    oracleText:
        "At the beginning of your upkeep, each opponent loses X life and you scry X, where X is the number of creature cards in your graveyard.\n{2}{U}{B}: Exile target creature card from a graveyard. Create a token that's a copy of it, except it's a 4/4 black Zombie.\nWhen The Scarab God dies, return it to its owner's hand at the beginning of the next end step.",
    power: "5",
    toughness: "5",
});

function outcome(card: OracleCard) {
    return compileCard(card);
}

describe("delayed return — golden fixtures (CR 603.7a)", () => {
    it('Thawing Glaciers: "Return this land to its owner\'s hand at the beginning of the next cleanup step"', () => {
        const out = outcome(THAWING_GLACIERS);
        if (out.state === "unparsed") throw new Error("did not compile");
        const ability = out.definition.activatedAbilities![0]!;
        expect(sortKeys(ability.effects![ability.effects!.length - 1])).toEqual(
            sortKeys({
                op: "delayedTrigger",
                timing: "next-cleanup-step",
                oracleText:
                    "Return this land to its owner's hand at the beginning of the next cleanup step.",
                capture: { $self: { ref: "$source" } },
                effects: [
                    {
                        op: "moveZone",
                        target: { ref: "$self" },
                        to: "hand",
                    },
                ],
            })
        );
    });

    it('Voidwalk: "Return it to the battlefield under its owner\'s control …" returns the exiled card', () => {
        const out = outcome(VOIDWALK);
        if (out.state === "unparsed") throw new Error("did not compile");
        expect(out.state).toBe("ready");
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Voidwalk",
                types: ["Sorcery"],
                manaCost: { X: 3, U: 1 },
                oracleText: VOIDWALK.oracleText,
                effects: [
                    {
                        op: "exile",
                        target: { target: 0 },
                        bind: "$that1",
                    },
                    {
                        op: "delayedTrigger",
                        timing: "next-end-step",
                        oracleText:
                            "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                        capture: { $c: { ref: "$that1" } },
                        effects: [
                            {
                                op: "moveZone",
                                target: { ref: "$c" },
                                from: "exile",
                                to: "battlefield",
                            },
                        ],
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
});

describe("delayed return — refusals stay unparsed", () => {
    it("a +1/+1 counter rider is not read (Teferi's Time Twist)", () => {
        expect(outcome(TIME_TWIST).state).toBe("unparsed");
    });

    it('"it" naming the dying source of a trigger is not read (The Scarab God)', () => {
        expect(outcome(SCARAB_GOD).state).toBe("unparsed");
    });

    it('"it" with no earlier object names nothing', () => {
        const card = oracleCard({
            ...VOIDWALK,
            oracleText:
                "Return it to the battlefield under its owner's control at the beginning of the next end step.",
        });
        expect(outcome(card).state).toBe("unparsed");
    });

    it('"it" returned to the battlefield after a non-exile sentence names no exiled card', () => {
        const card = oracleCard({
            ...VOIDWALK,
            oracleText:
                "Destroy target creature. Return it to the battlefield under its owner's control at the beginning of the next end step.",
        });
        expect(outcome(card).state).toBe("unparsed");
    });

    it('a "skip your next draw step" rider is not read (Ivory Gargoyle form)', () => {
        const card = oracleCard({
            ...VOIDWALK,
            oracleText:
                "Exile target creature. Return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step.",
        });
        expect(outcome(card).state).toBe("unparsed");
    });
});
