// SOS (Scourge) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { traumaticCritique } from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

describe("Traumatic Critique (X damage + draw two, discard one; CR 107.3 / 115.4 / 121.1)", () => {
    it("is an {X}{U}{R} instant targeting any target", () => {
        expect(traumaticCritique.manaCost).toEqual({ X: "X", U: 1, R: 1 });
        expect(traumaticCritique.types).toEqual(["Instant"]);
        expect(traumaticCritique.targetRequirement).toMatchObject({
            type: "any",
            count: 1,
        });
    });

    it("deals X damage to a player, draws two, then discards one", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;

        // First resolution step: 3 damage to p2 + draw 2 (irreversible), then
        // it suspends on the discard choice.
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the discard pick
        expect(state.players[1].life).toBe(17); // 20 - 3
        // Drew 2 (lib0, lib1) added to the pre-existing hand card.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h0",
            "lib0",
            "lib1",
        ]);

        // Submit the discard choice (discard the original hand card).
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
        expect(state.players[0].graveyard.some((c) => c.id === "h0")).toBe(
            true
        );
    });

    it("wire format: the damage and net card count survive projection", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        // p1 drew 2, discarded 1 → net hand of 2; p2 at 18 life.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[1].life).toBe(18);
    });
});
