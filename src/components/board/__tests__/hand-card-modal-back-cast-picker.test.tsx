// Frontend wiring for a modal double-faced card's BACK-face cast (CR 712.11b,
// issue #7200).
//
// The back face is offered through the same cast-option list the split half
// and the Adventure ride (`independentCastOptionsFor` → the alt-cost picker),
// so nothing in `src/` names it — which is exactly why it owes a test through
// the REAL projection, the REAL hook and the REAL picker: a seam that dropped
// the option anywhere between the GRE and `announceCast` would leave a card
// whose back face the server can cast and the player cannot reach.
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
            activateManaAbility: { _name: "activateManaAbility" },
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
} from "@convex/cards/__tests__/setup.helper";
import { forest, plains } from "@convex/cards/sets/lea/colorless.cards";
import { modalBackCastAltCostId } from "@convex/gre/modalBackCast";
import {
    MODAL_CREATURE_BACK_PROBE_ID,
    modalCreatureBackProbe,
} from "@convex/gre/__tests__/fixtures/modalBackProbe.fixture";

/** `me` holds the creature-back probe ({W} 1/1 // {2}{G} 4/4) with a Plains
 *  and three Forests — enough for EITHER face, so the picker's rows are a
 *  genuine choice. Run through the REAL wire projection. */
function projected() {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(MODAL_CREATURE_BACK_PROBE_ID, {
                        id: "mdfc1",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: [
                    makeInstance(plains().id, {
                        id: "plains-0",
                        controllerId: "me",
                        ownerId: "me",
                    }),
                    ...Array.from({ length: 3 }, (_, i) =>
                        makeInstance(forest().id, {
                            id: `forest-${i}`,
                            controllerId: "me",
                            ownerId: "me",
                        })
                    ),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("them", {}),
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

describe("cast-option picker for a modal double-faced card (CR 712.11b)", () => {
    it("offers the front face's printed cost AND the back face", () => {
        const p = projected();
        expect(p.card.legalActions).toContain("cast");
        // CR 712.11 — the front face is the default cast, so its row stays.
        expect(p.card.printedCostCastUnavailable).not.toBe(true);

        renderCard(p);
        fireEvent.click(el());

        expect(
            screen.getByRole("button", { name: "Pay mana cost" })
        ).toBeTruthy();
        expect(
            screen.getByRole("button", {
                name: (accessibleName: string) =>
                    accessibleName.startsWith("Cast Modal Probe Behemoth"),
            })
        ).toBeTruthy();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("picking the back face sends ITS alternativeCostId", () => {
        const p = projected();
        renderCard(p);
        fireEvent.click(el());

        fireEvent.click(
            screen.getByRole("button", {
                name: (accessibleName: string) =>
                    accessibleName.startsWith("Cast Modal Probe Behemoth"),
            })
        );
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "mdfc1",
            alternativeCostId: modalBackCastAltCostId(modalCreatureBackProbe),
        });
    });
});
