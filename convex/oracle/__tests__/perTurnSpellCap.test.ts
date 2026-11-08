// Per-turn spell cap — "Each player can't cast more than one spell each turn"
// (CR 601.3, CR 101.2), emitted by the static clause as a compiled
// `cast-restriction` carrying `maxSpellsEachTurn: 1`.
//
//  1. GOLDEN fixture — a real corpus card compiled whole.
//  2. REFUSALS — the neighbours this rule does not read (state "unparsed").
//  3. The cap's predicate, through the one cast gate
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

const CAP_TEXT = "Each player can't cast more than one spell each turn.";

const RULE_OF_LAW = {
    name: "Rule of Law",
    manaCost: "{2}{W}",
    typeLine: "Enchantment",
    oracleText: CAP_TEXT,
};

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

describe("per-turn spell cap — golden fixture (CR 601.3)", () => {
    it("Rule of Law", () => {
        expect(sortKeys(compiled(RULE_OF_LAW))).toEqual(
            sortKeys({
                name: "Rule of Law",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 1 },
                oracleText: CAP_TEXT,
                compiledStaticEffects: [
                    {
                        kind: "cast-restriction",
                        id: "rule-of-law-spell-cap",
                        oracleText: CAP_TEXT,
                        maxSpellsEachTurn: 1,
                    },
                ],
            })
        );
    });
});

describe("per-turn spell cap — refusals (fail-closed)", () => {
    it.each([
        // a class of spell (Deafening Silence's shape)
        "Each player can't cast more than one noncreature spell each turn.",
        // another caster
        "You can't cast more than one spell each turn.",
        "Your opponents can't cast more than one spell each turn.",
        // another count or window
        "Each player can't cast more than two spells each turn.",
        "Each player can't cast more than one spell each combat.",
    ])("refuses %s", (text) => {
        expect(refused(text)).toBe("unparsed");
    });
});

describe("per-turn spell cap — the cast gate (CR 601.3, 101.2)", () => {
    const CAP_ID = "8582aaaa-1111-4111-8111-111111111111";
    // Built per call, not at collection: a refused line then reds the test
    // that reads it rather than the whole file.
    const cap = (): CardDefinition =>
        expandDefinition({
            ...compiled(RULE_OF_LAW),
            id: CAP_ID,
            rarity: "uncommon",
        });

    function gate(casterId: string, castSoFar: number) {
        return withTemporaryDefinition(cap(), () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(CAP_ID, {
                                id: "cap-perm",
                                controllerId: "p1",
                                ownerId: "p1",
                            }),
                        ],
                        spellsCastThisTurn: casterId === "p1" ? castSoFar : 0,
                    }),
                    makePlayer("p2", {
                        spellsCastThisTurn: casterId === "p2" ? castSoFar : 0,
                    }),
                ],
                activePlayerId: "p1",
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

    it("leaves a player's first spell of the turn free", () => {
        expect(gate("p2", 0)).toBeUndefined();
        expect(gate("p1", 0)).toBeUndefined();
    });
    it("forbids an opponent's second spell", () => {
        expect(gate("p2", 1)).toBe(CAP_TEXT);
    });
    it("forbids the controller's second spell too", () => {
        expect(gate("p1", 1)).toBe(CAP_TEXT);
    });
});
