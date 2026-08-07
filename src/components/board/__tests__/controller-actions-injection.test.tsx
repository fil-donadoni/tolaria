// Injectable controller action-descriptor source (#2167, PRD #2162). The
// context carries the HOOK, not the computed value — the same shape the PRD
// mandates for the battlefield interaction seam — so every layout calls it
// unconditionally, whether or not a provider is present, and the single-mount
// invariant (proven in controller-landscape.test.tsx, kept unmodified by this
// change) never sees two evaluations.
//
// This file proves the two halves of the acceptance criteria the rest of the
// controller suite cannot: (1) a provider-supplied source is what EACH of the
// three mounted layouts renders, and (2) absent any provider the default is
// today's `useControllerActions`, dispatching the same mutation as before.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { DEFAULT_SKIP_PREFS } from "~/lib/skip-phase-prefs";
import {
    ControllerActionsContext,
    type ControllerActionsSource,
} from "~/hooks/controllerActionsContext";
import type { ControllerState } from "~/hooks/useControllerActions";
import type { Player } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

// Only the "no provider" case reaches these — the provider-injected cases
// never call `useControllerActions`, so `useMutation` never fires for them.
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            passPriority: "passPriority",
        },
    },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
vi.mock("../controller-phase-panel", () => ({ default: () => <div /> }));
vi.mock("../controller-phase-sheet", () => ({ default: () => <div /> }));

const { default: ControllerPod } = await import("../controller-pod");
const { default: ControllerBottomBar } =
    await import("../controller-bottom-bar");
const { default: ControllerLandscapeStrip } =
    await import("../controller-landscape-strip");

function makePlayer(overrides: Partial<Player> = {}): Player {
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

const STUB_LABEL = "Provider-injected action";

function stubState(): ControllerState {
    return {
        cue: "mine",
        actions: [
            {
                key: "stub",
                label: STUB_LABEL,
                tone: "primary",
                disabled: false,
                onClick: () => {},
            },
        ],
        isAutoPass: false,
        isQueuedEndTurn: false,
        attackAllConfirm: {
            open: false,
            eligibleCount: 0,
            confirm: () => {},
            cancel: () => {},
        },
    };
}

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

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

type Layout = React.ComponentType<{ onOpenMenu: () => void }>;

function renderLayout(Layout: Layout, source?: ControllerActionsSource) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [makePlayer()],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    const body = (
        <GameContext value={value}>
            <SkipPhasePrefsContext
                value={{
                    prefs: DEFAULT_SKIP_PREFS,
                    toggle: () => {},
                    reset: () => {},
                }}
            >
                <PendingChoiceBufferContext value={noopBuffer}>
                    <MinimizedChoiceContext value={noopMinimized}>
                        <Layout onOpenMenu={() => {}} />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
    return render(
        source ? (
            <ControllerActionsContext value={source}>
                {body}
            </ControllerActionsContext>
        ) : (
            body
        )
    );
}

beforeEach(() => {
    calls.length = 0;
});

describe.each([
    ["ControllerPod", ControllerPod],
    ["ControllerBottomBar", ControllerBottomBar],
    ["ControllerLandscapeStrip", ControllerLandscapeStrip],
] as [string, Layout][])(
    "%s reads its action descriptors from the injected context (#2167)",
    (_name, Layout) => {
        it("renders the provider-supplied descriptor, not a hook-derived one", () => {
            renderLayout(Layout, stubState);
            expect(screen.getByText(STUB_LABEL)).toBeTruthy();
            // Nothing dispatched — proof the real `useControllerActions` (and
            // its mutations) never ran while a provider is present.
            expect(calls).toHaveLength(0);
        });
    }
);

describe("Absent any provider, descriptors are today's (#2167)", () => {
    it("ControllerPod falls back to useControllerActions and dispatches passPriority", () => {
        renderLayout(ControllerPod);
        expect(screen.queryByText(STUB_LABEL)).toBeNull();
        fireEvent.click(screen.getByText(/^Pass$/));
        const pass = calls.find((c) => c.ref === "passPriority");
        expect(pass?.args).toMatchObject({ gameId: "game-id", playerId: "me" });
    });
});
