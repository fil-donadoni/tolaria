// Bot enumeration under a forced target choice (CR 601.2c, issue #3805).
//
// THE INVARIANT: every target tuple the enumerator offers is one the server
// accepts. The Bot submits a whole tuple in one `selectTargets` call and the
// server applies it PICK BY PICK, so a tuple that is legal "as a set" but
// illegal at one of its picks throws half-way through the announcement — and a
// rejected submission freezes the Bot exactly as hard as no submission at all
// (`gre-development.md` § Bot reachability).
//
// The shape that makes this more than a restatement of the cast test is a
// VARIABLE-count requirement. CR 601.2c narrows a pick only once the
// requirement can no longer be deferred, and for "up to three target
// creatures" the chooser may stop at ONE — so the very first pick is already
// the last one they are obliged to make, and `[Grizzly Bears, Standard
// Bearer]` is a tuple whose SET obeys the rule and whose FIRST PICK does not.
// A whole-tuple filter accepts it and the server rejects it.
//
// No catalogue card carries the shape yet, so the board registers a variant
// through the `withTemporaryDefinition` seam (the catalogue is frozen).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { standardBearer } from "../../cards/sets/apc/white";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { mountain } from "../../cards/sets/lea/colorless";
import { enumerateMoves, type Move } from "../moves";
import { announceCast, confirmTargets, selectTargets } from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import type { GameState } from "../state";

/** "Up to ONE target creature" — the `min: 0` shape (Teferi, Time Raveler's
 *  +1, Minsc & Boo, Sorin). The chooser may decline the group entirely, so the
 *  first pick they DO make is already the last one the requirement can bind,
 *  and a group-satisfiability probe that reads `min: 0` as "nothing here can
 *  obey" hands the Bot a tuple the mutation throws on. */
const NUDGE: CardDefinition = {
    id: "5a8f33a1-6f2c-4f2f-9b7e-4c2b1f0a77c4",
    name: "Test Nudge",
    rarity: "common",
    oracleText: "Test Nudge deals 1 damage to up to one target creature.",
    manaCost: {},
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 0, max: 1 } },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};

/** "Deals 1 damage to each of up to three target creatures" — the
 *  variable-count announcement CR 601.2c binds on its FIRST pick. */
const SPRAY: CardDefinition = {
    id: "0cf0c0b8-1a43-4f0f-9e6b-5d3e6a0f9a11",
    name: "Test Spray",
    rarity: "common",
    oracleText:
        "Test Spray deals 1 damage to each of up to three target creatures.",
    manaCost: {},
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1, max: 3 } },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};

type CastMove = Extract<Move, { kind: "cast-spell" }>;
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };
type AnyHandler = Handler<Record<string, unknown>, void>;

/** p1 holds the spell; p2 fields the Flagbearer beside two better targets. */
function board(spellId: string = SPRAY.id): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(spellId, {
                        id: "spray",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(mountain.id, {
                        id: "mountain-1",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    // Board order puts a NON-satisfier first, deliberately:
                    // `combinations` walks the legal targets in board order, so
                    // the tuples the enumerator builds first are the ones that
                    // open with a Grizzly Bears.
                    makeInstance(grizzlyBears.id, {
                        id: "bears-1",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "bears-2",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                    makeInstance(standardBearer.id, {
                        id: "bearer",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "battlefield",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function castMoves(state: GameState): CastMove[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === "spray"
    );
}

/** Replays one enumerated tuple through the REAL mutations, in the executor's
 *  own order, and returns the rejection message if the server refused it. */
async function replay(
    state: GameState,
    move: CastMove
): Promise<string | undefined> {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation(announceCast as unknown as AnyHandler, harness.ctx, {
        ...BASE,
        cardInstanceId: move.cardInstanceId,
    });
    try {
        if (move.targets.length > 0) {
            await runMutation(
                selectTargets as unknown as AnyHandler,
                harness.ctx,
                {
                    ...BASE,
                    targets: move.targets.map((t) => ({
                        targetType: t.type,
                        targetId: t.id,
                    })),
                }
            );
        }
        if (move.confirmTargets) {
            await runMutation(
                confirmTargets as unknown as AnyHandler,
                harness.ctx,
                { ...BASE }
            );
        }
    } catch (e) {
        return (e as Error).message;
    }
    return harness.state().pendingTarget === undefined
        ? undefined
        : "announcement left open";
}

describe("bot enumeration under a forced target choice (CR 601.2c, issue #3805)", () => {
    it("offers only tuples whose FIRST pick obeys the requirement", () => {
        withTemporaryDefinition(SPRAY, () => {
            const moves = castMoves(board());
            expect(moves.length).toBeGreaterThan(0);
            for (const m of moves) {
                // "Up to three" may stop at one, so the first pick is the last
                // one the chooser is obliged to make — it must be the
                // Flagbearer.
                expect(m.targets[0]?.id).toBe("bearer");
            }
        });
    });

    it("every offered tuple is one the real announcement ACCEPTS", async () => {
        await withTemporaryDefinitionAsync(SPRAY, async () => {
            const moves = castMoves(board());
            expect(moves.length).toBeGreaterThan(0);
            for (const move of moves) {
                // A fresh harness per tuple: each replay is its own
                // announcement, through the same two mutations the executor
                // drives (`announceCast` then ONE batched `selectTargets`).
                const harness = makeMutationCtx("p1", [gameStateSeed(board())]);
                await runMutation(
                    announceCast as unknown as AnyHandler,
                    harness.ctx,
                    { ...BASE, cardInstanceId: "spray" }
                );
                await runMutation(
                    selectTargets as unknown as AnyHandler,
                    harness.ctx,
                    {
                        ...BASE,
                        targets: move.targets.map((t) => ({
                            targetType: t.type,
                            targetId: t.id,
                        })),
                    }
                );
                if (move.confirmTargets) {
                    // The executor's own trailing call for a variable-count
                    // announcement that did not auto-finalize (CR 601.2c).
                    await runMutation(
                        confirmTargets as unknown as AnyHandler,
                        harness.ctx,
                        { ...BASE }
                    );
                }
                // Accepted end to end: the selection closed rather than
                // throwing on one of its picks.
                expect(harness.state().pendingTarget).toBeUndefined();
            }
        });
    });

    it("leaves the enumeration untouched when no Flagbearer is out", () => {
        withTemporaryDefinition(SPRAY, () => {
            const state = board();
            state.players[1]!.battlefield =
                state.players[1]!.battlefield.filter((c) => c.id !== "bearer");
            const moves = castMoves(state);
            // Both Bears, alone and together — nothing narrowed.
            expect(moves.some((m) => m.targets[0]?.id === "bears-1")).toBe(
                true
            );
            expect(moves.some((m) => m.targets[0]?.id === "bears-2")).toBe(
                true
            );
        });
    });
});

describe('the "up to one" group (CR 601.2c, `min: 0`) — the freeze shape', () => {
    it("narrows the only pick, and every offered tuple is ACCEPTED", async () => {
        await withTemporaryDefinitionAsync(NUDGE, async () => {
            const state = board(NUDGE.id);
            const moves = castMoves(state);
            expect(moves.length).toBeGreaterThan(0);
            for (const move of moves) {
                // Either the declined announcement (CR 601.2c announces the
                // NUMBER first) or the Flagbearer — never a Grizzly Bears.
                expect(
                    move.targets.length === 0 ||
                        move.targets[0]?.id === "bearer"
                ).toBe(true);
                expect(await replay(state, move)).toBeUndefined();
            }
        });
    });
});
