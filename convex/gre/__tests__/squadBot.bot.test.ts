// Bot reachability for Squad (CR 702.157, issue #3220).
//
// The resident rule's three seams, for a keyword whose whole cost half is new
// vocabulary on an old subsystem:
//
//   ENUMERATION — `enumerateKickerVariants` (`gre/kicker.ts`) samples a
//     `multi` entry's repeat axis at [0, 1, 2] and is KEYWORD-BLIND, so a
//     squad entry is offered exactly like a Multikicker one. This file proves
//     that against the shipped card rather than against the sampler's source,
//     because "reachable" is a property of `enumerateMoves`, which nothing
//     guards catalogue-wide.
//   EXECUTION — the two search sandboxes charge the payment and carry it onto
//     the sandboxed stack item, so a squad cast the Bot picks is a squad cast
//     the Bot actually paid for.
//   VALUATION — `createTokenCopy` has had its `OP_VALUERS` row and its
//     `beneficial` `OP_BENEFICENCE` sign since issue #1459/#1515, and the
//     `{ additionalCostPaid }` count grounds to the shared `CF_ASSUMED_REF`
//     floor (`grounding.ts`) rather than to zero — the sign never fails open
//     to neutral. Asserted through the census in `opValuers.bot.test.ts`; what
//     is asserted HERE is the one thing that census cannot see, namely that
//     the Op is reached at all.
//
// The choice surface is the fourth question and has no row: squad raises no
// `PendingChoice`. The count is announced as part of the cast Move, so there
// is nothing for a candidate generator to answer and no minimal-legal
// fallback to freeze on.
import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { additionalCostPaidCount } from "../kicker";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";

const BOT = "p1";
const OPP = "p2";

const SECURITRON_SQUADRON = getCardByName("Securitron Squadron").id;
const PLAINS = getCardByName("Plains").id;

function lands(n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(PLAINS, {
            id: `pl${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        })
    );
}

function board(landCount: number): GameState {
    return makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(SECURITRON_SQUADRON, {
                        id: "sq",
                        zone: "hand",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                battlefield: lands(landCount),
            }),
            makePlayer(OPP),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

function castMoves(state: GameState): Move[] {
    return enumerateMoves(state, BOT).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "sq"
    );
}

function paymentsOf(moves: Move[]): Set<string> {
    return new Set(
        moves.map((m) =>
            JSON.stringify(
                m.kind === "cast-spell" ? (m.kickerPayments ?? null) : null
            )
        )
    );
}

describe("Squad — the Bot can reach it (CR 702.157a / 702.33c)", () => {
    it("offers the unpaid cast and both sampled squad counts", () => {
        // {1}{W} printed plus {3} per payment: 8 Plains covers squad ×2.
        expect(paymentsOf(castMoves(board(8)))).toEqual(
            new Set(["null", '{"squad":1}', '{"squad":2}'])
        );
    });

    it("offers only what is affordable — squad is an ADDITIONAL cost (CR 601.2f)", () => {
        // 5 Plains: {1}{W} + one {3}, and nothing left for a second.
        expect(paymentsOf(castMoves(board(5)))).toEqual(
            new Set(["null", '{"squad":1}'])
        );
        // 2 Plains: the printed cost only.
        expect(paymentsOf(castMoves(board(2)))).toEqual(new Set(["null"]));
    });

    it("the search sandbox carries the payment onto the sandboxed spell", () => {
        // A Move the enumerator offers but the sandbox casts naked is the
        // silent half of this bug class: the Bot would pay for the squad cost
        // in its own model and get no tokens in the real game.
        const state = board(8);
        const move = castMoves(state).find(
            (m) => m.kind === "cast-spell" && m.kickerPayments?.squad === 2
        )!;
        expect(move, "the squad ×2 Move was never offered").toBeDefined();
        const after = applyMoveForSearch(state, BOT, move);
        const onStack = after.stack.find(
            (s) => s.card.id === SECURITRON_SQUADRON
        );
        const onBoard = getPlayer(after, BOT).battlefield.find(
            (c) => c.card.id === SECURITRON_SQUADRON && c.isToken !== true
        );
        const carrier = onStack ?? onBoard;
        expect(
            carrier,
            "the Squadron reached neither the sandboxed stack nor the sandboxed battlefield"
        ).toBeDefined();
        // CR 702.33d — squad is not a kick, so the count is on the SIBLING
        // record; a sandbox that wrote it to `kickerPayments` would make the
        // Bot's own model disagree with the server's.
        expect(carrier!.kickerPayments).toBeUndefined();
        expect(additionalCostPaidCount(carrier!, "squad")).toBe(2);
    });
});
