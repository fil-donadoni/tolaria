// Regression (issue #943): sacrificing a permanent to pay its OWN mana
// ability's cost (a useStack:false mana ability that resolves immediately,
// CR 605.3a) must put the source into the graveyard AND fire its
// leave-the-battlefield / dies trigger. Moving to the graveyard from the
// battlefield is the trigger condition regardless of WHY the permanent left
// (CR 603.6 / 700.4).
//
// The bug: the immediate mana-ability payment path moved the sacrificed source
// with a raw `moveCard`, which queues NO `PERMANENT_LEFT` / `CREATURE_DIED`
// event, so Chromatic Star's dies-draw (and any other leave trigger) never
// fired. The fix routes every sacrifice-for-mana site through the generic
// `removePermanentTo` funnel, which queues the leave/death events that
// `processPendingActionTriggers` then drains onto the stack.
//
// These tests drive the REAL exported production function `tapSourceIntoPayment`
// (the payment-tap path taken when a mana source is sacrificed while paying a
// spell/ability cost), so a regression back to `moveCard` fails here — not a
// hand-mirrored copy of the mutation logic.

import { describe, it, expect } from "vitest";
import { tapSourceIntoPayment } from "../../game";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../state";
import { projectPublicState } from "../../gameProjections";
import { chromaticStar } from "../../cards/sets/tsp";
import { basalThrull } from "../../cards/sets/fem";
import { soulNet } from "../../cards/sets/lea";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const FOREST = getCardByName("Forest").id;

describe("sacrifice-for-mana fires the source's leave-the-battlefield trigger (CR 603.6 / 700.4 / 605.3a, issue #943)", () => {
    it("Chromatic Star: sacrificing it to pay its own mana ability adds mana AND draws a card", () => {
        const star = makeInstance(chromaticStar.id, {
            id: "star",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const lib = makeInstance(FOREST, {
            id: "lib0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [star], library: [lib] }),
                makePlayer("p2"),
            ],
        });
        const p1 = getPlayer(state, "p1");

        // Drive the REAL payment-tap path (choice branch): pick colour option 0
        // ({W}) and sacrifice the Star to produce the mana.
        tapSourceIntoPayment(state, p1, star, 0, []);

        // CR 605.1a — the mana is added immediately (mana-ability semantics
        // unchanged) and the Star has left the battlefield for the graveyard.
        expect(p1.manaPool.W).toBe(1);
        expect(p1.battlefield.some((c) => c.id === "star")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "star")).toBe(true);
        // The leave event was queued — the exact thing the raw `moveCard` dropped.
        expect(
            (state.pendingEvents ?? []).some(
                (e) => e.type === "PERMANENT_LEFT" && e.instanceId === "star"
            )
        ).toBe(true);

        // CR 603.3 — the dies trigger goes ON the stack; it does NOT auto-resolve.
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "chromatic-star-death-draw"
        );
        expect(p1.hand).toHaveLength(0); // trigger not yet resolved

        // Resolving the trigger under normal priority draws the card.
        resolveTopOfStack(state);
        expect(p1.hand.map((c) => c.id)).toContain("lib0");

        // Wire format — the drawn card is visible to its controller after the
        // projection (`library: { count }`, own hand shown face-up).
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
    });

    it("class generality: an UNRELATED death watcher (Soul Net) fires when Basal Thrull is sacrificed to its own mana ability (fixed-output branch)", () => {
        // Basal Thrull ("{T}, Sacrifice: Add {B}{B}") takes the FIXED-output
        // sacrifice branch (no manaChoices); Soul Net is a third-party
        // "whenever a creature dies" watcher. Because the fix lives in the
        // generic sacrifice-cost application (not card-specific code), the
        // death/leave events are emitted for ANY sacrificed permanent, so an
        // unrelated trigger fires too.
        const thrull = makeInstance(basalThrull.id, {
            id: "thrull",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const net = makeInstance(soulNet.id, {
            id: "net",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [thrull, net] }),
                makePlayer("p2"),
            ],
        });
        const p1 = getPlayer(state, "p1");

        // Real fixed-output payment-tap path (no colour choice → index undefined).
        tapSourceIntoPayment(state, p1, thrull, undefined, []);

        expect(p1.manaPool.B).toBe(2);
        expect(p1.graveyard.some((c) => c.id === "thrull")).toBe(true);
        // General emission: both the death and the leave event are queued for
        // the sacrificed source (a raw `moveCard` queued neither).
        const events = state.pendingEvents ?? [];
        expect(
            events.some(
                (e) =>
                    e.type === "CREATURE_DIED" &&
                    e.creatureInstanceId === "thrull"
            )
        ).toBe(true);
        expect(
            events.some(
                (e) => e.type === "PERMANENT_LEFT" && e.instanceId === "thrull"
            )
        ).toBe(true);

        // The unrelated watcher's trigger lands on the stack (does not
        // auto-resolve; left unresolved here to avoid its may-pay sub-choice).
        processPendingActionTriggers(state);
        expect(
            state.stack.some((s) => s.triggeredAbilityId === "soul-net-life")
        ).toBe(true);
    });
});
