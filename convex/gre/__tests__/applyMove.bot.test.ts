// CR 702.66b / 601.2g (issue #1661) — the search leaf must model delve's
// graveyard-exile payment. `enumerateMoves` (moves.ts) discounts a delve
// cast's `tapPlan` by the number of graveyard cards it assumes get exiled,
// but the emitted `Move` never records which/how many cards that was — so a
// search leaf that only replays `tapPlan` (both `applyMoveForSearch`, the
// greedy 1-ply sandbox, and `applyMoveInSearch`, the actual ISMCTS tree leaf)
// previously evaluated a delve cast as costing NOTHING from the graveyard.
// That over-rates Treasure Cruise and leaves phantom fuel for a later
// graveyard-cost play in the same rollout (escape, flashback, another delve
// cast) to illegally reuse.
//
// See `applyDelveExileForSearch` (`convex/gre/applyMove.ts`), shared by both
// leaves.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import { delveEligibleCards } from "../payWith";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { Move } from "../moves";

const TREASURE_CRUISE = getCardByName("Treasure Cruise").id; // {7}{U}, delve
const ISLAND = getCardByName("Island").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** `n` cards in `BOT`'s graveyard as delve fuel — plain vanilla cards, delve
 *  has no colour/type filter (CR 702.66a). */
function fuel(n: number, ownerId: string) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(MOUNTAIN, {
            id: `gy${i}`,
            controllerId: ownerId,
            ownerId,
            zone: "graveyard",
        })
    );
}

/** One untapped Island — exactly enough to pay Treasure Cruise's {U} pip and
 *  nothing toward its {7} generic, so the generic portion is FULLY forced
 *  onto delve (`genericManaShortfall` sees zero leftover mana). With a
 *  7-card graveyard this makes the delve count deterministic: exactly 7. */
function oneIsland(id: string, ownerId: string) {
    return makeInstance(ISLAND, { id, controllerId: ownerId });
}

function findCastMove(moves: Move[], cardInstanceId: string) {
    return moves.find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("applyMoveForSearch — delve pays graveyard, not free mana (issue #1661)", () => {
    it("shrinks the simulated graveyard by the delved card count", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const moves = enumerateMoves(state, BOT);
        const castMove = findCastMove(moves, cruise.id);
        expect(castMove).toBeDefined();
        expect(castMove?.kind).toBe("cast-spell");

        const next = applyMoveForSearch(state, BOT, castMove!);
        const nextBot = next.players.find((p) => p.id === BOT)!;

        // The whole 7-card graveyard was the forced minimum delve (1 lone
        // Island covers only the {U} pip, nothing toward the {7} generic) —
        // every one of those 7 cards should have left for exile. The ONE
        // card left in the graveyard afterward is Treasure Cruise itself,
        // landing there normally once `applyMoveForSearch` resolves it off
        // the stack (a sorcery goes to its owner's graveyard on resolution,
        // CR 608.2m) — not leftover delve fuel.
        expect(nextBot.graveyard.map((c) => c.id)).toEqual([cruise.id]);
        expect(nextBot.exile).toHaveLength(7);
        expect(nextBot.exile.map((c) => c.id).sort()).toEqual(
            fuel(7, BOT)
                .map((c) => c.id)
                .sort()
        );

        // The original (pre-move) state must be untouched — applyMoveForSearch
        // clones before mutating.
        expect(bot.graveyard).toHaveLength(7);
    });
});

describe("applyMoveInSearch — delve pays graveyard, not free mana (issue #1661)", () => {
    it("shrinks the simulated graveyard by the delved card count, in place", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const castMove = findCastMove(enumerateMoves(state, BOT), cruise.id)!;
        applyMoveInSearch(state, BOT, castMove);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        expect(botAfter.graveyard).toHaveLength(0);
        expect(botAfter.exile).toHaveLength(7);
    });

    it("a later graveyard-cost play in the same rollout can no longer reuse the delved fuel", () => {
        const BOT = "p2";
        const cruise1 = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const cruise2 = makeInstance(TREASURE_CRUISE, {
            id: "cruise2",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise1, cruise2],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        // Before anything is cast, BOTH copies see the full 7-card graveyard
        // as eligible delve fuel — each evaluated independently against the
        // still-untouched position.
        expect(delveEligibleCards(bot, cruise1.id)).toHaveLength(7);
        expect(delveEligibleCards(bot, cruise2.id)).toHaveLength(7);
        expect(
            findCastMove(enumerateMoves(state, BOT), cruise2.id)
        ).toBeDefined();

        // Cast the first copy through the real ISMCTS leaf.
        const firstCast = findCastMove(enumerateMoves(state, BOT), cruise1.id)!;
        applyMoveInSearch(state, BOT, firstCast);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        expect(botAfter.graveyard).toHaveLength(0);

        // THE BUG: without the fix, the graveyard still reports 7 eligible
        // cards here (the exile never happened), so the second copy would
        // still see itself as fully delve-payable. With the fix, the fuel is
        // gone — the primitive every graveyard-cost mechanic (delve, escape,
        // flashback) queries reports zero.
        expect(delveEligibleCards(botAfter, cruise2.id)).toHaveLength(0);

        // And the second-order behavioral effect: the second copy is no
        // longer castable at all in this position (no mana AND no delve fuel
        // left) — the lone Island is spent and the graveyard is empty, where
        // it was legally castable moments ago against the pre-cast position.
        const movesAfter = enumerateMoves(state, BOT);
        expect(findCastMove(movesAfter, cruise2.id)).toBeUndefined();
    });
});
