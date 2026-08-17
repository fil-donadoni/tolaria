// Frontend wiring for the CR 601.3c conditional-flash surcharge (issue #2146).
//
// The trap this file exists for: the cast-cost dialog is gated on
// `hasX || offeredKickers.length > 0 || def.buyback` (useHandCardCommit), and
// FOUR of the five Invasion cards carrying the rider — Rout, Breaking Wave,
// Twilight's Call, Saproling Symbiosis — have no X, no kicker and no buyback.
// A server-side-only fix therefore ships an unreachable affordance: the caster
// clicks the card, `announceCast` fires, and {2} extra mana is charged with no
// warning anywhere in the UI.
//
// So the assertion runs through the REAL reducer, not a hand-built view: the
// card handed to `<BoardHandCard>` is the one `projectPublicState` produces
// from a real `GameState`, carrying whatever `flashSurchargeRequired` the
// projection chose to attach (a hand-built card would mask a dropped field —
// the exact shape the frontend-wiring rule forbids). `@convex/cards` is NOT
// mocked either, so `getDefinition` returns the real Rout definition and the
// dialog quotes the real declared cost.
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
import { rout } from "@convex/cards/sets/inv/white";
import type { GameState } from "@convex/gre/state";

/** Rout in `me`'s hand with the mana to cast it, at the given timing frame,
 *  run through the REAL wire projection. */
function projectedRout(overrides: Partial<GameState>): CardInstance {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(rout.id, {
                        id: "rout1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                manaPool: { W: 7, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("them"),
        ],
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    });
    const projected = projectPublicState(state, 1, "me");
    return projected.players[0].hand[0] as unknown as CardInstance;
}

function renderCard(card: CardInstance) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "them",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
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

describe("cast-cost dialog gate for a card whose ONLY cost decision is the CR 601.3c surcharge", () => {
    it("opens the dialog with the surcharge notice, and dispatches the acknowledgement only after Cast", () => {
        // Opponent's turn, `me` holds priority: Rout is announceable only under
        // the CR 601.3c permission, so the surcharge is owed.
        const card = projectedRout({
            activePlayerId: "them",
            priorityPlayerId: "me",
        });
        // The affordance the client renders from — attached by the real
        // projection, not by this test.
        expect(card.flashSurchargeRequired).toBe(true);
        expect(card.legalActions).toContain("cast");

        renderCard(card);
        fireEvent.click(el());

        // Nothing dispatched yet: the click opened the dialog instead of
        // silently surcharging the caster.
        expect(announceCast).not.toHaveBeenCalled();
        const notice = screen.getByTestId("cast-cost-flash-surcharge");
        expect(notice.textContent).toContain("2");

        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "rout1",
            payFlashSurcharge: true,
        });
    });

    it("skips the dialog entirely inside the caster's own sorcery window — no pointless {2} is offered", () => {
        const card = projectedRout({
            activePlayerId: "me",
            priorityPlayerId: "me",
        });
        expect(card.flashSurchargeRequired).toBeUndefined();

        renderCard(card);
        fireEvent.click(el());

        expect(screen.queryByTestId("cast-cost-flash-surcharge")).toBeNull();
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0].payFlashSurcharge).toBeUndefined();
    });
});
