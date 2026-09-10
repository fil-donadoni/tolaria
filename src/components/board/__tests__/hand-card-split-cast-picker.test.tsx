// Frontend wiring for a SPLIT card's cast (CR 709.3, ADR 0121).
//
// The trap: `useHandCardCommit` decides the picker's rows from ONE server
// flag, `printedCostCastUnavailable`, and when it is set it filtered the
// remaining options down to "the board permission's own" (CR 118.9b). A split
// card sets the same flag for an unrelated reason — CR 709.3 has the half
// chosen before the card is put onto the stack, so there is no printed cast —
// and that filter would have dropped BOTH half rows, leaving a card the
// server says is castable with no affordance able to cast it.
//
// A test on `affordableAltCostsForCard` alone is blind to that: it calls the
// helper, not the gate that filters its result. So this one goes through the
// REAL hook, the REAL projection and the REAL picker, and asserts on what
// `announceCast` receives.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};

const playCard = vi.fn();
const announceCast = vi.fn();
const activateAbility = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard"
            ? playCard
            : ref._name === "activateAbility"
              ? activateAbility
              : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
        },
    },
}));
// Inert visuals only — definition, projection and picker are all the real thing.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHandCard from "../board-hand-card";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { standDeliver } from "@convex/cards/sets/inv/multicolor";
import { hillGiant } from "@convex/cards/sets/lea/red";
import { plains, island } from "@convex/cards/sets/lea/colorless";
import { splitCastAltCostId } from "@convex/gre/splitCast";

const LEFT_ALT = splitCastAltCostId(standDeliver, "left");
const RIGHT_ALT = splitCastAltCostId(standDeliver, "right");

/** `me` holds Stand // Deliver with one Plains and three Islands in their own
 *  main phase — enough for EITHER half, so the two rows are a genuine choice.
 *  `them` has a Hill Giant, a legal target for both halves. Run through the
 *  REAL wire projection. */
function projected() {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(standDeliver.id, {
                        id: "split1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(plains.id, {
                        id: "plains-0",
                        controllerId: "me",
                        ownerId: "me",
                    }),
                    ...Array.from({ length: 3 }, (_, i) =>
                        makeInstance(island.id, {
                            id: `island-${i}`,
                            controllerId: "me",
                            ownerId: "me",
                        })
                    ),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("them", {
                battlefield: [
                    makeInstance(hillGiant.id, {
                        id: "giant",
                        controllerId: "them",
                        ownerId: "them",
                    }),
                ],
            }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const view = projectPublicState(state, 1, "me") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    return {
        card: view.players[0].hand[0] as unknown as CardInstance,
        allPlayers: view.players,
        activePlayerId: view.activePlayerId,
    };
}

function renderCard(p: ReturnType<typeof projected>) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: p.activePlayerId,
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: p.allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={p.card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const el = () =>
    screen.getByTestId("card-image").closest("[data-board-hand-card]")!;

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("cast-option picker for a split card (CR 709.3, ADR 0121)", () => {
    it("offers BOTH halves and no 'Pay mana cost' row", () => {
        const p = projected();
        expect(p.card.legalActions).toContain("cast");
        // The server said so — the client re-derives no cast timing (ADR 0074).
        expect(p.card.printedCostCastUnavailable).toBe(true);

        renderCard(p);
        fireEvent.click(el());

        // CR 709.3 — the combined {2}{W}{U} is a characteristic in a zone,
        // never a price, so the row that would pay it must not exist.
        expect(
            screen.queryByRole("button", { name: "Pay mana cost" })
        ).toBeNull();
        // …and BOTH halves are offered. The flag that removed the printed row
        // must not also remove these: it is set here for CR 709.3's reason,
        // not CR 118.9b's.
        const rows = screen.getAllByRole("button", {
            name: (accessibleName: string) =>
                accessibleName.startsWith("Cast Stand") ||
                accessibleName.startsWith("Cast Deliver"),
        });
        expect(rows).toHaveLength(2);
        // Nothing is dispatched until a half is picked — two options is a
        // real choice, so the picker opens rather than auto-committing.
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("picking a half sends THAT half's alternativeCostId", () => {
        const p = projected();
        renderCard(p);
        fireEvent.click(el());

        fireEvent.click(
            screen.getByRole("button", {
                name: (accessibleName: string) =>
                    accessibleName.startsWith("Cast Deliver"),
            })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "split1",
            alternativeCostId: RIGHT_ALT,
        });
        // The discriminating half of the pair: the OTHER id is not what a
        // click on "Cast Deliver" sends.
        expect(announceCast.mock.calls[0][0].alternativeCostId).not.toBe(
            LEFT_ALT
        );
    });
});
