// Hand card busy state while a game intent is in flight (issue #9981).
//
// A click during an in-flight intent is refused by the commit guards
// (`hasPendingGameIntent()`); the card must SAY so (waiting cursor, dimmed
// image, aria-busy) instead of dropping the click silently. Driven through the
// REAL projection, the REAL hand card and the REAL pending-intent store.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    act,
    render,
    screen,
    cleanup,
    fireEvent,
} from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    resetPendingGameIntents,
    trackGameIntent,
} from "~/lib/pending-intent-store";
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

const plotCard = vi.fn().mockResolvedValue(undefined);
const announceCast = vi.fn();
const other = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "plotCard"
            ? plotCard
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
import { getCardByName } from "@convex/cards";
import { pillageTheBog } from "@convex/cards/sets/otj/multicolor.cards";

/** `me` holds `cardId` in their own precombat main with priority, an empty
 *  stack and the given lands; projected through the REAL wire reducer. */
function projected(cardId: string, landNames: string[]) {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: "plotter",
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
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("hand card busy state while an intent is in flight (issue #9981)", () => {
    const playable = () => projected(getCardByName("Island").id, []);

    it("is idle with nothing in flight", () => {
        renderCard(playable());
        expect(el().getAttribute("data-intent-pending")).toBeNull();
        expect(el().getAttribute("aria-busy")).toBeNull();
        expect(el().className).toContain("cursor-pointer");
    });

    it("shows a waiting affordance while an intent round-trips, and clears on settle", async () => {
        renderCard(playable());
        let settle!: () => void;
        const inFlight = new Promise<void>((r) => (settle = r));
        act(() => {
            void trackGameIntent(inFlight);
        });
        expect(el().getAttribute("data-intent-pending")).toBe("true");
        expect(el().getAttribute("aria-busy")).toBe("true");
        expect(el().className).toContain("cursor-progress");
        expect(el().className).not.toContain("cursor-pointer");
        expect(
            screen.getByTestId("card-image").parentElement!.className
        ).toContain("opacity-60");

        await act(async () => {
            settle();
            await inFlight;
        });
        expect(el().getAttribute("data-intent-pending")).toBeNull();
        expect(el().className).toContain("cursor-pointer");
    });

    const menuCard = () =>
        // Cast + Plot → two options → a click opens a menu when idle.
        projected(pillageTheBog().id, ["Swamp", "Forest", "Swamp"]);

    it("a menu card opens its menu when idle", () => {
        renderCard(menuCard());
        fireEvent.click(el());
        expect(screen.queryAllByRole("menuitem").length).toBe(2);
    });

    it("a menu card opens no menu onto refusing entries while busy", () => {
        renderCard(menuCard());
        act(() => {
            void trackGameIntent(new Promise<void>(() => {}));
        });
        fireEvent.click(el());
        expect(screen.queryAllByRole("menuitem")).toEqual([]);
    });
});
