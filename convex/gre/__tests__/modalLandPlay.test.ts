// CR 614.1d / 712.12 (issue #9467) — a MODAL double-faced card whose back
// face is a plain "This land enters tapped." land (Valakut Awakening //
// Valakut Stoneforge's shape).
//
// Subject: a variant of Sink into Stupor // Soporific Springs whose back face
// trades the CR 614.12 shock clause for `entersTapped: true`. The variant is
// registered through `withTemporaryDefinition` (the shared catalogue is
// deep-frozen), parent AND twin, because the twin is what a modal land play
// stamps onto the entering permanent.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { tryGetDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    modalBackFaceDefinitionId,
    modalBackTwinDefinition,
} from "../../cards/modalDfc";
import { applyPlayLand } from "../playLand";
import { projectPublicState } from "../../gameProjections";
import type { CardDefinition } from "../../cards/types";

const SINK_INTO_STUPOR = "5358b87a-1a29-426d-b165-40c97da2c14d";

/** Sink into Stupor with a back face that enters tapped unconditionally. */
function tappedBackVariant(): CardDefinition {
    const base = tryGetDefinition(SINK_INTO_STUPOR);
    if (!base?.backFace) throw new Error("Sink into Stupor has no back face");
    const { entersTappedUnlessPay: _shock, ...back } = base.backFace;
    void _shock;
    return { ...base, backFace: { ...back, entersTapped: true } };
}

function withVariant<T>(fn: () => T): T {
    const parent = tappedBackVariant();
    const twin = modalBackTwinDefinition(parent);
    if (!twin) throw new Error("variant registers no modal twin");
    return withTemporaryDefinition(parent, () =>
        withTemporaryDefinition(twin, fn)
    );
}

describe("modal back face — plain entersTapped (CR 614.1d / 712.12, issue #9467)", () => {
    it("the registered twin carries the face's entersTapped", () => {
        const twin = modalBackTwinDefinition(tappedBackVariant());
        expect(twin?.entersTapped).toBe(true);
        expect(twin?.entersTappedUnlessPay).toBeUndefined();
    });

    it("SURFACE: playing the back face puts it onto the battlefield tapped, with no pay-choice", () => {
        withVariant(() => {
            const card = makeInstance(SINK_INTO_STUPOR, {
                controllerId: "p1",
                zone: "hand",
            });
            const state = makeState({
                players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
            });
            const player = state.players[0];

            applyPlayLand(state, player, card.id, "back");

            // No CR 614.12 window: the face declares no optional cost.
            expect(state.pendingChoices ?? []).toEqual([]);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === card.id
            );
            expect(slim?.types).toEqual(["Land"]);
            expect((slim?.card as { id: string }).id).toBe(
                modalBackFaceDefinitionId(SINK_INTO_STUPOR)
            );
            // CR 614.1d — "This land enters tapped."
            expect(slim?.isTapped).toBe(true);
            expect(player.landsPlayedThisTurn).toBe(1);
        });
    });
});
