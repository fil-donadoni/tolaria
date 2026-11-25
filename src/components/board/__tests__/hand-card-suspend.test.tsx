// Frontend wiring for the SUSPEND special action on a hand card (CR 116.2f /
// 702.62a, issue #10495).
//
// Suspend is not a cast: it reaches the server through its own `suspendCard`
// mutation, offered from the projection's `canSuspend`. A card that can be
// both cast and suspended routes through the menu that names each; a card that
// can ONLY be suspended takes the suspend on a plain click. Driven through the
// REAL projection, the REAL hand card and the REAL menu, asserting on what the
// mutations receive.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    within,
} from "@testing-library/react";
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

const suspendCard = vi.fn().mockResolvedValue(undefined);
const announceCast = vi.fn();
const other = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "suspendCard"
            ? suspendCard
            : ref._name === "announceCast"
              ? announceCast
              : other,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
            activateManaAbility: { _name: "activateManaAbility" },
            plotCard: { _name: "plotCard" },
            foretellCard: { _name: "foretellCard" },
            suspendCard: { _name: "suspendCard" },
        },
    },
}));
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
import { getCardByName, registerTokenDefinition } from "@convex/cards";

/** Suspend 1—{R} on a {2}{R} sorcery, and on a {5}{R} one whose cast one
 *  Mountain can never pay. Test-only definitions. */
const CHEAP = "test-hand-suspend-cheap";
const DEAR = "test-hand-suspend-dear";
for (const [id, generic] of [
    [CHEAP, 2],
    [DEAR, 5],
] as const) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { X: generic, R: 1 },
        types: ["Sorcery"],
        staticAbilities: ["suspend 1"],
        suspend: { R: 1 },
        effects: [{ op: "gainLife", player: "controller", amount: 3 }],
    });
}

/** `me` holds `cardId` in their own precombat main with priority, an empty
 *  stack and the given lands; projected through the REAL wire reducer. */
function projected(cardId: string, landNames: string[]) {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: "suspender",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: landNames.map((name, i) =>
                    makeInstance(getCardByName(name).id, {
                        id: `land-${i}`,
                        controllerId: "me",
                        ownerId: "me",
                    })
                ),
            }),
            makePlayer("them"),
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
    suspendCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("the suspend special action on a hand card (CR 702.62a)", () => {
    it("a castable AND suspendable card opens a menu naming both; Suspend sends suspendCard", () => {
        const p = projected(CHEAP, ["Mountain", "Mountain", "Mountain"]);
        expect(p.card.canSuspend).toBe(true);
        expect(p.card.legalActions).toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        const items = within(document.body).getAllByRole("menuitem");
        expect(items.map((i) => i.textContent)).toEqual(["Cast", "Suspend"]);
        expect(suspendCard).not.toHaveBeenCalled();

        fireEvent.click(items[1]);
        expect(suspendCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "suspender",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a card that can ONLY be suspended takes the suspend on a plain click", () => {
        const p = projected(DEAR, ["Mountain"]);
        expect(p.card.canSuspend).toBe(true);
        expect(p.card.legalActions ?? []).not.toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(suspendCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "suspender",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("offers no Suspend entry when suspending is not legal", () => {
        // No land at all: nothing is payable, and nothing is offered.
        const p = projected(DEAR, []);
        expect(p.card.canSuspend).toBeUndefined();
        renderCard(p);
        fireEvent.click(el());
        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(suspendCard).not.toHaveBeenCalled();
    });
});
