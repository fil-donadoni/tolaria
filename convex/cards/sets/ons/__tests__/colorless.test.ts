// ONS — per-card behavior tests for colorless cards in
// `convex/cards/sets/ons/colorless.ts` (set split by colour, ADR 0043). The
// fetchland family's Op combination is exercised as its own permanent test
// in `convex/gre/effects/__tests__/interpreter.test.ts` (per-Op regime,
// issue #677); this file proves ONE representative real registered card
// (Polluted Delta) wires it correctly end to end.

import { describe, it, expect } from "vitest";
import { pollutedDelta } from "../colorless";
import { island, swamp } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../../../game";

describe("Polluted Delta (CR 701.23 / 400.7 / 701.24)", () => {
    it("fetches an Island or Swamp card onto the battlefield, then shuffles", () => {
        const land = makeInstance(pollutedDelta.id, {
            id: "deltaLand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libIsland = makeInstance(island.id, {
            id: "island1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libSwamp = makeInstance(swamp.id, {
            id: "swamp1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land],
                    library: [libIsland, libSwamp, libBear],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "polluted-delta-fetch",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.candidateIds?.sort()).toEqual(["island1", "swamp1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["island1"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "island1"
        );
        expect(state.players[0].library.map((c) => c.id).sort()).toEqual([
            "bear1",
            "swamp1",
        ]);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "island1"
        );
    });

    // CR 118.4 — the "Pay 1 life" leg of the activation cost. Regression for a
    // bug where the life cost was declared on every fetchland but never paid:
    // activateAbility's commit paths deducted tap/sacrifice but skipped life.
    // Drives the REAL cost-commit seam (buildPendingActivation +
    // tryAutoCommitPendingActivation) so a future regression in the commit
    // order is caught, not a test-local mirror.
    it("pays 1 life and sacrifices itself when the fetch ability is committed (CR 118.4)", () => {
        const ability = pollutedDelta.activatedAbilities![0];
        const land = makeInstance(pollutedDelta.id, {
            id: "deltaLand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libIsland = makeInstance(island.id, {
            id: "island1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land],
                    library: [libIsland],
                }),
                makePlayer("p2"),
            ],
        });
        state.priorityPlayerId = "p1";

        // No mana cost → the pending payment is already covered and commits
        // immediately through the real auto-commit path.
        const pa = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "deltaLand",
            abilityId: ability.id,
            ability,
            manaCost: undefined,
        });
        // The builder must carry the life cost forward to the commit step.
        expect(pa.lifeCost).toBe(1);
        state.pendingActivation = pa;

        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();

        // Life was paid (20 → 19), the land sacrificed to the graveyard, and
        // the fetch ability is on the stack awaiting resolution.
        expect(state.players[0].life).toBe(19);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "deltaLand"
        );
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("polluted-delta-fetch");
    });
});
