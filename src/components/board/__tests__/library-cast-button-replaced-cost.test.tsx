// CR 107.3b / 601.2b (issue #2398 review round 1, findings 1 + 3) — the two
// announcement choices that are ILLEGAL on a cast off the top of the library
// whose mana cost the permission REPLACED (Bolas's Citadel) must not be
// OFFERED, not merely rejected by the mutation.
//
// Both were reachable from a legal click before this fix: with Gush on top the
// alternative-cost picker rendered "Return two Islands" and selecting it threw
// out of `announceCast` (CR 601.2b — a player can't apply two alternative
// methods of casting to one spell); with Fireball on top the cost dialog
// offered an X stepper and announcing X = 5 SUCCEEDED for zero mana and one
// life (CR 107.3b — the only legal choice for X is 0).
//
// This drives the REAL `LibraryCastButton` → `useHandCardCommit` path with the
// REAL card registry and the REAL `affordableAltCostsForCard`, so the board
// (two untapped Islands, Gush's cast condition satisfied) is what makes the
// picker offerable — the same construction the reviewer used to reach the
// throw. Only the Convex mutation binding is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { gush } from "@convex/cards/sets/mmq/blue.cards";
import { fireball } from "@convex/cards/sets/lea/red.cards";
import { island } from "@convex/cards/sets/lea/colorless.cards";
import { getCardByName } from "@convex/cards";
import { withTemporaryDefinition } from "@convex/cards/registry";
import {
    BRAZEN_BORROWER,
    INSTANTS_AND_SORCERIES,
    withDefs,
} from "@convex/gre/__tests__/libraryTopCastFilter.fixture";
import { adventureCastAltCostId } from "@convex/gre/adventure";
import type { CardDefinition } from "@convex/cards/types";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));

import LibraryCastButton from "../library-cast-button";

/** The viewer's own library top, as `projectPublicState` hands it to
 *  `renderCardAction`. `castManaCostReplaced` is the server-authoritative flag
 *  under test; `undefined` models the pre-fix wire (and a permission with no
 *  `manaCostReplacement`, Vizier of the Menagerie's shape). */
function topCard(cardId: string, replaced: boolean): CardInstance {
    return {
        id: "top",
        card: { id: cardId },
        controllerId: "me",
        ownerId: "me",
        zone: "library",
        isTapped: false,
        legalActions: ["cast"],
        ...(replaced ? { castManaCostReplaced: true as const } : {}),
    } as CardInstance;
}

/** Two untapped Islands under the viewer — enough for Gush's "return two
 *  Islands" alternative cost to be genuinely affordable, so the picker is
 *  suppressed by the CR 601.2b gate and by nothing else. */
/** Vizier of the Menagerie's shape (CR 601.3): a cast-from-top permission
 *  with NO mana-cost replacement, so each announcement pays its own cost and
 *  the alternative-cost rows stay legal. The real projection never shows a
 *  castable top card without the permanent that grants it, and the picker
 *  asks that grant per row (CR 601.3e, issue #7526). */
const PRINTED_COST_PERMISSION: CardDefinition = {
    ...getCardByName("Bolas's Citadel"),
    id: "test-printed-cost-library-permission",
    name: "Test Printed-Cost Permission",
    castsSpellsFromTopOfLibrary: {},
};

function players(permission?: CardDefinition): Player[] {
    return [
        {
            id: "me",
            name: "me",
            life: 20,
            battlefield: [
                ...(permission
                    ? [
                          {
                              id: "permission",
                              card: { id: permission.id },
                              controllerId: "me",
                              ownerId: "me",
                              zone: "battlefield",
                              isTapped: false,
                              types: [...permission.types],
                              subtypes: [],
                          },
                      ]
                    : []),
                {
                    id: "isl-1",
                    card: { id: island().id },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "battlefield",
                    isTapped: false,
                    types: ["Land"],
                    subtypes: ["Island"],
                },
                {
                    id: "isl-2",
                    card: { id: island().id },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "battlefield",
                    isTapped: false,
                    types: ["Land"],
                    subtypes: ["Island"],
                },
            ],
            hand: [],
            graveyard: [],
            exile: [],
            library: { count: 1, known: [] },
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        },
    ] as unknown as Player[];
}

function renderButton(card: CardInstance, allPlayers: Player[] = players()) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <LibraryCastButton card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("library-top cast with a REPLACED mana cost — illegal announcement choices are not offered", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("CR 601.2b — Gush on top under a Citadel: no alternative-cost picker, the cast dispatches straight away", () => {
        renderButton(topCard(gush().id, true));
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));

        expect(screen.queryByText("Pay mana cost")).toBeNull();
        expect(screen.queryByText(/Return two Islands/)).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "top",
            alternativeCostId: undefined,
        });
    });

    it("the SAME board still offers the picker without the flag — the gate is the replacement, not the zone", () => {
        withTemporaryDefinition(PRINTED_COST_PERMISSION, () => {
            renderButton(
                topCard(gush().id, false),
                players(PRINTED_COST_PERMISSION)
            );
            fireEvent.click(screen.getByRole("button", { name: "Cast" }));

            expect(screen.getByText(/Return two Islands/)).toBeTruthy();
            expect(announceCast).not.toHaveBeenCalled();
        });
    });

    it("CR 601.3e (issue #7526) — the flag does not hide an Adventure a NON-replacing grant licenses", () => {
        withDefs(() => {
            // Brazen Borrower rides Bolas's Citadel (flag set); Petty Theft
            // rides the instant-and-sorcery grant scanned first, which keeps
            // the mana cost — a legal announcement the picker must offer.
            const citadel = getCardByName("Bolas's Citadel");
            const board = players(INSTANTS_AND_SORCERIES);
            board[0].battlefield.push({
                ...board[0].battlefield[0],
                id: "citadel",
                card: { id: citadel.id },
            });
            renderButton(topCard(BRAZEN_BORROWER.id, true), board);
            fireEvent.click(screen.getByRole("button", { name: "Cast" }));

            fireEvent.click(screen.getByText(/Petty Theft/));
            expect(announceCast).toHaveBeenCalledTimes(1);
            expect(announceCast.mock.calls[0][0]).toMatchObject({
                cardInstanceId: "top",
                alternativeCostId: adventureCastAltCostId(BRAZEN_BORROWER),
            });
        });
    });

    it("CR 107.3b — Fireball on top under a Citadel: no X stepper, the cast dispatches with no chosenX", () => {
        renderButton(topCard(fireball().id, true));
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));

        expect(screen.queryByLabelText("Choose X")).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "top",
            chosenX: undefined,
        });
    });

    it("the SAME card still opens the X dialog without the flag", () => {
        renderButton(topCard(fireball().id, false));
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));

        expect(screen.getByLabelText("Choose X")).toBeTruthy();
        expect(announceCast).not.toHaveBeenCalled();
    });
});
