// Issue #9500 — battlefield grouping by attack destination and the hover
// preview dock side the board requests per row. Harness mirrors
// `board-battlefield-grouping-preference.test.tsx`.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

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
    default: ({
        card,
        previewDockSide,
    }: {
        card: CardInstance;
        previewDockSide?: "left";
    }) => (
        <div
            data-testid={`card-${card.id}`}
            data-preview-dock-side={previewDockSide}
        />
    ),
}));

vi.mock("../battlefield-stack", () => ({
    default: ({ members }: { members: CardInstance[] }) => (
        <div data-testid={`stack-of-${members.length}`} />
    ),
}));

vi.mock("../combat-panels", () => ({ default: () => null }));

import BoardBattlefield from "../board-battlefield";
import type { Combat } from "~/types/game";

function card(id: string, def: string, types: string[]): CardInstance {
    return {
        id,
        card: { id: def },
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

function renderBoard(me: Player, combat?: Combat) {
    return render(
        <GameContext
            value={
                {
                    gameId: "game-id" as never,
                    playerId: "me",
                    activePlayerId: "me",
                    priorityPlayerId: "me",
                    phase: combat ? "DECLARE_ATTACKERS" : "PRECOMBAT_MAIN",
                    turn: 1,
                    engineTurn: 1,
                    stackCount: 0,
                    stackItems: [],
                    allPlayers: [me],
                    showAllCards: false,
                    debugAllActions: false,
                    combat,
                } as React.ContextType<typeof GameContext>
            }
        >
            <BoardBattlefield player={me} />
        </GameContext>
    );
}

const bears = () =>
    makePlayer([
        card("bear-1", "def-bear", ["Creature"]),
        card("bear-2", "def-bear", ["Creature"]),
    ]);

const declared = (attackTargets: Record<string, string>): Combat =>
    ({
        attackerIds: ["bear-1", "bear-2"],
        attackTargets,
        blockerAssignments: {},
        confirmed: false,
    }) as unknown as Combat;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

// Issue #9500 — CR 508.1b: an attacker is announced against one player or
// planeswalker, so two identical attackers with different destinations are
// no longer interchangeable and leave the fan; same destination stays fanned.
describe("battlefield grouping by attack destination (issue #9500)", () => {
    it("identical attackers against DIFFERENT targets get one slot each", () => {
        renderBoard(bears(), declared({ "bear-1": "pw-1" }));
        expect(screen.getAllByTestId("slot")).toHaveLength(2);
    });

    it("identical attackers against the SAME target stay one fan", () => {
        renderBoard(bears(), declared({ "bear-1": "pw-1", "bear-2": "pw-1" }));
        expect(screen.getAllByTestId("slot")).toHaveLength(1);
        expect(screen.getByTestId("stack-of-2")).toBeTruthy();
    });
});

// Issue #9500 — the back row's right block (noncreature, nonland) sits under
// the right-edge hover dock, so the board asks the preview to dock left.
describe("hover preview dock side per row (issue #9500)", () => {
    it("a planeswalker / noncreature artifact asks for the left dock; creatures and lands do not", () => {
        renderBoard(
            makePlayer([
                card("pw", "def-pw", ["Planeswalker"]),
                card("rock", "def-rock", ["Artifact"]),
                card("bear", "def-bear", ["Creature"]),
                card("land", "def-land", ["Land"]),
                card("golem", "def-golem", ["Artifact", "Creature"]),
            ])
        );
        const side = (id: string) =>
            screen
                .getByTestId(`card-${id}`)
                .getAttribute("data-preview-dock-side");
        expect(side("pw")).toBe("left");
        expect(side("rock")).toBe("left");
        expect(side("bear")).toBeNull();
        expect(side("land")).toBeNull();
        expect(side("golem")).toBeNull();
    });
});
