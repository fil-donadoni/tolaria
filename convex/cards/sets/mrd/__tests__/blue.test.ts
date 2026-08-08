// mrd (Mirrodin) — blue behavior tests (ADR 0043 colour split).
//
// ─────────────────────────────────────────────────────────────────────────────
// Affinity keyword (CR 702.41, PRD #702 / ADR 0063). This file is the KEYWORD's
// permanent test — the "new mechanic pays the entry fee once, reuse rides free"
// trade (`.claude/rules/gre-development.md` § per-Op / new-mechanic regime).
// Every later affinity card inherits it; Frogmite (`mrd/colorless.test.ts`) and
// Thought Monitor (`mh2/blue.test.ts`) add only the properties THEY are the
// witness for (self-count, keyword composition).
//
// 702.41a: "Affinity for [text]" is a static ability that functions while the
//          spell with affinity is on the stack. It means "This spell costs {1}
//          less to cast for each [text] you control."
// 702.41b: multiple instances of affinity each apply.
//
// Thoughtcast is the COLOURED witness: it proves the reduction is generic-only.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { thoughtcast } from "../blue";
import { frogmite } from "../colorless";
import { solRing } from "../../lea";
import { grizzlyBears } from "../../lea/green";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getLegalActions } from "../../../../gre/rules";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../../../../gre/state";
import type { CardDefinition } from "../../../types";

/** Mirror `game.ts`'s hand-cast cost calc: normalize the printed cost, then
 *  fold in cost modifiers (battlefield scan + self-host). The exact pair of
 *  functions the real cast site calls, so this asserts the shipped path and
 *  not a re-implementation. */
function effectiveCastCost(
    def: CardDefinition,
    state: GameState,
    controllerId = "p1"
): Record<string, number> {
    const spellView = makeInstance(def.id, {
        id: `${def.id}-spell-view`,
        controllerId,
        zone: "hand",
    });
    const cost = normalizeManaCost(def.manaCost ?? {});
    applyCostModifiers(cost, getCostModifiers(state, spellView, "spell"));
    return cost;
}

/** A board where `controllerId` controls `n` artifacts (Sol Rings) and,
 *  optionally, `bears` non-artifact creatures — the negative control for the
 *  `countFilter`. */
function boardWith(
    n: number,
    controllerId: "p1" | "p2" = "p1",
    bears = 0
): GameState {
    const permanents = [
        ...Array.from({ length: n }, (_, i) =>
            makeInstance(solRing.id, { id: `art-${i}`, controllerId })
        ),
        ...Array.from({ length: bears }, (_, i) =>
            makeInstance(grizzlyBears.id, { id: `bear-${i}`, controllerId })
        ),
    ];
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: controllerId === "p1" ? permanents : [],
            }),
            makePlayer("p2", {
                battlefield: controllerId === "p2" ? permanents : [],
            }),
        ],
    });
}

describe("Thoughtcast — Affinity for artifacts (CR 702.41a)", () => {
    it("is reachable through the card registry by name", () => {
        expect(getCardByName("Thoughtcast")?.id).toBe(thoughtcast.id);
    });

    it("costs the full {4}{U} with no artifacts controlled", () => {
        expect(effectiveCastCost(thoughtcast, boardWith(0))).toEqual({
            X: 4,
            U: 1,
        });
    });

    it("costs {1} less per artifact you control (1 → {3}{U}, 3 → {1}{U})", () => {
        expect(effectiveCastCost(thoughtcast, boardWith(1))).toEqual({
            X: 3,
            U: 1,
        });
        expect(effectiveCastCost(thoughtcast, boardWith(3))).toEqual({
            X: 1,
            U: 1,
        });
    });

    it("NEVER reduces the coloured {U} pip, however many artifacts (CR 702.41a reduces by {1}, a generic symbol)", () => {
        // 4 artifacts consume the whole {4}; 12 would consume far more.
        expect(effectiveCastCost(thoughtcast, boardWith(4))).toEqual({ U: 1 });
        expect(effectiveCastCost(thoughtcast, boardWith(12))).toEqual({ U: 1 });
    });

    it("counts only ARTIFACTS — a non-artifact creature does not reduce the cost", () => {
        expect(effectiveCastCost(thoughtcast, boardWith(0, "p1", 3))).toEqual({
            X: 4,
            U: 1,
        });
        // Mixed board: 2 artifacts + 3 bears reduces by exactly 2.
        expect(effectiveCastCost(thoughtcast, boardWith(2, "p1", 3))).toEqual({
            X: 2,
            U: 1,
        });
    });

    it("counts only the CASTER's artifacts, never an opponent's (CR 702.41a 'you control')", () => {
        expect(
            effectiveCastCost(thoughtcast, boardWith(4, "p2"), "p1")
        ).toEqual({ X: 4, U: 1 });
    });

    it("castability: the server does NOT offer 'cast' when only {U} floats and no artifacts are out", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(thoughtcast.id, {
                            id: "thoughtcast-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).not.toContain("cast");
    });

    it("castability: the server DOES offer 'cast' once four artifacts reduce it to {U}", () => {
        // The reduction alone makes the spell affordable — the affordability
        // probe (`rules.ts`) must see it, not just the payment path.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(thoughtcast.id, {
                            id: "thoughtcast-hand",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: Array.from({ length: 4 }, (_, i) =>
                        makeInstance(solRing.id, {
                            id: `art-${i}`,
                            controllerId: "p1",
                        })
                    ),
                    manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).toContain("cast");
    });

    it("two affinity spells on the board reduce independently — the reduction is per-SPELL, not shared (CR 702.41b)", () => {
        // Frogmite and Thoughtcast read the SAME board; each resolves its own
        // reduction. (702.41b's "multiple instances each apply" is the
        // single-spell case of the same additive accumulation in
        // `getCostModifiers`.)
        const state = boardWith(2);
        expect(effectiveCastCost(thoughtcast, state)).toEqual({ X: 2, U: 1 });
        expect(effectiveCastCost(frogmite, state)).toEqual({ X: 2 });
    });
});
