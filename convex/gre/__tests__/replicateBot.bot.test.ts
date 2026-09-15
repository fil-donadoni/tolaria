// Bot reachability for Replicate (CR 702.56, issue #2100).
//
//   ENUMERATION — `enumerateKickerVariants` (`gre/kicker.ts`) is KEYWORD-BLIND
//     and samples a `multi` entry at [0, 1, 2], so a replicate entry is offered
//     exactly like a Multikicker or Squad one. Proved here against the shipped
//     card, because "reachable" is a property of `enumerateMoves`.
//   EXECUTION — the search sandbox charges the payment onto the sandboxed
//     spell and casts through `emitSpellCastEvent`, so the Bot's own model gets
//     the cast-copy trigger the server would build.
//   VALUATION — Lose Focus's script is `mayPay` + `if` + `counter`, Ops with
//     standing `OP_VALUERS` rows (Force Spike's shape); the copies are valued by
//     searching them, not by a new term.
//
// The choice surface raises nothing new: the count is part of the cast Move,
// and each copy's CR 707.10b offer is the copy-retarget `pendingTarget` the
// Bot already answers for Storm.
import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { additionalCostPaidCount } from "../kicker";
import { type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";

const BOT = "p1";
const OPP = "p2";

const LOSE_FOCUS = getCardByName("Lose Focus").id;
const ISLAND = getCardByName("Island").id;
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;

function board(islandCount: number): GameState {
    const state = makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(LOSE_FOCUS, {
                        id: "lf",
                        zone: "hand",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
                battlefield: Array.from({ length: islandCount }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `is${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "battlefield",
                    })
                ),
            }),
            makePlayer(OPP),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    // Something for Lose Focus to target.
    pushSpell(state, LIGHTNING_BOLT, OPP, [{ type: "player", id: BOT }]);
    return state;
}

function castMoves(state: GameState): Move[] {
    return enumerateMoves(state, BOT).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "lf"
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

describe("Replicate — the Bot can reach it (CR 702.56a)", () => {
    it("offers the unpaid cast and both sampled replicate counts", () => {
        // {1}{U} printed plus {U} per payment: 4 Islands covers replicate ×2.
        expect(paymentsOf(castMoves(board(4)))).toEqual(
            new Set(["null", '{"replicate":1}', '{"replicate":2}'])
        );
    });

    it("offers only what is affordable — replicate is an ADDITIONAL cost (CR 601.2f)", () => {
        expect(paymentsOf(castMoves(board(2)))).toEqual(new Set(["null"]));
    });

    it("the search sandbox pays it and builds the cast-copy trigger", () => {
        const state = board(4);
        const move = castMoves(state).find(
            (m) => m.kind === "cast-spell" && m.kickerPayments?.replicate === 2
        )!;
        expect(move, "the replicate ×2 Move was never offered").toBeDefined();
        const after = applyMoveForSearch(state, BOT, move);
        const spell = after.stack.find((s) => s.id === "lf");
        expect(spell, "Lose Focus is not on the sandboxed stack").toBeDefined();
        // CR 702.33d — not a kick: the count is on the sibling record.
        expect(spell!.kickerPayments).toBeUndefined();
        expect(additionalCostPaidCount(spell!, "replicate")).toBe(2);
        // The sandbox drains the cast-induced segment (`applyMoveForSearch`),
        // so the trigger has already resolved: its two copies are what the
        // Bot's model now holds.
        expect(
            after.stack.filter(
                (s) => s.isCopy === true && s.card.id === LOSE_FOCUS
            )
        ).toHaveLength(2);
    });
});
