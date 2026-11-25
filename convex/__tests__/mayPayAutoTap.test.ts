// Accepting a `may-pay` runs Auto-Tap for what the pool is short of and pays in
// the SAME mutation (issue #10460): the REGISTERED `submitMayPay` handler over
// the stub `MutationCtx`, against a real Daze / Miscalculation suspension.
//
//   608.2g  If an effect gives a player the option to pay mana, they may
//           activate mana abilities before taking that action.
import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "../cards";
import { TREASURE_TOKEN } from "../cards/sharedTokens";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../cards/__tests__/setup.helper";
import { plains } from "../cards/sets/lea/colorless.cards";
import { submitMayPay } from "../game";
import { projectFullState, projectPublicState } from "../gameProjections";
import { mayPayAutoTapInputs } from "../gre/mayPayAutoTap";
import {
    createTokenPermanents,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingChoice,
} from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

preloadDefinitions([plains()]);

type Args = {
    gameId: Id<"games">;
    playerId: string;
    accept: boolean;
    sacrificeIds?: string[];
};

const submit = (state: GameState, accept = true) => {
    const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
    return {
        stub,
        done: runMutation<Args, void>(
            submitMayPay as unknown as Handler<Args, void>,
            stub.ctx,
            { gameId: GAME_ID, playerId: "p1", accept }
        ),
    };
};

const mine = (name: string, id: string, over = {}) =>
    makeInstance(getCardByName(name).id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });

/** p1's Lightning Bolt, countered-unless-paid by p2's `taxer`, suspended on the
 *  may-pay p1 owes. */
function taxed(
    battlefield: CardInstanceState[],
    over: Partial<Parameters<typeof makePlayer>[1]> = {},
    taxer = "Daze"
): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1", { battlefield, ...over }), makePlayer("p2")],
    });
    const bolt = pushSpell(state, getCardByName("Lightning Bolt").id, "p1", [
        { type: "player", id: "p2" },
    ]);
    pushSpell(state, getCardByName(taxer).id, "p2", [
        { type: "spell", id: bolt.id },
    ]);
    resolveTopOfStack(state);
    expect(state.pendingChoices?.[0]).toMatchObject({
        kind: "may-pay",
        playerId: "p1",
    });
    return state;
}

const tappedIds = (state: GameState) =>
    state.players[0].battlefield.filter((c) => c.isTapped).map((c) => c.id);
const stackNames = (state: GameState) =>
    state.stack.map((s) => (s.card as { id?: string }).id);
const BOLT = getCardByName("Lightning Bolt").id;
const floating = (state: GameState) =>
    Object.values(state.players[0].manaPool).reduce((a, b) => a + b, 0);
const flag = (state: GameState, viewer = "p1") =>
    projectPublicState(state, 1, viewer).pendingChoices?.[0]?.manaAutoTappable;

describe("submitMayPay auto-taps the mana leg (CR 608.2g, issue #10460)", () => {
    it("empty pool, one untapped land: taps it, pays {1}, the spell survives", async () => {
        const state = taxed([mine("Forest", "f1")]);
        expect(flag(state)).toBe(true);
        const { stub, done } = submit(state);
        await done;

        const after = stub.state();
        expect(tappedIds(after)).toEqual(["f1"]);
        expect(floating(after)).toBe(0);
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(stackNames(after)).toContain(BOLT);
        // One document version of the game row: no saved state has the land
        // tapped and the choice still open.
        expect(stub.writes.filter((w) => w.id === "gs-1")).toHaveLength(1);
        // The land's mana is spent, so it can't be untapped for a refund.
        expect(after.players[0].battlefield[0]).toMatchObject({
            manaCommitted: true,
        });
    });

    it("no affordable plan: the server rejects and nothing is written", async () => {
        const state = taxed([mine("Forest", "f1", { isTapped: true })]);
        expect(flag(state)).toBeUndefined();
        const { stub, done } = submit(state);
        await expect(done).rejects.toThrow("Cannot pay the cost");
        expect(stub.writes).toHaveLength(0);
    });

    it("too few sources for {2}: rejects without tapping the one there is", async () => {
        const state = taxed([mine("Forest", "f1")], {}, "Miscalculation");
        expect(flag(state)).toBeUndefined();
        const { stub, done } = submit(state);
        await expect(done).rejects.toThrow("Cannot pay the cost");
        expect(stub.writes).toHaveLength(0);
    });

    it("partial pool + one land covers {2}: the pool goes first, one land tapped", async () => {
        const state = taxed(
            [mine("Forest", "f1"), mine("Forest", "f2")],
            { manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 } },
            "Miscalculation"
        );
        expect(flag(state)).toBe(true);
        const { stub, done } = submit(state);
        await done;
        expect(tappedIds(stub.state())).toHaveLength(1);
        expect(floating(stub.state())).toBe(0);
        expect(stackNames(stub.state())).toContain(BOLT);
    });

    it("a pool that already covers the cost taps nothing", async () => {
        const state = taxed([mine("Forest", "f1")], {
            manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        });
        expect(flag(state)).toBeUndefined();
        const { stub, done } = submit(state);
        await done;
        expect(tappedIds(stub.state())).toEqual([]);
        expect(stackNames(stub.state())).toContain(BOLT);
    });

    it("declining taps nothing and the spell is countered", async () => {
        const { stub, done } = submit(taxed([mine("Forest", "f1")]), false);
        await done;
        expect(tappedIds(stub.state())).toEqual([]);
        expect(stackNames(stub.state())).not.toContain(BOLT);
    });

    it("preserves the Demand in hand: pays with the Plains, not the only Mountain", async () => {
        const state = taxed([mine("Plains", "pl1"), mine("Mountain", "a-m1")], {
            hand: [mine("Lightning Bolt", "held", { zone: "hand" })],
        });
        const { stub, done } = submit(state);
        await done;
        expect(tappedIds(stub.state())).toEqual(["pl1"]);
    });

    it("a becomes-tapped trigger raised by the tap waits on the stack above the spell (CR 603.3)", async () => {
        const { stub, done } = submit(taxed([mine("City of Brass", "cob")]));
        await done;
        const after = stub.state();
        expect(tappedIds(after)).toEqual(["cob"]);
        expect(after.stack).toHaveLength(2);
        expect(stackNames(after)[0]).toBe(BOLT);
        expect(after.stack[1].triggeredAbilityId).toBeDefined();
    });

    it("spends a Treasure only when no land can pay (CR 111.10a)", async () => {
        const treasured = (lands: CardInstanceState[]) => {
            const state = taxed(lands);
            createTokenPermanents(state, TREASURE_TOKEN, "p1", 1);
            return state;
        };
        const withLand = submit(treasured([mine("Forest", "f1")]));
        await withLand.done;
        expect(withLand.stub.state().players[0].battlefield).toHaveLength(2);

        const alone = submit(treasured([]));
        await alone.done;
        expect(alone.stub.state().players[0].battlefield).toHaveLength(0);
        expect(stackNames(alone.stub.state())).toContain(BOLT);
    });
});

describe("manaAutoTappable on the wire (issue #10460)", () => {
    it("is stamped for the chooser alone, and by the full debug view", () => {
        const state = taxed([mine("Forest", "f1")]);
        expect(flag(state, "p2")).toBeUndefined();
        expect(
            projectFullState(state, 1).pendingChoices?.[0]?.manaAutoTappable
        ).toBe(true);
        // Derived per projection: the engine's own choice never carries it.
        expect(state.pendingChoices![0]).not.toHaveProperty("manaAutoTappable");
    });

    it("plans restricted mana exactly where the leg admits it (CR 106.6)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [mine("Adarkar Unicorn", "u1")],
                }),
                makePlayer("p2"),
            ],
        });
        const choice = {
            kind: "may-pay",
            playerId: "p1",
            cost: { U: 1 },
        } as PendingChoice;
        expect(mayPayAutoTapInputs(state, choice)!.sources).toEqual([]);
        expect(
            mayPayAutoTapInputs(state, {
                ...choice,
                manaRestriction: "cumulative-upkeep",
            })!.sources.map((s) => s.cardId)
        ).toEqual(["u1"]);
    });

    it("never plans a Treasure the cost's own sacrifice leg may name", () => {
        const state = makeState({});
        createTokenPermanents(state, TREASURE_TOKEN, "p1", 1);
        const sources = (filter: { types: string } | undefined) =>
            mayPayAutoTapInputs(state, {
                kind: "may-pay",
                playerId: "p1",
                cost: {
                    mana: { X: 1 },
                    ...(filter
                        ? {
                              permanent: {
                                  action: "sacrifice",
                                  filter,
                                  count: 1,
                              },
                          }
                        : {}),
                },
            } as PendingChoice)!.sources;
        expect(sources(undefined)).toHaveLength(1);
        expect(sources({ types: "Artifact" })).toEqual([]);
        expect(sources({ types: "Creature" })).toHaveLength(1);
    });
});
