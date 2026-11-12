// CR 508.3a / 603.7b — "Whenever you attack this turn, …" (Dalkovan Encampment):
// a repeating delayed trigger that fires once per declaration its controller
// makes and is gone after the turn.
import { describe, it, expect } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { validateEffectScript } from "../effects/validate";
import { emitAttackersDeclaredEvents } from "../phases";
import { resolveTopOfStack } from "../state";
import type { GameState } from "../state";

const land = () => getCardByName("Dalkovan Encampment");
const ability = () =>
    land().activatedAbilities!.find((a) => a.id.endsWith("-warriors"))!;

function openWindow(state: GameState, controllerId: string): void {
    const id = `test-you-attack-${controllerId}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Sorcery"],
        effects: ability().effects,
    });
    pushSpell(state, id, controllerId);
    resolveTopOfStack(state);
}

function board(): GameState {
    const bear = getCardByName("Grizzly Bears");
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(bear.id, {
                        id: "a",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(bear.id, {
                        id: "x",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

function declare(
    state: GameState,
    activePlayerId: string,
    attackerIds: string[]
): void {
    state.activePlayerId = activePlayerId;
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
    while (state.stack.some((s) => s.delayedTriggerId !== undefined)) {
        resolveTopOfStack(state);
    }
}

const warriors = (state: GameState, owner: string) =>
    state.players
        .find((p) => p.id === owner)!
        .battlefield.filter((c) => c.subtypes.includes("Warrior"));

describe("this-turn-you-attack (CR 508.3a / 603.7b)", () => {
    it("validates as a delayed trigger body", () => {
        expect(validateEffectScript(ability().effects!)).toEqual([]);
    });

    it("fires once per own declaration: two tapped, attacking Warriors", () => {
        const state = board();
        openWindow(state, "p1");
        expect(state.delayedTriggers).toHaveLength(1);
        declare(state, "p1", ["a"]);
        const made = warriors(state, "p1");
        expect(made).toHaveLength(2);
        expect(made.every((c) => c.isTapped)).toBe(true);
        expect(state.combat!.attackerIds).toEqual(
            expect.arrayContaining(made.map((c) => c.id))
        );
        // Tokens entering attacking declare nothing: no second firing (CR 508.3a).
        expect(
            state.delayedTriggers!.some(
                (t) => t.timing === "this-turn-you-attack"
            )
        ).toBe(true);
    });

    it("repeats on an extra combat, and an opponent's declaration does not fire it", () => {
        const state = board();
        openWindow(state, "p1");
        declare(state, "p2", ["x"]);
        expect(warriors(state, "p1")).toHaveLength(0);
        declare(state, "p1", ["a"]);
        declare(state, "p1", ["a"]);
        expect(warriors(state, "p1")).toHaveLength(4);
    });

    it("survives projection to the client", () => {
        const state = board();
        openWindow(state, "p1");
        declare(state, "p1", ["a"]);
        const view = projectPublicState(state, 1, "p1");
        expect(
            view.players
                .find((p) => p.id === "p1")!
                .battlefield.filter((c) => c.subtypes.includes("Warrior"))
        ).toHaveLength(2);
    });
});
