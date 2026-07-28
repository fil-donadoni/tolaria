// "This permanent enters with N counters on it" as a REPLACEMENT effect
// (CR 121.6 + CR 614.1c) — issue #1693.
//
// CR 121.6: "If an effect says a permanent enters the battlefield with counters
// on it, those counters are put onto that permanent as it enters." CR 614.1c
// makes that a self-replacement: it changes HOW the object enters, so the
// counters exist the first instant the permanent is observable. Modelling it as
// a `PERMANENT_ENTERED` triggered ability (the pre-#1693 shape) put the
// placement on the stack, gave both players priority with the permanent at zero
// counters, and rendered the clause as a respondable ability.
//
// This suite proves the ENGINE seam — the pure count oracle
// (`resolveEntersWithCounters`, `convex/cards/entersWith.ts`) and its
// application at every permanent-entry site. Per-card coverage lives in each
// set's colour test file; the catalogue-wide guard that no card re-declares the
// clause as a trigger lives in `convex/cards/__tests__/entersWithCounters.test.ts`.
import { describe, it, expect } from "vitest";
import { resolveEntersWithCounters } from "../../cards/entersWith";
import {
    buildSpellContext,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { clockworkBeast } from "../../cards/sets/lea/colorless";
import { rockHydra } from "../../cards/sets/lea/red";
import { everflowingChalice } from "../../cards/sets/wwk/colorless";
import { resurrection } from "../../cards/sets/lea/white";

describe("resolveEntersWithCounters — the count vocabulary (CR 121.6)", () => {
    it("returns an empty delta for a card declaring nothing", () => {
        expect(resolveEntersWithCounters(undefined, {})).toEqual({});
        expect(resolveEntersWithCounters({}, {})).toEqual({});
        expect(resolveEntersWithCounters({ entersWith: {} }, {})).toEqual({});
    });

    it("reads a literal count", () => {
        expect(
            resolveEntersWithCounters(
                { entersWith: { counters: [{ type: "wish", count: 3 }] } },
                {}
            )
        ).toEqual({ wish: 3 });
    });

    it("reads the cast-time X (CR 107.3) and treats an uncast entry as X = 0", () => {
        const def = {
            entersWith: { counters: [{ type: "+1/+1", count: "X" as const }] },
        };
        expect(resolveEntersWithCounters(def, { chosenX: 4 })).toEqual({
            "+1/+1": 4,
        });
        // CR 107.3b — X is 0 anywhere other than on the stack, so a reanimated
        // / tutored permanent enters with none.
        expect(resolveEntersWithCounters(def, {})).toEqual({});
    });

    it("reads the kicker tally (CR 702.33e) and drops a zero", () => {
        const def = {
            entersWith: {
                counters: [{ type: "charge", count: "kicker" as const }],
            },
        };
        expect(resolveEntersWithCounters(def, { kickerCount: 2 })).toEqual({
            charge: 2,
        });
        expect(resolveEntersWithCounters(def, { kickerCount: 0 })).toEqual({});
    });

    it("SUMS repeated entries of the same type — the 'N × kicker' idiom", () => {
        // "If this creature was kicked, it enters with four +1/+1 counters on
        // it" is four `count: "kicker"` entries (Duskwalker / Llanowar Elite /
        // Vodalian Serpent), so the tally 0/1 becomes 0 or 4.
        const def = {
            entersWith: {
                counters: [
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                    { type: "+1/+1", count: "kicker" as const },
                ],
            },
        };
        expect(resolveEntersWithCounters(def, { kickerCount: 1 })).toEqual({
            "+1/+1": 4,
        });
        expect(resolveEntersWithCounters(def, { kickerCount: 0 })).toEqual({});
    });

    it("drops non-positive literals rather than recording a zero counter", () => {
        expect(
            resolveEntersWithCounters(
                {
                    entersWith: {
                        counters: [
                            { type: "a", count: 0 },
                            { type: "b", count: -2 },
                            { type: "c", count: 1 },
                        ],
                    },
                },
                {}
            )
        ).toEqual({ c: 1 });
    });
});

describe("entry counters apply AS the permanent enters (CR 614.1c)", () => {
    it("a resolving permanent spell is on the battlefield with its counters and no stack item", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);

        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
        // A printed 0/4 reads 7/4 on the very first look — the layer system
        // (CR 613) never sees the zero-counter intermediate state.
        expect(getEffectivePower(state, live)).toBe(7);
        expect(getEffectiveToughness(state, live)).toBe(4);
        // Nothing was put on the stack for the placement.
        expect(state.stack).toEqual([]);
    });

    it("the trigger scan collects nothing for the placement — no priority window at zero counters", () => {
        // CR 614.1c — the replacement is applied BEFORE the permanent is
        // considered to have entered, so draining the PERMANENT_ENTERED
        // notification through the trigger scan puts nothing on the stack:
        // neither player ever receives priority with the permanent holding
        // zero counters, and there is no ability to respond to.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);
        expect(state.pendingChoices ?? []).toEqual([]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
    });

    it("reads X chosen at cast time (CR 107.3)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, rockHydra.id, "p1");
        item.chosenX = 3;
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.["+1/+1"]).toBe(3);
    });

    it("reads the Multikicker tally (CR 702.33e)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, everflowingChalice.id, "p1");
        item.kickerCount = 2;
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === item.id
        )!;
        expect(live.counters?.charge).toBe(2);
    });

    // The clause is not "as this is CAST" — a permanent put onto the
    // battlefield by ANY effect enters with its counters too (CR 121.6 says
    // "enters the battlefield", not "resolves"). Before #1693 this path applied
    // no entry counters at all: `entersWith` was read only at the
    // cast-resolution site, so a reanimated Clockwork Beast entered as a 0/4.
    it("applies on the non-cast entry path too (reanimation / put onto the battlefield)", () => {
        const beast = makeInstance(clockworkBeast.id, {
            id: "beast",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [beast] }),
                makePlayer("p2"),
            ],
        });
        const stackItem = pushSpell(state, resurrection.id, "p1");
        const ctx = buildSpellContext(state, stackItem);
        expect(ctx.returnToBattlefield("p1", "beast", "graveyard")).toBe(true);

        const live = state.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(live.counters?.["+1/+0"]).toBe(7);
        expect(getEffectivePower(state, live)).toBe(7);
    });

    it("wire format: the counters survive projectPublicState with no zero-counter window", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, clockworkBeast.id, "p1");
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === item.id
            )!;
            expect(slim.counters?.["+1/+0"]).toBe(7);
            expect(getEffectivePower(projected, slim)).toBe(7);
            // Nothing for the client to render on the stack / ability list.
            expect(projected.stack).toEqual([]);
        }
    });
});
