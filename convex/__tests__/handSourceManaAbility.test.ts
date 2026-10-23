// A mana ability activated from the HAND — "Exile this card from your hand:
// Add {G}." (Elvish Spirit Guide; CR 113.6m / 605.1a / 605.3a, issue #5326).
//
// CR 113.6m: the cost moves the card out of the hand, so the ability functions
// only there — never on the permanent the same card becomes. CR 605.3a: it is
// a mana ability, so it is activatable with priority AND inside a payment.
//
// Driven through the registered `activateManaAbility` handler over the stub
// `MutationCtx`, on the CATALOGUE card (the compiled definition, which carries
// no resolution body: its `manaProduced` is the whole output).

import { describe, it, expect, beforeAll } from "vitest";
import { activateManaAbility } from "../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import { projectPublicState } from "../gameProjections";
import { getActivatedManaAbility, hasManaAbility } from "../gre/constants";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

const GUIDE = getCardByName("Elvish Spirit Guide");
const GUIDE_MANA = "elvish-spirit-guide-mana";
const ELVES = getCardByName("Llanowar Elves");
const AGENT = getCardByName("Agent of Stromgald");

beforeAll(() => {
    preloadDefinitions([GUIDE, ELVES, AGENT]);
});

type ManaArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
};

function board(opts: {
    hand?: string[];
    battlefield?: string[];
    opponentHand?: string[];
    pendingCast?: PendingCast;
}): GameState {
    const own = (defId: string, id: string, owner = "p1") =>
        makeInstance(defId, { id, controllerId: owner, ownerId: owner });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: (opts.hand ?? []).map((id) =>
                    own(id === "elves" ? ELVES.id : GUIDE.id, id)
                ),
                battlefield: (opts.battlefield ?? []).map((id) =>
                    own(id === "agent" ? AGENT.id : GUIDE.id, id)
                ),
            }),
            makePlayer("p2", {
                hand: (opts.opponentHand ?? []).map((id) =>
                    own(GUIDE.id, id, "p2")
                ),
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(opts.pendingCast ? { pendingCast: opts.pendingCast } : {}),
    });
}

function activate(
    state: GameState,
    cardInstanceId: string,
    abilityId = GUIDE_MANA
) {
    const ctx = makeMutationCtx("p1", [gameStateSeed(state)]);
    const run = runMutation<ManaArgs, void>(
        activateManaAbility as unknown as Handler<ManaArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId, abilityId }
    );
    return { ctx, run };
}

describe("a mana ability activated from the hand (CR 113.6m / 605.1a)", () => {
    it("exiles the card from its owner's hand and adds {G}", async () => {
        const { ctx, run } = activate(board({ hand: ["guide"] }), "guide");
        await run;
        const p1 = ctx.state().players[0];
        expect(p1.manaPool.G).toBe(1);
        expect(p1.hand.map((c) => c.id)).toEqual([]);
        expect(p1.exile.map((c) => c.id)).toEqual(["guide"]);
    });

    it("the exiled card is public on the wire (CR 400.2)", async () => {
        const { ctx, run } = activate(board({ hand: ["guide"] }), "guide");
        await run;
        const seenByOpponent = projectPublicState(ctx.state(), 1, "p2");
        const exiled = seenByOpponent.players[0].exile.find(
            (c) => c.id === "guide"
        );
        expect((exiled?.card as { id?: string } | undefined)?.id).toBe(
            GUIDE.id
        );
    });

    it("funds a cast in progress and commits it (CR 605.3a)", async () => {
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "elves",
            manaCost: { G: 1 },
            tappedLandIds: [],
        };
        const { ctx, run } = activate(
            board({ hand: ["guide", "elves"], pendingCast }),
            "guide"
        );
        await run;
        const state = ctx.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((item) => item.id)).toEqual(["elves"]);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["guide"]);
    });

    it("refuses the card whose own cast is being paid (CR 601.2a)", async () => {
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "guide",
            manaCost: { X: 2, G: 1 },
            tappedLandIds: [],
        };
        const { run } = activate(
            board({ hand: ["guide"], pendingCast }),
            "guide"
        );
        await expect(run).rejects.toThrow("This card is being cast");
    });

    it("refuses an opponent's card in hand (CR 602.2)", async () => {
        const { run } = activate(board({ opponentHand: ["theirs"] }), "theirs");
        await expect(run).rejects.toThrow("Card not on battlefield");
    });

    it("does not function on the battlefield (CR 113.6m)", async () => {
        const state = board({ battlefield: ["guide"] });
        const permanent = state.players[0].battlefield[0];
        expect(getActivatedManaAbility(permanent)).toBeNull();
        expect(hasManaAbility(permanent)).toBe(false);
        const { run } = activate(state, "guide");
        await expect(run).rejects.toThrow(
            "This ability can't be activated from the battlefield"
        );
    });
});

describe("a fixed no-tap mana ability with no resolution body (CR 605.3b)", () => {
    it("deposits its manaProduced (Agent of Stromgald: {R}: Add {B})", async () => {
        const state = board({ battlefield: ["agent"] });
        state.players[0].manaPool.R = 1;
        const { ctx, run } = activate(
            state,
            "agent",
            AGENT.activatedAbilities![0].id
        );
        await run;
        const pool = ctx.state().players[0].manaPool;
        expect(pool.R).toBe(0);
        expect(pool.B).toBe(1);
    });
});
