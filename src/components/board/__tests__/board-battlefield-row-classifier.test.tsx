// Injectable row classifier (issue #2166). `BoardBattlefield` accepts a
// `rowClassifier` prop (`{ bandOf, backRowRank }`) instead of hard-coding the
// creature/land split — a Manual Game (PRD #2162) has no hydrated
// `CardInstance.types` to read `isCreature`/`isLand` off, so it needs its own
// answer to both halves: which row a permanent lands in, AND how the back
// row sub-orders (lands left, other noncreatures right).
//
// These tests observe ORDER directly: the mocked `SpatialZone` below renders
// `items` in the array order `BoardBattlefield` hands it, so a band swap
// shows up as a DOM-order swap.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import type { BattlefieldRowClassifier } from "../board-battlefield";

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

vi.mock("@convex/cards", () => ({
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
                <div key={it.key}>{it.node}</div>
            ))}
        </div>
    ),
}));

vi.mock("../board-battlefield-card", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid={`card-${card.id}`} />
    ),
}));

import BoardBattlefield from "../board-battlefield";

function card(id: string, types: string[]): CardInstance {
    return {
        id,
        card: { id: `${id}-def` },
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

/** Extract the rendered marker ids, in DOM order — the mocked SpatialZone
 *  preserves the `orderedItems` array order it was handed. */
function renderedCardOrder(): string[] {
    return Array.from(
        screen
            .getByTestId("spatial-zone")
            .querySelectorAll<HTMLElement>("[data-testid^='card-']")
    ).map((el) => el.dataset.testid!.replace("card-", ""));
}

afterEach(cleanup);

describe("injected battlefield row classifier (issue #2166)", () => {
    it("default classifier reproduces today's creature-forward, land-then-other back-row ordering", () => {
        const bear = card("bear", ["Creature"]);
        const forest = card("forest", ["Land"]);
        const sol = card("sol-ring", ["Artifact"]);
        const me = makePlayer([sol, forest, bear]);
        render(
            <GameContext value={makeContext(me)}>
                <BoardBattlefield player={me} />
            </GameContext>
        );
        // creature first, then lands, then other noncreature permanents —
        // regardless of the input array's order.
        expect(renderedCardOrder()).toEqual(["bear", "forest", "sol-ring"]);
    });

    it("an injected classifier changes which row a permanent lands in", () => {
        // A classifier that flips the polarity entirely: artifacts join the
        // "creatures" row, everything else is "back" with lands ranked LAST
        // instead of first. Proves BoardBattlefield defers to the injected
        // functions rather than falling back to isCreature/isLand.
        const flipped: BattlefieldRowClassifier = {
            bandOf: (c) =>
                c.types?.includes("Artifact") ? "creatures" : "back",
            backRowRank: (c) => (c.types?.includes("Land") ? 1 : 0),
        };
        const bear = card("bear", ["Creature"]);
        const forest = card("forest", ["Land"]);
        const sol = card("sol-ring", ["Artifact"]);
        const me = makePlayer([sol, forest, bear]);
        render(
            <GameContext value={makeContext(me)}>
                <BoardBattlefield player={me} rowClassifier={flipped} />
            </GameContext>
        );
        // sol-ring (now "creatures" band) leads; of the back row, the
        // classifier ranks non-lands (bear) before lands (forest).
        expect(renderedCardOrder()).toEqual(["sol-ring", "bear", "forest"]);
    });
});
