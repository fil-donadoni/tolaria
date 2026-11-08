// A mana ability whose cost is "{T}, Tap an untapped creature you control"
// (Springleaf Drum; CR 605.1a / 302.6 / 107.5, issue #8448).
//
// CR 605.1a: a mana ability, so it is activatable with priority AND inside a
// payment. CR 302.6: the source's own {T} needs it untapped (and, a creature,
// free of summoning sickness); the creature tapped to pay the cost needs
// neither — being tapped for another permanent's cost is not a {T} activation.
//
// Driven through the registered `activateManaAbility` / `tapUntap` handlers
// over the stub `MutationCtx`, on the CATALOGUE card (the compiled definition).

import { describe, it, expect, beforeAll } from "vitest";
import { activateManaAbility, tapUntap } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import { projectPublicState } from "../gameProjections";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

const DRUM = getCardByName("Springleaf Drum");
const DRUM_MANA = DRUM.activatedAbilities![0].id;
const BEARS = getCardByName("Grizzly Bears");
const ELVES = getCardByName("Llanowar Elves");
/** `manaChoices` is W, U, B, R, G — "one mana of any color". */
const GREEN = 4;

beforeAll(() => {
    preloadDefinitions([DRUM, BEARS, ELVES]);
});

type ManaArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
    manaChoiceIndex?: number;
    tapOtherIds?: string[];
};

function board(opts: {
    bears?: { tapped?: boolean; sick?: boolean };
    noBears?: boolean;
    drumTapped?: boolean;
    hand?: string[];
    pendingCast?: PendingCast;
}): GameState {
    const own = (defId: string, id: string, extra = {}) =>
        makeInstance(defId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            ...extra,
        });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: (opts.hand ?? []).map((id) => own(ELVES.id, id)),
                battlefield: [
                    own(DRUM.id, "drum", { isTapped: !!opts.drumTapped }),
                    ...(opts.noBears
                        ? []
                        : [
                              own(BEARS.id, "bears", {
                                  isTapped: !!opts.bears?.tapped,
                                  isSummoningSick: !!opts.bears?.sick,
                              }),
                          ]),
                ],
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(opts.pendingCast ? { pendingCast: opts.pendingCast } : {}),
    });
}

function activate(state: GameState, args: Partial<ManaArgs> = {}) {
    const ctx = makeMutationCtx("p1", [gameStateSeed(state)]);
    const run = runMutation<ManaArgs, void>(
        activateManaAbility as unknown as Handler<ManaArgs, void>,
        ctx.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "drum",
            abilityId: DRUM_MANA,
            manaChoiceIndex: GREEN,
            tapOtherIds: ["bears"],
            ...args,
        }
    );
    return { ctx, run };
}

const tapped = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.isTapped).map((c) => c.id);

describe("{T} + tap-other mana ability (CR 605.1a / 302.6)", () => {
    it("taps the source AND the chosen creature, and adds the chosen colour", async () => {
        const { ctx, run } = activate(board({}));
        await run;
        const state = ctx.state();
        expect(tapped(state).sort()).toEqual(["bears", "drum"]);
        expect(state.players[0].manaPool.G).toBe(1);
    });

    it("both taps reach the wire", async () => {
        const { ctx, run } = activate(board({}));
        await run;
        const seen = projectPublicState(ctx.state(), 1, "p2");
        const mine = seen.players[0].battlefield;
        expect(mine.find((c) => c.id === "drum")?.isTapped).toBe(true);
        expect(mine.find((c) => c.id === "bears")?.isTapped).toBe(true);
    });

    it("a summoning-sick creature still pays the tap-other leg (CR 302.6)", async () => {
        const { ctx, run } = activate(board({ bears: { sick: true } }));
        await run;
        expect(ctx.state().players[0].manaPool.G).toBe(1);
    });

    it("is refused with no untapped creature to tap, touching nothing", async () => {
        const { ctx, run } = activate(board({ bears: { tapped: true } }));
        await expect(run).rejects.toThrow(
            "Selected permanent is already tapped"
        );
        expect(ctx.state().players[0].battlefield[0].isTapped).toBe(false);
        const none = activate(board({ noBears: true }), { tapOtherIds: [] });
        await expect(none.run).rejects.toThrow(
            "Not enough untapped permanents to pay the tap cost"
        );
        expect(none.ctx.state().players[0].manaPool.G ?? 0).toBe(0);
    });

    it("is refused when the source is already tapped (CR 302.6)", async () => {
        const { ctx, run } = activate(board({ drumTapped: true }));
        await expect(run).rejects.toThrow("Card already tapped");
        expect(ctx.state().players[0].battlefield[1].isTapped).toBe(false);
    });

    it("funds a cast in progress and commits it (CR 605.3a)", async () => {
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "elves",
            manaCost: { G: 1 },
            tappedLandIds: [],
        };
        const { ctx, run } = activate(board({ hand: ["elves"], pendingCast }));
        await run;
        const state = ctx.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((item) => item.id)).toEqual(["elves"]);
    });

    it("the tap route refuses it: a plain tap would tap nothing else", async () => {
        const ctx = makeMutationCtx("p1", [gameStateSeed(board({}))]);
        const run = runMutation(
            tapUntap as unknown as Handler<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                    manaChoiceIndex?: number;
                },
                void
            >,
            ctx.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "drum",
                manaChoiceIndex: GREEN,
            }
        );
        await expect(run).rejects.toThrow(
            "Use activateManaAbility for a mana ability that taps another permanent"
        );
    });
});
