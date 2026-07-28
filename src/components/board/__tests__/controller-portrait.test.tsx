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
//   7. The You tab is a REAL self-target surface (#1766): a pending player
//      target dispatches the SAME `selectTarget` mutation the nameplate would,
//      with the viewer's own id, and wears the same pulsing ring while
//      targetable.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    ABOVE_CONTROLLER_BAR,
    CONTROLLER_BAR_HEIGHT_VAR,
} from "~/lib/controller-bar-metrics";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { DEFAULT_SKIP_PREFS, type Side } from "~/lib/skip-phase-prefs";
import type { Phase } from "@convex/gre/types";
import type { CardInstance, PendingChoice, Player } from "~/types/game";

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
            selectTarget: "selectTarget",
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
// `BoardPileChips` itself is NOT mocked: it is the reducer under test here (it
// is the sole portrait mount of PlayerLibrary / PlayerGraveyard / PlayerExile,
// which own the blocking choice surfaces), and a stub would mask exactly the
// softlock these tests exist to prevent. Only the leaf card renderers — pure
// art — are stubbed out.
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="card-image" data-card-id={card.id} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: ({ cardInstance }: { cardInstance: CardInstance }) => (
        <div data-testid="selectable-card" data-card-id={cardInstance.id} />
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

type CtxOverrides = Partial<React.ContextType<typeof GameContext>>;

function renderController(
    ctx: CtxOverrides = {},
    toggle: (phase: Phase, side: Side) => void = () => {},
    bufferOverrides: Partial<PendingChoiceBuffer> = {}
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
    const buffer: PendingChoiceBuffer = { ...noopBuffer, ...bufferOverrides };
    return render(
        <GameContext value={value}>
            <SkipPhasePrefsContext
                value={{ prefs: DEFAULT_SKIP_PREFS, toggle, reset: () => {} }}
            >
                <PendingChoiceBufferContext value={buffer}>
                    <MinimizedChoiceContext value={noopMinimized}>
                        <Controller onOpenMenu={() => {}} />
                    </MinimizedChoiceContext>
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

    it("Zones tab toggles the drawer's VISIBILITY — the viewer's real pile chips stay mounted", () => {
        // Driven through the REAL BoardPileChips (no stub): it is the sole
        // portrait mount of PlayerLibrary / PlayerGraveyard / PlayerExile, and
        // those own the blocking choice surfaces. Unmounting the drawer while
        // closed therefore softlocks a scry / search / graveyard pick, so the
        // contract is mounted-always, hidden-when-closed.
        const { container } = renderController();
        const drawer = () =>
            container.querySelector(
                "[data-controller-zones-drawer]"
            ) as HTMLElement;

        expect(drawer()).toBeTruthy();
        expect(drawer().dataset.open).toBe("false");
        expect(drawer().className).toContain("hidden");
        expect(drawer().getAttribute("aria-hidden")).toBe("true");
        // Mounted, not merely present: the real chip row is inside it.
        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();
        expect(screen.getByTestId("chip-library-me")).toBeTruthy();

        fireEvent.click(screen.getByLabelText("Toggle your zones"));
        expect(drawer().dataset.open).toBe("true");
        expect(drawer().className).not.toContain("hidden");
        expect(drawer().getAttribute("aria-hidden")).toBe("false");
        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();

        fireEvent.click(screen.getByLabelText("Toggle your zones"));
        expect(drawer().dataset.open).toBe("false");
        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();
    });

    it("a blocking graveyard pick surfaces its picker with the Zones drawer closed", () => {
        // The softlock regression, end to end through the real components:
        // PendingChoicePrompt renders nothing for a pile-owned choice, so if
        // the drawer is unmounted while closed the chooser gets NO UI.
        const choice = {
            kind: "choose-graveyard-card",
            playerId: "me",
            zone: "graveyard",
            count: 1,
            prompt: "Choose a card from your graveyard",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
        } as unknown as PendingChoice;

        renderController({
            allPlayers: [
                makePlayer({
                    id: "me",
                    graveyard: [
                        {
                            id: "g1",
                            card: { id: "def-g1" },
                            controllerId: "me",
                            ownerId: "me",
                            zone: "graveyard",
                            isTapped: false,
                        } as CardInstance,
                    ],
                }),
            ],
            pendingChoices: [choice],
        });

        // Never opened the Zones tab — the pick's own modal is up anyway.
        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain(
            "Choose a card from your graveyard"
        );
        // …and the drawer forces itself open so the chips behind it are usable.
        expect(
            screen
                .getByLabelText("Toggle your zones")
                .getAttribute("aria-expanded")
        ).toBe("true");
    });
});

describe("You tab — real self-target surface (#1766)", () => {
    // A player-target spell/ability pending on the viewer, targeting THEM (not
    // routed through a hand-built view — the same `pendingTarget` shape
    // `usePlayerInteraction` reads off `useGameContext()` for the nameplate).
    const selfPlayerTarget = {
        playerId: "me",
        cardInstanceId: "spell-1",
        targetType: "player" as const,
        count: 1,
        selected: [],
    };

    it("tapping the You tab fires the SAME selectTarget mutation the nameplate would, with the viewer's own id", () => {
        renderController({ pendingTarget: selfPlayerTarget });

        fireEvent.click(screen.getByLabelText("Your life total: 20"));

        const call = calls.find((c) => c.ref === "selectTarget");
        expect(call?.args).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            targetType: "player",
            targetId: "me",
        });
    });

    it("wears the pulsing target ring while a player-target selection is active, not otherwise", () => {
        const { unmount } = renderController({
            pendingTarget: selfPlayerTarget,
        });
        const targetableTab = screen.getByLabelText("Your life total: 20");
        expect(targetableTab.className).toContain("ring-2");
        expect(targetableTab.className).toContain("animate-pulse");
        unmount();

        const idleTab = renderController().container.querySelector(
            "[aria-label='Your life total: 20']"
        ) as HTMLElement;
        expect(idleTab.className).not.toContain("ring-2");
    });

    it("routes a choose-damage-target pick owed to the viewer through the pending-choice buffer, not selectTarget", () => {
        // Cuombajj Witches (CR 115.4/608.2) style: the viewer is the chooser
        // and their own seat is a candidate — `useSelfTargetTab` must treat
        // `isDamageTargetPickable` as targetable too (not only `isTargetable`).
        const witchesChoice: PendingChoice = {
            stackItemId: "witches",
            step: 0,
            choiceId: "cuombajj-witches",
            playerId: "me",
            kind: "choose-damage-target",
            zone: "battlefield",
            allControllers: true,
            count: 1,
            prompt: "Cuombajj Witches: choose any target.",
            candidateIds: [],
            candidatePlayerIds: ["me"],
        };
        const toggle = vi.fn();

        renderController({ pendingChoices: [witchesChoice] }, () => {}, {
            toggle,
        });

        const tab = screen.getByLabelText("Your life total: 20");
        expect(tab.className).toContain("ring-2");

        fireEvent.click(tab);
        // Proves the click ROUTES through the buffer (the viewer's own id,
        // matching `usePlayerInteraction.handleClick`'s
        // `bufferCtx.toggle(player.id)`), not merely that it fails to select.
        expect(toggle).toHaveBeenCalledWith("me");
        expect(calls.find((c) => c.ref === "selectTarget")).toBeUndefined();
    });
});

describe("Bar height reservation follows the measured height (#1759)", () => {
    // The bar's command row WRAPS, so the bar grows: ~106px on one line, ~150px
    // once DECLARE_ATTACKERS pushes the side pills onto their own line. Anything
    // reserving a fixed inset (the old `bottom-32` = 128px) is then wrong — the
    // grown bar covered the hand strip's bottom edge (eating taps) and the Zones
    // drawer's own edge. The bar therefore PUBLISHES what it measures and the
    // consumers anchor to that variable.
    //
    // jsdom does no layout, so the contract under test is the plumbing, not
    // pixels: the bar is observed, the observed height is what gets written, and
    // the consumers reference the variable rather than a constant.
    type Observed = { target: Element; cb: () => void };
    const observed: Observed[] = [];
    const realRO = globalThis.ResizeObserver;

    beforeEach(() => {
        observed.length = 0;
        class RecordingResizeObserver {
            cb: () => void;
            constructor(cb: () => void) {
                this.cb = cb;
            }
            observe(target: Element) {
                observed.push({ target, cb: this.cb });
            }
            unobserve() {}
            disconnect() {}
        }
        globalThis.ResizeObserver =
            RecordingResizeObserver as unknown as typeof ResizeObserver;
        document.documentElement.style.removeProperty(
            CONTROLLER_BAR_HEIGHT_VAR
        );
    });

    afterEach(() => {
        globalThis.ResizeObserver = realRO;
        document.documentElement.style.removeProperty(
            CONTROLLER_BAR_HEIGHT_VAR
        );
    });

    it("publishes the bar's observed height, and republishes when it grows", () => {
        const { container, unmount } = renderController();
        const bar = container.querySelector(
            "[data-controller-bottom-bar]"
        ) as HTMLElement;
        const root = document.documentElement;

        // Seeded on mount, before any observer callback fires.
        expect(root.style.getPropertyValue(CONTROLLER_BAR_HEIGHT_VAR)).toMatch(
            /^[\d.]+px$/
        );

        // The BAR itself is the observed element (not an ancestor whose height
        // the wrap would not change).
        const entry = observed.find((o) => o.target === bar);
        expect(entry).toBeTruthy();

        // A resize republishes the height the observer saw: the two-line
        // DECLARE_ATTACKERS bar is taller than the 128px that used to be
        // hard-coded, and the reservation now follows it instead of clipping.
        bar.getBoundingClientRect = () => ({ height: 150 }) as DOMRect;
        entry!.cb();
        expect(root.style.getPropertyValue(CONTROLLER_BAR_HEIGHT_VAR)).toBe(
            "150px"
        );

        // Removed with the bar, so landscape / the lobby fall back to the
        // class's own default.
        unmount();
        expect(root.style.getPropertyValue(CONTROLLER_BAR_HEIGHT_VAR)).toBe("");
    });

    it("anchors the Zones drawer to the variable, not a fixed inset", () => {
        const { container } = renderController();
        const drawer = container.querySelector(
            "[data-controller-zones-drawer]"
        ) as HTMLElement;
        expect(drawer.className).toContain(ABOVE_CONTROLLER_BAR);
        expect(drawer.className).toContain(CONTROLLER_BAR_HEIGHT_VAR);
        expect(drawer.className).not.toContain("bottom-32");
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
