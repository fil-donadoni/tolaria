// Bot-lane half of the conditional-flash SURCHARGE (CR 601.3c, issue #2146):
// the Bot's tap plan must pay the SAME total `announceCast` charges.
//
// Lives in its own `*.bot.test.ts` file because `convex/gre/moves.ts` is a
// declared bot module (`bot-suite-boundary.test.ts`), so any test importing the
// enumerator belongs to `test:bot`.
//
// The shape this guards (round-2 review finding 1) is the bot-freeze one, not a
// mispriced-by-{2} curiosity. `getLegalActions` offers the off-window cast when
// the caster can POTENTIALLY make the SURCHARGED total (`extraMana`,
// `rules.ts`), while `enumerateCastMoves` used to build its `tapPlan` from the
// PRINTED cost alone. The executor (`src/lib/ai/executor.ts`) announces FIRST
// and taps afterwards, so a cast enumerated at 5 against a folded 7 parks in
// `pendingCast` with 5 mana in the pool; `enumerateMoves` returns [] while a
// `pendingCast` is open, leaving only the `abort-announcement` rung — tap five
// lands for nothing, cancel, re-enumerate the identical move, forever.
//
// Both directions are pinned: the surcharge is IN the plan off-window, and OUT
// of it inside the caster's own sorcery window (it is never payable for
// nothing, CR 601.3c).

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { getLegalActions } from "../rules";
import type { GameState } from "../state";
import { rout } from "../../cards/sets/inv/white";
import { ghituFire } from "../../cards/sets/inv/red";

const PLAINS = getCardByName("Plains").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** p1 holds `cardId` with `landCount` untapped lands of `landId`. */
function board(
    cardId: string,
    landId: string,
    landCount: number,
    window: "own" | "off"
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(cardId, {
                        id: "spell1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: landCount }, (_, i) =>
                    makeInstance(landId, {
                        id: `land${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        // p1 always holds priority; only whose TURN it is moves.
        activePlayerId: window === "own" ? "p1" : "p2",
        priorityPlayerId: "p1",
    });
}

function castMoves(state: GameState): Extract<Move, { kind: "cast-spell" }>[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "spell1"
    );
}

describe("Bot tap plan vs the conditional-flash surcharge (CR 601.3c, issue #2146)", () => {
    it("pays the SURCHARGED total off-window — {3}{W}{W} + {2} = seven lands, not five", () => {
        // Rout {3}{W}{W} = 5; the off-window cast owes {2} more.
        const state = board(rout.id, PLAINS, 7, "off");
        // The affordability probe offers the cast...
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).toContain("cast");
        const casts = castMoves(state);
        expect(casts).toHaveLength(1);
        // ...and the plan the executor will submit pays what `announceCast`
        // folds. Five here is the shipped freeze.
        expect(casts[0].tapPlan).toHaveLength(7);
    });

    it("does NOT pay it inside the caster's own sorcery window — five lands", () => {
        const state = board(rout.id, PLAINS, 7, "own");
        const casts = castMoves(state);
        expect(casts).toHaveLength(1);
        expect(casts[0].tapPlan).toHaveLength(5);
    });

    it("enumerates no cast at all when only the PRINTED cost is reachable — planner and probe agree", () => {
        // Six Plains covers {3}{W}{W} but not the surcharged seven: the probe
        // withholds "cast" and the enumerator emits nothing, so the Bot never
        // announces a cast it cannot finish paying for.
        const state = board(rout.id, PLAINS, 6, "off");
        expect(
            getLegalActions(state, state.players[0], state.players[0].hand[0])
        ).not.toContain("cast");
        expect(castMoves(state)).toHaveLength(0);
        // ...while the same six lands are plenty inside the own window.
        const own = board(rout.id, PLAINS, 6, "own");
        expect(castMoves(own)).toHaveLength(1);
    });

    it("shrinks an X spell's enumerated range by the surcharge (Ghitu Fire {X}{R})", () => {
        // Six Mountains: X ≤ 5 in the own window, X ≤ 3 off-window ({R} + {2}).
        const maxX = (s: GameState) =>
            Math.max(...castMoves(s).map((m) => m.chosenX ?? 0));
        expect(maxX(board(ghituFire.id, MOUNTAIN, 6, "own"))).toBe(5);
        const off = board(ghituFire.id, MOUNTAIN, 6, "off");
        expect(maxX(off)).toBe(3);
        // Every enumerated X pays the surcharge, not just the ceiling.
        for (const m of castMoves(off)) {
            expect(m.tapPlan).toHaveLength((m.chosenX ?? 0) + 1 + 2);
        }
    });
});
