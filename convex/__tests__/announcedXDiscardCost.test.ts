// The ANNOUNCED-X discard additional cost (CR 601.2b / 118.4 / 701.9 — issue
// #2714).
//
// `additionalCosts.discard.count` was typed `number`, so "As an additional
// cost to cast this spell, discard X cards" had no encoding at all — ten
// corpus cards print it and `docs/findings/2699-spell-slot-gaps.md` item (3)
// has been standing on it. The count now takes the literal `"X"`, the same
// authoring idiom `targetRequirement.count` already uses, and the announce-time
// flow is `payXLife`'s one resource over: the caster names X, the cards leave
// hand at cast commit through the ordinary hand-cost picker, and X is
// snapshotted onto the stack item so `getX()` reads it back at resolve.
//
// Sickening Dreams (`tor/black.ts`) is the first card announcing an X with NO
// `{X}` pip in its mana cost at all, which is why this crosses every layer:
//
//  1. **Unit** — `additionalCostDiscardXCeiling` (the single authority on the
//     largest legal X) and `additionalCostHandLeg` (the cost leg it prices)
//     against the real catalogue definition.
//  2. **Full path** — driven through the REGISTERED `announceCast` mutation
//     via `gameMutationHarness.ts` (the established game.ts seam, ADR 0001 —
//     never a hand-rolled reimplementation of the handler's body): the cards
//     actually leave hand, the spell reaches the stack carrying its X, and an
//     X above the ceiling is refused.
//  3. **Resolve** — the stack item's X drives the damage, to each creature and
//     each player alike.

import { describe, it, expect } from "vitest";
import {
    additionalCostDiscardXCeiling,
    additionalCostHandLeg,
} from "../gre/additionalCost";
import {
    announceCast,
    recordCastAlternativeHandCostPick,
    tryAutoCommitPendingCast,
} from "../game";
import { getPlayer, resolveTopOfStack } from "../gre/state";
import { sickeningDreams } from "../cards/sets/tor";
import { grizzlyBears, lightningBolt } from "../cards/sets/lea";
import { swamp } from "../cards/sets/lea/colorless";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    chosenX?: number;
};

/** p1 holds Sickening Dreams plus `spare` other cards, six untapped Swamps and
 *  `{B}{B}{B}` already floating (the pool covering the cost is what makes
 *  `announceCast` take the immediate-commit branch rather than parking on
 *  mana). p2 fields a Grizzly Bears, so the damage has a creature to find. */
function board(spare: number) {
    const spell = makeInstance(sickeningDreams.id, {
        id: "spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const spares = Array.from({ length: spare }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `spare${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        })
    );
    const lands = Array.from({ length: 6 }, (_, i) =>
        makeInstance(swamp.id, {
            id: `swamp-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell, ...spares],
                battlefield: lands,
                manaPool: { W: 0, U: 0, B: 3, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const announce = (state: ReturnType<typeof board>, chosenX: number) => {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    return runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            cardInstanceId: "spell",
            chosenX,
        }
    ).then(() => harness);
};

describe("additionalCostDiscardXCeiling — the largest X a caster may announce (CR 601.2b / 601.2a)", () => {
    it("counts every card in hand EXCEPT the one being cast", () => {
        const state = board(3);
        expect(
            additionalCostDiscardXCeiling(
                getPlayer(state, "p1"),
                sickeningDreams.additionalCosts,
                "spell"
            )
        ).toBe(3);
    });

    it("is 0 on a hand holding nothing but the spell itself", () => {
        const state = board(0);
        expect(
            additionalCostDiscardXCeiling(
                getPlayer(state, "p1"),
                sickeningDreams.additionalCosts,
                "spell"
            )
        ).toBe(0);
    });

    it("is `undefined` — not 0 — for a card with no announced-X discard leg", () => {
        // The distinction the Bot's enumerator and the client cap both read:
        // "no X owed here" is not "X owed, ceiling 0".
        const state = board(3);
        expect(
            additionalCostDiscardXCeiling(
                getPlayer(state, "p1"),
                lightningBolt.additionalCosts,
                "spell"
            )
        ).toBeUndefined();
    });
});

describe("additionalCostHandLeg — an 'X' count prices off the announced X (CR 118.4)", () => {
    it("asks for exactly X cards", () => {
        expect(
            additionalCostHandLeg(sickeningDreams.additionalCosts, 2)
        ).toEqual({
            hand: {
                action: "discard",
                requirements: [{ filter: {}, count: 2 }],
            },
        });
    });

    it("owes nothing at X = 0, and nothing with no X supplied at all", () => {
        // CR 118.3 — a cost of no cards is payable by anyone, which is what
        // keeps an announced-X leg invisible to the affordability gate.
        expect(
            additionalCostHandLeg(sickeningDreams.additionalCosts, 0)
        ).toBeUndefined();
        expect(
            additionalCostHandLeg(sickeningDreams.additionalCosts)
        ).toBeUndefined();
    });
});

describe("announceCast — 'discard X cards' is announced, paid and snapshotted (CR 601.2b / 701.9)", () => {
    it("X = 2 with three spare cards: parks on the hand picker for exactly two", async () => {
        const harness = await announce(board(3), 2);
        const after = harness.state();
        // A real pick (three candidates for two slots), so the cast parks.
        expect(after.stack).toHaveLength(0);
        expect(after.pendingCast?.alternativeCostHandChoice).toEqual({
            action: "discard",
            requirements: [{ filter: {}, count: 2 }],
            excludeInstanceId: "spell",
        });
    });

    it("…and the pick commits the cast, moving exactly those cards to the graveyard", async () => {
        const harness = await announce(board(3), 2);
        const state = harness.state();
        recordCastAlternativeHandCostPick(state, "p1", ["spare0", "spare2"]);
        tryAutoCommitPendingCast(state, "p1");
        const p1 = getPlayer(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(sickeningDreams.id);
        // CR 107.3 — the announced X rides the stack item, so the effect reads
        // the value that was actually paid for.
        expect(state.stack[0].chosenX).toBe(2);
        expect(p1.graveyard.map((c) => c.id)).toEqual(["spare0", "spare2"]);
        expect(p1.hand.map((c) => c.id)).toEqual(["spare1"]);
    });

    it("X = 2 with exactly two spare cards: the forced pick auto-resolves and commits", async () => {
        const harness = await announce(board(2), 2);
        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].chosenX).toBe(2);
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual([
            "spare0",
            "spare1",
        ]);
        expect(after.players[0].hand).toHaveLength(0);
    });

    it("X = 0: the spell commits at once and nothing is discarded", async () => {
        const harness = await announce(board(3), 0);
        const after = harness.state();
        expect(after.stack).toHaveLength(1);
        expect(after.stack[0].chosenX).toBe(0);
        expect(after.players[0].graveyard).toHaveLength(0);
        expect(after.players[0].hand).toHaveLength(3);
    });

    it("an X above the hand ceiling is REFUSED (CR 601.2a — the spell can't pay for itself)", async () => {
        // Two spares, X = 3: the third card would have to be Sickening Dreams
        // itself, which is on the stack by the time costs are paid.
        await expect(announce(board(2), 3)).rejects.toThrow(
            /Cannot discard more cards than you have/
        );
    });

    it("announcing no X at all is REFUSED (the mutation never guesses)", async () => {
        const harness = makeMutationCtx("p1", [gameStateSeed(board(3))]);
        await expect(
            runMutation<AnnounceCastArgs, void>(
                announceCast as unknown as Handler<AnnounceCastArgs, void>,
                harness.ctx,
                {
                    gameId: "game-1" as Id<"games">,
                    playerId: "p1",
                    cardInstanceId: "spell",
                }
            )
        ).rejects.toThrow(/Must choose X/);
    });
});

describe("Sickening Dreams — the announced X is what resolves (CR 119.3 / 608.2)", () => {
    it("deals X to each creature and each player alike", async () => {
        const harness = await announce(board(2), 2);
        const state = harness.state();
        resolveTopOfStack(state);
        // 2 damage to a 2/2 is lethal — SBAs bin the Bears (CR 704.5g).
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        // …and to EACH player, the caster included.
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(getPlayer(state, "p2").life).toBe(18);
    });

    it("X = 0 is a legal announcement and a complete no-op", async () => {
        const harness = await announce(board(3), 0);
        const state = harness.state();
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p1").life).toBe(20);
        expect(getPlayer(state, "p2").life).toBe(20);
    });
});
