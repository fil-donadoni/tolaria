// Portrait controller (#335): the right control column collapses to a fixed
// bottom action bar (+ phase bottom sheet) below the `md:` breakpoint. The
// contracts tested here are the acceptance criteria:
//   1. The portrait branch (`Controller` with `useIsPortrait` = true) renders
//      the bottom bar with the current-phase chip and a full-width primary
//      action, NOT the desktop right-edge pod.
//   2. Each rendered action dispatches the SAME mutation, with the same args, as
//      the desktop pod — proving the wiring (`useControllerActions`) is reused.
//   3. The phase sheet opens from the chip and routes stop toggles through the
//      SAME `useSkipPhasePreferences().toggle(phase, side)` path.
//   4. The single seam picks pod vs. bar: landscape mounts the pod, portrait the
//      bar — exactly one, so the shortcut/mutation hook never doubles.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { DEFAULT_SKIP_PREFS, type Side } from "~/lib/skip-phase-prefs";
import type { Phase } from "@convex/gre/types";
import type { Player } from "~/types/game";

const calls: { ref: unknown; args: unknown }[] = [];

vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            cancelCast: "cancelCast",
            cancelActivation: "cancelActivation",
            confirmAttackers: "confirmAttackers",
            confirmBlockers: "confirmBlockers",
            confirmDamage: "confirmDamage",
            passPriority: "passPriority",
            autoTapForPayment: "autoTapForPayment",
            endTurn: "endTurn",
            cancelAutoPass: "cancelAutoPass",
            submitMayPay: "submitMayPay",
        },
    },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// The single seam under test — drive it explicitly so jsdom's flaky matchMedia
// never decides the branch.
let portrait = true;
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => portrait,
}));

// Chrome irrelevant to these contracts.
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
// The real stop dot uses a Base UI Tooltip (flaky in jsdom); stand it in with a
// plain button that surfaces the aria-label + click — same contract.
vi.mock("../phase-stop-dot", () => ({
    default: ({
        active,
        onClick,
        ariaLabel,
    }: {
        active: boolean;
        onClick: () => void;
        ariaLabel: string;
    }) => (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
        />
    ),
}));

const { default: Controller } = await import("../controller");

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

type CtxOverrides = Partial<React.ContextType<typeof GameContext>>;

function renderController(
    ctx: CtxOverrides = {},
    toggle: (phase: Phase, side: Side) => void = () => {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [makePlayer()],
        showAllCards: false,
        debugAllActions: false,
        ...ctx,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <SkipPhasePrefsContext
                value={{ prefs: DEFAULT_SKIP_PREFS, toggle, reset: () => {} }}
            >
                <PendingChoiceBufferContext value={noopBuffer}>
                    <Controller onOpenMenu={() => {}} />
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}

beforeEach(() => {
    calls.length = 0;
    portrait = true;
});

describe("Controller seam (#335)", () => {
    it("portrait mounts the bottom action bar, not the desktop pod", () => {
        portrait = true;
        const { container } = renderController();
        expect(
            container.querySelector("[data-controller-bottom-bar]")
        ).toBeTruthy();
        expect(container.querySelector("[data-controller-pod]")).toBeNull();
    });

    it("landscape mounts the desktop pod, not the bottom bar", () => {
        portrait = false;
        const { container } = renderController();
        expect(container.querySelector("[data-controller-pod]")).toBeTruthy();
        expect(
            container.querySelector("[data-controller-bottom-bar]")
        ).toBeNull();
    });
});

describe("Portrait bottom bar — same controls, same mutations", () => {
    it("shows the current-phase chip and a full-width primary Pass action", () => {
        renderController();
        expect(screen.getByText("Main Phase 1")).toBeTruthy();
        // The primary action is the SAME "Pass" the desktop pod renders.
        fireEvent.click(screen.getByText(/^Pass$/));
        const pass = calls.find((c) => c.ref === "passPriority");
        expect(pass?.args).toMatchObject({ gameId: "game-id", playerId: "me" });
    });

    it("declaring attackers: primary Confirm Attackers dispatches confirmAttackers", () => {
        renderController({
            phase: "DECLARE_ATTACKERS",
            combat: { attackerIds: ["a1"], confirmed: false } as never,
        });
        fireEvent.click(screen.getByText(/Confirm Attackers/));
        const confirm = calls.find((c) => c.ref === "confirmAttackers");
        expect(confirm?.args).toMatchObject({
            gameId: "game-id",
            playerId: "me",
        });
    });

    it("auto-passing: the cancel pill dispatches cancelAutoPass", () => {
        renderController({ autoPassPlayers: ["me"], priorityPlayerId: "opp" });
        fireEvent.click(screen.getByText(/Auto-passing\.\.\. \(cancel\)/));
        expect(calls.map((c) => c.ref)).toContain("cancelAutoPass");
    });

    it("Space still routes through the shared hook on portrait", () => {
        renderController();
        fireEvent.keyDown(window, { code: "Space" });
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });
});

describe("Portrait phase sheet — same stop-toggle path", () => {
    it("opens from the phase chip and toggles a YOU stop via useSkipPhasePreferences", () => {
        const toggle = vi.fn();
        renderController({}, toggle);
        // The chip is the toggle for the phase list (aria-label).
        fireEvent.click(screen.getByLabelText("Toggle phase list"));
        // The sheet is open (the phase-list dialog is now mounted).
        expect(screen.getByRole("dialog")).toBeTruthy();
        // A YOU stop toggle routes through the identical path the desktop list
        // uses: toggle(phase, "self").
        fireEvent.click(
            screen.getByLabelText("Stop on my turn (PRECOMBAT_MAIN)")
        );
        expect(toggle).toHaveBeenCalledWith("PRECOMBAT_MAIN", "self");
    });

    it("toggles an OPP stop via the same path", () => {
        const toggle = vi.fn();
        renderController({}, toggle);
        fireEvent.click(screen.getByLabelText("Toggle phase list"));
        fireEvent.click(
            screen.getByLabelText("Stop on opponent's turn (PRECOMBAT_MAIN)")
        );
        expect(toggle).toHaveBeenCalledWith("PRECOMBAT_MAIN", "opponent");
    });
});
