// Per-card test for mir/black.ts. Shallow Grave (issue #1967) is one of the
// two consumers of the deterministic top-of-graveyard selector (`moveZone`'s
// positional shape, CR 404.3); the canned smoke generator SKIPS it ("Op
// moveZone changes zones on an object/zone the canned generator does not
// model"), so per `.claude/rules/gre-development.md` § DSL-first authoring it
// earns a hand-written test — including the mandatory wire-format
// re-assertion, since the reanimated creature is board-visible.
//
// The ORDERING assertion is the load-bearing one: two creature cards are
// stacked in the graveyard and the LAST-inserted (= the top of the pile,
// CR 404.3) must be the one that returns. A test that put only one creature
// in the graveyard would pass with the scan running in either direction.
import { describe, it, expect } from "vitest";
import { shallowGrave } from "..";
import { griselbrand } from "../../avr";
import { resolveTopOfStack } from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Shallow Grave (CR 404.3 ordered graveyard, CR 400.7 reanimation, CR 702.10 haste, CR 603.7 delayed exile)", () => {
    /** Graveyard ids MINUS Shallow Grave itself — an instant puts itself into
     *  its owner's graveyard as it resolves (CR 608.2m), which is noise for
     *  the ordering assertions. */
    const gyIds = (zone: { id: string }[], spellId: string) =>
        zone.map((c) => c.id).filter((cid) => cid !== spellId);

    const inGraveyard = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });

    it("definitional: {1}{B} Instant", () => {
        expect(shallowGrave.manaCost).toEqual({ X: 1, B: 1 });
        expect(shallowGrave.types).toEqual(["Instant"]);
    });

    it("returns the TOP (last-inserted) creature card of YOUR graveyard, hasted, and exiles it at the next end step", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        inGraveyard("sg-older", griselbrand.id),
                        inGraveyard("sg-newer", griselbrand.id),
                    ],
                }),
                // An opponent's graveyard creature must never be taken —
                // the oracle says "YOUR graveyard".
                makePlayer("p2", {
                    graveyard: [
                        makeInstance(griselbrand.id, {
                            id: "sg-theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "graveyard",
                        }),
                    ],
                }),
            ],
        });
        const spell = pushSpell(state, shallowGrave.id, "p1");
        resolveTopOfStack(state);

        const entered = state.players[0].battlefield.find(
            (c) => c.id === "sg-newer"
        );
        expect(entered).toBeDefined();
        expect(entered!.staticAbilities).toContain("haste");
        expect(gyIds(state.players[0].graveyard, spell.id)).toEqual([
            "sg-older",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "sg-theirs",
        ]);

        // Wire format — the reanimated creature survives projectPublicState
        // for both viewers (battlefield/graveyard are public zones, CR 400.2).
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            expect(
                projected.players[0].battlefield.some(
                    (c) => c.id === "sg-newer"
                )
            ).toBe(true);
            expect(
                gyIds(projected.players[0].graveyard, spell.id)
            ).not.toContain("sg-newer");
        }

        // CR 603.7 — the delayed trigger captured EXACTLY the creature that
        // returned, and exiles it at the beginning of the next end step.
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].payload).toEqual({
            captured: "sg-newer",
        });
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "sg-newer")
        ).toBe(false);
        expect(state.players[0].exile.map((c) => c.id)).toContain("sg-newer");
    });

    it("scans PAST a non-creature card sitting on top — the filter is positional, not a top-card type check", () => {
        // Pile bottom → top: creature, then Shallow Grave itself (an
        // Instant). The literal top card is the instant; "the top CREATURE
        // card" is the creature under it, so the spell does NOT fizzle.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        inGraveyard("sg-buried", griselbrand.id),
                        inGraveyard("sg-instant", shallowGrave.id),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, shallowGrave.id, "p1");
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.some((c) => c.id === "sg-buried")
        ).toBe(true);
        expect(gyIds(state.players[0].graveyard, spell.id)).toEqual([
            "sg-instant",
        ]);
    });

    it("is a clean no-op on an empty graveyard (CR 608.2b)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const spell = pushSpell(state, shallowGrave.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(gyIds(state.players[0].graveyard, spell.id)).toEqual([]);
        expect(state.stack).toHaveLength(0);
    });
});
