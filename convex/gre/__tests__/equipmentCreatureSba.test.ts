import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { checkStateBasedActions } from "../sba";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { ironManArmor } from "../../cards/sets/msh/colorless.cards";

/**
 * CR 301.5c (issue #7237) — an Equipment that is also a creature (and has no
 * Reconfigure) can't equip a creature: the state-based action unattaches it.
 * Iron Man Armor animating itself while equipped is the reaching card.
 */
describe("CR 301.5c — a creature Equipment becomes unattached", () => {
    const board = () => {
        const bears = makeInstance(grizzlyBears().id, { id: "bears" });
        const armor = makeInstance(ironManArmor().id, {
            id: "armor",
            attachedTo: "bears",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bears, armor] }),
                makePlayer("p2"),
            ],
        });
        return { state, armor };
    };

    it("stays attached while it is not a creature", () => {
        const { state } = board();
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "armor")
                ?.attachedTo
        ).toBe("bears");
    });

    it("unattaches once its own ability animates it, host loses the buff", () => {
        const { state, armor } = board();
        resolveActivated(state, armor, "iron-man-armor-animate");
        checkStateBasedActions(state);
        const seen = projectPublicState(state, 1, "p1").players[0].battlefield;
        expect(seen.find((c) => c.id === "armor")?.attachedTo).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "armor")
                ?.attachedTo
        ).toBeUndefined();
    });
});
