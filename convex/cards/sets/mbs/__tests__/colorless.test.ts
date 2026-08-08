// MBS — per-card behavior tests for colorless cards in
// `convex/cards/sets/mbs/colorless.ts` (set split by colour, ADR 0043).
//
// Blightsteel Colossus reuses the SAME "from anywhere" graveyard-shuffle
// trigger shape as Worldspine Wurm (rtr/green.ts, rtr/__tests__/green.test.ts)
// — `moveZone` + `libraryLook`(shuffle), already interpreter-exercised Ops
// (per-Op regime, ADR 0046) — plus infect/trample/indestructible, all three
// already-shipped keywords. This card-level test proves the FULL composed
// "from anywhere" trigger fires from every one of its three origins
// (battlefield death, hand discard, library mill), mirroring Worldspine
// Wurm's own coverage.

import { describe, it, expect } from "vitest";
import { blightsteelColossus } from "../colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    discardToGraveyard,
    processPendingActionTriggers,
    resolveTopOfStack,
    moveCard,
    emitCardMilled,
    getPlayer,
} from "../../../../gre/state";

/** Drains the stack, resolving every pending item (including any
 *  `trigger-order` PendingChoice, ADR 0058) — mirrors the Worldspine Wurm
 *  test helper. */
function drainStack(state: ReturnType<typeof makeState>): void {
    let guard = 0;
    while (
        (state.stack.length > 0 || state.pendingChoices?.length) &&
        guard++ < 10
    ) {
        if (state.pendingChoices?.[0]?.kind === "trigger-order") {
            resolveTriggerOrder(state);
            continue;
        }
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
}

describe("Blightsteel Colossus (CR 702.19 trample, 702.90 infect, 702.12b indestructible, 400.7/701.24 graveyard-from-anywhere shuffle, issue #1201)", () => {
    it("dies on the battlefield: shuffles itself into its owner's library instead of the graveyard", () => {
        const colossus = makeInstance(blightsteelColossus.id, {
            id: "colossus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus] }),
                makePlayer("p2"),
            ],
        });

        removePermanentTo(state, "colossus", "graveyard");
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.library.some((c) => c.id === "colossus")).toBe(true);
    });

    it("discarded from hand: shuffles itself into its owner's library (no battlefield presence needed)", () => {
        const colossus = makeInstance(blightsteelColossus.id, {
            id: "colossus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [colossus] }), makePlayer("p2")],
        });

        expect(discardToGraveyard(state, "p1", "colossus")).toBe(true);
        processPendingActionTriggers(state);
        drainStack(state);

        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.library.some((c) => c.id === "colossus")).toBe(true);
    });

    it("milled from library: shuffles itself into its owner's library (CR 701.17)", () => {
        const colossus = makeInstance(blightsteelColossus.id, {
            id: "colossus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [colossus] }),
                makePlayer("p2"),
            ],
        });

        const p1 = getPlayer(state, "p1");
        moveCard(p1, "colossus", "library", "graveyard");
        emitCardMilled(state, "p1", "colossus", blightsteelColossus.id);
        processPendingActionTriggers(state);
        drainStack(state);

        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.library.some((c) => c.id === "colossus")).toBe(true);
    });
});
