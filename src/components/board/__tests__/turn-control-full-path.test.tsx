// Turn Control, the whole path (CR 723, ADR 0181, issue #8446):
//
//   GRE     — a `controlNextTurn` spell resolves through the real interpreter
//             and the real turn boundary activates it;
//   game.ts — every step is a REGISTERED mutation on the shared stub ctx, the
//             tick mirror and `getPublicState` included;
//   UI      — the two boards derive their seat, their lock and their notice
//             from the projection each user is actually served.
//
// Three pieces that each pass alone and disagree together is the bug class:
// a control the tick does not mirror leaves the controller unauthorised, a
// viewer the board picks differently from the server opens the wrong hand.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CardDefinition } from "@convex/cards/types";
import { withTemporaryDefinitionAsync } from "@convex/cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Row,
} from "@convex/__tests__/gameMutationHarness.fixture";
import { getPublicState, passPriority } from "@convex/game";
import type { PublicGameState } from "@convex/gameProjections";
import { computePriorityState } from "~/lib/priority";
import {
    boardViewerSeat,
    isSeatLocked,
    lockedSeatView,
    turnControlNotice,
} from "~/lib/turn-control";
import { withBoardContext } from "~/lib/testing/board-context";
import type { Player } from "~/types/game";
import TurnControlNotice from "../turn-control-notice";

afterEach(cleanup);

const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** "You control target player during that player's next turn." */
const CONTROL_SPELL: CardDefinition = {
    id: "test-turn-control-full-path",
    name: "Test Turn Control",
    rarity: "common",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "controlNextTurn", player: { target: 0 } }],
} as CardDefinition;

type Ctx = Parameters<typeof runMutation>[1];
const pass = (ctx: Ctx, playerId: string) =>
    runMutation(passPriority, ctx, { gameId: "game-1", playerId });
const view = (ctx: Ctx, playerId: string) =>
    runMutation<Row, PublicGameState>(getPublicState, ctx, {
        gameId: "game-1",
        playerId,
    });

/** The priority reads `board.tsx` hands the context, off the projection. */
const priorityCtx = (state: PublicGameState) => ({
    activePlayerId: state.activePlayerId,
    priorityPlayerId: state.priorityPlayerId ?? state.activePlayerId,
    phase: state.phase,
    combat: state.combat,
    pendingChoices: state.pendingChoices,
    pendingTarget: state.pendingTarget,
    pendingCast: state.pendingCast,
    pendingActivation: state.pendingActivation,
});

describe("Turn Control — GRE → game.ts → UI (CR 723)", () => {
    it("a resolved control spell hands the opponent's next turn to its caster, on both boards", async () => {
        await withTemporaryDefinitionAsync(CONTROL_SPELL, async () => {
            const hand = (owner: string, id: string) =>
                makeInstance(MOUNTAIN, {
                    controllerId: owner,
                    ownerId: owner,
                    zone: "hand",
                    id,
                });
            const library = (owner: string) =>
                Array.from({ length: 5 }, (_, i) =>
                    makeInstance(MOUNTAIN, {
                        controllerId: owner,
                        ownerId: owner,
                        zone: "library",
                        id: `${owner}-lib-${i}`,
                    })
                );
            const state = makeState({
                players: [
                    makePlayer("alice", {
                        hand: [hand("alice", "alice-card")],
                        library: library("alice"),
                    }),
                    makePlayer("bob", {
                        hand: [hand("bob", "bob-card")],
                        library: library("bob"),
                    }),
                ],
                activePlayerId: "alice",
                priorityPlayerId: "alice",
                phase: "END_STEP",
                turn: 3,
            });
            // Alice's spell is on the stack, aimed at bob.
            pushSpell(state, CONTROL_SPELL.id, "alice", [
                { type: "player", id: "bob" },
            ]);
            const stub = makeMutationCtx("alice", [
                {
                    _id: "game-1",
                    __table: "games",
                    name: "Game",
                    status: "playing",
                    players: [{ id: "alice" }, { id: "bob" }],
                    createdAt: 0,
                    updatedAt: 0,
                },
                gameStateSeed(state),
            ]);
            const alice = stub.ctx;
            const bob = stub.asUser("bob");

            // ── GRE through game.ts: both pass, the spell resolves ──────────
            await pass(alice, "alice");
            await pass(bob, "bob");
            expect(stub.state().turnControls).toEqual([
                { controlledId: "bob", controllerId: "alice" },
            ]);
            // Pending: nothing changes hands during alice's own turn.
            await expect(pass(alice, "bob")).rejects.toThrow(
                /cannot act as another player/
            );

            // ── The turn ends; bob's next turn begins CONTROLLED ───────────
            // Each window is passed by whoever the tick says must answer, AS
            // the seat the rules name — until the controlled turn has started
            // and it is the controlled seat that owes input.
            for (let i = 0; i < 12; i++) {
                const s = stub.state();
                if (s.activePlayerId === "bob" && s.priorityPlayerId === "bob")
                    break;
                const owed = s.priorityPlayerId;
                await pass(owed === "alice" ? alice : bob, owed);
            }
            const live = stub.state();
            expect(live.activePlayerId).toBe("bob");
            expect(live.turnControls).toEqual([
                { controlledId: "bob", controllerId: "alice", active: true },
            ]);

            // ── game.ts: the controlled user is refused, the controller acts ─
            await expect(pass(bob, "bob")).rejects.toThrow(
                /controls you this turn/
            );

            // ── UI, the CONTROLLER's board ─────────────────────────────────
            const aliceState = await view(alice, "alice");
            const aliceViewer = boardViewerSeat(aliceState, "alice", false);
            expect(aliceViewer).toBe("bob");
            expect(isSeatLocked(aliceState, "alice")).toBe(false);
            // Both hands are on the wire for her (CR 723.4), bob's playable.
            const seat = (s: PublicGameState, id: string) =>
                s.players.find((p) => p.id === id)!;
            expect(seat(aliceState, "bob").hand.map((c) => c?.id)).toContain(
                "bob-card"
            );
            expect(seat(aliceState, "alice").hand[0]?.id).toBe("alice-card");
            expect(
                computePriorityState({
                    ...priorityCtx(aliceState),
                    playerId: aliceViewer,
                })
            ).toBe("mine");
            render(
                withBoardContext(
                    <TurnControlNotice
                        notice={turnControlNotice(aliceState, "alice")}
                    />,
                    {
                        ctx: {
                            allPlayers:
                                aliceState.players as unknown as Player[],
                        },
                    }
                )
            );
            expect(screen.getByTestId("turn-control-notice").textContent).toBe(
                "You control bob this turn"
            );
            cleanup();

            // ── UI, the CONTROLLED player's board ──────────────────────────
            const bobRaw = await view(bob, "bob");
            expect(isSeatLocked(bobRaw, "bob")).toBe(true);
            const bobState = lockedSeatView(bobRaw, "bob");
            expect(boardViewerSeat(bobState, "bob", false)).toBe("bob");
            expect(seat(bobState, "alice").hand).toEqual([null]);
            expect(
                seat(bobState, "bob").hand.every(
                    (c) => (c?.legalActions ?? []).length === 0
                )
            ).toBe(true);
            expect(
                computePriorityState({
                    ...priorityCtx(bobState),
                    playerId: "bob",
                    actingLocked: true,
                })
            ).toBe("opponent");
            render(
                withBoardContext(
                    <TurnControlNotice
                        notice={turnControlNotice(bobRaw, "bob")}
                    />,
                    {
                        ctx: {
                            allPlayers: bobRaw.players as unknown as Player[],
                        },
                    }
                )
            );
            expect(screen.getByTestId("turn-control-notice").textContent).toBe(
                "alice controls you this turn"
            );

            // ── …and the controller's click lands: bob's seat passes ────────
            const before = stub.doc("gs-1").seq as number;
            await pass(alice, "bob");
            expect(stub.doc("gs-1").seq).toBe(before + 1);
        });
    });
});
