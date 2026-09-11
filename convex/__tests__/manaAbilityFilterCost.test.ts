// Filtered give-up costs on the NON-STACK (mana) path — CR 605.1a / 605.3a /
// 605.3b / 118.3 / 118.5, issue #3455.
//
// "Sacrifice a creature: Add {C}{C}" (Ashnod's Altar), "Sacrifice a Goblin:
// Add {R}" (Skirk Prospector), "{T}, Sacrifice a creature: Add {B}{B}"
// (Phyrexian Tower), "{B}, {T}, Discard a card: Add {B}{B}{B}" (Bog Witch) are
// mana abilities by CR 605.1a: no target, they add mana, no library movement.
// So they do not use the stack (CR 605.3b) — and every non-stack entry point
// pays its cost INLINE, which a FILTER cannot be: it names no card, only the
// player can. Before this issue the activation was accepted, the cost was never
// paid, and for a `manaProduced` output no mana was added either.
//
// Driven through the REAL entry points — `tapSourceIntoPayment` (the primitive
// the payment-tap mutations share) and the registered `activateManaAbility` /
// `tapUntap` / `selectSacrifice` / `selectActivationDiscardCost` /
// `cancelActivation` mutation handlers over the stub `MutationCtx` — never a
// hand-rolled copy of a mutation body.

import { describe, it, expect, beforeAll } from "vitest";
import {
    activateManaAbility,
    tapUntap,
    tapSourceIntoPayment,
    selectSacrifice,
    selectActivationDiscardCost,
    cancelActivation,
    tryAutoCommitPendingCast,
    selectSacrificeOnState,
} from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { getCardByName } from "../cards";
import { preloadDefinitions } from "../cards/registry";
import { projectPublicState } from "../gameProjections";
import { nextOwedPayment } from "../gre/owedPayment";
import { getManaTapOptions } from "../gre/constants";
import { buildAutoTapSources } from "../gre/autoTap";
import type { CardDefinition } from "../cards/types";
import type { GameState, PendingCast } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

/** Ashnod's Altar as the Oracle compiler emits it (CR 605.1a-faithful):
 *  "Sacrifice a creature: Add {C}{C}." — no {T}, no self-sacrifice, a FILTER.
 *  The catalogue's own copy deliberately deviates to `useStack: true` for
 *  exactly the gap this issue closes (`convex/cards/sets/atq/red.ts`), so the
 *  compiled shape is exercised through a test-only definition. */
const ALTAR: CardDefinition = {
    id: "test-3455-altar",
    name: "Test Sacrifice Altar",
    rarity: "uncommon",
    oracleText: "Sacrifice a creature: Add {C}{C}.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "test-3455-altar-mana",
            oracleText: "Sacrifice a creature: Add {C}{C}.",
            cost: { sacrificeFilter: { types: ["Creature"] } },
            useStack: false,
            manaProduced: { C: 2 },
        },
    ],
};

/** Skirge Familiar's shape: "Discard a card: Add {B}." — the FILTERED DISCARD
 *  half of the class, on a source with no {T} and no self-sacrifice. */
const FAMILIAR: CardDefinition = {
    id: "test-3455-familiar",
    name: "Test Discard Familiar",
    rarity: "rare",
    oracleText: "Discard a card: Add {B}.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Imp"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "test-3455-familiar-mana",
            oracleText: "Discard a card: Add {B}.",
            cost: { discardFilter: { filter: {}, count: 1 } },
            useStack: false,
            manaProduced: { B: 1 },
        },
    ],
};

/** Phyrexian Tower's shape: a plain "{T}: Add {C}" BESIDE the filtered
 *  "{T}, Sacrifice a creature: Add {B}{B}" — the tap-legged half of the class,
 *  and the one whose filter leg has never been proven paid. */
const TOWER: CardDefinition = {
    id: "test-3455-tower",
    name: "Test Sacrifice Tower",
    rarity: "rare",
    oracleText: "{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "test-3455-tower-c",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
        },
        {
            id: "test-3455-tower-b",
            oracleText: "{T}, Sacrifice a creature: Add {B}{B}.",
            cost: { tap: true, sacrificeFilter: { types: ["Creature"] } },
            useStack: false,
            manaProduced: { B: 2 },
        },
    ],
};

beforeAll(() => {
    preloadDefinitions([ALTAR, FAMILIAR, TOWER]);
});

const BOLT = () => getCardByName("Lightning Bolt").id;
/** DISTINGUISHABLE victims — `autoResolveFungible` collapses a board of
 *  identical candidates to a forced pick (the zero-branch convention), so a
 *  test that wants the PROMPT must offer a real choice. */
const VICTIMS = ["Grizzly Bears", "Llanowar Elves", "Scathe Zombies"];

/** p1 with `defId` plus `creatures` DISTINCT creatures on the battlefield and
 *  `hand` cards in hand, priority held. */
function board(
    defId: string,
    opts: {
        creatures?: number;
        hand?: number;
        pendingCast?: PendingCast;
        handSpellId?: string;
    } = {}
): GameState {
    const source = makeInstance(defId, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const creatures = Array.from({ length: opts.creatures ?? 0 }, (_, i) =>
        makeInstance(getCardByName(VICTIMS[i]).id, {
            id: `bear-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        })
    );
    const hand = Array.from({ length: opts.hand ?? 0 }, (_, i) =>
        makeInstance(BOLT(), {
            id: `hand-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    if (opts.handSpellId) {
        hand.push(
            makeInstance(BOLT(), {
                id: opts.handSpellId,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
    }
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [source, ...creatures], hand }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        ...(opts.pendingCast ? { pendingCast: opts.pendingCast } : {}),
    });
}

type ManaArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
    manaChoiceIndex?: number;
};
type TapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};
type PickArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};
type DiscardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceIds: string[];
};
type CancelArgs = { gameId: Id<"games">; playerId: string };

const ctxFor = (state: GameState) =>
    makeMutationCtx("p1", [gameStateSeed(state)]);

const runActivate = (
    ctx: ReturnType<typeof ctxFor>,
    cardInstanceId: string,
    abilityId: string,
    manaChoiceIndex?: number
) =>
    runMutation<ManaArgs, void>(
        activateManaAbility as unknown as Handler<ManaArgs, void>,
        ctx.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId,
            abilityId,
            ...(manaChoiceIndex !== undefined ? { manaChoiceIndex } : {}),
        }
    );

const runTap = (
    ctx: ReturnType<typeof ctxFor>,
    cardInstanceId: string,
    manaChoiceIndex?: number
) =>
    runMutation<TapArgs, void>(
        tapUntap as unknown as Handler<TapArgs, void>,
        ctx.ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId,
            ...(manaChoiceIndex !== undefined ? { manaChoiceIndex } : {}),
        }
    );

const runPick = (ctx: ReturnType<typeof ctxFor>, cardInstanceId: string) =>
    runMutation<PickArgs, void>(
        selectSacrifice as unknown as Handler<PickArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceId }
    );

const runDiscard = (ctx: ReturnType<typeof ctxFor>, ids: string[]) =>
    runMutation<DiscardArgs, void>(
        selectActivationDiscardCost as unknown as Handler<DiscardArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1", cardInstanceIds: ids }
    );

const runCancel = (ctx: ReturnType<typeof ctxFor>) =>
    runMutation<CancelArgs, void>(
        cancelActivation as unknown as Handler<CancelArgs, void>,
        ctx.ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );

describe("filtered SACRIFICE cost, non-stack path (CR 605.3b, issue #3455)", () => {
    it("prompts for the victim with 2+ legal ones, then pays it and adds the mana", async () => {
        const ctx = ctxFor(board(ALTAR.id, { creatures: 2 }));

        await runActivate(ctx, "source", "test-3455-altar-mana");

        // Parked, not resolved: nothing paid, no mana yet.
        const parked = ctx.state();
        expect(parked.pendingActivation?.resolveWithoutStack).toBe(true);
        expect(parked.players[0].manaPool.C ?? 0).toBe(0);
        expect(parked.players[0].battlefield).toHaveLength(3);
        expect(nextOwedPayment(parked, "p1")?.kind).toBe(
            "activation:sacrificeSelection"
        );

        await runPick(ctx, "bear-1");

        const after = ctx.state();
        expect(after.players[0].manaPool.C).toBe(2);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["bear-1"]);
        expect(after.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bear-1"
        );
        expect(after.pendingActivation).toBeUndefined();
    });

    it("never appears on the stack and never grants priority (CR 605.3b)", async () => {
        const ctx = ctxFor(board(ALTAR.id, { creatures: 2 }));
        await runActivate(ctx, "source", "test-3455-altar-mana");
        await runPick(ctx, "bear-0");

        // Asserted through the PUBLIC projection — the view the client and the
        // bot actually read — not a hand-built one.
        const view = projectPublicState(ctx.state(), 1, "p1");
        expect(view.stack).toHaveLength(0);
        expect(view.priorityPlayerId).toBe("p1");
        expect(ctx.state().passCount).toBe(0);
    });

    it("auto-resolves with exactly one legal victim — no prompt", async () => {
        const ctx = ctxFor(board(ALTAR.id, { creatures: 1 }));

        await runActivate(ctx, "source", "test-3455-altar-mana");

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.players[0].manaPool.C).toBe(2);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["bear-0"]);
    });

    it("cancelling the pick leaves the source and every candidate untouched", async () => {
        const ctx = ctxFor(board(ALTAR.id, { creatures: 2 }));
        await runActivate(ctx, "source", "test-3455-altar-mana");

        await runCancel(ctx);

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.players[0].battlefield.map((c) => c.id)).toEqual([
            "source",
            "bear-0",
            "bear-1",
        ]);
        expect(after.players[0].graveyard).toHaveLength(0);
        expect(after.players[0].manaPool.C ?? 0).toBe(0);
    });

    it("withholds the activation entirely when no permanent matches the filter", async () => {
        const ctx = ctxFor(board(ALTAR.id, { creatures: 0 }));
        await expect(
            runActivate(ctx, "source", "test-3455-altar-mana")
        ).rejects.toThrow(/sacrifice cost/i);
        expect(ctx.state().pendingActivation).toBeUndefined();
    });
});

describe("the unified mana-source option list (CR 605.1a, issue #3455)", () => {
    const optionsFor = (state: GameState, id: string) =>
        getManaTapOptions(
            state.players[0].battlefield.find((c) => c.id === id)!,
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );

    it("offers a tap-less filtered-sacrifice ability as a payment source", () => {
        // The gate used to be "has {T} or sacrifices itself", which is neither,
        // so the source was invisible to the client menu, the payment-source
        // click and the castability census alike.
        expect(optionsFor(board(ALTAR.id, { creatures: 1 }), "source")).toEqual(
            [{ C: 2 }]
        );
    });

    it("the AUTOMATIC planner still refuses it — per option, not per source", () => {
        // CR 602.1 — giving up a creature is a decision, never an auto-payment;
        // and the option now PARKS on a pick no solver can answer.
        const altar = board(ALTAR.id, { creatures: 2 });
        expect(
            buildAutoTapSources(
                altar.players[0].battlefield,
                altar.players.map((p) => ({
                    playerId: p.id,
                    battlefield: p.battlefield,
                }))
            ).map((s) => s.cardId)
        ).not.toContain("source");

        // Phyrexian Tower keeps its plain "{T}: Add {C}" auto-tappable: the
        // exclusion is per-OPTION, and indices are never renumbered.
        const tower = board(TOWER.id, { creatures: 2 });
        const towerSource = buildAutoTapSources(
            tower.players[0].battlefield,
            tower.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        ).find((s) => s.cardId === "source");
        expect(towerSource?.options.map((o) => o.mana)).toEqual([{ C: 1 }]);
    });
});

describe("filtered DISCARD cost, same window (CR 118.3, issue #3455)", () => {
    it("parks on the discard pick, then pays it and adds the mana", async () => {
        const ctx = ctxFor(board(FAMILIAR.id, { hand: 2 }));

        await runActivate(ctx, "source", "test-3455-familiar-mana");
        const parked = ctx.state();
        expect(nextOwedPayment(parked, "p1")?.kind).toBe(
            "activation:discardFilterChoice"
        );
        expect(parked.players[0].hand).toHaveLength(2);

        await runDiscard(ctx, ["hand-1"]);

        const after = ctx.state();
        expect(after.players[0].manaPool.B).toBe(1);
        expect(after.players[0].hand.map((c) => c.id)).toEqual(["hand-0"]);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["hand-1"]);
        expect(after.stack).toHaveLength(0);
    });

    it("withholds the activation with an empty hand", async () => {
        const ctx = ctxFor(board(FAMILIAR.id, { hand: 0 }));
        await expect(
            runActivate(ctx, "source", "test-3455-familiar-mana")
        ).rejects.toThrow(/discard cost/i);
    });
});

describe("the TAP-legged members actually pay their filter leg (issue #3455)", () => {
    it("tapUntap on the chosen sacrifice option taps, eats the victim and adds {B}{B}", async () => {
        const state = board(TOWER.id, { creatures: 2 });
        // The unified option list is what `manaChoiceIndex` indexes into.
        const options = getManaTapOptions(
            state.players[0].battlefield[0],
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );
        const bIndex = options.findIndex((o) => (o.B ?? 0) === 2);
        expect(bIndex).toBeGreaterThanOrEqual(0);

        const ctx = ctxFor(state);
        await runTap(ctx, "source", bIndex);
        expect(ctx.state().pendingActivation?.resolveWithoutStack).toBe(true);

        await runPick(ctx, "bear-0");

        const after = ctx.state();
        expect(after.players[0].manaPool.B).toBe(2);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["bear-0"]);
        const source = after.players[0].battlefield.find(
            (c) => c.id === "source"
        );
        expect(source?.isTapped).toBe(true);
        // CR 106.4 / 603.3 — the victim cannot be un-sacrificed, so the tap is
        // a commitment: the untap-to-refund toggle must refuse it.
        expect(source?.manaCommitted).toBe(true);
        await expect(runTap(ctx, "source")).rejects.toThrow(/Cannot untap/i);
    });

    it("the plain {C} option on the same source is untouched by any of this", async () => {
        const state = board(TOWER.id, { creatures: 1 });
        const options = getManaTapOptions(
            state.players[0].battlefield[0],
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );
        const cIndex = options.findIndex((o) => (o.C ?? 0) === 1);
        const ctx = ctxFor(state);

        await runTap(ctx, "source", cIndex);

        const after = ctx.state();
        expect(after.pendingActivation).toBeUndefined();
        expect(after.players[0].manaPool.C).toBe(1);
        expect(after.players[0].graveyard).toHaveLength(0);
    });
});

describe("CR 605.3a — activatable mid-cast, and it funds the cast", () => {
    it("the payment tap parks, and the answered pick commits the pending cast", () => {
        const pendingCast: PendingCast = {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { X: 2 },
            tappedLandIds: [],
        };
        const state = board(ALTAR.id, {
            creatures: 2,
            pendingCast,
            handSpellId: "spell",
        });
        const player = state.players[0];

        tapSourceIntoPayment(
            state,
            player,
            player.battlefield[0],
            undefined,
            pendingCast.tappedLandIds
        );

        // Parked INSIDE the cast's payment window: the cast's own commit gate
        // must see the inner park, not answer `null` because a cast exists.
        expect(state.pendingActivation?.resolveWithoutStack).toBe(true);
        expect(nextOwedPayment(state, "p1")?.container).toBe("activation");
        tryAutoCommitPendingCast(state, "p1");
        expect(state.pendingCast).toBeDefined();
        expect(state.stack).toHaveLength(0);

        // Answering the pick pays the cost, adds {C}{C} — and the cast that was
        // waiting on it commits, with only the SPELL on the stack.
        selectSacrificeOnState(state, {
            playerId: "p1",
            cardInstanceId: "bear-1",
        });

        expect(state.pendingActivation).toBeUndefined();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe("spell");
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["bear-1"]);
    });
});
