// Integration tests for the battlefield-wide declared-attacker / declared-
// blocker COUNT CAP (CR 508.1a / 509.1a — Dueling Grounds, Caverns of Despair;
// issue #1127), driven through the REGISTERED `game.ts` mutations.
//
// The GRE unit tests (`convex/cards/sets/inv/__tests__/multicolor.test.ts`)
// prove the scanner and the confirm-time whole-set validators. They cannot
// prove the mutation path, and the mutation path is where the cap has two
// distinct enforcement sites that must agree:
//
//   1. `toggleAttacker` / `assignBlockerTarget` refuse the INCREMENTAL
//      selection that would exceed the cap.
//   2. `confirmAttackers` auto-includes creatures that MUST attack
//      (CR 508.1d, Juggernaut). A requirement never overrides a restriction,
//      so that auto-include has to stop at the cap — otherwise it manufactures
//      an over-cap declaration that its own confirm-time check then rejects,
//      and the player can never leave the declare-attackers step.
//
// Same harness discipline as `selectTargetsBatch.test.ts`: this project has no
// convex-test harness, so the seam is a stub `MutationCtx` driving the
// registered mutation's own `_handler` (`gameMutationHarness.ts`) — never a
// reimplementation of the mutation body, which could not catch (2) at all.

import { describe, it, expect } from "vitest";
import {
    toggleAttacker,
    confirmAttackers,
    assignBlockerTarget,
    confirmBlockers,
} from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { duelingGrounds } from "../cards/sets/inv/multicolor";
import { grizzlyBears } from "../cards/sets/lea/green";
import { twoHeadedGiantOfForiys } from "../cards/sets/lea/red";
import { juggernaut } from "../cards/sets/lea/colorless";
import { lure } from "../cards/sets/lea/green";
import type { GameState, CardInstanceState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

const runToggleAttacker = (
    ctx: Parameters<typeof runMutation>[1],
    cardInstanceId: string
) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; cardInstanceId: string },
        void
    >(
        toggleAttacker as unknown as Handler<
            { gameId: Id<"games">; playerId: string; cardInstanceId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

const runConfirmAttackers = (ctx: Parameters<typeof runMutation>[1]) =>
    runMutation<{ gameId: Id<"games">; playerId: string }, void>(
        confirmAttackers as unknown as Handler<
            { gameId: Id<"games">; playerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

const runAssignBlockerTarget = (
    ctx: Parameters<typeof runMutation>[1],
    attackerId: string
) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; attackerId: string },
        void
    >(
        assignBlockerTarget as unknown as Handler<
            { gameId: Id<"games">; playerId: string; attackerId: string },
            void
        >,
        ctx,
        { gameId: GAME_ID, playerId: "p2", attackerId }
    );

function creature(
    defId: string,
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** p1 (active, holding priority) in DECLARE_ATTACKERS with `p1Battlefield`;
 *  p2 holds a Dueling Grounds unless `withGrounds` is false. */
function declareAttackersState(
    p1Battlefield: CardInstanceState[],
    withGrounds = true
): GameState {
    const p2Battlefield = withGrounds
        ? [makeInstance(duelingGrounds.id, { id: "dg", controllerId: "p2" })]
        : [];
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Battlefield }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("declared-attacker cap through the real mutations (CR 508.1a, issue #1127)", () => {
    it("toggleAttacker declares the first creature and refuses the second with the Oracle sentence", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState([
                    creature(grizzlyBears.id, "a", "p1"),
                    creature(grizzlyBears.id, "b", "p1"),
                ])
            ),
        ]);

        await runToggleAttacker(h.ctx, "a");
        expect(h.state().combat!.attackerIds).toEqual(["a"]);

        await expect(runToggleAttacker(h.ctx, "b")).rejects.toThrow(
            "No more than one creature can attack each combat."
        );
        expect(h.state().combat!.attackerIds).toEqual(["a"]);
    });

    it("without the cap in play the same second declaration is accepted (the cap is what refuses it)", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState(
                    [
                        creature(grizzlyBears.id, "a", "p1"),
                        creature(grizzlyBears.id, "b", "p1"),
                    ],
                    false
                )
            ),
        ]);

        await runToggleAttacker(h.ctx, "a");
        await runToggleAttacker(h.ctx, "b");
        expect(h.state().combat!.attackerIds).toEqual(["a", "b"]);
    });

    it("confirmAttackers auto-includes must-attack creatures only up to the cap (CR 508.1d — a requirement never breaks a restriction)", async () => {
        // Two Juggernauts ("attacks each combat if able", CR 508.1d) and a cap
        // of one. Pre-fix the confirm auto-include pushed BOTH into the
        // declaration and its own confirm-time cap check then rejected it —
        // an unresolvable declare-attackers step.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState([
                    creature(juggernaut.id, "j1", "p1"),
                    creature(juggernaut.id, "j2", "p1"),
                ])
            ),
        ]);

        await runConfirmAttackers(h.ctx);

        const combat = h.state().combat!;
        expect(combat.confirmed).toBe(true);
        expect(combat.attackerIds).toHaveLength(1);
        expect(combat.attackerIds[0]).toBe("j1");
    });

    it("a voluntary attacker never crowds a must-attack creature out of the last slot (CR 508.1d)", async () => {
        // CR 508.1d — the declaration must obey the MAXIMUM number of
        // requirements the restrictions leave room for. With one slot and one
        // Juggernaut ("attacks each combat if able"), the ONLY legal
        // declaration is the Juggernaut: a voluntary Grizzly Bears in that slot
        // obeys zero requirements where one was possible. The fold drops it.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState([
                    creature(juggernaut.id, "j1", "p1"),
                    creature(grizzlyBears.id, "bear", "p1"),
                ])
            ),
        ]);

        await runToggleAttacker(h.ctx, "bear");
        expect(h.state().combat!.attackerIds).toEqual(["bear"]);

        await runConfirmAttackers(h.ctx);
        expect(h.state().combat!.attackerIds).toEqual(["j1"]);
        const bear = h
            .state()
            .players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.isAttacking).toBeFalsy();
    });

    it("with cap room for both, the voluntary pick is KEPT alongside the requirement (the fold drops only what the cap forces)", async () => {
        // Same board with no cap in play: nothing is crowded out, so the
        // dropping above is provably the cap's doing and not a blanket
        // "requirements replace selections" rule.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState(
                    [
                        creature(juggernaut.id, "j1", "p1"),
                        creature(grizzlyBears.id, "bear", "p1"),
                    ],
                    false
                )
            ),
        ]);

        await runToggleAttacker(h.ctx, "bear");
        await runConfirmAttackers(h.ctx);
        expect([...h.state().combat!.attackerIds].sort()).toEqual([
            "bear",
            "j1",
        ]);
    });

    it("the player's choice of WHICH requirement to obey survives the fold", async () => {
        // Two Juggernauts, cap of one: the player picked j2, so j2 is the one
        // that attacks — the engine only picks when the player expressed
        // nothing (the previous test's j1-by-battlefield-order case).
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                declareAttackersState([
                    creature(juggernaut.id, "j1", "p1"),
                    creature(juggernaut.id, "j2", "p1"),
                ])
            ),
        ]);

        await runToggleAttacker(h.ctx, "j2");
        await runConfirmAttackers(h.ctx);
        expect(h.state().combat!.attackerIds).toEqual(["j2"]);
    });
});

describe("declared-blocker cap through the real mutations (CR 509.1a, issue #1127)", () => {
    /** p1 attacking with two creatures; p2 (the defender) declaring blockers
     *  with `pendingBlockerId` already selected. */
    function declareBlockersState(pendingBlockerId: string): GameState {
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", {
                    battlefield: [
                        creature(grizzlyBears.id, "a", "p1"),
                        creature(grizzlyBears.id, "b", "p1"),
                        makeInstance(duelingGrounds.id, {
                            id: "dg",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        // Two-Headed Giant of Foriys can block an ADDITIONAL
                        // creature (CR 509.1b), so the second assignment below
                        // is refused by the cap alone and by nothing else.
                        creature(twoHeadedGiantOfForiys.id, "x", "p2"),
                        creature(grizzlyBears.id, "y", "p2"),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["a", "b"],
                confirmed: true,
                blockerAssignments: { x: ["a"] },
                blockersConfirmed: false,
                pendingBlockerId,
            },
        });
    }

    it("refuses a SECOND distinct blocker with the Oracle sentence", async () => {
        const h = makeMutationCtx("p2", [
            gameStateSeed(declareBlockersState("y")),
        ]);
        await expect(runAssignBlockerTarget(h.ctx, "b")).rejects.toThrow(
            "No more than one creature can block each combat."
        );
        expect(h.state().combat!.blockerAssignments).toEqual({ x: ["a"] });
    });

    it("still lets the ALREADY-blocking creature take a second attacker (the cap counts creatures, not assignments)", async () => {
        const h = makeMutationCtx("p2", [
            gameStateSeed(declareBlockersState("x")),
        ]);
        await runAssignBlockerTarget(h.ctx, "b");
        expect(h.state().combat!.blockerAssignments.x).toEqual(["a", "b"]);
    });
});

describe("must-block requirements under the declared-blocker cap (CR 509.1a/509.1c, issue #1127)", () => {
    /** p1 attacking with a Lure-enchanted creature; p2 has two untapped
     *  creatures, both "able to block" it and therefore both REQUIRED to. */
    function lureState(withCap: boolean): GameState {
        const attacker = creature(grizzlyBears.id, "a", "p1");
        const aura = makeInstance(lure.id, {
            id: "lure",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "a";
        const p1Battlefield: CardInstanceState[] = [attacker, aura];
        if (withCap) {
            p1Battlefield.push(
                makeInstance(duelingGrounds.id, {
                    id: "dg",
                    controllerId: "p1",
                })
            );
        }
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", {
                    battlefield: [
                        creature(grizzlyBears.id, "x", "p2"),
                        creature(grizzlyBears.id, "y", "p2"),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["a"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }

    const runConfirmBlockers = (ctx: Parameters<typeof runMutation>[1]) =>
        runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            confirmBlockers as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            ctx,
            { gameId: GAME_ID, playerId: "p2" }
        );

    it("auto-assigns Lure blockers only up to the cap instead of manufacturing an unconfirmable declaration", async () => {
        const h = makeMutationCtx("p2", [gameStateSeed(lureState(true))]);
        await runConfirmBlockers(h.ctx);
        const assignments = h.state().combat!.blockerAssignments;
        const blocking = Object.entries(assignments).filter(
            ([, ids]) => (ids?.length ?? 0) > 0
        );
        expect(blocking).toHaveLength(1);
    });

    it("without the cap Lure pulls BOTH creatures into the block (the cap is what stops the second)", async () => {
        const h = makeMutationCtx("p2", [gameStateSeed(lureState(false))]);
        await runConfirmBlockers(h.ctx);
        const assignments = h.state().combat!.blockerAssignments;
        const blocking = Object.entries(assignments).filter(
            ([, ids]) => (ids?.length ?? 0) > 0
        );
        expect(blocking).toHaveLength(2);
    });
});

describe("must-block requirements never yield to a VOLUNTARY block (CR 509.1a/509.1c, issue #1127)", () => {
    /** p1 attacks with a Lure-enchanted `a` plus a plain `a2`; the defender's
     *  creatures are `x` (of type `defenderDefId`) and `y`. A Dueling Grounds
     *  caps distinct blockers at one unless `withCap` is false. */
    function lureBoard(
        assignments: Record<string, string[]>,
        withCap: boolean,
        defenderDefId: string = grizzlyBears.id
    ): GameState {
        const aura = makeInstance(lure.id, {
            id: "lure",
            controllerId: "p1",
            ownerId: "p1",
        });
        aura.attachedTo = "a";
        const p1Battlefield: CardInstanceState[] = [
            creature(grizzlyBears.id, "a", "p1"),
            creature(grizzlyBears.id, "a2", "p1"),
            aura,
        ];
        if (withCap) {
            p1Battlefield.push(
                makeInstance(duelingGrounds.id, {
                    id: "dg",
                    controllerId: "p1",
                })
            );
        }
        return makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", {
                    battlefield: [
                        creature(defenderDefId, "x", "p2"),
                        creature(grizzlyBears.id, "y", "p2"),
                    ],
                }),
            ],
            combat: {
                attackerIds: ["a", "a2"],
                confirmed: true,
                blockerAssignments: assignments,
                blockersConfirmed: false,
            },
        });
    }

    const confirm = (ctx: Parameters<typeof runMutation>[1]) =>
        runMutation<{ gameId: Id<"games">; playerId: string }, void>(
            confirmBlockers as unknown as Handler<
                { gameId: Id<"games">; playerId: string },
                void
            >,
            ctx,
            { gameId: GAME_ID, playerId: "p2" }
        );

    const blocking = (state: GameState) =>
        Object.entries(state.combat!.blockerAssignments)
            .filter(([, ids]) => (ids?.length ?? 0) > 0)
            .map(([id, ids]) => [id, ids] as const);

    it("drops a voluntary block to make room for a required one when the cap is full (CR 509.1c)", async () => {
        // `y` blocks the NON-Lure attacker a2 — a voluntary block occupying the
        // only slot. `x` is required to block the Lure'd `a`. Obeying zero
        // requirements when one was possible is illegal, so the voluntary block
        // yields.
        const h = makeMutationCtx("p2", [
            gameStateSeed(lureBoard({ y: ["a2"] }, true)),
        ]);
        await confirm(h.ctx);
        expect(blocking(h.state())).toEqual([["x", ["a"]]]);
    });

    it("without the cap the voluntary block SURVIVES alongside the required ones (the cap is what forces the trade)", async () => {
        const h = makeMutationCtx("p2", [
            gameStateSeed(lureBoard({ y: ["a2"] }, false)),
        ]);
        await confirm(h.ctx);
        const ids = blocking(h.state()).map(([id]) => id);
        expect(new Set(ids)).toEqual(new Set(["x", "y"]));
    });

    it("an ALREADY-blocking creature still takes its required attacker with the cap full (the cap counts creatures, not assignments)", async () => {
        // `x` is a Two-Headed Giant of Foriys (can block an additional
        // creature) already blocking a2 — the single allowed blocker. It is
        // also required to block the Lure'd `a`, and doing so costs no new
        // slot, so the requirement must go through. Dropping the
        // "already blocking" exemption leaves `x` on a2 alone (0 requirements
        // obeyed) and the declaration unconfirmable.
        const h = makeMutationCtx("p2", [
            gameStateSeed(
                lureBoard({ x: ["a2"] }, true, twoHeadedGiantOfForiys.id)
            ),
        ]);
        await confirm(h.ctx);
        expect(blocking(h.state())).toEqual([["x", ["a2", "a"]]]);
    });
});
