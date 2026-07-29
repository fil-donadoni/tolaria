// Portrait chips (#336): on a narrow viewport the pile columns and the always-on
// stack panel collapse to tappable chips (zone label + count). These tests
// assert the acceptance criteria as external behavior: each chip shows its
// count, and TAPPING a chip opens the EXISTING reveal / stack view (the same
// dialog / panel the desktop board uses) — nothing is rebuilt.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
    render,
    screen,
    cleanup,
    fireEvent,
    within,
} from "@testing-library/react";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import BoardPortraitChips from "../board-portrait-chips";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="card-image" data-card-id={card.id} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: ({ cardInstance }: { cardInstance: CardInstance }) => (
        <div data-testid="selectable-card" data-card-id={cardInstance.id} />
    ),
}));
// The stack panel pulls in draggable / arrow-highlight wiring irrelevant here;
// stub it down to a marker that surfaces the item count it was handed.
vi.mock("../game-stack", () => ({
    default: ({
        stack,
        elevated,
        narrow,
    }: {
        stack: StackItem[];
        elevated?: boolean;
        narrow?: boolean;
    }) => (
        <div
            data-testid="stack-view"
            data-count={stack.length}
            data-elevated={elevated ?? false}
            data-narrow={narrow ?? false}
        />
    ),
}));

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

function makeCard(id: string, zone: CardInstance["zone"]): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone,
        isTapped: false,
    };
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function renderChips(
    opponent: Player,
    me: Player,
    stackItems: StackItem[] = [],
    ctxOverrides: Partial<React.ContextType<typeof GameContext>> = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: stackItems.length,
        allPlayers: [opponent, me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        ...ctxOverrides,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    <BoardPortraitChips
                        orderedPlayers={[opponent, me]}
                        stackItems={stackItems}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("BoardPortraitChips (#336)", () => {
    it("renders the opponent's pile-chip row with zone labels + counts", () => {
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
            library: { count: 24 },
        });
        const opp = makePlayer("opp", {
            exile: [makeCard("x1", "exile")],
            library: { count: 30 },
        });
        renderChips(opp, me);

        const oppChips = screen.getByTestId("pile-chips-opp");
        expect(
            within(oppChips).getByTestId("chip-exile-opp").textContent
        ).toContain("1");
        expect(
            within(oppChips).getByTestId("chip-library-opp").textContent
        ).toContain("30");
    });

    it("does NOT mount the viewer's own pile-chip row — that lives in the controller bottom bar now (#1815 review fixup)", () => {
        // #1815 first mirrored the opponent's row to the bottom-left, on the
        // board — reviewed and reverted (portrait's vertical budget has no
        // spare ~44px band for a chip row without either overlapping the
        // battlefield's back row or starving its own ≥44px card-width floor).
        // The viewer's chips now render inline in `ControllerBottomBar`
        // instead (`controller-bottom-bar.test.tsx`); this component mounts
        // ONLY the opponent's board-level row plus the stack chip.
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
            library: { count: 12 },
        });
        const opp = makePlayer("opp", { library: { count: 30 } });
        const { container } = renderChips(opp, me);

        const rows = [
            ...container.querySelectorAll("[data-testid^='pile-chips-']"),
        ]
            .map((el) => el.getAttribute("data-testid"))
            .filter((id) => !id?.startsWith("pile-chips-row-"));
        expect(rows).toEqual(["pile-chips-opp"]);
        expect(screen.queryByTestId("pile-chips-me")).toBeNull();
        expect(screen.queryByTestId("pile-chips-row-viewer")).toBeNull();

        // Opponent stays pinned top-left.
        expect(
            screen.getByTestId("pile-chips-row-opponent").className
        ).toContain("top-2");
    });

    it("derives the opponent by IDENTITY (viewer id from context), not array position (#1815 review fixup, finding 5)", () => {
        // The bug this guards: `orderedPlayers` is built upstream as
        // `[opponent, me].filter(Boolean)` (`board.tsx`) — with no opponent
        // seat yet, that collapses to a ONE-element array whose sole entry
        // is the VIEWER's own state. A positional `const [opponent] =
        // orderedPlayers` would then render the viewer's own pile-chip row
        // mislabeled as the opponent's board-level row. Deriving by identity
        // (`playerId` from context) instead means a missing opponent seat
        // renders no opponent row at all — never a mislabeled one.
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
        });
        const value = {
            gameId: "game-id" as never,
            playerId: "me",
            activePlayerId: "me",
            priorityPlayerId: "me",
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            stackCount: 0,
            allPlayers: [me],
            showAllCards: false,
            debugAllActions: false,
            onSwitchGame: () => {},
        } as React.ContextType<typeof GameContext>;
        render(
            <GameContext value={value}>
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext value={noopMinimized}>
                        {/* Only ONE entry — the viewer's own state, standing
                            in for the "no opponent seat yet" shape that used
                            to trip the positional destructure. */}
                        <BoardPortraitChips
                            orderedPlayers={[me]}
                            stackItems={[]}
                        />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </GameContext>
        );

        expect(screen.queryByTestId("pile-chips-row-opponent")).toBeNull();
        expect(screen.queryByTestId("pile-chips-opp")).toBeNull();
        expect(screen.queryByTestId("pile-chips-me")).toBeNull();
    });

    it("no reveal dialog is open until a chip is tapped", () => {
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
        });
        const opp = makePlayer("opp");
        renderChips(opp, me);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("tapping the opponent's graveyard chip opens the EXISTING reveal view", () => {
        const opp = makePlayer("opp", {
            graveyard: [
                makeCard("g1", "graveyard"),
                makeCard("g2", "graveyard"),
            ],
        });
        renderChips(opp, makePlayer("me"));

        fireEvent.click(screen.getByTestId("chip-graveyard-opp"));

        const dialog = screen.getByRole("dialog");
        // The reveal dialog is the same one the desktop pile opens — titled with
        // the zone + count.
        expect(
            within(dialog).getAllByText(/Graveyard \(2\)/).length
        ).toBeGreaterThan(0);
    });

    it("tapping the opponent's library chip opens its reveal view", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp", {
            library: { count: 3 },
        });
        renderChips(opp, me);

        fireEvent.click(screen.getByTestId("chip-library-opp"));
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("renders the stack chip only when the stack is non-empty, OPEN BY DEFAULT with no tap (issue #1816), and the chip toggles it", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");

        // Empty stack: no chip, no panel.
        const { unmount } = renderChips(opp, me, []);
        expect(screen.queryByTestId("chip-stack")).toBeNull();
        expect(screen.queryByTestId("stack-view")).toBeNull();
        unmount();

        const stack = [
            { id: "s1", card: { id: "def-s1" } },
            { id: "s2", card: { id: "def-s2" } },
        ] as unknown as StackItem[];
        renderChips(opp, me, stack);

        // Issue #1816: the panel is visible the instant the stack is
        // non-empty — NO tap required.
        const chip = screen.getByTestId("chip-stack");
        expect(chip.textContent).toContain("2");
        const view = screen.getByTestId("stack-view");
        expect(view.getAttribute("data-count")).toBe("2");

        // Tap collapses it.
        fireEvent.click(chip);
        expect(screen.queryByTestId("stack-view")).toBeNull();

        // Tap again re-opens it (same stack run).
        fireEvent.click(screen.getByTestId("chip-stack"));
        expect(
            screen.getByTestId("stack-view").getAttribute("data-count")
        ).toBe("2");
    });

    it("a stack that empties then refills starts OPEN again, even if the player had collapsed the previous run (issue #1816)", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");
        const firstRun = [
            { id: "s1", card: { id: "def-s1" } },
        ] as unknown as StackItem[];
        const { rerender } = renderChips(opp, me, firstRun);

        // Open by default — collapse it explicitly.
        fireEvent.click(screen.getByTestId("chip-stack"));
        expect(screen.queryByTestId("stack-view")).toBeNull();

        // Stack empties: no chip, no panel.
        const rerenderChips = (stackItems: StackItem[]) =>
            rerender(
                <GameContext
                    value={
                        {
                            gameId: "game-id" as never,
                            playerId: "me",
                            activePlayerId: "me",
                            priorityPlayerId: "me",
                            phase: "PRECOMBAT_MAIN",
                            turn: 1,
                            stackCount: stackItems.length,
                            allPlayers: [opp, me],
                            showAllCards: false,
                            debugAllActions: false,
                            onSwitchGame: () => {},
                        } as React.ContextType<typeof GameContext>
                    }
                >
                    <PendingChoiceBufferContext value={noopBuffer}>
                        <MinimizedChoiceContext value={noopMinimized}>
                            <BoardPortraitChips
                                orderedPlayers={[opp, me]}
                                stackItems={stackItems}
                            />
                        </MinimizedChoiceContext>
                    </PendingChoiceBufferContext>
                </GameContext>
            );
        rerenderChips([]);
        expect(screen.queryByTestId("chip-stack")).toBeNull();
        expect(screen.queryByTestId("stack-view")).toBeNull();

        // A NEW stack run begins — the collapsed preference does not carry
        // over, so the panel opens again with no tap.
        const secondRun = [
            { id: "s2", card: { id: "def-s2" } },
        ] as unknown as StackItem[];
        rerenderChips(secondRun);
        expect(
            screen.getByTestId("stack-view").getAttribute("data-count")
        ).toBe("1");
    });

    it("review fixup round 2 (#1813/#1823) — the stack chip and an opened stack overlay sit at `z-chip`, strictly between the centered banner's `z-banner` and a blocking modal's `z-modal`", () => {
        // Round 1 put both at `z-modal-top` so they'd out-rank a centered
        // pending-choice banner (then also `z-modal`) — but `z-modal-top`
        // also out-ranks every BLOCKING modal (trigger-order-prompt,
        // mana-choice-picker, the reveal overlays), leaving the chip tappable
        // through their scrim. The fix: the banner moved DOWN to `z-banner`
        // (below `z-chip`), the chip stays at the new `z-chip` tier — NOT
        // `z-modal-top`, NOT the old `z-30`, and NOT `z-modal` itself, so a
        // real blocking modal still wins outright.
        const me = makePlayer("me");
        const opp = makePlayer("opp");
        const stack = [
            { id: "s1", card: { id: "def-s1" } },
        ] as unknown as StackItem[];
        renderChips(opp, me, stack);

        const rowClassName = screen.getByTestId("stack-chip-row").className;
        expect(rowClassName).toContain("z-chip");
        expect(rowClassName).not.toMatch(/\bz-30\b/);
        expect(rowClassName).not.toContain("z-modal-top");
        expect(rowClassName).not.toMatch(/\bz-modal\b(?!-)/);

        // Issue #1816: the panel is open by default (no tap needed) — assert
        // `elevated` on the already-mounted view directly, and that the
        // portrait mount passes `narrow` (the desktop mount in `board.tsx`
        // never does).
        const view = screen.getByTestId("stack-view");
        expect(view.getAttribute("data-elevated")).toBe("true");
        expect(view.getAttribute("data-narrow")).toBe("true");
    });

    it("pins the numeric ordering in src/index.css: banner < chip < modal", () => {
        // This is the actual bug from #1823 round 1: `--z-modal-top` (110) sat
        // ABOVE `--z-modal` (100), so raising the chip past `--z-modal` let it
        // paint over a real blocking modal's scrim. jsdom in this test suite
        // never loads `src/index.css` (no `getComputedStyle` signal to assert
        // on), so read the source of truth directly — a future edit that
        // re-breaks the ordering fails HERE, not only visually.
        //
        // The `import.meta.url` indirection through `moduleUrl` (rather than
        // the literal `new URL("../../../index.css", import.meta.url)`) is
        // load-bearing: Vite's import-analysis plugin pattern-matches that
        // exact literal as a static-asset reference and rewrites it to the
        // DEV-SERVER url (`http://localhost:3000/src/index.css`) instead of
        // leaving it as a runtime `file://` URL — which then makes
        // `readFileSync` throw ("The URL must be of scheme file"). Assigning
        // to a variable first defeats that static rewrite and keeps this
        // cwd-independent (no `process.cwd()` assumption about where the
        // test runner was launched from).
        const moduleUrl = import.meta.url;
        const css = readFileSync(
            new URL("../../../index.css", moduleUrl),
            "utf8"
        );
        const valueOf = (name: string): number => {
            const match = css.match(new RegExp(`--${name}:\\s*(\\d+);`));
            if (!match) throw new Error(`--${name} not found in index.css`);
            return Number(match[1]);
        };

        const banner = valueOf("z-banner");
        const chip = valueOf("z-chip");
        const modal = valueOf("z-modal");
        const modalTop = valueOf("z-modal-top");

        expect(banner).toBeLessThan(chip);
        expect(chip).toBeLessThan(modal);
        expect(modal).toBeLessThan(modalTop);
    });
});
