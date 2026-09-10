// Bot reachability for a split HALF cast from a zone other than the hand
// (CR 709.3, issue #3344).
//
// The mirror of the frontend walk in `splitCast.test.ts`: a half the GRE
// offers and the projection surfaces is still unshipped if `enumerateMoves`
// never emits it — the Bot simply never casts Life or Death out of a graveyard
// and nothing anywhere is red. Two seams are at stake, and both were closed
// before this issue only because the whole card failed closed outside the hand:
//
//   * REACHABILITY — the independent-cast-options loop (`enumerateCastMoves`)
//     was gated on `lifeInsteadOfMana === undefined`, so a split card on top of
//     a Bolas's Citadel library enumerated nothing at all;
//   * PRICE — that loop paid `alt.mana`, the half's PRINTED cost, in every
//     zone. From a graveyard under Underworld Breach the mutation charges the
//     escape cost and off a Citadel it charges life and no mana, so a tap plan
//     built from the printed cost is a Move `announceCast` refuses: the
//     #2283/#2284 bot-freeze shape.
//
// Both are asserted against the SAME authority the mutation resolves the
// announced option through (`castAlternativeCostForZone`), so a future
// divergence reds here rather than in a game.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateCastMoves } from "../moves";
import { libraryTopCastLifeCost } from "../rules";
import { splitCastAltCostId } from "../splitCast";
import type { GameState } from "../state";
import { bonecrusherGiant } from "../../cards/sets/eld/red";

const STAND_DELIVER = getCardByName("Stand // Deliver");
const PLAINS = getCardByName("Plains").id;
const ISLAND = getCardByName("Island").id;
const CITADEL = getCardByName("Bolas's Citadel").id;

const LEFT = splitCastAltCostId(STAND_DELIVER, "left");
const RIGHT = splitCastAltCostId(STAND_DELIVER, "right");

/** p1 with Stand // Deliver in `zone`, `plains` Plains, `islands` Islands and
 *  a Hill Giant on p2's board (a legal target for both halves). */
function position(
    zone: "graveyard" | "library",
    plains: number,
    islands: number,
    extraBattlefield: string[] = []
): GameState {
    const card = makeInstance(STAND_DELIVER.id, {
        id: "split",
        controllerId: "p1",
        ownerId: "p1",
        zone,
    });
    return makeState({
        players: [
            makePlayer("p1", {
                ...(zone === "graveyard"
                    ? { graveyard: [card] }
                    : { library: [card] }),
                battlefield: [
                    ...Array.from({ length: plains }, (_, i) =>
                        makeInstance(PLAINS, {
                            id: `plains${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                    ...Array.from({ length: islands }, (_, i) =>
                        makeInstance(ISLAND, {
                            id: `island${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                    ...extraBattlefield.map((id, i) =>
                        makeInstance(id, {
                            id: `extra${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(getCardByName("Hill Giant").id, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const castIds = (moves: ReturnType<typeof enumerateCastMoves>) =>
    new Set(
        moves.flatMap((m) =>
            m.kind === "cast-spell" ? [m.alternativeCostId] : []
        )
    );

describe("CR 709.3 — the Bot reaches a split half outside the hand (issue #3344)", () => {
    it("enumerates BOTH halves from the graveyard, each on its own price", () => {
        const state = position("graveyard", 1, 3);
        const moves = enumerateCastMoves(
            state,
            state.players[0],
            state.players[0].graveyard[0],
            { castFromZone: "graveyard" }
        );
        expect(castIds(moves)).toEqual(new Set([LEFT, RIGHT]));
        // Every move carries the zone, so the executor's `announceCast`
        // resolves the same source the enumerator priced.
        for (const m of moves) {
            if (m.kind === "cast-spell") {
                expect(m.castFromZone).toBe("graveyard");
            }
        }
    });

    it("drops the half the board cannot pay for (CR 709.3a)", () => {
        // ONE Plains: Stand's {W} is payable, Deliver's {2}{U} is not — and
        // the card's own {2}{U}{W} would have dropped both.
        const state = position("graveyard", 1, 0);
        const moves = enumerateCastMoves(
            state,
            state.players[0],
            state.players[0].graveyard[0],
            { castFromZone: "graveyard" }
        );
        expect(castIds(moves)).toEqual(new Set([LEFT]));
    });

    it("enumerates a half off the top of a Bolas's Citadel library, paying the HALF's life (CR 119.4 / 709.4b)", () => {
        const state = position("library", 0, 0, [CITADEL]);
        const player = state.players[0];
        const top = player.library[0];
        const lifeCost = libraryTopCastLifeCost(state, player, top);
        // The whole-card amount, which is what the caller can compute and what
        // the Move must NOT charge: Stand // Deliver is {2}{U}{W}, mana value 4.
        expect(lifeCost).toBe(4);
        const moves = enumerateCastMoves(state, player, top, {
            castFromZone: "library",
            lifeInsteadOfMana: lifeCost,
        });
        expect(castIds(moves)).toEqual(new Set([LEFT, RIGHT]));
        const left = moves.find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === LEFT
        );
        const right = moves.find(
            (m) => m.kind === "cast-spell" && m.alternativeCostId === RIGHT
        );
        // Stand's mana value is 1 and Deliver's is 3 — the life each half
        // actually costs, and no mana is tapped for either.
        expect(left).toMatchObject({ payLife: 1, tapPlan: [] });
        expect(right).toMatchObject({ payLife: 3, tapPlan: [] });
    });

    it("does NOT enumerate an ADVENTURE off a cost-replacing library top (CR 601.2b, PR review finding 1)", () => {
        // The half-loop's `lifeInsteadOfMana` gate had to be relaxed for the
        // split half, and relaxing it for EVERY independent option let the
        // Adventure through: CR 601.2b forbids two alternative methods of
        // casting on one spell, so `announceCast` refuses that Move outright —
        // the #2283/#2284 bot-freeze shape. Only the split half is exempt,
        // because CR 709.3's choice of half is not a price at all.
        const card = makeInstance(bonecrusherGiant.id, {
            id: "giant-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [card],
                    battlefield: [
                        makeInstance(CITADEL, {
                            id: "citadel",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        ...Array.from({ length: 4 }, (_, i) =>
                            makeInstance(getCardByName("Mountain").id, {
                                id: `mtn${i}`,
                                controllerId: "p1",
                                ownerId: "p1",
                            })
                        ),
                    ],
                }),
                makePlayer("p2", {}),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        const player = state.players[0];
        const moves = enumerateCastMoves(state, player, card, {
            castFromZone: "library",
            lifeInsteadOfMana: libraryTopCastLifeCost(state, player, card),
        });
        // The printed cast alone — the Adventure carries no way to say it is
        // riding the life substitution, so it is not offered.
        expect(castIds(moves)).toEqual(new Set([undefined]));
    });

    it("offers only the half the caster's life can pay for (CR 119.4)", () => {
        const state = position("library", 0, 0, [CITADEL]);
        const player = state.players[0];
        player.life = 2;
        const moves = enumerateCastMoves(state, player, player.library[0], {
            castFromZone: "library",
            lifeInsteadOfMana: libraryTopCastLifeCost(
                state,
                player,
                player.library[0]
            ),
        });
        // Deliver costs 3 life and Stand 1. Before this the whole card was
        // refused at 4 life or less and nothing was enumerated at all.
        expect(castIds(moves)).toEqual(new Set([LEFT]));
    });
});
