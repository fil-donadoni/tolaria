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
// "timed": the mock coin lands after its `durationMs`, like the real one.
let timedLand = false;
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
            durationMs,
            skipped,
            onLanded,
        }: {
            face: string;
            tone: string;
            caption: string;
            durationMs?: number;
            skipped?: boolean;
            onLanded: () => void;
        }) {
            React.useEffect(() => {
                if (autoLand || skipped) {
                    onLanded();
                    return;
                }
                if (!timedLand) return;
                const t = setTimeout(onLanded, durationMs);
                return () => clearTimeout(t);
            }, [skipped, onLanded, durationMs]);
            return (
                <div
                    data-testid="coin-anim"
                    data-face={face}
                    data-tone={tone}
                    data-skipped={String(!!skipped)}
                    data-duration={durationMs}
                >
                    {caption}
                </div>
            );
        },
    };
});

import {
    REVEAL_FINAL_HOLD_MS,
    holdMs,
    tossMs,
} from "~/lib/random-reveal-pacing";
import RandomRevealOverlay from "~/components/board/random-reveal-overlay";

afterEach(cleanup);
beforeEach(() => {
    autoLand = true;
    timedLand = false;
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

// Issue #5519 — a Flip Sequence plays round by round: toss, HOLD the result,
// toss the next. The history grows under the coin; the series' length and its
// consequence stay hidden until it ends.
describe("RandomRevealOverlay — Flip Sequence (issue #5519)", () => {
    const SERIES: PendingChoice = {
        ...WIN_CHOICE,
        stackItemId: "squee",
        choiceId: "coinFlipSeriesOutcome",
        flips: [
            { flipperId: "p1", face: "heads", outcome: "win", round: 0 },
            { flipperId: "p1", face: "heads", outcome: "win", round: 1 },
            { flipperId: "p1", face: "tails", outcome: "lose", round: 2 },
        ],
        flipLimit: 5,
        realized: { face: "LOSE", consequence: "Not every flip was won." },
    };
    // Each phase is scheduled by an effect after the previous one's state
    // commits, so a phase advances in its own `act` — never one big jump.
    const advance = (...phases: number[]) =>
        phases.forEach((ms) =>
            act(() => {
                vi.advanceTimersByTime(ms);
            })
        );
    const historyCaptions = (root: HTMLElement) =>
        Array.from(
            root.querySelectorAll('[data-testid="flip-history-item"]')
        ).map((li) => li.textContent);

    beforeEach(() => {
        autoLand = false;
        timedLand = true;
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it("plays toss → hold → toss in order, the history growing as coins land", () => {
        const { getByTestId, queryByTestId, container } = renderOverlay(
            "p1",
            SERIES
        );
        const coin = () => getByTestId("coin-anim");
        // Round 0 is tossing for its pacing-table duration; nothing landed.
        expect(coin().getAttribute("data-duration")).toBe(String(tossMs(0)));
        expect(queryByTestId("flip-history")).toBeNull();

        advance(tossMs(0)); // lands; the result is HELD
        expect(historyCaptions(container)).toEqual(["1 · Win"]);
        advance(holdMs(0) - 1);
        expect(coin().getAttribute("data-duration")).toBe(String(tossMs(0)));
        expect(coin().getAttribute("data-face")).toBe("heads");

        advance(1); // the hold ends: round 1 is tossed, history unchanged
        expect(coin().getAttribute("data-duration")).toBe(String(tossMs(1)));
        expect(historyCaptions(container)).toEqual(["1 · Win"]);

        advance(tossMs(1));
        expect(historyCaptions(container)).toEqual(["1 · Win", "2 · Win"]);
        advance(holdMs(1));
        expect(coin().getAttribute("data-face")).toBe("tails");
        expect(coin().getAttribute("data-duration")).toBe(String(tossMs(2)));
        advance(tossMs(2));
        expect(historyCaptions(container)).toEqual([
            "1 · Win",
            "2 · Win",
            "3 · Lose",
        ]);
    });

    it("heads the coin 'Flip k of up to N' while the card has a chosen number", () => {
        const { getByTestId, queryByTestId } = renderOverlay("p1", SERIES);
        expect(getByTestId("flip-heading").textContent).toBe(
            "Flip 1 of up to 5"
        );
        advance(tossMs(0), holdMs(0));
        expect(getByTestId("flip-heading").textContent).toBe(
            "Flip 2 of up to 5"
        );
        cleanup();
        const plain = renderOverlay("p1", { ...SERIES, flipLimit: undefined });
        expect(plain.queryByTestId("flip-heading")).toBeNull();
        expect(queryByTestId("flip-heading")).toBeNull();
    });

    it("hides the series length — ghosts and consequence — until it ends", () => {
        const { queryByTestId, queryAllByTestId, getByTestId, container } =
            renderOverlay("p1", SERIES);
        advance(tossMs(0), holdMs(0), tossMs(1), holdMs(1), tossMs(2) - 1);
        // The last coin is still in the air: no ghosts, no consequence, and
        // only the two landed rounds in the history.
        expect(historyCaptions(container)).toHaveLength(2);
        expect(queryAllByTestId("flip-history-ghost")).toHaveLength(0);
        expect(queryByTestId("reveal-consequence")).toBeNull();

        advance(1); // the series ends
        expect(historyCaptions(container)).toHaveLength(3);
        expect(
            queryAllByTestId("flip-history-ghost").map((g) => g.textContent)
        ).toEqual(["4 · not flipped", "5 · not flipped"]);
        expect(getByTestId("reveal-consequence").textContent).toBe(
            "Not every flip was won."
        );
    });

    it("the flipper acks once, only after the final hold of the whole series", () => {
        renderOverlay("p1", SERIES);
        advance(tossMs(0), holdMs(0), tossMs(1), holdMs(1), tossMs(2));
        advance(REVEAL_FINAL_HOLD_MS - 1);
        expect(submitRandomRevealAck).not.toHaveBeenCalled();
        advance(1);
        expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
    });

    it("click-to-end jumps mid-sequence to the final state; the next click acks", () => {
        const { getByTestId, queryAllByTestId, container } = renderOverlay(
            "p1",
            SERIES
        );
        advance(tossMs(0)); // round 0 landed and held
        fireEvent.click(getByTestId("random-reveal-overlay"));
        expect(getByTestId("coin-anim").getAttribute("data-face")).toBe(
            "tails"
        );
        expect(historyCaptions(container)).toEqual([
            "1 · Win",
            "2 · Win",
            "3 · Lose",
        ]);
        expect(queryAllByTestId("flip-history-ghost")).toHaveLength(2);
        expect(getByTestId("reveal-consequence")).toBeTruthy();
        expect(submitRandomRevealAck).not.toHaveBeenCalled();

        fireEvent.click(getByTestId("random-reveal-overlay"));
        expect(submitRandomRevealAck).toHaveBeenCalledTimes(1);
    });

    it("a viewer's click jumps their animation but never acks", () => {
        const { getByTestId, container } = renderOverlay("p2", SERIES);
        fireEvent.click(getByTestId("random-reveal-overlay"));
        expect(historyCaptions(container)).toHaveLength(3);
        fireEvent.click(getByTestId("random-reveal-overlay"));
        advance(REVEAL_FINAL_HOLD_MS);
        expect(submitRandomRevealAck).not.toHaveBeenCalled();
    });

    it("a won series with no loss ends on its last win, ghosts up to the chosen number", () => {
        const won: PendingChoice = {
            ...SERIES,
            flips: SERIES.flips!.slice(0, 2),
            flipLimit: 2,
        };
        const { queryAllByTestId, container } = renderOverlay("p1", won);
        advance(tossMs(0), holdMs(0), tossMs(1));
        expect(historyCaptions(container)).toEqual(["1 · Win", "2 · Win"]);
        expect(queryAllByTestId("flip-history-ghost")).toHaveLength(0);
    });
});
