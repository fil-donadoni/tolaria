// Shared DOM scaffolding for board component tests (issue #4491).
//
// Every board surface reads the game through `GameContext` and, depending on
// the surface, the pending-choice buffer, the minimized-choice flag and the
// phase-stop preferences. The controller and graveyard test families each
// hand-rolled the same inert values and the same provider nest; they now build
// them here, so a new context field lands in ONE default instead of a dozen
// drifting copies.
import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import type { Phase } from "@convex/gre/types";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { DEFAULT_SKIP_PREFS, type Side } from "~/lib/skip-phase-prefs";
import type { Player } from "~/types/game";

export type GameContextValue = NonNullable<
    React.ContextType<typeof GameContext>
>;

/** A pending-choice buffer that holds nothing and does nothing. */
export const noopPendingChoiceBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

/** A minimized-choice value that is never minimized. */
export const noopMinimizedChoice = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

/** The viewer `"me"`: 20 life, every zone empty, an empty mana pool. */
export function makeTestPlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

/** Turn 1, precombat main, `"me"` active with priority and viewing, empty
 *  stack, one default player. */
export function makeGameContextValue(
    overrides: Partial<GameContextValue> = {}
): GameContextValue {
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
        allPlayers: [makeTestPlayer()],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as GameContextValue;
}

export interface BoardContextOptions {
    ctx?: Partial<GameContextValue>;
    buffer?: PendingChoiceBuffer;
    /** Mounts `SkipPhasePrefsContext` (default prefs) routing toggles here;
     *  omitted, the provider is not mounted at all. */
    skipPhaseToggle?: (phase: Phase, side: Side) => void;
    /** Mounts `MinimizedChoiceContext` (never minimized). Default true. */
    minimizedChoice?: boolean;
}

/** `ui` wrapped in the board providers — for a test that `rerender`s the
 *  identical tree with a new context. */
export function withBoardContext(
    ui: ReactNode,
    {
        ctx = {},
        buffer = noopPendingChoiceBuffer,
        skipPhaseToggle,
        minimizedChoice = true,
    }: BoardContextOptions = {}
): ReactElement {
    let tree: ReactNode = minimizedChoice ? (
        <MinimizedChoiceContext value={noopMinimizedChoice}>
            {ui}
        </MinimizedChoiceContext>
    ) : (
        ui
    );
    tree = (
        <PendingChoiceBufferContext value={buffer}>
            {tree}
        </PendingChoiceBufferContext>
    );
    if (skipPhaseToggle) {
        tree = (
            <SkipPhasePrefsContext
                value={{
                    prefs: DEFAULT_SKIP_PREFS,
                    toggle: skipPhaseToggle,
                    reset: () => {},
                }}
            >
                {tree}
            </SkipPhasePrefsContext>
        );
    }
    return <GameContext value={makeGameContextValue(ctx)}>{tree}</GameContext>;
}

/** Renders `ui` inside `withBoardContext`. */
export function renderWithBoardContext(
    ui: ReactNode,
    options: BoardContextOptions = {}
) {
    return render(withBoardContext(ui, options));
}
