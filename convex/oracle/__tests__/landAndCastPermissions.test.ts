// Land and cast permissions (issue #7220) — three board statics the engine
// already reads live off the battlefield, now emitted by the static clause:
//
//  - "You may look at the top card of your library any time" (CR 401.5) →
//    `looksAtLibraryTop: "controller"`;
//  - "You may play lands from your graveyard" (CR 305.1) →
//    `graveyardPlayPermission: { actions: ["play-land"] }` (ADR 0093);
//  - "Your opponents can't cast spells during your turn" (CR 601.3, 102.1) →
//    a compiled `cast-restriction` scoped to the controller's turn.
//
//  1. GOLDEN fixtures — real corpus cards compiled whole.
//  2. REFUSALS — the neighbours these rules do not read (state "unparsed").
//  3. The cast lock's predicate, through the one cast gate
//     (`castProhibitionReason`) on a registered expanded definition.

import { describe, expect, it } from "vitest";
import { castProhibitionReason } from "../../cards/castRestrictions";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiled(card: Parameters<typeof oracleCard>[0]) {
    const outcome = compileCard(oracleCard(card));
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

function refused(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe Relic",
            manaCost: "{3}",
            typeLine: "Artifact",
            oracleText,
        })
    ).state;
}

const SPHINX_TEXT =
    "Flying\nShroud (This creature can't be the target of spells or abilities.)\nYou may look at the top card of your library any time.";
const CRUCIBLE_TEXT = "You may play lands from your graveyard.";
const BARRACUDA_TEXT =
    "Any player may cast spells as though they had flash.\nYour opponents can't cast spells during your turn.";

describe("library-top look — golden fixture (CR 401.5)", () => {
    it("Sphinx of Jwar Isle", () => {
        expect(
            sortKeys(
                compiled({
                    name: "Sphinx of Jwar Isle",
                    manaCost: "{4}{U}{U}",
                    typeLine: "Creature — Sphinx",
                    oracleText: SPHINX_TEXT,
                    power: "5",
                    toughness: "5",
                })
            )
        ).toEqual(
            sortKeys({
                name: "Sphinx of Jwar Isle",
                types: ["Creature"],
                subtypes: ["Sphinx"],
                manaCost: { X: 4, U: 2 },
                power: 5,
                toughness: 5,
                oracleText: SPHINX_TEXT,
                staticAbilities: ["flying", "shroud"],
                looksAtLibraryTop: "controller",
            })
        );
    });
});

describe("graveyard land play — golden fixture (CR 305.1)", () => {
    it("Crucible of Worlds", () => {
        expect(
            sortKeys(
                compiled({
                    name: "Crucible of Worlds",
                    manaCost: "{3}",
                    typeLine: "Artifact",
                    oracleText: CRUCIBLE_TEXT,
                })
            )
        ).toEqual(
            sortKeys({
                name: "Crucible of Worlds",
                types: ["Artifact"],
                manaCost: { X: 3 },
                oracleText: CRUCIBLE_TEXT,
                graveyardPlayPermission: { actions: ["play-land"] },
            })
        );
    });
});

const BARRACUDA = {
    name: "Tidal Barracuda",
    manaCost: "{3}{U}",
    typeLine: "Creature — Fish",
    oracleText: BARRACUDA_TEXT,
    power: "3",
    toughness: "4",
};

describe("opponent cast lock during your turn — golden fixture (CR 601.3)", () => {
    it("Tidal Barracuda", () => {
        expect(sortKeys(compiled(BARRACUDA))).toEqual(
            sortKeys({
                name: "Tidal Barracuda",
                types: ["Creature"],
                subtypes: ["Fish"],
                manaCost: { X: 3, U: 1 },
                power: 3,
                toughness: 4,
                oracleText: BARRACUDA_TEXT,
                compiledStaticEffects: [
                    {
                        kind: "cast-permission",
                        grantee: "any-player",
                        filter: {},
                        asThoughFlash: true,
                        oracleText:
                            "Any player may cast spells as though they had flash.",
                        id: "any-player-spell-3a1e60c6",
                    },
                    {
                        kind: "cast-restriction",
                        id: "tidal-barracuda-opponent-cast-lock",
                        oracleText:
                            "Your opponents can't cast spells during your turn.",
                        opponentsDuringControllersTurn: true,
                    },
                ],
            })
        );
    });
});

describe("land and cast permissions — refusals (fail-closed)", () => {
    it.each([
        // another audience or library (CR 401.5)
        "Players may look at the top card of their libraries any time.",
        "You may look at the top card of target player's library any time.",
        "You may look at the top card of your library.",
        // a gated or wider graveyard permission (ADR 0093)
        "During each of your turns, you may play a land from your graveyard.",
        "You may play lands and cast spells from your graveyard.",
        "You may play lands from your graveyard this turn.",
        // another class, window or caster (CR 601.3)
        "Your opponents can't cast noncreature spells during your turn.",
        "Your opponents can't cast spells during combat.",
        "Players can't cast spells during your turn.",
    ])("refuses %s", (text) => {
        expect(refused(text)).toBe("unparsed");
    });
});

describe("opponent cast lock during your turn — the cast gate (CR 601.3, 102.1)", () => {
    const LOCK_ID = "7220aaaa-1111-4111-8111-111111111111";
    const lock: CardDefinition = expandDefinition({
        ...compiled({
            ...BARRACUDA,
            oracleText: BARRACUDA_TEXT.split("\n")[1]!,
        }),
        id: LOCK_ID,
        rarity: "rare",
    });

    function gate(activePlayerId: string, casterId: string) {
        return withTemporaryDefinition(lock, () => {
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
                activePlayerId,
                priorityPlayerId: casterId,
            });
            const spell = makeInstance(grizzlyBears().id, {
                id: "probe-spell",
                controllerId: casterId,
                ownerId: casterId,
                zone: "hand",
            });
            return castProhibitionReason(casterId, spell, state);
        });
    }

    it("forbids an opponent during the controller's turn", () => {
        expect(gate("p1", "p2")).toBe(
            "Your opponents can't cast spells during your turn."
        );
    });
    it("leaves the opponent free on their own turn", () => {
        expect(gate("p2", "p2")).toBeUndefined();
    });
    it("never locks the controller", () => {
        expect(gate("p1", "p1")).toBeUndefined();
    });
});
