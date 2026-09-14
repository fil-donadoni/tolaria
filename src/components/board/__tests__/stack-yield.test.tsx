// The **Yield** surface (issue #3556): the per-ability toggle on every
// **Stack** row, and the "Clear all yields" reset in the panel header.
//
// Driven through the REAL projection (`projectPublicState` → `projectStackItem`)
// and the REAL store hook (`useYieldPrefsState`), never a hand-built view or a
// stubbed store — the bug this guards against is the toggle and the auto-pass
// keying an ability differently, which only a shared derivation over the
// client's actual fields can rule out.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    YieldPrefsContext,
    useYieldPrefsState,
} from "~/hooks/useYieldPreferences";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/color-overlay-card-image", () => ({
    default: () => <div data-testid="stack-card" />,
}));

import GameStack from "../game-stack";

const NOBLE = getCardByName("Noble Hierarch");
const BOLT = getCardByName("Lightning Bolt");
const EXALTED = "exalted";

type Entry = {
    instance: string;
    defId: string;
    castById: string;
    abilityId?: string;
};

function projectStack(entries: Entry[], viewerId = "p1"): StackItem[] {
    const state: GameState = makeState({
        stack: entries.map((e) => {
            const base = {
                ...makeInstance(e.defId, {
                    id: e.instance,
                    controllerId: e.castById,
                    ownerId: e.castById,
                    zone: "stack",
                }),
                castById: e.castById,
            };
            return (
                e.abilityId
                    ? {
                          ...base,
                          triggeredAbilityId: e.abilityId,
                          triggerSourceId: "src",
                      }
                    : base
            ) as EngineStackItem;
        }),
    } as Partial<GameState>);
    return projectPublicState(state, 1, viewerId)
        .stack as unknown as StackItem[];
}

/** Mounts the panel over the REAL store, so a toggle writes where the
 *  auto-pass predicate reads. `gameId` is the store's lifetime key (§6). */
function Harness({
    stack,
    gameId = "game-a",
}: {
    stack: StackItem[];
    gameId?: string;
}) {
    const yieldPrefs = useYieldPrefsState(gameId);
    const value = {
        gameId: gameId as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: stack.length,
        stackItems: stack,
        allPlayers: [] as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={value}>
            <YieldPrefsContext value={yieldPrefs}>
                <GameStack stack={stack} />
            </YieldPrefsContext>
        </GameContext>
    );
}

const toggles = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("[data-stack-yield-toggle]"));

beforeEach(() => {
    localStorage.clear();
});
afterEach(cleanup);

describe("Yield toggle on every stack row (issue #3556 §1)", () => {
    it("renders one on the viewer's own objects AND the opponent's, spell and trigger alike", () => {
        const stack = projectStack([
            { instance: "spell-1", defId: BOLT.id, castById: "p1" },
            {
                instance: "trig-1",
                defId: NOBLE.id,
                castById: "p2",
                abilityId: EXALTED,
            },
        ]);
        const { container } = render(<Harness stack={stack} />);
        expect(toggles(container)).toHaveLength(2);
    });

    it("reflects state and toggles it, without touching localStorage (§6)", () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        const stack = projectStack([
            {
                instance: "trig-1",
                defId: NOBLE.id,
                castById: "p1",
                abilityId: EXALTED,
            },
        ]);
        const { container } = render(<Harness stack={stack} />);
        const toggle = toggles(container)[0];
        expect(toggle.getAttribute("aria-pressed")).toBe("false");

        fireEvent.click(toggle);
        expect(toggles(container)[0].getAttribute("aria-pressed")).toBe("true");

        fireEvent.click(toggles(container)[0]);
        expect(toggles(container)[0].getAttribute("aria-pressed")).toBe(
            "false"
        );
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();
    });

    it("shows a LATER, distinct instance of the same ability as already yielded (§2)", () => {
        const first = projectStack([
            {
                instance: "trig-1",
                defId: NOBLE.id,
                castById: "p1",
                abilityId: EXALTED,
            },
        ]);
        const view = render(<Harness stack={first} />);
        fireEvent.click(toggles(view.container)[0]);

        // A brand-new stack object: different instance id, same ability of the
        // same card. The store is unchanged across the re-render.
        const second = projectStack([
            {
                instance: "trig-2",
                defId: NOBLE.id,
                castById: "p1",
                abilityId: EXALTED,
            },
        ]);
        view.rerender(<Harness stack={second} />);
        expect(toggles(view.container)[0].getAttribute("aria-pressed")).toBe(
            "true"
        );
    });
});

describe("Clear all yields (issue #3556 §5/§6)", () => {
    const stack = () =>
        projectStack([
            {
                instance: "trig-1",
                defId: NOBLE.id,
                castById: "p1",
                abilityId: EXALTED,
            },
            { instance: "spell-1", defId: BOLT.id, castById: "p1" },
        ]);

    it("is absent with no yields, names the count once there are, and clears them", () => {
        const view = render(<Harness stack={stack()} />);
        const reset = () =>
            view.container.querySelector('[data-clear-yields="panel"]');
        expect(reset()).toBeNull();

        fireEvent.click(toggles(view.container)[0]);
        expect(reset()?.textContent).toBe("Clear all yields (1)");
        fireEvent.click(toggles(view.container)[1]);
        expect(reset()?.textContent).toBe("Clear all yields (2)");

        fireEvent.click(reset()!);
        expect(reset()).toBeNull();
        for (const t of toggles(view.container))
            expect(t.getAttribute("aria-pressed")).toBe("false");
    });

    it("starts a new Game with no yields", () => {
        const view = render(<Harness stack={stack()} gameId="game-a" />);
        fireEvent.click(toggles(view.container)[0]);
        expect(
            view.container.querySelector('[data-clear-yields="panel"]')
        ).not.toBeNull();

        view.rerender(<Harness stack={stack()} gameId="game-b" />);
        expect(
            view.container.querySelector('[data-clear-yields="panel"]')
        ).toBeNull();
    });
});
