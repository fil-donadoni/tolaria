// The stack panel's target line (ADR 0103, issue #2727).
//
// The board's arrows are the representation of "what this targets" and
// `game-stack-order.test.tsx` pins that decision — the DESKTOP row prints no
// target name and this slice does not relitigate that. What it adds is the one
// case the decision did not cover: the PHONE panels cover the half of the board
// the arrow crosses (portrait pins the panel between the midline and the
// viewer battlefield's own bottom inset; landscape-compact covers the right
// rail), so while the panel is open the arrow's far end is behind it and the
// player has no representation at all.
//
// Both halves of that claim are asserted here — the line appears on the phone
// variants and is ABSENT on desktop — because either one alone is satisfiable
// by a bug: always-on regresses the pinned decision, never-on is the state
// before this slice.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/color-overlay-card-image", () => ({
    default: () => <div data-testid="stack-card" />,
}));

import GameStack from "../game-stack";

function makeStackItem(id: string, targets?: StackItem["targets"]): StackItem {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        castById: "me",
        zone: "stack",
        isTapped: false,
        targets,
    } as StackItem;
}

const RIVAL = { id: "opp", name: "Rival", battlefield: [], graveyard: [] };

function renderStack(props: { narrow?: boolean; landscape?: boolean } = {}) {
    const stack = [
        makeStackItem("bolt", [{ type: "player" as const, id: "opp" }]),
    ];
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 1,
        stackItems: [],
        allPlayers: [RIVAL] as unknown as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} {...props} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("target line — phone panels only", () => {
    it("portrait's narrow panel names the target", () => {
        const { container } = renderStack({ narrow: true });
        const line = container.querySelector("[data-stack-target-line]");
        expect(line).toBeTruthy();
        expect(line!.textContent).toContain("Rival");
    });

    it("landscape-compact's right panel names it too", () => {
        const { container } = renderStack({ landscape: true });
        expect(
            container.querySelector("[data-stack-target-line]")?.textContent
        ).toContain("Rival");
    });

    it("desktop does not — the arrows are visible there, and that decision stands", () => {
        const { container } = renderStack();
        expect(container.querySelector("[data-stack-target-line]")).toBeNull();
        expect(container.textContent).not.toContain("Rival");
    });
});
