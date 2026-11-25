// Exhaust (CR 702.177a): "Exhaust — [Cost]: [Effect]" means "[Cost]: [Effect].
// Activate only once." Read through the server's real entry points on a shipped
// compiled card with three exhaust abilities, one of them a mana ability that
// never uses the stack (CR 605.1a):
//
//  1. STACK — `activateAbilityOnState`; the gate is per ability and outlives the
//     turn.
//  2. MANA — the payment tap (`tapSourceIntoPayment`), the tap mutation
//     (`tapUntap`) and the option list, and every reversal of that tap.
//  3. OBJECT — a re-entry is a new object (CR 400.7), and the spent list
//     survives the wire.
//
// The grammar half is `convex/oracle/__tests__/exhaust.test.ts`, the Bot half
// `convex/gre/__tests__/exhaust.bot.test.ts`, the client half
// `src/lib/__tests__/exhaust.test.ts`.
import { describe, expect, it } from "vitest";
import {
    activateAbilityOnState,
    cancelCast,
    tapSourceIntoPayment,
    tapUntap,
    untapForPayment,
} from "../game";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getManaTapOptions, manaGateBattlefields } from "../gre/constants";
import { advancePhase } from "../gre/phases";
import { compactState, expandState } from "../gre/serialize";
import { applyCopy } from "../gre/copy";
import {
    resetBattlefieldTransientState,
    resolveTopOfStack,
    type GameState,
} from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const LOOT = getCardByName("Loot, the Pathfinder");
const [, DRAW, DAMAGE] = LOOT.activatedAbilities!.map((a) => a.id) as [
    string,
    string,
    string,
];
const GREEN = 4;
const GAME_ID = "game-1" as Id<"games">;

function board(): GameState {
    const state = makeState({
        turn: 5,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(LOOT.id, {
                        id: "loot",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: Array.from({ length: 8 }, (_, i) =>
                    makeInstance(getCardByName("Forest").id, {
                        id: `lib-${i}`,
                        zone: "library",
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    Object.assign(state.players[0]!.manaPool, { U: 3, R: 3, G: 3 });
    return state;
}

const loot = (state: GameState) =>
    state.players[0]!.battlefield.find((c) => c.id === "loot")!;

/** Ready Loot for another activation: untapped, its controller on priority. */
function again(state: GameState): GameState {
    loot(state).isTapped = false;
    state.priorityPlayerId = "p1";
    return state;
}

function activate(state: GameState, abilityId: string): GameState {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "loot",
        abilityId,
    });
    return state;
}

function draw(state: GameState): GameState {
    activate(state, DRAW);
    resolveTopOfStack(state);
    return again(state);
}

function payTap(state: GameState): GameState {
    tapSourceIntoPayment(state, state.players[0]!, loot(state), GREEN, []);
    return state;
}

const options = (state: GameState) =>
    getManaTapOptions(loot(state), "p1", manaGateBattlefields(state)).length;

describe("a stack exhaust ability is activated only once (CR 702.177a)", () => {
    it("draws three, then refuses a second activation", () => {
        const state = draw(board());
        expect(state.players[0]!.hand).toHaveLength(3);
        expect(() => activate(state, DRAW)).toThrow("Activate only once");
    });

    it("gates each ability on its own", () => {
        const state = draw(board());
        expect(options(state)).toBe(5);
        expect(() => activate(state, DAMAGE)).not.toThrow();
    });

    it("outlives the turn", () => {
        const state = draw(board());
        state.phase = "CLEANUP";
        advancePhase(state);
        again(state);
        state.activePlayerId = "p1";
        state.phase = "PRECOMBAT_MAIN";
        state.players[0]!.manaPool.U = 1;
        expect(loot(state).activationsThisTurn).toBeUndefined();
        expect(() => activate(state, DRAW)).toThrow("Activate only once");
    });

    it("survives a save and load", () => {
        const state = expandState(compactState(draw(board())));
        state.players[0]!.manaPool.U = 1;
        expect(() => activate(state, DRAW)).toThrow("Activate only once");
    });
});

describe("a new object starts fresh (CR 400.7 / 707.2)", () => {
    it("re-entering the battlefield", () => {
        const state = draw(board());
        resetBattlefieldTransientState(loot(state), state);
        loot(state).isSummoningSick = false;
        expect(() => activate(state, DRAW)).not.toThrow();
    });

    it("a copy of a permanent that spent its abilities", () => {
        const state = draw(board());
        const clone = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "clone",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0]!.battlefield.push(clone);
        applyCopy(state, clone, loot(state));
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "clone",
                abilityId: DRAW,
            })
        ).not.toThrow();
    });
});

describe("an exhaust mana ability is activated only once (CR 702.177a / 605.1a)", () => {
    it("the payment tap adds three once, then the source makes no mana", () => {
        const state = payTap(board());
        expect(state.players[0]!.manaPool.G).toBe(5);
        again(state);
        expect(options(state)).toBe(0);
        expect(() => payTap(state)).toThrow();
        expect(state.players[0]!.manaPool.G).toBe(5);
    });

    it("leaves the stack abilities alone", () => {
        expect(() => activate(again(payTap(board())), DRAW)).not.toThrow();
    });
});

type Args = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId?: string;
    manaChoiceIndex?: number;
};

async function run(
    state: GameState,
    mutation: unknown,
    args: Partial<Args>
): Promise<GameState> {
    const h = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation<Args, void>(
        mutation as unknown as Handler<Args, void>,
        h.ctx,
        { gameId: GAME_ID, playerId: "p1", ...args }
    );
    return h.state();
}

describe("an exhaust tap through the mutation, and its undo (CR 702.177a / 106.4)", () => {
    const tap = (state: GameState) =>
        run(state, tapUntap, {
            cardInstanceId: "loot",
            manaChoiceIndex: GREEN,
        });

    it("spends the ability", async () => {
        const state = await tap(board());
        expect(state.players[0]!.manaPool.G).toBe(5);
        await expect(tap(again(state))).rejects.toThrow();
    });

    it("untapping before the mana is spent gives it back", async () => {
        const undone = await run(await tap(board()), tapUntap, {
            cardInstanceId: "loot",
        });
        expect(loot(undone).isTapped).toBe(false);
        expect(undone.players[0]!.manaPool.G).toBe(3);
        expect(options(undone)).toBe(5);
    });

    function castPayment(): GameState {
        const state = payTap(board());
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { G: 9 },
            tappedLandIds: ["loot"],
        };
        return state;
    }

    it("untapping one payment source gives it back", async () => {
        const undone = await run(castPayment(), untapForPayment, {
            cardInstanceId: "loot",
        });
        expect(undone.players[0]!.manaPool.G).toBe(3);
        expect(options(undone)).toBe(5);
    });

    it("cancelling the cast gives it back", async () => {
        const undone = await run(castPayment(), cancelCast, {});
        expect(options(undone)).toBe(5);
    });

    it("a later untap does not reopen a tap whose mana was kept", async () => {
        const state = await tap(board());
        state.phase = "CLEANUP";
        loot(state).isTapped = false;
        expect(options(state)).toBe(0);
    });
});
