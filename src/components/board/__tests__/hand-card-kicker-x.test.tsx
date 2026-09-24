// Frontend wiring for Kicker {X} (CR 107.3a / 601.2b, issue #2141).
//
// Verdeloth the Ancient's printed cost has no {X}, so the hand hook's `hasX`
// is false and the only source of the X stepper is the Kicker row itself: the
// `announcesX` flag `useHandCardCommit` derives from the definition. Drop that
// flag and the dialog kicks the spell with no X, which `announceCast` refuses
// ("Must choose X"). So this runs the REAL projection, the REAL definition and
// the REAL dialog, and asserts on what reaches the mutation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
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
// Inert visuals only — the card definition, the projection and the cost dialog
// are all the real thing.
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
import { verdelothTheAncient } from "@convex/cards/sets/inv/green";

/** Verdeloth in `me`'s hand in its own main phase, through the REAL wire
 *  projection; `allPlayers` is what the hook prices the Kicker rows from. */
function projectedVerdeloth() {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(verdelothTheAncient.id, {
                        id: "verdeloth1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 9, C: 0 },
            }),
            makePlayer("them"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const projected = projectPublicState(state, 1, "me");
    return {
        card: projected.players[0].hand[0] as unknown as CardInstance,
        allPlayers: projected.players,
    };
}

function renderCard(card: CardInstance, allPlayers: unknown) {
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
                <BoardHandCard card={card} />
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

describe("cast-cost dialog for a Kicker {X} on a card with no printed X (issue #2141)", () => {
    it("asks X only once the Kicker is toggled on, and sends it with the kick", () => {
        const { card, allPlayers } = projectedVerdeloth();
        expect(card.legalActions).toContain("cast");
        renderCard(card, allPlayers);
        fireEvent.click(el());

        expect(announceCast).not.toHaveBeenCalled();
        expect(screen.queryByLabelText("Choose X")).toBeNull();
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.change(screen.getByLabelText("Choose X"), {
            target: { value: "3" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "verdeloth1",
            chosenX: 3,
            kickerPayments: { kicker: 1 },
        });
    });

    it("an unkicked cast announces no X", () => {
        const { card, allPlayers } = projectedVerdeloth();
        renderCard(card, allPlayers);
        fireEvent.click(el());
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));

        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0].chosenX).toBeUndefined();
        expect(announceCast.mock.calls[0][0].kickerPayments).toBeUndefined();
    });
});
