// Frontend routing seam for the Random Reveal coin flip (#301, CR 705 /
// ADR 0023). The pending-choice prompt routes `kind === "random-reveal"` to
// `RandomRevealOverlay` (an animation, NOT buttons). The overlay renders a
// viewer-relative label, the consequence preview, and — for the CHOOSER only —
// auto-acknowledges once when the animation completes (no button). The opponent
// watches the same outcome but never submits.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import type { Player, PendingChoice } from "~/types/game";

// --- Mutation capture ---
let autoLand = true;
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
// not run motion's lifecycle). It exposes its props and invokes onLanded on mount
// or as soon as `skipped` flips, simulating the toss finishing.
vi.mock("~/components/board/coin-flip-animation", async () => {
    const React = await import("react");
    return {
        __esModule: true,
        default: function MockCoinFlipAnimation({
            face,
            tone,
            caption,
            skipped,
            onLanded,
        }: {
            face: string;
            tone: string;
            caption: string;
            skipped?: boolean;
            onLanded: () => void;
        }) {
            React.useEffect(() => {
                if (autoLand || skipped) onLanded();
            }, [skipped, onLanded]);
            return (
                <div
                    data-testid="coin-anim"
                    data-face={face}
                    data-tone={tone}
                    data-skipped={String(!!skipped)}
                >
                    {caption}
                </div>
            );
        },
    };
});

import { REVEAL_FINAL_HOLD_MS } from "~/lib/random-reveal-pacing";
import RandomRevealOverlay from "~/components/board/random-reveal-overlay";

afterEach(cleanup);
beforeEach(() => {
    autoLand = true;
    submitRandomRevealAck.mockClear();
});

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
    flips: [{ flipperId: "p1", face: "heads", outcome: "win", round: 0 }],
    source: { cardId: "Mana Crypt", controllerId: "p1" },
    oracleExcerpt:
        "Flip a coin. If you lose the flip, Mana Crypt deals 3 damage to you.",
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
        stackItems: [],
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
        expect(anim.getAttribute("data-face")).toBe("heads");
        expect(anim.getAttribute("data-tone")).toBe("good");
        // No buttons — a coin flip has no decision (ADR 0023).
        expect(queryByRole("button")).toBeNull();
    });

    it("a reveal saved before the flip list existed still lands on its result", () => {
        const { getByTestId, getByText } = renderOverlay("p1", {
            ...WIN_CHOICE,
            flips: undefined,
            result: 1,
        });
        expect(getByTestId("coin-anim").getAttribute("data-face")).toBe(
            "heads"
        );
        expect(getByText("You win the flip")).toBeTruthy();
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

    it("the chooser acks once, only after the final hold — the result stays on screen", () => {
        vi.useFakeTimers();
        try {
            const { getByTestId } = renderOverlay("p1");
            expect(getByTestId("coin-anim").textContent).toBe(
                "You win the flip"
            );
            act(() => {
                vi.advanceTimersByTime(REVEAL_FINAL_HOLD_MS - 1);
            });
            expect(submitRandomRevealAck).not.toHaveBeenCalled();
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
            expect(submitRandomRevealAck).toHaveBeenCalledWith({
                gameId: "game-id",
                playerId: "p1",
                stackItemId: "bottle",
                choiceId: "bottle-of-suleiman-flip",
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("the opponent watches but never submits", () => {
        renderOverlay("p2");
        expect(submitRandomRevealAck).not.toHaveBeenCalled();
    });

    it("LOSE: viewer-relative label and consequence", () => {
        const loseChoice: PendingChoice = {
            ...WIN_CHOICE,
            flips: [
                { flipperId: "p1", face: "tails", outcome: "lose", round: 0 },
            ],
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

    it("source row shows name, kind, controller chip and the Oracle excerpt", () => {
        const { getByTestId, getByText } = renderOverlay("p1");
        const row = getByTestId("reveal-source-row");
        expect(row.textContent).toContain("Mana Crypt");
        expect(getByTestId("reveal-source-kind").textContent).toBe(
            "TRIGGERED ABILITY"
        );
        expect(getByText("Alice")).toBeTruthy();
        expect(getByTestId("reveal-source-excerpt").textContent).toContain(
            "If you lose the flip"
        );
    });

    it("source row names the other controller for a Bot-controlled copy", () => {
        const { getByTestId } = renderOverlay("p1", {
            ...WIN_CHOICE,
            playerId: "p2",
            flips: [
                { flipperId: "p2", face: "tails", outcome: "lose", round: 0 },
            ],
            source: { cardId: "Mana Crypt", controllerId: "p2" },
        });
        expect(getByTestId("reveal-source-row").textContent).toContain("Bob");
        expect(getByTestId("coin-anim").textContent).toBe("Bob loses the flip");
        expect(getByTestId("coin-anim").getAttribute("data-tone")).toBe("bad");
    });

    it("a face-only flip colours heads green and tails red", () => {
        const heads = renderOverlay("p1", {
            ...WIN_CHOICE,
            flips: [
                { flipperId: "p1", face: "heads", outcome: "none", round: 0 },
            ],
        });
        expect(heads.getByTestId("coin-anim").getAttribute("data-tone")).toBe(
            "good"
        );
        cleanup();
        const tails = renderOverlay("p1", {
            ...WIN_CHOICE,
            flips: [
                { flipperId: "p1", face: "tails", outcome: "none", round: 0 },
            ],
        });
        expect(tails.getByTestId("coin-anim").getAttribute("data-tone")).toBe(
            "bad"
        );
    });

    it("click-to-end: the flipper's first click lands the coin, the next acks once", () => {
        vi.useFakeTimers();
        try {
            autoLand = false;
            const { getByTestId } = renderOverlay("p1");
            fireEvent.click(getByTestId("random-reveal-overlay"));
            expect(getByTestId("coin-anim").getAttribute("data-skipped")).toBe(
                "true"
            );
            expect(submitRandomRevealAck).not.toHaveBeenCalled();
            fireEvent.click(getByTestId("random-reveal-overlay"));
            expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
            act(() => {
                vi.advanceTimersByTime(REVEAL_FINAL_HOLD_MS);
            });
            expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("click-to-end: a viewer's click jumps their animation but never acks", () => {
        autoLand = false;
        const { getByTestId } = renderOverlay("p2");
        fireEvent.click(getByTestId("random-reveal-overlay"));
        expect(getByTestId("coin-anim").getAttribute("data-skipped")).toBe(
            "true"
        );
        // A second click on the landed result still never acks for a viewer.
        fireEvent.click(getByTestId("random-reveal-overlay"));
        expect(submitRandomRevealAck).not.toHaveBeenCalled();
    });
});
