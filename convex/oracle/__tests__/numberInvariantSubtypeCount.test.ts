// "if you control N or more <land subtype>" — the counted intervening-if
// (CR 603.4) over a subtype noun, and "Plains", the land type spelled the
// same in both numbers (CR 205.3i).
//
//  1. GRAMMAR — every land-subtype form the corpus prints, "Plains" read as
//     the plural each count clause demands, and the singular nouns still
//     refused.
//  2. COMPILE — Emeria, the Sky Ruin compiled whole.
//  3. ENGINE — the compiled seven-Plains gate, run against a raw game state.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import { oracleCard, parseContext } from "./oracle.fixture";

const EMERIA_TRIGGER =
    "At the beginning of your upkeep, if you control seven or more Plains, you may return target creature card from your graveyard to the battlefield.";

const EMERIA_TEXT = `This land enters tapped.\n${EMERIA_TRIGGER}\n{T}: Add {W}.`;

const EMERIA = oracleCard({
    name: "Emeria, the Sky Ruin",
    manaCost: "",
    typeLine: "Land",
    oracleText: EMERIA_TEXT,
    power: undefined,
    toughness: undefined,
});

function read(span: string) {
    return conditionRule.run(span, parseContext());
}

describe("a counted land subtype (CR 603.4, CR 205.3i)", () => {
    it.each([
        ["if you control seven or more Plains", "Plains", 7],
        ["if you control two or more Plains", "Plains", 2],
        ["if you control two or more Forests", "Forest", 2],
        ["if you control two or more Islands", "Island", 2],
        ["if you control two or more Mountains", "Mountain", 2],
        ["if you control two or more Swamps", "Swamp", 2],
        ["if you control two or more Gates", "Gate", 2],
        ["if you control five or more Deserts", "Desert", 5],
    ])("reads %s", (span, subtype, atLeast) => {
        const parsed = read(span);
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls-at-least",
            player: "you",
            filter: { subtypes: [subtype] },
            atLeast,
        });
    });

    it('reads "no Plains" as the zero count', () => {
        const parsed = read("if you control no Plains");
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls",
            player: "you",
            filter: { subtypes: ["Plains"] },
            atMost: 0,
        });
    });

    it.each([
        [
            "a singular Forest after or more",
            "if you control two or more Forest",
        ],
        ["a singular Gate after no", "if you control no Gate"],
    ])("refuses %s", (_what, span) => {
        expect(read(span).ok).toBe(false);
    });
});

function compiled(): CardDefinition {
    const outcome = compileCard(EMERIA);
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition as CardDefinition;
}

describe("compiled whole", () => {
    it('"you control seven or more Plains" (Emeria, the Sky Ruin)', () => {
        expect(compiled().compiledTriggeredAbilities).toEqual([
            {
                id: "emeria-the-sky-ruin-trigger",
                oracleText: EMERIA_TRIGGER,
                head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                condition: {
                    kind: "controls",
                    filter: { subtypes: ["Plains"] },
                    atLeast: 7,
                },
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
                effects: [
                    {
                        op: "mayPay",
                        player: "controller",
                        prompt: "Return target creature card from your graveyard to the battlefield?",
                        bind: "$may1",
                    },
                    {
                        op: "if",
                        predicate: { binding: "$may1" },
                        then: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "battlefield",
                            },
                        ],
                    },
                ],
            },
        ]);
    });
});

/** Emeria's compiled gate with `plains` Plains beside it, `opponents` on p2. */
function gateOn(plains: number, opponents = 0): boolean {
    const definition = {
        ...compiled(),
        id: "compiled-emeria-5275",
        rarity: "mythic" as const,
    };
    const lands = (controllerId: "p1" | "p2", n: number) =>
        Array.from({ length: n }, () =>
            makeInstance(getCardByName("Plains").id, { controllerId })
        );
    return withTemporaryDefinition(definition, () => {
        const self = makeInstance(definition.id, { id: "source" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [self, ...lands("p1", plains)],
                }),
                makePlayer("p2", { battlefield: lands("p2", opponents) }),
            ],
        });
        const ability = resolveCompiledTrigger(
            definition.compiledTriggeredAbilities![0]!
        );
        return ability.interveningIf!(
            { type: "PHASE_BEGIN", phase: "UPKEEP", playerId: "p1" } as never,
            self as unknown as PermanentView,
            state as unknown as TriggerStateView
        );
    });
}

describe("the seven-Plains gate (CR 603.4)", () => {
    it("holds from the seventh Plains the controller controls", () => {
        expect(gateOn(6)).toBe(false);
        expect(gateOn(7)).toBe(true);
    });

    it("never counts an opponent's Plains (CR 109.5)", () => {
        expect(gateOn(0, 7)).toBe(false);
    });
});
