// `cost.returnThisToHand` on the BOT's payment path (issue #3204).
//
// A cost leg the mutation pays and the search does not is a leg the Bot plays
// for free: the tree keeps the permanent on the board AND banks the ability's
// payoff, so the line evaluates strictly better than anything live play can
// reach. `COST_LEG_CLAIMS.returnThisToHand` claims
// `applyActivationCostsForSearch` (`gre/applyMove.ts`) as the whole answer for
// this leg, and this file is what makes the claim testable rather than
// asserted: the REAL Attunement definition, through the REAL enumerator, into
// both search entry points.
//
// Both are needed and they are different code (the `applyMove.bot.test.ts`
// eternalize pair draws the same distinction): `applyMoveForSearch` is the
// greedy 1-ply sandbox and copies, `applyMoveInSearch` is the ISMCTS tree leaf
// and mutates in place.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { Move } from "../moves";
import type { GameState } from "../state";

const ATTUNEMENT = getCardByName("Attunement").id;
const ISLAND = getCardByName("Island").id;
const BOT = "p1";

function attunementState(): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                battlefield: [
                    makeInstance(ATTUNEMENT, {
                        id: "attunement",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                library: Array.from({ length: 10 }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `lib${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

function attunementMove(state: GameState): Move {
    const move = enumerateMoves(state, BOT).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "attunement" &&
            m.abilityId === "attunement-draw-discard"
    );
    // Seam 1 of the Bot reachability walk: the enumerator REACHES the ability.
    // A cost leg it cannot afford by construction would leave this undefined.
    expect(move, "enumerateMoves offers Attunement's ability").toBeDefined();
    return move!;
}

describe("cost.returnThisToHand in the Bot's search (CR 602.1a / 601.2h)", () => {
    it("applyMoveForSearch (greedy 1-ply sandbox) moves the source battlefield → hand", () => {
        const state = attunementState();
        const move = attunementMove(state);

        const next = applyMoveForSearch(state, BOT, move);
        const nextBot = next.players.find((p) => p.id === BOT)!;

        expect(nextBot.battlefield.map((c) => c.id)).toEqual([]);
        expect(nextBot.hand.some((c) => c.id === "attunement")).toBe(true);
        // The pure sandbox must not leak the bounce back into the caller.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "attunement",
        ]);
    });

    it("applyMoveInSearch (ISMCTS tree leaf) moves the source battlefield → hand, in place", () => {
        const state = attunementState();
        const move = attunementMove(state);

        applyMoveInSearch(state, BOT, move);
        const bot = state.players.find((p) => p.id === BOT)!;

        expect(bot.battlefield.map((c) => c.id)).toEqual([]);
        expect(bot.hand.some((c) => c.id === "attunement")).toBe(true);
        // The resource is genuinely spent inside the tree: the same line cannot
        // activate the same permanent twice.
        expect(
            enumerateMoves(state, BOT).filter(
                (m) =>
                    m.kind === "activate-ability" &&
                    m.cardInstanceId === "attunement"
            )
        ).toHaveLength(0);
    });
});
