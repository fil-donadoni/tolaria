// Cast timing (issue #7356) — the two halves of Teferi, Time Raveler's
// casting-timing subsystem, now emitted by the grammar:
//
//  - "Until your next turn, you may cast sorcery spells as though they had
//    flash" (CR 601.3b, CR 611.2a) → the `grantCastTiming` Op, controller-
//    scoped, narrowed to Sorcery; the Op owns the "until your next turn"
//    boundary;
//  - "Each opponent can cast spells only any time they could cast a sorcery"
//    (CR 601.3, CR 307.1) → a compiled `cast-timing-lock` scoped to the
//    controller's opponents.
//
//  1. GOLDEN fixture — the real corpus card compiled whole.
//  2. REFUSALS — the neighbours these rules do not read (state "unparsed").
//  3. The lock's predicate, through the one timing gate
//     (`isCastTimingSorcerySpeedLocked`) on a registered expanded definition.

import { describe, expect, it } from "vitest";
import { isCastTimingSorcerySpeedLocked } from "../../cards/castRestrictions";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const LOCK_LINE =
    "Each opponent can cast spells only any time they could cast a sorcery.";
const GRANT_LINE =
    "+1: Until your next turn, you may cast sorcery spells as though they had flash.";
const TEFERI_TEXT = `${LOCK_LINE}\n${GRANT_LINE}\n−3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card.`;

const TEFERI = {
    name: "Teferi, Time Raveler",
    manaCost: "{1}{W}{U}",
    typeLine: "Legendary Planeswalker — Teferi",
    loyalty: "4",
    oracleText: TEFERI_TEXT,
} as Parameters<typeof oracleCard>[0];

function compiled(card: Parameters<typeof oracleCard>[0]) {
    const outcome = compileCard(oracleCard(card));
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

function refusedStatic(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe Relic",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText,
        })
    ).state;
}

function refusedLoyalty(line: string) {
    return compileCard(oracleCard({ ...TEFERI, oracleText: line })).state;
}

describe("cast timing grant + opponent timing lock — golden fixture (CR 601.3b, 601.3)", () => {
    it("Teferi, Time Raveler", () => {
        expect(sortKeys(compiled(TEFERI))).toEqual(
            sortKeys({
                name: "Teferi, Time Raveler",
                types: ["Planeswalker"],
                subtypes: ["Teferi"],
                supertypes: ["Legendary"],
                manaCost: { X: 1, W: 1, U: 1 },
                loyalty: 4,
                oracleText: TEFERI_TEXT,
                compiledStaticEffects: [
                    {
                        kind: "cast-timing-lock",
                        id: "teferi-time-raveler-opponent-timing-lock",
                        oracleText: LOCK_LINE,
                    },
                ],
                activatedAbilities: [
                    {
                        id: "teferi-time-raveler-ability",
                        cost: { loyalty: 1 },
                        useStack: true,
                        oracleText: GRANT_LINE,
                        effects: [
                            {
                                op: "grantCastTiming",
                                player: "controller",
                                cardTypes: ["Sorcery"],
                            },
                        ],
                    },
                    {
                        id: "teferi-time-raveler-ability-2",
                        cost: { loyalty: -3 },
                        useStack: true,
                        oracleText:
                            "-3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card.",
                        targetRequirement: {
                            type: ["Artifact", "Creature", "Enchantment"],
                            count: { min: 0, max: 1 },
                        },
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "hand",
                            },
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            })
        );
    });
});

describe("cast timing — refusals (fail-closed)", () => {
    it.each([
        // another caster, class of spell or window (CR 601.3)
        "Each player can cast spells only any time they could cast a sorcery.",
        "Each opponent can cast creature spells only any time they could cast a sorcery.",
        "Each opponent can cast spells only during their own turn.",
    ])("static refuses %s", (text) => {
        expect(refusedStatic(text)).toBe("unparsed");
    });
    it.each([
        // the Op's boundary is "until your next turn", never "this turn"
        "+1: You may cast spells this turn as though they had flash.",
        "+1: You may cast sorcery spells this turn as though they had flash.",
        // another class of spell (CR 601.3b)
        "+1: Until your next turn, you may cast creature spells as though they had flash.",
        "+1: Until your next turn, you may cast spells as though they had flash.",
        // another grantee
        "+1: Until your next turn, each player may cast sorcery spells as though they had flash.",
    ])("loyalty ability refuses %s", (line) => {
        expect(refusedLoyalty(line)).toBe("unparsed");
    });
});

describe("opponent timing lock — the timing gate (CR 601.3, 307.1)", () => {
    const LOCK_ID = "7356aaaa-1111-4111-8111-111111111111";
    const lock = (): CardDefinition =>
        expandDefinition({
            ...compiled({ ...TEFERI, oracleText: LOCK_LINE }),
            id: LOCK_ID,
            rarity: "rare",
        });

    function locked(casterId: string) {
        return withTemporaryDefinition(lock(), () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(LOCK_ID, {
                                id: "lock-perm",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                priorityPlayerId: casterId,
            });
            return isCastTimingSorcerySpeedLocked(casterId, state);
        });
    }

    it("locks an opponent of the controller", () => {
        expect(locked("p2")).toBe(true);
    });
    it("never locks the controller", () => {
        expect(locked("p1")).toBe(false);
    });
});
