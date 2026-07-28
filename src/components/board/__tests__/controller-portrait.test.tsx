// Portrait controller (#335), redesigned as variant D (#1759): the right
// control column collapses to a fixed app tab bar (You · Zones · Phase · Menu)
// plus a morphing command row, below the `md:` breakpoint. The contracts tested
// here are the acceptance criteria:
//   1. The portrait branch (`Controller` with `useIsPortrait` = true) renders
//      the bottom bar, NOT the desktop right-edge pod.
//   2. Each rendered action dispatches the SAME mutation, with the same args, as
//      the desktop pod — proving the wiring (`useControllerActions`) is reused.
//   3. The phase sheet opens from the Phase tab and routes stop toggles through
//      the SAME `useSkipPhasePreferences().toggle(phase, side)` path.
//   4. The single seam picks pod vs. bar: landscape mounts the pod, portrait the
//      bar — exactly one, so the shortcut/mutation hook never doubles.
//   5. Zero layout shift: exactly one fixed-size primary slot, Pass Turn always
//      mounted (disabled-aware), own life always on the bar.
//   6. The viewer's zone chips — which used to sit UNDER the bar — are reachable
//      again from the Zones tab.
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
// The real pile-chip row drags in every pile dialog; it has its own suite
// (`board-portrait-chips.test.tsx`). Here we only care THAT the Zones tab mounts
// it for the viewer's seat.
vi.mock("../board-pile-chips", () => ({
    default: ({ player }: { player: Player }) => (
        <div data-testid={`pile-chips-${player.id}`} />
    ),
}));
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
    it("shows the fixed-width phase tab and a primary Pass action", () => {
        renderController();
        // Fixed-width `T<n> · <group>` form — the step name (which varies in
        // width) stays inside the sheet.
        expect(screen.getByText("T1 · Main 1")).toBeTruthy();
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

describe("Variant D bar — no layout shift, nothing buried (#1759)", () => {
    it("keeps own life on the bar, with the opponent's total as the subline", () => {
        renderController({
            allPlayers: [
                makePlayer({ id: "me", life: 17 }),
                makePlayer({ id: "opp", life: 12 }),
            ],
        });
        const life = screen.getByLabelText("Your life total: 17");
        expect(life.textContent).toContain("17");
        expect(life.textContent).toContain("vs 12");
    });

    it("mounts exactly one primary slot and always mounts Pass Turn", () => {
        // Priority: Pass owns the primary slot, Pass Turn is enabled.
        const { unmount } = renderController();
        expect(screen.getByText(/^Pass$/)).toBeTruthy();
        expect(
            screen.getByLabelText("Pass Turn").hasAttribute("disabled")
        ).toBe(false);
        unmount();

        // No priority: the SAME two slots are still mounted — the bar cannot
        // reflow — but Pass Turn is disabled rather than removed.
        renderController({ priorityPlayerId: "opp" });
        expect(screen.getByText(/^Pass$/)).toBeTruthy();
        expect(
            screen.getByLabelText("Pass Turn").hasAttribute("disabled")
        ).toBe(true);
    });

    it("morphs the primary slot to the contextual action, demoting nothing", () => {
        renderController({
            phase: "DECLARE_ATTACKERS",
            combat: { attackerIds: [], confirmed: false } as never,
        });
        // "Skip Attack" (the confirm-attackers descriptor) beats Pass in the
        // primary slot; Pass Turn keeps its own circular slot.
        expect(screen.getByText(/Skip Attack/)).toBeTruthy();
        expect(screen.getByLabelText("Pass Turn")).toBeTruthy();
    });

    it("signals priority with a hairline, self vs opponent", () => {
        const { container, unmount } = renderController();
        const mine = container.querySelector(
            "[data-controller-priority-hairline]"
        );
        expect(mine?.className).toContain("via-signal-self");
        unmount();

        const other = renderController({
            activePlayerId: "opp",
        }).container.querySelector("[data-controller-priority-hairline]");
        expect(other?.className).toContain("via-signal-opponent");
    });

    it("Zones tab reveals the viewer's pile chips (they no longer sit under the bar)", () => {
        const { container } = renderController();
        expect(container.querySelector("[data-controller-zones-drawer]")).toBe(
            null
        );

        fireEvent.click(screen.getByLabelText("Toggle your zones"));
        const drawer = container.querySelector(
            "[data-controller-zones-drawer]"
        );
        expect(drawer).toBeTruthy();
        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();

        fireEvent.click(screen.getByLabelText("Toggle your zones"));
        expect(container.querySelector("[data-controller-zones-drawer]")).toBe(
            null
        );
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
