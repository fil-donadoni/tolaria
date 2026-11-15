// A compiled "When this creature blocks" head reaches the engine as a REAL
// trigger (issue #9621, CR 509.3a).
//
// `oracle/__tests__/blocksHead.test.ts` proves the Oracle text lowers to the
// `blocks` descriptor. It cannot prove the rebuilt ability FIRES on the right
// event — only when THIS creature is declared a blocker, never for another
// blocker or for the attacker — so each test compiles a real Oracle row,
// registers it, and drives it through the real block emitter, the real
// trigger scan, the real stack and the real resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { emitBlockersConfirmedEvents } from "../phases";
import { resolveTopOfStack, type GameState } from "../state";

function register(
    id: string,
    card: Parameters<typeof compileCard>[0]
): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    const definition = {
        ...outcome.definition,
        id,
        rarity: "common" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const ZEPHYR_SPIRIT = register("test-9621-zephyr-spirit", {
    oracleId: "ff640343-6980-4668-a41f-0f01b0bbc0f2",
    name: "Zephyr Spirit",
    manaCost: "{5}{U}",
    typeLine: "Creature — Spirit",
    oracleText: "When this creature blocks, return it to its owner's hand.",
    power: "0",
    toughness: "6",
    layout: "normal",
});

const ELDER_LAND_WURM = register("test-9621-elder-land-wurm", {
    oracleId: "5948381a-419d-4b8b-8ea2-ea623cb0d606",
    name: "Elder Land Wurm",
    manaCost: "{4}{W}{W}{W}",
    typeLine: "Creature — Dragon Wurm",
    oracleText:
        "Defender, trample\nWhen this creature blocks, it loses defender.",
    power: "5",
    toughness: "5",
    layout: "normal",
});

/**
 * p1 attacks with a Zephyr Spirit of its own; p2 controls two copies of
 * `blockerCard` and only `b1` blocks. Every creature carries the trigger, so a
 * head that fires on ANY block, or on the attacker, is a second stack item.
 */
function blockState(blockerCard: CardDefinition): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(ZEPHYR_SPIRIT.id, {
                        id: "a1",
                        controllerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(blockerCard.id, {
                        id: "b1",
                        controllerId: "p2",
                    }),
                    makeInstance(blockerCard.id, {
                        id: "b2",
                        controllerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: ["a1"],
            confirmed: true,
            blockersConfirmed: true,
            blockerAssignments: { b1: ["a1"] },
        },
    });
}

function resolveAll(state: GameState): void {
    while (state.stack.length > 0) {
        if (resolveTopOfStack(state) === null) break;
    }
}

describe("compiled 'when this creature blocks' (CR 509.3a)", () => {
    it("fires once, for the declared blocker only — not the other blocker, not the attacker", () => {
        const state = blockState(ZEPHYR_SPIRIT);
        emitBlockersConfirmedEvents(state);

        expect(state.stack).toHaveLength(1);
        const event = state.stack[0]!.triggerEvent;
        expect(event?.type === "BLOCKER_DECLARED" && event.blockerId).toBe(
            "b1"
        );
    });

    it("Zephyr Spirit: the blocker returns to its owner's hand", () => {
        const state = blockState(ZEPHYR_SPIRIT);
        emitBlockersConfirmedEvents(state);
        resolveAll(state);

        const p2 = state.players[1]!;
        expect(p2.hand.map((c) => c.id)).toEqual(["b1"]);
        expect(p2.battlefield.map((c) => c.id)).toEqual(["b2"]);
        expect(state.players[0]!.battlefield.map((c) => c.id)).toEqual(["a1"]);
    });

    it("Elder Land Wurm: the blocker loses defender for good; the other keeps it", () => {
        const state = blockState(ELDER_LAND_WURM);
        emitBlockersConfirmedEvents(state);
        resolveAll(state);

        const [b1, b2] = state.players[1]!.battlefield;
        expect(b1!.staticAbilities).toEqual(["trample"]);
        expect(b2!.staticAbilities).toEqual(["defender", "trample"]);
    });
});
