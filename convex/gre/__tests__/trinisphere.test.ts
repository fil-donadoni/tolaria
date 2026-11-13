// Trinisphere — CR 601.2f: "any effects that directly affect the total cost
// are applied" once the total is determined, i.e. AFTER every increase and
// reduction. Each spell that would cost less than three mana costs three; the
// extra mana is generic, so coloured pips stay as printed.

import { describe, it, expect } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import { trinisphere } from "../../cards/sets/dst/colorless.cards";
import { forest } from "../../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import {
    applyCostModifiers,
    getCostModifiers,
    normalizeManaCost,
    type GameState,
} from "../state";
import type { ManaCost } from "../../cards/types";

const def = trinisphere();

function board(opts: { tapped?: boolean; sphere?: boolean } = {}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {}),
            makePlayer("p2", {
                battlefield:
                    opts.sphere === false
                        ? []
                        : [
                              makeInstance(def.id, {
                                  id: "trini",
                                  controllerId: "p2",
                                  ownerId: "p2",
                                  tapped: opts.tapped ?? false,
                              }),
                          ],
            }),
        ],
    });
}

function priced(
    state: GameState,
    printed: ManaCost,
    kind: "spell" | "ability" = "spell"
) {
    const view = makeInstance(forest().id, {
        id: "spell-view",
        controllerId: "p1",
        zone: "hand",
    });
    const cost = normalizeManaCost(printed);
    applyCostModifiers(
        cost,
        getCostModifiers(state, view, kind, undefined, "p1")
    );
    return cost;
}

describe("Trinisphere", () => {
    it("raises a {0} / {1} / {2} spell to three mana, generic", () => {
        withTemporaryDefinition(def, () => {
            expect(priced(board(), {}).X).toBe(3);
            expect(priced(board(), { X: 1 }).X).toBe(3);
            expect(priced(board(), { X: 2 }).X).toBe(3);
        });
    });

    it("keeps coloured pips and adds generic: {1}{B} costs {2}{B}", () => {
        withTemporaryDefinition(def, () => {
            const cost = priced(board(), { X: 1, B: 1 });
            expect(cost.B).toBe(1);
            expect(cost.X).toBe(2);
        });
    });

    it("never lowers or touches a cost of three or more", () => {
        withTemporaryDefinition(def, () => {
            expect(priced(board(), { X: 3 }).X).toBe(3);
            expect(priced(board(), { X: 5 }).X).toBe(5);
            expect(priced(board(), { X: 1, B: 2 })).toEqual({ X: 1, B: 2 });
        });
    });

    it("is applied after reductions: a reduced spell is lifted back to three", () => {
        withTemporaryDefinition(def, () => {
            const state = board();
            const view = makeInstance(forest().id, {
                id: "spell-view",
                controllerId: "p1",
                zone: "hand",
            });
            const cost = normalizeManaCost({ X: 4 });
            const mods = getCostModifiers(
                state,
                view,
                "spell",
                undefined,
                "p1"
            );
            mods.reductionGeneric = 3;
            applyCostModifiers(cost, mods);
            expect(cost.X).toBe(3);
        });
    });

    it("stops while it is tapped", () => {
        withTemporaryDefinition(def, () => {
            expect(priced(board({ tapped: true }), { X: 1 }).X).toBe(1);
        });
    });

    it("does nothing without it on the battlefield", () => {
        withTemporaryDefinition(def, () => {
            expect(priced(board({ sphere: false }), { X: 1 }).X).toBe(1);
        });
    });

    it("leaves an activated ability's cost alone (it is not a spell)", () => {
        withTemporaryDefinition(def, () => {
            expect(priced(board(), { X: 1 }, "ability").X).toBe(1);
        });
    });
});
