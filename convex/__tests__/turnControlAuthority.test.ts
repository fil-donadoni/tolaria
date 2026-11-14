// Seat authority under Turn Control (CR 723, ADR 0181) — through the REAL
// mutations, on the shared stub ctx.
//
// The rule under test is one line (`seatAuthorityRefusal`): a caller may
// submit as seat S iff they own S's Acting Player. What makes it worth an
// integration test is where it reads from: `gameTicks.turnControls`, the
// mirror `saveGameState` writes — a control that is not mirrored, or a mirror
// that is not cleared, is an authority bug no pure test of the rule can see.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { FACE_DOWN_CARD_ID } from "../cards";
import { concede, getPublicState, passPriority } from "../game";
import { projectPublicState } from "../gameProjections";
import type { GameState } from "../gre/state";
import { seatAuthorityRefusal } from "../seatAuthority";
import type { PublicGameState } from "../gameProjections";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";

// LEA Mountain — any real definition works; it only has to sit in a hand.
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const handCard = (owner: string, id: string) =>
    makeInstance(MOUNTAIN, {
        controllerId: owner,
        ownerId: owner,
        zone: "hand",
        id,
    });

/** A 2-player game between two DIFFERENT users, in bob's turn, which alice
 *  controls (CR 723.1) — saved, so the tick row carries the mirror. */
function controlledTurn(phase: GameState["phase"] = "PRECOMBAT_MAIN") {
    const state = makeState({
        players: [
            makePlayer("alice", {
                hand: [handCard("alice", "alice-card")],
                outsideGame: [handCard("alice", "alice-side")],
            }),
            makePlayer("bob", {
                hand: [handCard("bob", "bob-card")],
                outsideGame: [handCard("bob", "bob-side")],
                // A face-down permanent (CR 708) and a library card only bob
                // has looked at.
                battlefield: [
                    makeInstance(MOUNTAIN, {
                        controllerId: "bob",
                        ownerId: "bob",
                        id: "bob-facedown",
                        faceDown: true,
                        faceDownOf: MOUNTAIN,
                        card: { id: FACE_DOWN_CARD_ID },
                    }),
                ],
                library: [
                    makeInstance(MOUNTAIN, {
                        controllerId: "bob",
                        ownerId: "bob",
                        zone: "library",
                        id: "bob-top",
                        knownTo: ["bob"],
                    }),
                ],
            }),
        ],
        activePlayerId: "bob",
        priorityPlayerId: "bob",
        phase,
        turn: 4,
        turnControls: [
            { controlledId: "bob", controllerId: "alice", active: true },
        ],
    });
    const seeds: Row[] = [
        { _id: "alice", __table: "users", nickname: "Alice" },
        { _id: "bob", __table: "users", nickname: "Bob" },
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
        {
            _id: "tick-1",
            __table: "gameTicks",
            gameId: "game-1",
            seq: 1,
            phase,
            priorityPlayerId: "bob",
            owedPlayerIds: ["alice"],
            turnControls: state.turnControls,
            updatedAt: 0,
        },
    ];
    return makeMutationCtx("alice", seeds);
}

const pass = (ctx: Parameters<typeof runMutation>[1], playerId: string) =>
    runMutation(passPriority, ctx, { gameId: "game-1", playerId });

describe("seatAuthorityRefusal — one rule (ADR 0181)", () => {
    const active = {
        turnControls: [
            {
                controlledId: "bob",
                controllerId: "alice",
                active: true as const,
            },
        ],
    };
    it("with no Turn Control it is plain seat ownership", () => {
        expect(seatAuthorityRefusal({}, "alice", "alice")).toBeNull();
        expect(seatAuthorityRefusal({}, "bob", "alice")).toBe("not-your-seat");
    });
    it("the controller may name the controlled seat and keeps their own (CR 723.5, 723.8)", () => {
        expect(seatAuthorityRefusal(active, "bob", "alice")).toBeNull();
        expect(seatAuthorityRefusal(active, "alice", "alice")).toBeNull();
    });
    it("the controlled player may not name their own seat (CR 723.5)", () => {
        expect(seatAuthorityRefusal(active, "bob", "bob")).toBe(
            "controlled-by-another-player"
        );
        expect(seatAuthorityRefusal(active, "alice", "bob")).toBe(
            "not-your-seat"
        );
    });
    it("a third user gains nothing", () => {
        expect(seatAuthorityRefusal(active, "bob", "carol")).toBe(
            "not-your-seat"
        );
    });
    it("a PENDING control changes nothing yet (CR 723.1)", () => {
        const pending = {
            turnControls: [{ controlledId: "bob", controllerId: "alice" }],
        };
        expect(seatAuthorityRefusal(pending, "bob", "bob")).toBeNull();
        expect(seatAuthorityRefusal(pending, "bob", "alice")).toBe(
            "not-your-seat"
        );
    });
    it("Solo Mode is untouched: one user owns both seats", () => {
        const solo = {
            turnControls: [
                {
                    controlledId: "u-p2",
                    controllerId: "u-p1",
                    active: true as const,
                },
            ],
        };
        expect(seatAuthorityRefusal(solo, "u-p2", "u")).toBeNull();
        expect(seatAuthorityRefusal(solo, "u-p1", "u")).toBeNull();
    });
});

describe("gameplay mutations under Turn Control (CR 723.5)", () => {
    it("refuses the controlled player their own seat", async () => {
        const stub = controlledTurn();
        await expect(pass(stub.asUser("bob"), "bob")).rejects.toThrow(
            /controls you this turn/
        );
        expect(stub.doc("gs-1").seq).toBe(1);
    });

    it("lets the controller act AS the controlled seat, and the rules still see that seat pass", async () => {
        const stub = controlledTurn();
        await pass(stub.ctx, "bob");
        expect(stub.doc("gs-1").seq).toBe(2);
        const state = stub.state();
        // CR 723.3 — bob is still the active player; it was BOB who passed.
        expect(state.activePlayerId).toBe("bob");
        expect(state.priorityPlayerId).toBe("alice");
        // The tick names who must ANSWER and keeps mirroring the control.
        expect(stub.doc("tick-1").owedPlayerIds).toEqual(["alice"]);
        expect(stub.doc("tick-1").turnControls).toEqual([
            { controlledId: "bob", controllerId: "alice", active: true },
        ]);
    });

    it("a stranger still cannot name either seat", async () => {
        const stub = controlledTurn();
        await expect(pass(stub.asUser("carol"), "bob")).rejects.toThrow(
            /cannot act as another player/
        );
    });

    it("when the controlled turn ends the mirror is cleared and the seat is its owner's again (CR 723.1)", async () => {
        const stub = controlledTurn("END_STEP");
        await pass(stub.ctx, "bob"); // alice, as bob
        await pass(stub.ctx, "alice"); // alice, as herself: the turn ends
        const state = stub.state();
        expect(state.activePlayerId).toBe("alice");
        expect(state.turnControls).toBeUndefined();
        expect(stub.doc("tick-1").turnControls).toBeUndefined();
        // Bob answers for bob again; alice no longer may.
        await expect(pass(stub.ctx, "bob")).rejects.toThrow(
            /cannot act as another player/
        );
    });
});

describe("conceding under Turn Control (CR 723.6)", () => {
    const runConcede = (
        ctx: Parameters<typeof runMutation>[1],
        playerId: string
    ) => runMutation(concede, ctx, { gameId: "game-1", playerId });

    it("the controller cannot make the controlled player concede", async () => {
        const stub = controlledTurn();
        await expect(runConcede(stub.ctx, "bob")).rejects.toThrow(
            /cannot act as another player/
        );
        expect(stub.state().gameOver).toBeUndefined();
    });

    it("the controlled player may still concede", async () => {
        const stub = controlledTurn();
        await runConcede(stub.asUser("bob"), "bob");
        expect(stub.state().gameOver).toMatchObject({
            loserId: "bob",
            reason: "concede",
        });
    });
});

describe("getPublicState under Turn Control (CR 723.4)", () => {
    const view = (ctx: Parameters<typeof runMutation>[1], playerId: string) =>
        runMutation<Row, PublicGameState>(getPublicState, ctx, {
            gameId: "game-1",
            playerId,
        });
    const handIds = (state: PublicGameState, seat: string) =>
        state.players
            .find((p) => p.id === seat)!
            .hand.map((c) => c?.id ?? null);

    it("the controller views the controlled seat while it owes input, and sees both hands", async () => {
        const stub = controlledTurn();
        const projected = await view(stub.ctx, "alice");
        expect(handIds(projected, "bob")).toEqual(["bob-card"]);
        expect(handIds(projected, "alice")).toEqual(["alice-card"]);
        // Viewed AS bob: bob's hand carries the legal actions, alice's none.
        const bobCard = projected.players.find((p) => p.id === "bob")!.hand[0]!;
        expect(bobCard.legalActions).toContain("play");
    });

    it("the controlled player sees their own hand and nothing of the controller's", async () => {
        const stub = controlledTurn();
        const projected = await view(stub.asUser("bob"), "bob");
        expect(handIds(projected, "bob")).toEqual(["bob-card"]);
        expect(handIds(projected, "alice")).toEqual([null]);
    });

    it("cards OUTSIDE the game stay each player's own, whichever seat the controller views", async () => {
        const stub = controlledTurn();
        const seat = (s: PublicGameState, id: string) =>
            s.players.find((p) => p.id === id)!;
        // Alice asks; the projection is made AS bob (he owes input).
        const forAlice = await view(stub.ctx, "alice");
        expect(seat(forAlice, "bob").outsideGame).toBeUndefined();
        expect(seat(forAlice, "alice").outsideGame?.map((c) => c.id)).toEqual([
            "alice-side",
        ]);
        const forBob = await view(stub.asUser("bob"), "bob");
        expect(seat(forBob, "bob").outsideGame?.map((c) => c.id)).toEqual([
            "bob-side",
        ]);
        expect(seat(forBob, "alice").outsideGame).toBeUndefined();
    });

    it("on her OWN window in the controlled turn the controller still reads the controlled player's hidden game information", async () => {
        const stub = controlledTurn();
        await pass(stub.ctx, "bob"); // priority is now alice's own
        const forAlice = await view(stub.ctx, "alice");
        const bob = forAlice.players.find((p) => p.id === "bob")!;
        // Viewed as HERSELF: bob's hand, his face-down permanent's identity
        // and the library card he knows all still reach her.
        expect(handIds(forAlice, "bob")).toEqual(["bob-card"]);
        expect(
            bob.battlefield.find((c) => c.id === "bob-facedown")?.knownCardId
        ).toBe(MOUNTAIN);
        expect(bob.library.known.map((k) => k.card.id)).toEqual(["bob-top"]);
        // …and none of it reaches her once the control is gone.
        const state = stub.state();
        state.turnControls = undefined;
        const free = projectPublicState(state, 9, "alice");
        const freeBob = free.players.find((p) => p.id === "bob")!;
        expect(freeBob.hand).toEqual([null]);
        expect(
            freeBob.battlefield.find((c) => c.id === "bob-facedown")
                ?.knownCardId
        ).toBeUndefined();
        expect(freeBob.library.known).toEqual([]);
    });
});
