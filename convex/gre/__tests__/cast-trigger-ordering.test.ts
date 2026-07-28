// CR 601.2i / 603.3 — cast triggers must be put on the stack ABOVE the spell
// that triggered them, BEFORE any player receives priority and therefore
// before any auto-pass drain can start resolving that spell.
//
// Regression: the commit path pushed the spell, ran `drainAutoPasses` (which
// with an auto-passing opponent + the caster's single-shot auto-pass reaches
// two consecutive passes and calls `resolveTopOfStack`), and only THEN emitted
// SPELL_CAST / ran the trigger pass. The spell resolved (or suspended
// mid-resolution on a `order-top` surveil choice) before its own cast trigger
// existed, and the trigger then landed on top of a half-resolved spell —
// Consider's surveil prompt opening while Ledger Shredder's connive trigger
// was still waiting on the stack, connive drawing the card surveil had just
// binned, and the resume erroring out with Consider stuck on the stack.

import { describe, it, expect } from "vitest";
import { tryAutoCommitPendingCast } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const CONSIDER = "a211d505-4d40-4914-a9da-220770d6ddbc"; // {U} Instant — Surveil 1, draw
const LEDGER_SHREDDER = "7ea4b5bc-18a4-45db-a56a-ab3f8bd2fb0d"; // connive on 2nd spell

describe("cast triggers land before the spell can start resolving (CR 601.2i)", () => {
    it("does not begin Consider's resolution before Ledger Shredder's connive trigger is on the stack", () => {
        const consider = makeInstance(CONSIDER, {
            id: "consider",
            zone: "hand",
            controllerId: "p1",
        });
        const shredder = makeInstance(LEDGER_SHREDDER, {
            id: "shredder",
            controllerId: "p1",
        });
        const libTop = makeInstance(CONSIDER, {
            id: "lib-top",
            zone: "library",
            controllerId: "p1",
        });
        const libNext = makeInstance(CONSIDER, {
            id: "lib-next",
            zone: "library",
            controllerId: "p1",
        });
        const p1 = makePlayer("p1", {
            hand: [consider],
            battlefield: [shredder],
            library: [libTop, libNext],
            manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
            // This cast is p1's SECOND spell this turn (connive's condition).
            spellsCastThisTurn: 1,
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            spellsCastThisTurn: 1,
            // The opponent auto-passes (vs-AI / solo), so the drain reaches two
            // consecutive passes right after the cast commits.
            autoPassPlayers: ["p2"],
            pendingCast: {
                playerId: "p1",
                cardInstanceId: "consider",
                manaCost: { U: 1 },
                tappedLandIds: [],
            },
        });

        const result = tryAutoCommitPendingCast(state, "p1");
        expect(result).not.toBeNull();

        const considerItem = state.stack.find((i) => i.id === "consider");
        const conniveItem = state.stack.find(
            (i) => i.triggeredAbilityId === "ledger-shredder-connive"
        );

        // The connive trigger must never sit on top of a Consider that has
        // already started resolving.
        if (considerItem && conniveItem) {
            expect(considerItem.resolutionStep).toBeUndefined();
        }
        // …and no surveil (`order-top`) choice may be pending while the trigger
        // is still waiting to resolve.
        const orderTop = (state.pendingChoices ?? []).find(
            (c) => c.kind === "order-top"
        );
        expect(conniveItem && orderTop).toBeFalsy();
    });
});
