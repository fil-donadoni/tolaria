// tla (Avatar: The Last Airbender) — per-card behavior tests for blue cards
// in `convex/cards/sets/tla/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { wanShiTongLibrarian } from "../blue";
import { vampiricTutor } from "../../vis/black";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";

/** Casts Wan Shi Tong for `x`, resolves the creature spell (entering the
 *  battlefield puts its ETB trigger on the stack, CR 603.6b — mirrors Jacked
 *  Rabbit's `castForX`, `sets/blc/__tests__/white.test.ts`), then resolves
 *  that trigger too so the counters/draw actually apply. */
function castForX(x: number): { state: GameState; wst: CardInstanceState } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(grizzlyBears.id, {
                        id: "lib-1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib-2",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib-3",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const item = pushSpell(state, wanShiTongLibrarian.id, "p1");
    item.chosenX = x;
    resolveTopOfStack(state); // creature enters; ETB trigger goes on the stack
    resolveTopOfStack(state); // ETB trigger resolves: counters + draw
    const wst = state.players[0].battlefield.find((c) => c.id === item.id)!;
    return { state, wst };
}

describe("Wan Shi Tong, Librarian — ETB (CR 603.6b, issue #788)", () => {
    it("X=4 — puts 4 +1/+1 counters and draws half of X, rounded down (2)", () => {
        const { state, wst } = castForX(4);
        expect(wst.counters?.["+1/+1"]).toBe(4);
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("X=1 — an odd X rounds the draw DOWN to 0", () => {
        const { state, wst } = castForX(1);
        expect(wst.counters?.["+1/+1"]).toBe(1);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(3);
    });

    it("X=0 — no counters, no draw, no crash", () => {
        const { state, wst } = castForX(0);
        expect(wst.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("effective P/T reflects the counters and survives the wire projection", () => {
        const { state, wst } = castForX(3);
        expect(getEffectivePower(state, wst)).toBe(4); // 1 base + 3 counters
        expect(getEffectiveToughness(state, wst)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === wst.id
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Wan Shi Tong, Librarian — opponent-searches trigger (CR 603.2, issue #788)", () => {
    /** Puts Wan Shi Tong directly on p1's battlefield (bypassing the X-cast
     *  ETB entirely — that half is covered above) so these tests isolate the
     *  SECOND ability. Casts and resolves `vampiricTutor` (a real shipped
     *  DSL tutor, `sets/vis/black.ts`) for `casterId`, submitting its
     *  search-library choice — the exact production choke point every
     *  tutor/fetchland commits through. */
    function withWanShiTongAnd(
        casterId: "p1" | "p2",
        overrides: Partial<Parameters<typeof makeState>[0]> = {}
    ): GameState {
        const wst = makeInstance(wanShiTongLibrarian.id, {
            id: "wst-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Both players' libraries carry a card regardless of who casts the
        // tutor: the SEARCHER needs one to find (vampiricTutor's `count:
        // {min:0,max:1}` tolerates an empty library, but a real find is a
        // stronger proof), and Wan Shi Tong's OWN CONTROLLER (p1) separately
        // needs one to actually DRAW when its ability resolves.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wst],
                    life: 20,
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p1-lib-1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "p2-lib-1",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
            ...overrides,
        });
        pushSpell(state, vampiricTutor.id, casterId);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: casterId === "p1" ? ["p1-lib-1"] : ["p2-lib-1"],
        });
        return state;
    }

    it("fires when an OPPONENT searches: +1/+1 counter and a card drawn", () => {
        const state = withWanShiTongAnd("p2");
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "wan-shi-tong-librarian-search"
        );
        expect(trigger).toBeDefined();
        resolveTopOfStack(state);
        const wst = state.players[0].battlefield.find((c) => c.id === "wst-1")!;
        expect(wst.counters?.["+1/+1"]).toBe(1);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("does NOT fire when Wan Shi Tong's OWN controller searches", () => {
        const state = withWanShiTongAnd("p1");
        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "wan-shi-tong-librarian-search"
            )
        ).toBeUndefined();
    });

    it("the counter and drawn card survive the wire projection", () => {
        const state = withWanShiTongAnd("p2");
        resolveTopOfStack(state);
        const wst = state.players[0].battlefield.find((c) => c.id === "wst-1")!;

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === wst.id
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        // The viewer (p1) sees their own hand count grow by the drawn card.
        expect(projected.players[0].hand).toHaveLength(1);
    });
});

// Bugfix regression (issue #788 post-review): the Scryfall type line is
// "Legendary Creature — Bird Spirit", but the card definition was missing
// `supertypes: ["Legendary"]` — `isLegendaryPermanent` (`gre/sba.ts`) reads
// that field, so the CR 704.5j legend rule never applied and two copies
// coexisted silently.
describe("Wan Shi Tong, Librarian — legend rule (CR 704.5j, issue #788)", () => {
    it("carries the Legendary supertype", () => {
        expect(wanShiTongLibrarian.supertypes).toEqual(["Legendary"]);
    });

    it("two controlled copies trigger the legend-keep SBA choice", () => {
        const a = makeInstance(wanShiTongLibrarian.id, {
            id: "wst-legend-a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(wanShiTongLibrarian.id, {
            id: "wst-legend-b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("legend-keep");

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head!.stackItemId,
            step: head!.step,
            choiceId: head!.choiceId,
            cardInstanceIds: ["wst-legend-b"],
        });

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "wst-legend-b",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "wst-legend-a",
        ]);
    });
});
