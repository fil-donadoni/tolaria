// ULG — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
    submitChoice,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const motherOfRunes = getDefinition("0b1a46ab-95cb-4c24-924f-fc2afd4fcac7");
const balduvianBears = getDefinition("ef5297cb-e763-4871-9cd3-0e2dbcc52095");

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors post-activateAbility state). */
/** Submit the current head option-pick choice by mode id. */
// Mother of Runes — {W} Creature — Human Cleric (CR 702.16 protection;
// CR 613.1f temporary keyword grant; CR 700.2 modal color choice).
describe("Mother of Runes (CR 702.16 protection; CR 700.2 color choice)", () => {
    function setup() {
        const mother = makeInstance(motherOfRunes.id, {
            id: "mother",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(balduvianBears.id, {
            id: "t",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mother, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, mother, target };
    }

    it("grants the chosen color's protection to the target until end of turn", () => {
        const { state, mother } = setup();
        resolveActivated(state, mother, "mother-of-runes-protect", [
            { type: "permanent", id: "t" },
        ]);
        // suspends on the color-pick
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices![0].kind).toBe("option-pick");
        submitChoice(state, ["protection-black"]);
        const target = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(target.staticAbilities).toContain("protection from black");
    });

    it("can target itself (no self-exclusion in the oracle text)", () => {
        const { state, mother } = setup();
        resolveActivated(state, mother, "mother-of-runes-protect", [
            { type: "permanent", id: "mother" },
        ]);
        submitChoice(state, ["protection-red"]);
        const self = state.players[0].battlefield.find(
            (c) => c.id === "mother"
        )!;
        expect(self.staticAbilities).toContain("protection from red");
    });
});
