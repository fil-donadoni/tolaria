// 5DN (Fifth Dawn) — black behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { nightsWhisper } from "../black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

describe("Night's Whisper (draw two, lose 2 life, CR 121.1 / 119.3)", () => {
    const setup = () => {
        const lib = [0, 1, 2].map((i) =>
            makeInstance(nightsWhisper.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, nightsWhisper.id, "p1");
        return state;
    };

    it("draws two cards and the caster loses 2 life", () => {
        const state = setup();
        resolveTopOfStack(state);
        expect(state.players[0].hand.length).toBe(2);
        expect(state.players[0].life).toBe(18);
    });

    it("the drawn count and life total survive projection (wire format)", () => {
        const state = setup();
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[0].life).toBe(18);
    });
});
