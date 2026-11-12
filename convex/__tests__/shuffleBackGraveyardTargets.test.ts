/**
 * CR 601.2c (issue #9328) — "Target player shuffles up to N target cards from
 * their graveyard into their library" announces the cards as TARGETS, with the
 * player: Krosan Reclamation and Gaea's Blessing driven through the REAL path —
 * the shipped definitions, the `announceCast` / `selectTargets` /
 * `confirmTargets` mutation handlers, the wire projection, then
 * `resolveTopOfStack`.
 *
 * CR 601.2c: "The player announces their choice of an appropriate object or
 * player for each target the spell requires." The card group is bound to the
 * graveyard of the player announced first (`zoneOwnerOfPriorPlayerTarget`);
 * CR 608.2b skips a card that left that graveyard before resolution.
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { announceCast, confirmTargets, selectTargets } from "../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";
import { resolveTopOfStack, type GameState } from "../gre/state";
import { projectPublicState } from "../gameProjections";

const KROSAN_RECLAMATION = "5b3c5144-7e15-46c6-b819-d729ecb30bb1";
const GAEAS_BLESSING = "ee83d511-57e0-40fb-a4db-62f6c2c39888";
const SPELL = "spell-1";
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

type Harness = ReturnType<typeof makeMutationCtx>;

const run = (handler: unknown, harness: Harness, args: object) =>
    runMutation(
        handler as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, ...args }
    );

const pickPlayer = (harness: Harness, targetId: string) =>
    run(selectTargets, harness, {
        targets: [{ targetType: "player", targetId }],
    });

const pickCards = (harness: Harness, owner: string, ids: string[]) =>
    run(selectTargets, harness, {
        targets: ids.map((targetId) => ({
            targetType: "graveyard-card",
            targetId,
            targetPlayerId: owner,
        })),
    });

function bear(id: string, owner: string, zone: "graveyard" | "library") {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone,
    });
}

/** p1 holds the spell and {1}{G}; each player has three graveyard cards and
 *  a two-card library. */
function board(spellCardId: string): GameState {
    const spell = makeInstance(spellCardId, {
        id: SPELL,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pile = (owner: string, zone: "graveyard" | "library", n: number) =>
        Array.from({ length: n }, (_, i) =>
            bear(`${owner}-${zone}-${i}`, owner, zone)
        );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell],
                graveyard: pile("p1", "graveyard", 3),
                library: pile("p1", "library", 2),
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
            }),
            makePlayer("p2", {
                graveyard: pile("p2", "graveyard", 3),
                library: pile("p2", "library", 2),
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const ids = (cards: readonly { id: string }[]) => cards.map((c) => c.id);

describe("Krosan Reclamation — the graveyard cards are announced targets (CR 601.2c)", () => {
    it("announces the player, then up to two cards from THAT player's graveyard", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(KROSAN_RECLAMATION)),
        ]);
        await run(announceCast, harness, { cardInstanceId: SPELL });
        expect(harness.state().pendingTarget?.targetType).toBe("player");

        await pickPlayer(harness, "p2");
        const group = harness.state().pendingTarget;
        expect(group?.zone).toBe("graveyard");
        expect(group?.zoneOwnerId).toBe("p2");
        expect(group?.count).toEqual({ min: 0, max: 2 });
        // SURFACE: the client's clickability gate reads the lowered owner.
        const view = projectPublicState(harness.state(), 1, "p1");
        expect(view.pendingTarget?.zoneOwnerId).toBe("p2");

        // Only the announced player's graveyard is legal for the card group.
        await expect(
            pickCards(harness, "p1", ["p1-graveyard-0"])
        ).rejects.toThrow(/announced player's graveyard/);
        await pickCards(harness, "p2", ["p2-graveyard-0", "p2-graveyard-1"]);
        const state = harness.state();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack[0]!.targets).toEqual([
            { type: "player", id: "p2" },
            { type: "graveyard-card", id: "p2-graveyard-0", playerId: "p2" },
            { type: "graveyard-card", id: "p2-graveyard-1", playerId: "p2" },
        ]);
        // SURFACE: the stack item on the wire carries every announced target.
        const stackView = projectPublicState(state, 2, "p1");
        expect(stackView.stack[0]?.targets).toEqual(state.stack[0]!.targets);

        resolveTopOfStack(state);
        const p2 = state.players[1]!;
        expect(ids(p2.graveyard)).toEqual(["p2-graveyard-2"]);
        expect(ids(p2.library).sort()).toEqual([
            "p2-graveyard-0",
            "p2-graveyard-1",
            "p2-library-0",
            "p2-library-1",
        ]);
        // The caster's own graveyard is untouched (the spell joins it).
        expect(ids(state.players[0]!.graveyard)).toEqual([
            "p1-graveyard-0",
            "p1-graveyard-1",
            "p1-graveyard-2",
            SPELL,
        ]);
    });

    it('choosing zero cards is legal ("up to")', async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(KROSAN_RECLAMATION)),
        ]);
        await run(announceCast, harness, { cardInstanceId: SPELL });
        await pickPlayer(harness, "p2");
        await run(confirmTargets, harness, {});
        const state = harness.state();
        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack[0]!.targets).toEqual([{ type: "player", id: "p2" }]);

        resolveTopOfStack(state);
        expect(state.players[1]!.graveyard).toHaveLength(3);
        expect(state.players[1]!.library).toHaveLength(2);
    });

    it("a targeted card that left the graveyard is not moved; the other is (CR 608.2b)", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(KROSAN_RECLAMATION)),
        ]);
        await run(announceCast, harness, { cardInstanceId: SPELL });
        await pickPlayer(harness, "p2");
        await pickCards(harness, "p2", ["p2-graveyard-0", "p2-graveyard-1"]);
        const state = harness.state();
        // In response, the first targeted card is exiled.
        const p2 = state.players[1]!;
        const exiled = p2.graveyard.find((c) => c.id === "p2-graveyard-0")!;
        p2.graveyard = p2.graveyard.filter((c) => c !== exiled);
        p2.exile = [...p2.exile, { ...exiled, zone: "exile" }];

        resolveTopOfStack(state);
        expect(ids(p2.exile)).toEqual(["p2-graveyard-0"]);
        expect(ids(p2.graveyard)).toEqual(["p2-graveyard-2"]);
        expect(ids(p2.library)).toContain("p2-graveyard-1");
        expect(ids(p2.library)).not.toContain("p2-graveyard-0");
        expect(p2.library).toHaveLength(3);
    });
});

describe("Gaea's Blessing — up to three targeted cards, then draw (CR 601.2c)", () => {
    it("announces up to three cards from the chosen graveyard and still draws a card", async () => {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(board(GAEAS_BLESSING)),
        ]);
        await run(announceCast, harness, { cardInstanceId: SPELL });
        await pickPlayer(harness, "p1");
        const group = harness.state().pendingTarget;
        expect(group?.zoneOwnerId).toBe("p1");
        expect(group?.count).toEqual({ min: 0, max: 3 });

        await pickCards(harness, "p1", [
            "p1-graveyard-0",
            "p1-graveyard-1",
            "p1-graveyard-2",
        ]);
        const state = harness.state();
        expect(state.stack[0]!.targets).toEqual([
            { type: "player", id: "p1" },
            { type: "graveyard-card", id: "p1-graveyard-0", playerId: "p1" },
            { type: "graveyard-card", id: "p1-graveyard-1", playerId: "p1" },
            { type: "graveyard-card", id: "p1-graveyard-2", playerId: "p1" },
        ]);

        resolveTopOfStack(state);
        const p1 = state.players[0]!;
        // Three cards shuffled in, then one drawn: 2 + 3 - 1.
        expect(p1.library).toHaveLength(4);
        expect(p1.hand).toHaveLength(1);
        // The spell itself is the only card in the graveyard afterwards.
        expect(ids(p1.graveyard)).toEqual([SPELL]);
    });
});
