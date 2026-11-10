// Battlefield grouping preference (issue #7429). "stacked" (default) fans
// identical permanents into one permanent stack (PRD #621); "separate" gives
// every permanent its own layout slot, permanently. The control is the one the
// Game Menu and Settings → Board mount, so flipping it here is the full path:
// control → per-device store → `BoardBattlefield`'s grouping.
//
// The mocked `SpatialZone` renders one wrapper per layout item, so the slot
// COUNT is the assertion.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    act,
} from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { saveBattlefieldGrouping } from "~/lib/boardViewPrefs";
import BattlefieldGroupingOptions from "../battlefield-grouping-options";

vi.mock("~/hooks/useBattlefieldInteractionContext", () => ({
    useBattlefieldInteractionHook: () => () => ({
        getVisualState: () => ({
            interactive: false,
            enabled: true,
            dimmed: false,
            combatOffset: "",
            ringClass: "",
            badge: null,
        }),
        canInteract: () => false,
        handleClick: () => {},
        handleClickWithEvent: () => {},
        getActivatable: () => [],
        handleActivateAbility: () => {},
        isSelectingOnThisBoard: false,
        overlays: null,
    }),
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    tryGetDefinition: () => undefined,
}));

// Render each item as a plain marker div, in the order given — that order IS
// the assertion.
vi.mock("../spatial-zone", () => ({
    default: ({
        items,
    }: {
        items: { key: string; node: React.ReactNode }[];
    }) => (
        <div data-testid="spatial-zone">
            {items.map((it) => (
                <div key={it.key} data-testid="slot">
                    {it.node}
                </div>
            ))}
        </div>
    ),
}));

vi.mock("../board-battlefield-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid={`card-${card.id}`} />
    ),
}));

vi.mock("../battlefield-stack", () => ({
    default: ({ members }: { members: CardInstance[] }) => (
        <div data-testid={`stack-of-${members.length}`} />
    ),
}));

import BoardBattlefield from "../board-battlefield";

function card(id: string, types: string[]): CardInstance {
    return {
        id,
        card: { id: "forest-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types,
        subtypes: [],
    } as CardInstance;
}

function makePlayer(battlefield: CardInstance[]): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeContext(
    me: Player,
    overrides: Partial<React.ContextType<typeof GameContext>> = {}
): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as React.ContextType<typeof GameContext>;
}

function slotCount(): number {
    return screen.getAllByTestId("slot").length;
}

function renderBoard(me: Player) {
    return render(
        <GameContext value={makeContext(me)}>
            <BattlefieldGroupingOptions />
            <BoardBattlefield player={me} />
        </GameContext>
    );
}

const threeForests = () =>
    makePlayer([
        card("forest-1", ["Land"]),
        card("forest-2", ["Land"]),
        card("forest-3", ["Land"]),
    ]);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("battlefield grouping preference (issue #7429)", () => {
    it("stacked (the default) fans three identical lands into one slot", () => {
        renderBoard(threeForests());
        expect(slotCount()).toBe(1);
        expect(screen.getByTestId("stack-of-3")).toBeTruthy();
    });

    it("a stored separate preference lays every permanent out in its own slot", () => {
        saveBattlefieldGrouping("separate");
        renderBoard(threeForests());
        expect(slotCount()).toBe(3);
        expect(screen.queryByTestId("stack-of-3")).toBeNull();
    });

    it("flipping the control re-lays the open board out, both ways, and remembers it", () => {
        renderBoard(threeForests());
        expect(slotCount()).toBe(1);
        act(() => {
            fireEvent.click(screen.getByRole("radio", { name: /separate/i }));
        });
        expect(slotCount()).toBe(3);
        expect(
            window.localStorage.getItem(
                "tolaria:boardViewPrefs:battlefieldGrouping"
            )
        ).toBe(JSON.stringify("separate"));
        act(() => {
            fireEvent.click(screen.getByRole("radio", { name: /stacked/i }));
        });
        expect(slotCount()).toBe(1);
    });
});
