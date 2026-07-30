// Frontend routing seam for the Random Reveal coin flip (#301, CR 705 /
// ADR 0023). The pending-choice prompt routes `kind === "random-reveal"` to
// `RandomRevealOverlay` (an animation, NOT buttons). The overlay renders a
// viewer-relative label, the consequence preview, and — for the CHOOSER only —
// auto-acknowledges once when the animation completes (no button). The opponent
// watches the same outcome but never submits.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import type { Player, PendingChoice } from "~/types/game";

// --- Mutation capture ---
const submitRandomRevealAck = vi.fn(() => Promise.resolve());
const noop = vi.fn(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    submitRandomRevealAck,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        game: { submitRandomRevealAck: { _name: "submitRandomRevealAck" } },
    },
}));

// Mock the coin animation so the test controls when "landed" fires (jsdom does
// not run motion's onAnimationComplete). It exposes its props for assertion and
// invokes onLanded immediately on mount, simulating the spin finishing.
vi.mock("~/components/board/coin-flip-animation", () => ({
    __esModule: true,
    default: ({
        result,
        face,
        onLanded,
    }: {
        result: number;
        face: string;
        onLanded: () => void;
    }) => {
        onLanded();
        return (
            <div data-testid="coin-anim" data-result={result} data-face={face}>
                {face}
            </div>
        );
    },
}));

import RandomRevealOverlay from "~/components/board/random-reveal-overlay";

afterEach(cleanup);
beforeEach(() => submitRandomRevealAck.mockClear());

function player(id: string, name: string): Player {
    return {
        id,
        name,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as unknown as Player;
}

const WIN_CHOICE: PendingChoice = {
    stackItemId: "bottle",
    step: 0,
    choiceId: "bottle-of-suleiman-flip",
    playerId: "p1",
    kind: "random-reveal",
    count: 1,
    prompt: "Flip a coin",
    randomKind: "coin",
    sides: 2,
    result: 1,
    realized: { face: "WIN", consequence: "Create a 5/5 flying Djinn" },
};

const players = [player("p1", "Alice"), player("p2", "Bob")];

function renderOverlay(viewerId: string, choice = WIN_CHOICE) {
    const ctx = {
        gameId: "game-id",
        playerId: viewerId,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: players,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={ctx}>
            <RandomRevealOverlay
                choice={choice}
                playerId={viewerId}
                gameId={"game-id" as never}
            />
        </GameContext>
    );
}

describe("RandomRevealOverlay (#301)", () => {
    it("mounts the coin animation (not buttons) with the realized result/face", () => {
        const { getByTestId, queryByRole } = renderOverlay("p1");
        const anim = getByTestId("coin-anim");
        expect(anim.getAttribute("data-result")).toBe("1");
        expect(anim.getAttribute("data-face")).toBe("WIN");
        // No buttons — a coin flip has no decision (ADR 0023).
        expect(queryByRole("button")).toBeNull();
    });

    it("renders the consequence preview line", () => {
        const { getByText } = renderOverlay("p1");
        expect(getByText("Create a 5/5 flying Djinn")).toBeTruthy();
    });

    it("viewer-relative label: the chooser sees 'You win the flip'", () => {
        const { getByText } = renderOverlay("p1");
        expect(getByText("You win the flip")).toBeTruthy();
    });

    it("viewer-relative label: the opponent sees '{Name} wins the flip'", () => {
        const { getByText } = renderOverlay("p2");
        expect(getByText("Alice wins the flip")).toBeTruthy();
    });

    it("the chooser's client auto-acks exactly once on animation end (no button)", () => {
        renderOverlay("p1");
        expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
        expect(submitRandomRevealAck).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "p1",
            stackItemId: "bottle",
            choiceId: "bottle-of-suleiman-flip",
        });
    });

    it("the opponent watches but never submits", () => {
        renderOverlay("p2");
        expect(submitRandomRevealAck).not.toHaveBeenCalled();
    });

    it("LOSE: viewer-relative label and consequence", () => {
        const loseChoice: PendingChoice = {
            ...WIN_CHOICE,
            result: 0,
            realized: {
                face: "LOSE",
                consequence: "Bottle of Suleiman deals 5 damage to you",
            },
        };
        const { getByText } = renderOverlay("p1", loseChoice);
        expect(getByText("You lose the flip")).toBeTruthy();
        expect(
            getByText("Bottle of Suleiman deals 5 damage to you")
        ).toBeTruthy();
    });
});
