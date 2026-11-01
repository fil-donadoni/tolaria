// The SOURCE of a reflexive triggered ability (CR 603.12 → CR 603.7d / 603.7e,
// issue #3719).
//
//   CR 603.12 — reflexive triggered abilities "follow the rules for delayed
//   triggered abilities (see rule 603.7)".
//   CR 603.7e — "If an activated or triggered ability creates a delayed
//   triggered ability, the source of that delayed triggered ability is the
//   same as the source of that other ability."
//
// The reflexive stack item used to carry only its own fresh id, so its body
// resolved with THAT id as `ctx.sourceInstanceId`: an `excludeSource` filter
// inside it ("if you control a red permanent other than Ajani", Ajani, Nacatl
// Avenger's `0`) excluded nothing and counted the source itself. Driven here
// through the real activation → resolution → reflexive-resolution path with a
// temporary definition (no catalogue dependency).

import { describe, expect, it } from "vitest";
import { resolveTopOfStack, type GameState } from "../state";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";

const SOURCE_ID = "test-3719-reflexive-source";
const ABILITY_ID = "reflexive-source-ability";

/** A red creature: "{0}: Gain 1 life. When you do, if you control a red
 *  permanent other than this creature, gain 5 life." The reflexive body's
 *  `excludeSource` is the clause under test. */
const RED_SOURCE: CardDefinition = {
    id: SOURCE_ID,
    name: "Reflexive Source",
    rarity: "common",
    manaCost: { R: 1 }, // red by its cost (CR 202.2)
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: ABILITY_ID,
            cost: {},
            useStack: true,
            oracleText:
                "Gain 1 life. When you do, if you control a red permanent other than this creature, gain 5 life.",
            effects: [
                { op: "gainLife", player: "controller", amount: 1 },
                {
                    op: "reflexiveTrigger",
                    oracleText:
                        "When you do, if you control a red permanent other than this creature, gain 5 life.",
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: {
                                    count: {
                                        zone: "battlefield",
                                        controller: "controller",
                                        filter: {
                                            color: "R",
                                            excludeSource: true,
                                        },
                                    },
                                },
                                op: "ge",
                                right: 1,
                            },
                            then: [
                                {
                                    op: "gainLife",
                                    player: "controller",
                                    amount: 5,
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

function activateAndResolveAll(withOtherRed: boolean): GameState {
    const source = makeInstance(SOURCE_ID, { id: "src", controllerId: "p1" });
    const battlefield = [source];
    if (withOtherRed) {
        battlefield.push(
            makeInstance(SOURCE_ID, { id: "other-red", controllerId: "p1" })
        );
    }
    const state = makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
    // An activated ability's stack item carries its SOURCE's id
    // (`buildActivatedAbilityStackItem`).
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId: ABILITY_ID,
        targets: [],
    });
    resolveTopOfStack(state);
    const reflexive = state.stack.find((s) => s.reflexiveTrigger);
    expect(reflexive).toBeDefined();
    // CR 603.7e — the reflexive ability's source is the activated ability's.
    expect(reflexive!.triggerSourceId).toBe("src");
    reflexive!.targets = [];
    resolveTopOfStack(state);
    return state;
}

describe("reflexive triggered ability source (CR 603.12 / 603.7e, issue #3719)", () => {
    it("excludeSource inside the reflexive body excludes the creating ability's source", () => {
        withTemporaryDefinition(RED_SOURCE, () => {
            // The only red permanent is the source itself → no bonus.
            expect(activateAndResolveAll(false).players[0].life).toBe(21);
        });
    });

    it("counts another red permanent (positive control)", () => {
        withTemporaryDefinition(RED_SOURCE, () => {
            expect(activateAndResolveAll(true).players[0].life).toBe(26);
        });
    });
});
