// ODY (Odyssey) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const cephalidColiseum = getDefinition("d5d74112-7244-4c3f-a5eb-b6be671aefe8");
const lightningBolt = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a");

const threshold = cephalidColiseum.activatedAbilities!.find(
    (a) => a.id === "cephalid-coliseum-threshold"
)!;

const pile = (
    owner: string,
    zone: "graveyard" | "library" | "hand",
    n: number
) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `${owner}-${zone}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone,
        })
    );

/** Puts an already-PAID activation of the threshold ability on the stack,
 *  aimed at `targetPlayerId`, and resolves it. */
function resolveThreshold(
    state: GameState,
    source: CardInstanceState,
    targetPlayerId: string
): void {
    state.stack.push({
        ...structuredClone(source),
        zone: "stack",
        castById: source.controllerId,
        abilityId: "cephalid-coliseum-threshold",
        targets: [{ type: "player", id: targetPlayerId }],
    } as StackItem);
    resolveTopOfStack(state);
}

const coliseum = () =>
    makeInstance(cephalidColiseum.id, {
        id: "coliseum",
        controllerId: "p1",
        ownerId: "p1",
    });

// The threshold clause is a `canActivate` closure, which no static sweep and
// no generated smoke scenario ever calls — the boundary is the whole card.
describe("Cephalid Coliseum — threshold gate (CR 602.1b activation restriction)", () => {
    const gate = (graveyardSize: number) => {
        const source = coliseum();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    graveyard: pile("p1", "graveyard", graveyardSize),
                }),
                // Seven cards in the OPPONENT's graveyard must not unlock it:
                // "your graveyard" is the activating player's (CR 109.5).
                makePlayer("p2", { graveyard: pile("p2", "graveyard", 7) }),
            ],
        });
        return threshold.canActivate!(source, state);
    };

    it("is closed below seven cards in the ACTIVATING player's graveyard", () => {
        expect(gate(6)).toBe(false);
    });

    it("opens at exactly seven — the boundary is >=, not >", () => {
        expect(gate(7)).toBe(true);
    });

    it("stays open above seven", () => {
        expect(gate(12)).toBe(true);
    });
});

describe("Cephalid Coliseum — target player draws three, then discards three (CR 701.9b)", () => {
    it("draws three and suspends on the TARGET's own discard choice", () => {
        const source = coliseum();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2", { library: pile("p2", "library", 5) }),
            ],
        });
        resolveThreshold(state, source, "p2");
        expect(state.players[1].hand).toHaveLength(3);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        // CR 701.9b — the DISCARDING player chooses, not the activator.
        expect(head.playerId).toBe("p2");
        expect(head.count).toBe(3);

        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: state.players[1].hand.slice(0, 3).map((c) => c.id),
        });
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(3);
    });

    it("can target the ACTIVATOR — 'target player' includes its controller (CR 115.1)", () => {
        const source = coliseum();
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    library: pile("p1", "library", 5),
                }),
                makePlayer("p2"),
            ],
        });
        resolveThreshold(state, source, "p1");
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.pendingChoices![0].playerId).toBe("p1");
    });

    it("the drawn-and-discarded outcome survives the wire projection", () => {
        const source = coliseum();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2", { library: pile("p2", "library", 5) }),
            ],
        });
        resolveThreshold(state, source, "p2");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p2",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: state.players[1].hand.slice(0, 3).map((c) => c.id),
        });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard).toHaveLength(3);
        // ADR 0026 — an opponent's hand projects as a list of nulls, so the
        // count is what the client can see, and it is zero.
        expect(projected.players[1].hand).toHaveLength(0);
    });
});
