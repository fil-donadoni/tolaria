// "If <self> would be put into a graveyard from anywhere, reveal <self> and
// shuffle it into its owner's library instead." — the static clause frame
// (CR 614.1a, issue #4315).
//
// Four layers, each watching a different way the frame can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition: the flag beside keywords (Darksteel Colossus,
//     Progenitus) and beside an activated ability (Legacy Weapon).
//  2. REFUSALS — the neighbours of the sentence stay unparsed: the CR 603
//     "When … is put into a graveyard" trigger, an exile redirect, a wording
//     without "reveal", and a subject that is not this object.
//  3. EXPANSION — `expandDefinition` rebuilds the flag into the hand-written
//     catalogue's `replacementEffects[]` entry and removes it, and leaves a
//     hand-written entry of the same id alone.
//  4. BEHAVIOUR — the compiled definition, registered as-is, sends a
//     discarded copy to its owner's library at the real `discardToGraveyard`
//     chokepoint, and a control card without the clause goes to the
//     graveyard — so the assertion can tell the two apart.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    shuffleFromAnywhereId,
    shuffleFromAnywhereReplacement,
} from "../../cards/abilities/shuffleFromAnywhereReplacement";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { discardToGraveyard } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./fixtures";

const DARKSTEEL_COLOSSUS = oracleCard({
    oracleId: "1b09d0cf-403c-4a15-aeee-602a1bdaf0c1",
    name: "Darksteel Colossus",
    manaCost: "{11}",
    typeLine: "Artifact Creature — Golem",
    oracleText:
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nIndestructible (Damage and effects that say \"destroy\" don't destroy this creature.)\nIf Darksteel Colossus would be put into a graveyard from anywhere, reveal Darksteel Colossus and shuffle it into its owner's library instead.",
    power: "11",
    toughness: "11",
});

const PROGENITUS = oracleCard({
    oracleId: "2d7e00b6-12f0-4b03-82a6-50e3d1b5395e",
    name: "Progenitus",
    manaCost: "{W}{W}{U}{U}{B}{B}{R}{R}{G}{G}",
    typeLine: "Legendary Creature — Hydra Avatar",
    oracleText:
        "Protection from everything\nIf Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead.",
    power: "10",
    toughness: "10",
});

const LEGACY_WEAPON = oracleCard({
    oracleId: "aa1a248d-2f76-4f15-b065-08f299af07b9",
    name: "Legacy Weapon",
    manaCost: "{7}",
    typeLine: "Legendary Artifact",
    oracleText:
        "{W}{U}{B}{R}{G}: Exile target permanent.\nIf Legacy Weapon would be put into a graveyard from anywhere, reveal Legacy Weapon and shuffle it into its owner's library instead.",
    power: undefined,
    toughness: undefined,
});

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("shuffle from anywhere — golden fixtures (CR 614.1a)", () => {
    it("Darksteel Colossus: the flag beside trample and indestructible", () => {
        expect(sortKeys(compiled(DARKSTEEL_COLOSSUS))).toEqual(
            sortKeys({
                name: "Darksteel Colossus",
                types: ["Artifact", "Creature"],
                subtypes: ["Golem"],
                manaCost: { X: 11 },
                power: 11,
                toughness: 11,
                oracleText: DARKSTEEL_COLOSSUS.oracleText,
                staticAbilities: ["trample", "indestructible"],
                shuffleFromAnywhere: true,
            })
        );
    });

    it("Progenitus: the flag beside protection from everything", () => {
        expect(sortKeys(compiled(PROGENITUS))).toEqual(
            sortKeys({
                name: "Progenitus",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Hydra", "Avatar"],
                manaCost: { W: 2, U: 2, B: 2, R: 2, G: 2 },
                power: 10,
                toughness: 10,
                oracleText: PROGENITUS.oracleText,
                staticAbilities: ["protection from everything"],
                shuffleFromAnywhere: true,
            })
        );
    });

    it("Legacy Weapon: the flag beside an activated exile", () => {
        expect(sortKeys(compiled(LEGACY_WEAPON))).toEqual(
            sortKeys({
                name: "Legacy Weapon",
                types: ["Artifact"],
                supertypes: ["Legendary"],
                manaCost: { X: 7 },
                oracleText: LEGACY_WEAPON.oracleText,
                activatedAbilities: [
                    {
                        id: "legacy-weapon-ability",
                        oracleText: "{W}{U}{B}{R}{G}: Exile target permanent.",
                        cost: { mana: { W: 1, U: 1, B: 1, R: 1, G: 1 } },
                        useStack: true,
                        effects: [{ op: "exile", target: { target: 0 } }],
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                        },
                    },
                ],
                shuffleFromAnywhere: true,
            })
        );
    });

    it("reads the bare sentence into the clause and routes it to the static slot", () => {
        const line =
            "If {self} would be put into a graveyard from anywhere, reveal {self} and shuffle it into its owner's library instead.";
        const parsed = staticSlot.run(line, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "shuffle-from-anywhere",
            });
        const routed = routeLine(line, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("shuffle from anywhere — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string][] = [
        [
            "the CR 603 trigger (Emrakul, the Aeons Torn), not a replacement",
            "When Test Card is put into a graveyard from anywhere, shuffle it into its owner's library.",
        ],
        [
            "an exile redirect",
            "If Test Card would be put into a graveyard from anywhere, exile it instead.",
        ],
        [
            "no reveal",
            "If Test Card would be put into a graveyard from anywhere, shuffle it into its owner's library instead.",
        ],
        [
            "a subject that is not this object",
            "If a creature would be put into a graveyard from anywhere, reveal it and shuffle it into its owner's library instead.",
        ],
        [
            "a revealed object that is not this one",
            "If Test Card would be put into a graveyard from anywhere, reveal target card and shuffle it into its owner's library instead.",
        ],
    ];
    it("control: the accepted sentence on the same card compiles ready", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Card",
                oracleText:
                    "If Test Card would be put into a graveyard from anywhere, reveal Test Card and shuffle it into its owner's library instead.",
            })
        );
        expect(outcome.state).toBe("ready");
    });

    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            const outcome = compileCard(
                oracleCard({ name: "Test Card", oracleText: text })
            );
            expect(outcome.state).toBe("unparsed");
        });
});

describe("shuffle from anywhere — expansion at the expandDefinition seam", () => {
    it("rebuilds the flag into the hand-written catalogue's entry and removes it", () => {
        const def: CardDefinition = {
            ...compiled(PROGENITUS),
            id: "test-progenitus",
            rarity: "mythic",
        };
        const expanded = expandDefinition(def);
        expect(expanded.shuffleFromAnywhere).toBeUndefined();
        const hand = shuffleFromAnywhereReplacement({
            id: "progenitus-shuffle",
            oracleText:
                "If Progenitus would be put into a graveyard from anywhere, reveal Progenitus and shuffle it into its owner's library instead.",
        });
        expect(expanded.replacementEffects).toHaveLength(1);
        const [entry] = expanded.replacementEffects!;
        expect(sortKeys(entry)).toEqual(sortKeys(hand));
    });

    it("does not add a second entry beside a hand-written one of the same id", () => {
        const entry = shuffleFromAnywhereReplacement({
            id: shuffleFromAnywhereId("Progenitus"),
            oracleText: "hand-written",
        });
        const def: CardDefinition = {
            ...compiled(PROGENITUS),
            id: "test-progenitus-hand",
            rarity: "mythic",
            replacementEffects: [entry],
        };
        expect(expandDefinition(def).replacementEffects).toEqual([entry]);
    });
});

describe("shuffle from anywhere — behaviour (CR 614.1a)", () => {
    function discardOne(def: CardDefinition): {
        library: number;
        graveyard: number;
    } {
        return withTemporaryDefinition(def, () => {
            const card = makeInstance(def.id, { id: "c1" });
            const state = makeState({
                players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
            });
            discardToGraveyard(state, "p1", "c1", {
                kind: "effect",
                controllerId: "p2",
            });
            const p1 = state.players[0];
            return {
                library: p1.library.filter((c) => c.id === "c1").length,
                graveyard: p1.graveyard.filter((c) => c.id === "c1").length,
            };
        });
    }

    it("the compiled Progenitus, discarded from hand, goes to its owner's library", () => {
        const def: CardDefinition = {
            ...compiled(PROGENITUS),
            id: "test-progenitus-behaviour",
            rarity: "mythic",
        };
        expect(discardOne(def)).toEqual({ library: 1, graveyard: 0 });
    });

    it("control: the same card without the clause goes to the graveyard", () => {
        const def: CardDefinition = {
            ...compiled(PROGENITUS),
            id: "test-progenitus-control",
            rarity: "mythic",
        };
        delete def.shuffleFromAnywhere;
        expect(discardOne(def)).toEqual({ library: 0, graveyard: 1 });
    });
});
