// Max speed from the graveyard (CR 702.178b): "If an ability granted by a max
// speed ability states which zones it functions from, the max speed ability
// that grants that ability functions from those zones." Both forms read the
// speed of the card's OWNER, the would-be activator or caster (CR 109.5):
//
//  1. ACTIVATED — "Max speed — {3}, Exile this card from your graveyard: Draw
//     a card." (the Surveyor cycle), through the mutation body
//     (`activateAbilityOnState`) and the one precondition authority the Bot
//     and the client hint read.
//  2. CAST — "Max speed — You may cast this card from your graveyard."
//     (Lightwheel Enhancements), through the cast mutation's source lookup
//     and the wire projection.
//
// The grammar half is `convex/oracle/__tests__/maxSpeed.test.ts`; the client
// hint half is `src/lib/__tests__/max-speed-graveyard.test.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { activateAbilityOnState } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { activationPreconditionViolation } from "../activationPrecondition";
import { locateCastSource } from "../activation";
import type { GameState } from "../state";

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";

function compiled(
    oracle: Parameters<typeof compileCard>[0],
    id: string
): CardDefinition {
    const outcome = compileCard(oracle);
    if (outcome.state !== "ready")
        throw new Error(`${oracle.name} is ${outcome.state}`);
    return { ...outcome.definition, id } as CardDefinition;
}

const surveyor = compiled(
    {
        oracleId: "237758f3-84b2-4e5b-a2c7-b28c893e2790",
        name: "Goblin Surveyor",
        manaCost: "{2}{R}",
        typeLine: "Creature — Goblin Scout",
        oracleText: `Trample\n${REMINDER}\nMax speed — {3}, Exile this card from your graveyard: Draw a card.`,
        power: "3",
        toughness: "2",
        layout: "normal",
    },
    "test-9587-surveyor"
);

const enhancements = compiled(
    {
        oracleId: "17fae94e-558f-449a-b30c-e3c37a068b79",
        name: "Lightwheel Enhancements",
        manaCost: "{W}",
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant creature or Vehicle\n${REMINDER}\nEnchanted permanent gets +1/+1 and has vigilance.\nMax speed — You may cast this card from your graveyard.`,
        layout: "normal",
    },
    "test-9587-enhancements"
);

/** p1 is the active player in its main phase, with priority; the card sits in
 *  p1's graveyard. */
function board(
    definition: CardDefinition,
    p1Speed: number | undefined,
    p2Speed?: number
): GameState {
    const state = makeState({
        turn: 5,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", p1Speed === undefined ? {} : { speed: p1Speed }),
            makePlayer("p2", p2Speed === undefined ? {} : { speed: p2Speed }),
        ],
    });
    state.players[0]!.graveyard = [
        makeInstance(definition.id, {
            id: "gy-card",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        }),
    ];
    // A creature for the Aura to enchant (CR 303.4a — an Aura spell targets).
    state.players[0]!.battlefield = [
        makeInstance(getCardByName("Grizzly Bears").id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        }),
        // {W} for the Aura's own cost.
        makeInstance(getCardByName("Plains").id, {
            id: "plains",
            controllerId: "p1",
            ownerId: "p1",
        }),
    ];
    return state;
}

describe("the graveyard activated ability behind max speed (CR 702.178b)", () => {
    const ability = surveyor.activatedAbilities![0]!;

    function violation(p1Speed: number | undefined, p2Speed?: number) {
        return withTemporaryDefinition(surveyor, () => {
            const state = board(surveyor, p1Speed, p2Speed);
            return activationPreconditionViolation(
                state,
                state.players[0]!.graveyard[0]! as unknown as PermanentView,
                ability
            );
        });
    }

    it("is activatable only at its owner's max speed", () => {
        expect(violation(4)).toBeNull();
        expect(violation(3)).not.toBeNull();
        expect(violation(undefined)).not.toBeNull();
    });

    it("reads the owner's speed, not an opponent's", () => {
        expect(violation(1, 4)).not.toBeNull();
    });

    // CR 109.5 — on a graveyard card the controller field is not who "you"
    // is: the owner activates it. A stale controller must not be read.
    it("reads the owner even when the card records another controller", () => {
        const outcome = withTemporaryDefinition(surveyor, () => {
            const state = board(surveyor, 4, 1);
            const card = state.players[0]!.graveyard[0]!;
            card.controllerId = "p2";
            return activationPreconditionViolation(
                state,
                card as unknown as PermanentView,
                ability
            );
        });
        expect(outcome).toBeNull();
    });

    function activate(p1Speed: number | undefined) {
        return withTemporaryDefinition(surveyor, () => {
            const state = board(surveyor, p1Speed);
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "gy-card",
                abilityId: ability.id,
            });
            return state;
        });
    }

    it("the activation mutation refuses it below max speed", () => {
        expect(() => activate(3)).toThrow(
            "Ability cannot be activated right now"
        );
    });

    it("the activation mutation opens its payment at max speed", () => {
        const state = activate(4);
        expect(state.pendingActivation?.cardInstanceId).toBe("gy-card");
    });
});

describe("the graveyard cast permission behind max speed (CR 702.178b)", () => {
    function read(p1Speed: number | undefined, p2Speed?: number) {
        return withTemporaryDefinition(enhancements, () => {
            const state = board(enhancements, p1Speed, p2Speed);
            const player = state.players[0]!;
            const wire = projectPublicState(state, 1, "p1");
            // `getLegalActions` alone is no evidence here: its hand branch
            // answers "cast" for a card in any zone (it never checks the
            // zone). The wire projection asks the graveyard question.
            return {
                located:
                    locateCastSource(state, player, "gy-card").card?.id ===
                    "gy-card",
                wire:
                    wire.players[0]!.graveyard.find((c) => c.id === "gy-card")
                        ?.legalActions ?? [],
            };
        });
    }

    it("is castable from the graveyard at its owner's max speed, on the wire too", () => {
        const at4 = read(4);
        expect(at4.located).toBe(true);
        expect(at4.wire).toContain("cast");
    });

    it("is not castable from the graveyard below max speed", () => {
        expect(read(3)).toEqual({ located: false, wire: [] });
    });

    it("reads the owner's speed, not an opponent's", () => {
        expect(read(1, 4)).toEqual({ located: false, wire: [] });
    });
});
