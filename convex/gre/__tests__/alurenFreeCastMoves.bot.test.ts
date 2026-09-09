// Bot REACHABILITY for a board cast permission (CR 601.3 / 118.9, issue #2706).
//
// A permission the Bot cannot enumerate is a permission the Bot never uses, and
// nothing else goes red for it: the `blade` receipt fires on `BOT_GLOBS`, which
// `cards/sets/**` never touches, and the valuation censuses cover Ops, not cast
// variants. So the free cast earns its own enumeration test, plus the harder
// half — that the printed-cost variants DISAPPEAR wherever announcing one would
// be rejected (CR 118.9b), because a Move the mutation refuses is the
// #2283/#2284 bot-freeze class, not a merely suboptimal line.

import { describe, expect, it } from "vitest";
import { aluren } from "../../cards/sets/tmp/green";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { forest } from "../../cards/sets/lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { CAST_PERMISSION_ALT_COST_PREFIX } from "../castPermissions";
import { enumerateMoves } from "../moves";
import type { GameState } from "../state";

const ALUREN_ALT_COST_ID = `${CAST_PERMISSION_ALT_COST_PREFIX}aluren-creature-permission`;

/** p1 always owns the Aluren; `forests` are the CASTER's, so a printed-cost
 *  cast is genuinely payable whenever the count is non-zero — without that the
 *  printed variant is absent for lack of mana and a test claiming it was
 *  SUPPRESSED would pass for the wrong reason. */
function board(opts: {
    caster: "p1" | "p2";
    forests?: number;
    priorityPlayerId?: "p1" | "p2";
}): GameState {
    const { caster, forests = 0, priorityPlayerId = caster } = opts;
    const hand = [
        makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: caster,
            ownerId: caster,
            zone: "hand",
        }),
    ];
    const lands = (owner: "p1" | "p2") =>
        owner === caster
            ? Array.from({ length: forests }, (_, i) =>
                  makeInstance(forest.id, {
                      id: `${owner}-forest-${i}`,
                      controllerId: owner,
                      ownerId: owner,
                  })
              )
            : [];
    return makeState({
        players: [
            makePlayer("p1", {
                hand: caster === "p1" ? hand : [],
                battlefield: [
                    makeInstance(aluren.id, {
                        id: "aluren",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    ...lands("p1"),
                ],
            }),
            makePlayer("p2", {
                hand: caster === "p2" ? hand : [],
                battlefield: lands("p2"),
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId,
    });
}

const castMoves = (state: GameState, playerId: string) =>
    enumerateMoves(state, playerId).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "bears"
    ) as Array<{
        kind: "cast-spell";
        alternativeCostId?: string;
        tapPlan?: unknown[];
    }>;

describe("enumerateMoves — board cast permission (CR 601.3 / 118.9)", () => {
    it("surfaces the free cast with no mana to tap, on a board where the printed cost is unpayable", () => {
        const moves = castMoves(board({ caster: "p1" }), "p1");

        expect(moves).toHaveLength(1);
        expect(moves[0].alternativeCostId).toBe(ALUREN_ALT_COST_ID);
        // The whole point: nothing is tapped for it.
        expect(moves[0].tapPlan ?? []).toHaveLength(0);
    });

    it("offers BOTH lines inside the caster's own sorcery window — the free cast is a choice there (CR 307.1)", () => {
        const moves = castMoves(board({ caster: "p1", forests: 2 }), "p1");
        const ids = moves.map((m) => m.alternativeCostId);

        expect(ids).toContain(undefined);
        expect(ids).toContain(ALUREN_ALT_COST_ID);
    });

    it("drops the printed-cost line where announcing it would be REJECTED (CR 118.9b) — never a Move the mutation refuses", () => {
        // p2 holds priority during p1's turn: outside p2's sorcery window, so
        // `announceCast` demands the permission's alternative cost.
        const state = board({
            caster: "p2",
            // Enough mana that the printed {1}{G} IS payable: what removes the
            // printed line here is the CR 118.9b rejection, not affordability.
            forests: 2,
            priorityPlayerId: "p2",
        });
        const moves = castMoves(state, "p2");

        expect(moves.map((m) => m.alternativeCostId)).toEqual([
            ALUREN_ALT_COST_ID,
        ]);
    });

    it("enumerates nothing extra once the source leaves the battlefield", () => {
        const state = board({ caster: "p1", forests: 2 });
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "aluren"
        );

        expect(castMoves(state, "p1").map((m) => m.alternativeCostId)).toEqual([
            undefined,
        ]);
    });
});
