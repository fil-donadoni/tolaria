// MBS — per-card behavior tests for colorless cards in
// `convex/cards/sets/mbs/colorless.ts` (set split by colour, ADR 0043).
//
// Blightsteel Colossus's "If ~ would be put into a graveyard from anywhere,
// reveal ~ and shuffle it into its owner's library instead" is a TRUE CR
// 614.1a replacement effect (issue #2106): the card never occupies the
// graveyard, not even momentarily, so no `CREATURE_DIED` /
// `CARD_DISCARDED`/`CARD_MILLED`/`CARD_PUT_INTO_GRAVEYARD` may ever fire for
// it. This suite exercises the replacement from every graveyard-bound
// chokepoint (battlefield death, hand discard, library mill) and proves the
// class-bug regression criterion from #2106: an unrelated "whenever a
// creature dies" permanent (Soul Net) does NOT see Blightsteel Colossus die.

import { describe, it, expect } from "vitest";
import { blightsteelColossus } from "../colorless";
import { soulNet } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import {
    removePermanentTo,
    discardToGraveyard,
    buildSpellContext,
    flushPendingEvents,
    processPendingActionTriggers,
} from "../../../../gre/state";

describe("Blightsteel Colossus (CR 702.19 trample, 702.90 infect, 702.12b indestructible, CR 614.1a graveyard-bound replacement, issue #2106)", () => {
    it("dies on the battlefield: shuffles itself into its owner's library instead of the graveyard, and never emits CREATURE_DIED", () => {
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

        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.library.some((c) => c.id === "colossus")).toBe(true);
        // CR 614.1a — the object never occupied the graveyard, so it never
        // "died" (CR 700.4): no CREATURE_DIED for it.
        const events = flushPendingEvents(state);
        expect(
            events.some(
                (e) =>
                    e.type === "CREATURE_DIED" &&
                    e.creatureInstanceId === "colossus"
            )
        ).toBe(false);
    });

    it("discarded from hand: shuffles itself into its owner's library (no battlefield presence needed), CARD_DISCARDED still fires", () => {
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

        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        expect(p1.library.some((c) => c.id === "colossus")).toBe(true);
        // The discard itself is real (CR 614.1a only redirects the LANDING
        // zone) — CARD_DISCARDED still fires — but no graveyard-entry event.
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_DISCARDED")).toBe(true);
        expect(events.some((e) => e.type === "CARD_PUT_INTO_GRAVEYARD")).toBe(
            false
        );
    });

    it("milled from library (CR 701.17): shuffles itself into its owner's library, and never emits CARD_MILLED", () => {
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

        const driver = pushSpell(state, blightsteelColossus.id, "p1");
        const ctx = buildSpellContext(state, driver);
        const milled = ctx.millCards("p1", 1);

        const p1 = state.players[0];
        // Genuinely milled cards are the ones that reached the graveyard —
        // Blightsteel Colossus was redirected, so it is absent from the list.
        expect(milled).toEqual([]);
        expect(p1.library).toHaveLength(1);
        expect(p1.library[0].id).toBe("colossus");
        expect(p1.graveyard.some((c) => c.id === "colossus")).toBe(false);
        const events = flushPendingEvents(state);
        expect(events.some((e) => e.type === "CARD_MILLED")).toBe(false);
    });

    it("does NOT trigger a 'whenever a creature dies' permanent (Soul Net) when destroyed — the object never dies (issue #2106 class-bug regression)", () => {
        const colossus = makeInstance(blightsteelColossus.id, {
            id: "colossus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const soulNetInstance = makeInstance(soulNet.id, {
            id: "soul-net",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus, soulNetInstance] }),
                makePlayer("p2"),
            ],
        });

        removePermanentTo(state, "colossus", "graveyard");
        processPendingActionTriggers(state);
        // Drain any trigger-order choice (CR 603.3b, ADR 0058) so a queued
        // trigger actually lands on the stack rather than sitting in
        // `pendingChoices` — a no-op when nothing triggered.
        resolveTriggerOrder(state);

        // Soul Net's "whenever a creature dies, you may pay {1}" ability must
        // NOT have been raised — there is nothing on the stack.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].library.some((c) => c.id === "colossus")).toBe(
            true
        );
    });
});
