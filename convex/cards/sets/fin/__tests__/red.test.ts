// FIN (Final Fantasy) — red card behavior tests (ADR 0043 colour split).
// Each card's describe block cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import { suplex } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";

const CREATURE_ID = "6914c5a8-2114-41c5-a471-ca97524d622f"; // Sabretooth Tiger
// A NON-creature artifact (Black Lotus — no toughness, so it can't die to an
// unrelated SBA and mask a broken exile).
const ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus

describe("Suplex (CR 700.2 modal — damage-then-exile a creature or exile an artifact)", () => {
    it("declares two modes with different target types", () => {
        expect(suplex.modes).toHaveLength(2);
        const damage = suplex.modes!.find((m) => m.id === "damage")!;
        const exile = suplex.modes!.find((m) => m.id === "exile")!;
        expect(damage.targetRequirement).toMatchObject({ type: "Creature" });
        expect(exile.targetRequirement).toMatchObject({ type: "Artifact" });
    });

    it("damage mode deals 3 damage and exiles the creature instead of destroying it (CR 614.1a)", () => {
        const creature = makeInstance(CREATURE_ID, {
            id: "creature-1",
            controllerId: "p2",
            ownerId: "p2",
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        state.stack.push({
            ...makeInstance(suplex.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "damage",
            targets: [{ type: "permanent", id: "creature-1" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "creature-1")
        ).toBe(false);
        expect(
            state.players[1].graveyard.some((c) => c.id === "creature-1")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "creature-1")).toBe(
            true
        );
    });

    it("exile mode exiles target artifact (CR 701.13)", () => {
        const artifact = makeInstance(ARTIFACT_ID, {
            id: "artifact-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        state.stack.push({
            ...makeInstance(suplex.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "exile",
            targets: [{ type: "permanent", id: "artifact-1" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "artifact-1")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "artifact-1")).toBe(
            true
        );
    });
});
