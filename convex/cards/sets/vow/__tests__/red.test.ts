// VOW — red card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { voldarenEpicure } from "../red";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getDefinition } from "../../../index";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

function epicureEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: voldarenEpicure.id,
        types: ["Creature"] as const,
    };
}

describe("Voldaren Epicure (CR 603.6a self-ETB, 120.1 damage, 111/701.7 token — issue #778)", () => {
    it("ETB deals 1 damage to each opponent and creates a Blood token with its real ability", () => {
        const epicure = makeInstance(voldarenEpicure.id, {
            id: "epicure-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [epicure] }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [
            epicureEntered("epicure-1", "p1"),
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        // CR 120.1 — 1 damage to the (single) opponent.
        expect(state.players[1].life).toBe(19);

        // CR 111/701.7 — a Blood token was created for the controller with
        // its real sac-discard-draw ability (not an inert placeholder).
        const blood = state.players[0].battlefield.find((c) => c.isToken);
        expect(blood).toBeDefined();
        expect(blood!.subtypes).toContain("Blood");
        const bloodDef = getDefinition((blood!.card as { id: string }).id);
        expect(bloodDef.activatedAbilities?.[0]?.id).toBe(
            "sacrifice-discard-draw"
        );
    });

    it("does not trigger off another permanent entering (CR 109.2 — self scope)", () => {
        const epicure = makeInstance(voldarenEpicure.id, {
            id: "epicure-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [epicure] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            epicureEntered("other-creature", "p1"),
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("wire format: opponent life loss and the Blood token survive projectPublicState", () => {
        const epicure = makeInstance(voldarenEpicure.id, {
            id: "epicure-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [epicure] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            epicureEntered("epicure-1", "p1"),
        ]);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(19);
        const blood = projected.players[0].battlefield.find((c) => c.isToken);
        expect(blood).toBeDefined();
        expect(blood!.subtypes).toContain("Blood");
    });
});
