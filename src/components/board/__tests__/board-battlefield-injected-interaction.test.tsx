// Injectable interaction hook (issue #2166). `BoardBattlefield` no longer
// imports `useBattlefieldInteraction` directly — it reads WHICH hook to call
// from `useBattlefieldInteractionContext`. This is load-bearing because
// `BoardBattlefield` mounts once per seat behind `BoardSurface`'s
// `{opponent && …}` / `{me && …}` conditionals: injecting a pre-computed
// RESULT (rather than the hook function) would force the call up into that
// conditional parent and break the rules-of-hooks contract the moment a seat
// appears or disappears mid-game.
//
// These tests prove the swap actually happens at the CALL SITE:
//  (a) with no provider, the real `useBattlefieldInteraction` is the one
//      `BoardBattlefield` invokes;
//  (b) with a `BattlefieldInteractionProvider`, the supplied hook is invoked
//      instead, and the real hook is never touched.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { BattlefieldInteractionProvider } from "~/hooks/useBattlefieldInteractionContext";
import type { BattlefieldInteractionResult } from "~/hooks/useBattlefieldInteractionContext";

// Replace the real hook with a spy so the test can assert whether it was
// called at all, without paying for its Convex-mutation machinery. The
// overlay testid is derived from `player.id` so the stub's `player` argument
// is genuinely exercised, not just threaded through unused.
const realHookSpy = vi.fn(
    (player: Player): BattlefieldInteractionResult =>
        makeStubResult(`real-overlay-${player.id}`)
);
vi.mock("~/hooks/useBattlefieldInteraction", () => ({
    useBattlefieldInteraction: (player: Player) => realHookSpy(player),
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

// SpatialZone measures its box via ResizeObserver; stub it so layout doesn't
// matter — only the overlay marker needs to reach the DOM.
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

import BoardBattlefield from "../board-battlefield";

function makeStubResult(overlayLabel: string): BattlefieldInteractionResult {
    return {
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
        overlays: <div data-testid={overlayLabel} />,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makePlayer(): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
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

afterEach(() => {
    cleanup();
    realHookSpy.mockClear();
});

describe("injected battlefield interaction hook (issue #2166)", () => {
    it("absent a provider, the real hook is the one BoardBattlefield calls", () => {
        const me = makePlayer();
        render(
            <GameContext value={makeContext(me)}>
                <BoardBattlefield player={me} />
            </GameContext>
        );
        expect(realHookSpy).toHaveBeenCalledTimes(1);
        expect(realHookSpy).toHaveBeenCalledWith(me);
        expect(screen.getByTestId("real-overlay-me")).toBeTruthy();
    });

    it("a provider-supplied interaction hook is what the mounted battlefield uses", () => {
        const me = makePlayer();
        const fakeHook = vi.fn(
            (player: Player): BattlefieldInteractionResult =>
                makeStubResult(`fake-overlay-${player.id}`)
        );
        render(
            <GameContext value={makeContext(me)}>
                <BattlefieldInteractionProvider value={fakeHook}>
                    <BoardBattlefield player={me} />
                </BattlefieldInteractionProvider>
            </GameContext>
        );
        expect(fakeHook).toHaveBeenCalledTimes(1);
        expect(fakeHook).toHaveBeenCalledWith(me);
        expect(realHookSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId("fake-overlay-me")).toBeTruthy();
    });
});
