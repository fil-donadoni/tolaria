// HOU (Hour of Devastation) — red card behavior tests (ADR 0043 colour
// split). Each card's describe block cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import { abrade } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { getDefinition } from "../../../index";

// A registered creature and a NON-creature artifact (Black Lotus — no
// toughness, so it can't die to an unrelated SBA and mask a broken destroy).
const CREATURE_ID = "6914c5a8-2114-41c5-a471-ca97524d622f"; // Sabretooth Tiger
const ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus

describe("Abrade (CR 700.2 modal — damage a creature or destroy an artifact)", () => {
    it("damage mode deals 3 damage to target creature (CR 120.1)", () => {
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
            ...makeInstance(abrade.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "damage",
            targets: [{ type: "permanent", id: "creature-1" }],
        });
        resolveTopOfStack(state);
        // 2 toughness, 3 damage marked → SBA destroys it (CR 704.5g).
        expect(
            state.players[1].battlefield.some((c) => c.id === "creature-1")
        ).toBe(false);
    });

    it("destroy mode destroys target artifact (CR 701.7)", () => {
        expect(getDefinition(ARTIFACT_ID).types).toContain("Artifact");
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
            ...makeInstance(abrade.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "destroy",
            targets: [{ type: "permanent", id: "artifact-1" }],
        });
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "artifact-1")
        ).toBe(false);
    });
});
