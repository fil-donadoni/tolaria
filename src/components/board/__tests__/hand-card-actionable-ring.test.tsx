// Issue #6917 — a hand card rings `actionable` exactly when its click opens an
// enabled option, in a plain Priority window only. Same predicate drives both.
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
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
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
import { mockInstanceManaCost } from "~/lib/testing/convex-cards-mock";
const cardDef = { name: "Test Card" };
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: never) => mockInstanceManaCost(c, () => cardDef),
    getDefinition: () => cardDef,
    tryGetDefinition: () => cardDef,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHandCard from "../gre-hand-card";

function makeCard(legalActions: CardInstance["legalActions"]): CardInstance {
    return {
        id: "c1",
        card: { id: "def-c1" },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        legalActions,
    };
}

function renderCard(card: CardInstance, ctx: Record<string, unknown> = {}) {
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
        allPlayers: [
            { id: "me", battlefield: [], hand: [] },
            { id: "opp", battlefield: [], hand: [] },
        ],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        ...ctx,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const ring = () => screen.getByTestId("card-image").parentElement!;
const root = () =>
    screen.getByTestId("card-image").closest("[data-board-hand-card]")!;

beforeEach(() => {
    cleanup();
    playCard.mockClear();
    announceCast.mockClear();
    resetPendingGameIntents();
});

describe("hand card `actionable` ring (issue #6917)", () => {
    it("an affordable card is ringed, pointer-cursored and clickable", () => {
        renderCard(makeCard(["cast"]));
        expect(ring().className).toContain("card-ring-actionable");
        expect(root().className).toContain("cursor-pointer");
        fireEvent.click(root());
        expect(announceCast).toHaveBeenCalledTimes(1);
    });

    it("the same card made unaffordable is neither ringed nor clickable", () => {
        renderCard(makeCard([]));
        expect(ring().className).not.toContain("card-ring-actionable");
        expect(root().className).not.toContain("cursor-pointer");
        fireEvent.click(root());
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });

    it("a land play rings", () => {
        renderCard(makeCard(["play"]));
        expect(ring().className).toContain("card-ring-actionable");
    });

    it("no ring while the opponent holds Priority", () => {
        renderCard(makeCard(["cast"]), { priorityPlayerId: "opp" });
        expect(ring().className).not.toContain("card-ring-actionable");
        expect(root().className).not.toContain("cursor-pointer");
    });

    it("no ring during a pending cast", () => {
        renderCard(makeCard(["cast"]), {
            pendingCast: { playerId: "me", cardInstanceId: "other" },
        });
        expect(ring().className).not.toContain("card-ring-actionable");
    });
});
