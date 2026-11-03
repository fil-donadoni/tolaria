// CR 601.2b / 715.3b (issue #7570) — the Adventure under a library-top permission
// that replaces the mana cost (Bolas's Citadel). The official ruling (Gatherer,
// 2019-10-04): "Casting a card as an Adventure isn't casting it for an
// alternative cost. Effects that allow you to cast a spell for an alternative
// cost or without paying its mana cost may allow you to apply those to the
// Adventure."
//
// Brazen Borrower is {1}{U}{U}, mana value 3; Petty Theft is {1}{U}, mana value
// 2 (CR 715.3b: "while on the stack as an Adventure, the spell has only its
// alternative characteristics"). A morph cast stays refused: CR 702.37c, "this
// follows the rules for paying alternative costs".

import { describe, expect, it } from "vitest";
import { announceCast, selectTargets } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { getCardByName } from "../../cards";
import { adventureCastAltCostId, adventureCastOptionFor } from "../adventure";
import { castAlternativeCostForZone } from "../castCost";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import {
    getLegalActions,
    libraryTopAnnouncementChoices,
    libraryTopAnnouncementLicensed,
    libraryTopCastLifeCost,
    libraryTopReplacementChoices,
} from "../rules";
import type { GameState } from "../state";
import {
    BRAZEN_BORROWER,
    CITADEL,
    EXALTED_ANGEL,
    INSTANTS_AND_SORCERIES,
    board,
    withDefs,
    withDefsAsync,
} from "./libraryTopCastFilter.fixture";

const PETTY_THEFT = adventureCastAltCostId(BRAZEN_BORROWER);
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

type AnnounceArgs = typeof BASE & {
    cardInstanceId: string;
    alternativeCostId?: string;
    declineManaCostReplacement?: boolean;
};

const announce = (
    harness: ReturnType<typeof makeMutationCtx>,
    args: { alternativeCostId?: string; declineManaCostReplacement?: boolean }
) =>
    runMutation<AnnounceArgs, void>(
        announceCast as unknown as Handler<AnnounceArgs, void>,
        harness.ctx,
        { ...BASE, cardInstanceId: "top", ...args }
    );

const pickGiant = (harness: ReturnType<typeof makeMutationCtx>) =>
    runMutation<Record<string, unknown>, void>(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: [{ targetType: "permanent", targetId: "giant" }] }
    );

const citadelBoard = (life = 20) => {
    const state = board([CITADEL.id], BRAZEN_BORROWER.id);
    state.players[0].life = life;
    return state;
};

const topWire = (state: GameState) =>
    projectPublicState(state, 1, "p1").players.find((p) => p.id === "p1")!
        .library.known[0]?.card;

const tappedLands = (state: GameState) =>
    state.players[0].battlefield.filter(
        (c) => c.id.startsWith("land-") && c.isTapped
    ).length;

describe("CR 601.2b — the Adventure may ride a permission that replaces the mana cost (issue #7570)", () => {
    it("Bolas's Citadel licenses Petty Theft for its own mana value, and the printed cast for 3", () => {
        withDefs(() => {
            const state = citadelBoard();
            const p1 = state.players[0];
            const top = p1.library[0];
            expect(
                libraryTopAnnouncementLicensed(state, p1, top, PETTY_THEFT)
            ).toBe(true);
            expect(libraryTopCastLifeCost(state, p1, top, PETTY_THEFT)).toBe(2);
            expect(libraryTopCastLifeCost(state, p1, top)).toBe(3);
        });
    });

    it("its {1}{U} is not charged on top of the life; under a keeping grant it still is", () => {
        withDefs(() => {
            const replaced = citadelBoard();
            const option = adventureCastOptionFor(
                replaced.players[0].library[0]
            );
            expect(
                castAlternativeCostForZone(
                    replaced,
                    replaced.players[0].library[0],
                    "library",
                    PETTY_THEFT,
                    option
                )?.mana
            ).toEqual({});

            const kept = board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id);
            expect(
                castAlternativeCostForZone(
                    kept,
                    kept.players[0].library[0],
                    "library",
                    PETTY_THEFT,
                    option
                )
            ).toBe(option);
        });
    });

    it("a morph cast stays refused under the Citadel (CR 702.37c)", () => {
        withDefs(() => {
            const state = board([CITADEL.id], EXALTED_ANGEL.id);
            const p1 = state.players[0];
            expect(
                libraryTopAnnouncementLicensed(
                    state,
                    p1,
                    p1.library[0],
                    MORPH_CAST_ALT_COST_ID
                )
            ).toBe(false);
        });
    });

    it("announceCast commits Petty Theft for 2 life and no mana", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(citadelBoard()),
            ]);
            await announce(harness, { alternativeCostId: PETTY_THEFT });
            await pickGiant(harness);
            const after = harness.state();
            expect(after.players[0].life).toBe(18);
            expect(tappedLands(after)).toBe(0);
            expect(after.pendingCast).toBeUndefined();
            expect(after.stack.map((s) => s.adventureOf)).toEqual([
                BRAZEN_BORROWER.id,
            ]);
        });
    });

    it("an UNTARGETED Adventure commits on announceCast's own path, for its life and no mana", async () => {
        await withDefsAsync(async () => {
            // Flameshape ({1}{R}) never reaches `selectTargets`: this is the
            // second of the two commit sites.
            const gandalf = getCardByName("Gandalf, Goblins' Bane");
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board([CITADEL.id], gandalf.id)),
            ]);
            await announce(harness, {
                alternativeCostId: adventureCastAltCostId(gandalf),
            });
            const after = harness.state();
            expect(after.players[0].life).toBe(18);
            expect(tappedLands(after)).toBe(0);
            expect(after.pendingCast).toBeUndefined();
            expect(after.stack.map((s) => s.adventureOf)).toEqual([gandalf.id]);
        });
    });

    it("announceCast commits the printed Brazen Borrower for 3 life", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(citadelBoard()),
            ]);
            await announce(harness, {});
            expect(harness.state().players[0].life).toBe(17);
            expect(tappedLands(harness.state())).toBe(0);
        });
    });

    it("the morph announcement is refused by announceCast", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board([CITADEL.id], EXALTED_ANGEL.id)),
            ]);
            await expect(
                announce(harness, { alternativeCostId: MORPH_CAST_ALT_COST_ID })
            ).rejects.toThrow();
        });
    });
});

describe("CR 119.4 — the life gate is per announcement (issue #7570)", () => {
    it("at 2 life Petty Theft is castable and Brazen Borrower is not, on every surface", async () => {
        await withDefsAsync(async () => {
            const state = citadelBoard(2);
            const p1 = state.players[0];
            const top = p1.library[0];
            expect(getLegalActions(state, p1, top)).toContain("cast");
            expect(
                libraryTopAnnouncementChoices(state, p1, top, PETTY_THEFT)
            ).toEqual([undefined]);
            expect(
                libraryTopAnnouncementChoices(state, p1, top, undefined)
            ).toEqual([]);
            // WIRE — the picker loses the printed row.
            expect(topWire(state)?.printedCostCastUnavailable).toBe(true);

            const refused = makeMutationCtx("p1", [
                gameStateSeed(citadelBoard(2)),
            ]);
            await expect(announce(refused, {})).rejects.toThrow();

            const accepted = makeMutationCtx("p1", [
                gameStateSeed(citadelBoard(2)),
            ]);
            await announce(accepted, { alternativeCostId: PETTY_THEFT });
            await pickGiant(accepted);
            expect(accepted.state().players[0].life).toBe(0);
        });
    });

    it("at 1 life neither is castable", () => {
        withDefs(() => {
            const state = citadelBoard(1);
            const p1 = state.players[0];
            expect(getLegalActions(state, p1, p1.library[0])).not.toContain(
                "cast"
            );
        });
    });
});

describe("CR 601.2b / 118.9 — beside a grant keeping the cost, the Adventure's payment is the caster's (issue #7570)", () => {
    const both = () =>
        board([INSTANTS_AND_SORCERIES.id, CITADEL.id], BRAZEN_BORROWER.id);

    it("Petty Theft may pay life or mana; the printed creature only life", () => {
        withDefs(() => {
            const state = both();
            const p1 = state.players[0];
            const top = p1.library[0];
            expect(
                libraryTopReplacementChoices(state, p1, top, PETTY_THEFT)
            ).toEqual([undefined, true]);
            expect(
                libraryTopReplacementChoices(state, p1, top, undefined)
            ).toEqual([undefined]);
            // WIRE — the flag is about the printed cast, so no printed "pay
            // mana" row is offered for a creature no keeping grant covers.
            expect(
                topWire(state)?.castManaCostReplacementDeclinable
            ).toBeUndefined();
        });
    });

    it("declining pays the Adventure's own {1}{U} and no life", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [gameStateSeed(both())]);
            await announce(harness, {
                alternativeCostId: PETTY_THEFT,
                declineManaCostReplacement: true,
            });
            await pickGiant(harness);
            const after = harness.state();
            expect(after.players[0].life).toBe(20);
            expect(after.pendingCast).toMatchObject({
                manaCost: { X: 1, U: 1 },
            });
        });
    });
});
