// Bot-lane half of Bestow (CR 702.103, issue #2388): the cast mode has to be
// VISIBLE to the search, not merely legal for a human.
//
// Lives in its own `*.bot.test.ts` file because `convex/gre/moves.ts` is a
// declared bot module (`bot-suite-boundary.test.ts`), so any test importing
// the enumerator belongs to `test:bot`.
//
// Why this matters more than the usual "the bot plays suboptimally" argument
// for an unenumerated cast option: every OTHER alternative cost this engine
// ships (evoke, dash, Gush, Fireblast) changes only what the caster PAYS, so a
// Bot that ignores them still reaches the same board states by another route.
// Bestow changes what the spell IS — a bestow line puts an Aura on a creature,
// and no other move this Bot can make produces that board. Skipping it makes a
// whole class of position unreachable in search.
//
// Three properties are pinned:
//   1. the bestow variant is enumerated ALONGSIDE the plain cast, one move per
//      legal creature target (CR 702.103b — an Aura spell must target);
//   2. it is NOT enumerated when no creature could host it, because the
//      executor announces before it taps and a target-less announcement
//      strands the Bot in `pendingCast` (the bot-freeze shape);
//   3. the search sandbox actually attaches it — `applyMoveForSearch` must
//      resolve the bestow variant into an Aura on the target, or every bestow
//      line evaluates as "a 1/1 entered" and the mode is worthless to the
//      value model even once enumerated.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { getEffectivePower } from "../layers";
import type { GameState } from "../state";
import { springheartNantuko } from "../../cards/sets/mh3/green";
import { grizzlyBears } from "../../cards/sets/lea";

const FOREST = getCardByName("Forest").id;

/** p1 holds Springheart Nantuko with two untapped Forests; `creatures` names
 *  the creatures on the board and who controls each. */
function board(creatures: Array<["p1" | "p2", string]>): GameState {
    const nantuko = makeInstance(springheartNantuko.id, {
        id: "nantuko",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const mine = creatures
        .filter(([who]) => who === "p1")
        .map(([, id]) =>
            makeInstance(grizzlyBears.id, { id, controllerId: "p1" })
        );
    const theirs = creatures
        .filter(([who]) => who === "p2")
        .map(([, id]) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [nantuko],
                battlefield: [
                    makeInstance(FOREST, { id: "f1", controllerId: "p1" }),
                    makeInstance(FOREST, { id: "f2", controllerId: "p1" }),
                    ...mine,
                ],
            }),
            makePlayer("p2", { battlefield: theirs }),
        ],
    });
}

function nantukoCasts(state: GameState): Move[] {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "nantuko"
    );
}

describe("Bestow — Bot move enumeration (CR 702.103a/b)", () => {
    it("enumerates the bestow variant beside the plain cast, one per legal host", () => {
        const state = board([
            ["p1", "bear1"],
            ["p2", "bear2"],
        ]);
        const casts = nantukoCasts(state);
        const plain = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === undefined
        );
        const bestowed = casts.filter(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "bestow"
        );
        expect(plain).toHaveLength(1);
        // "Enchant creature" names no controller, so BOTH creatures are legal
        // hosts — the Bot must see the option to buff its own AND the option
        // to bestow onto the opponent's.
        expect(bestowed).toHaveLength(2);
        for (const m of bestowed) {
            if (m.kind !== "cast-spell") throw new Error("narrowing");
            expect(m.targets).toHaveLength(1);
            expect(m.confirmTargets).toBe(false);
            // The tap plan must cover the BESTOW cost, not the printed one
            // (equal here, but read independently — the executor taps this
            // plan after announcing, so a short plan is the freeze shape).
            expect(m.tapPlan).toHaveLength(2);
        }
        expect(
            bestowed.flatMap((m) =>
                m.kind === "cast-spell" ? m.targets.map((t) => t.id) : []
            )
        ).toEqual(expect.arrayContaining(["bear1", "bear2"]));
    });

    it("enumerates NO bestow variant when no creature could host it (CR 601.2c)", () => {
        const casts = nantukoCasts(board([]));
        expect(
            casts.some(
                (m) =>
                    m.kind === "cast-spell" && m.alternativeCostId === "bestow"
            )
        ).toBe(false);
        // …and the plain creature cast is still there.
        expect(casts).toHaveLength(1);
    });

    it("the search sandbox resolves a bestow move into an attached Aura, so the value model sees the buff", () => {
        const state = board([["p1", "bear1"]]);
        const bestow = nantukoCasts(state).find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === "bestow"
        )!;
        const next = applyMoveForSearch(state, "p1", bestow);
        const p1 = next.players.find((p) => p.id === "p1")!;
        const permanent = p1.battlefield.find((c) => c.id === "nantuko")!;
        expect(permanent.bestowed).toBe(true);
        expect(permanent.types).toEqual(["Enchantment"]);
        expect(permanent.attachedTo).toBe("bear1");
        const bear = p1.battlefield.find((c) => c.id === "bear1")!;
        expect(getEffectivePower(next, bear)).toBe(3);
    });

    it("the PLAIN cast of the same card is still a 1/1 creature in the sandbox", () => {
        const state = board([["p1", "bear1"]]);
        const plain = nantukoCasts(state).find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === undefined
        )!;
        const next = applyMoveForSearch(state, "p1", plain);
        const p1 = next.players.find((p) => p.id === "p1")!;
        const permanent = p1.battlefield.find((c) => c.id === "nantuko")!;
        expect(permanent.bestowed).toBeUndefined();
        expect(permanent.attachedTo).toBeUndefined();
        const bear = p1.battlefield.find((c) => c.id === "bear1")!;
        expect(getEffectivePower(next, bear)).toBe(2);
    });
});
