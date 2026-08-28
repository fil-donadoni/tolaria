// Expanded phase list + stops (#333): the full turn-structure surface revealed
// by the pod's CTA. Three contracts are tested here:
//   1. Every phase in PHASE_GROUPS renders (content-sized list, nothing hidden).
//   2. YOU / OPP column heads are present and each stop toggle routes through
//      the SAME `useSkipPhasePreferences().toggle(phase, side)` path the old
//      PhaseStepCell used — only the presentation moved.
//   3. The panel is non-modal with click-away: a pointerdown outside the list
//      (and outside the pod) closes it; one inside does not.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import {
    DEFAULT_SKIP_PREFS,
    SKIPPABLE_PHASES,
    type Side,
} from "~/lib/skip-phase-prefs";
import { PHASE_GROUPS } from "~/lib/phase-labels";
import { makeState } from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { Phase } from "@convex/gre/types";

// The real stop dot renders a Base UI Tooltip, irrelevant to the toggle
// contract and flaky in jsdom. Stand it in with a plain button that surfaces
// the aria-label + click so assertions stay on the contract.
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

const { default: ControllerPhaseList } =
    await import("../controller-phase-list");
const { default: ControllerPhasePanel } =
    await import("../controller-phase-panel");
const { default: ControllerPhaseSheet } =
    await import("../controller-phase-sheet");

type CtxOverrides = Partial<React.ContextType<typeof GameContext>>;

function renderWith(
    node: React.ReactNode,
    ctx: CtxOverrides = {},
    toggle: (phase: Phase, side: Side) => void = () => {}
) {
    const value = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        ...ctx,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <SkipPhasePrefsContext
                value={{ prefs: DEFAULT_SKIP_PREFS, toggle, reset: () => {} }}
            >
                {node}
            </SkipPhasePrefsContext>
        </GameContext>
    );
}

const ALL_STEPS = PHASE_GROUPS.flatMap((g) => g.steps);

describe("ControllerPhaseList — every phase visible", () => {
    it("renders a row for every phase in the turn structure", () => {
        renderWith(<ControllerPhaseList onClose={() => {}} />);
        for (const step of ALL_STEPS) {
            // Labels can collide with the collapsed pod elsewhere; here the
            // list is the only thing rendered, so getAllByText >= 1 is enough.
            expect(screen.getAllByText(step.label).length).toBeGreaterThan(0);
        }
    });

    it("shows YOU and OPP column heads over the stop toggles", () => {
        renderWith(<ControllerPhaseList onClose={() => {}} />);
        expect(screen.getByText("You")).toBeTruthy();
        expect(screen.getByText("Opp")).toBeTruthy();
    });
});

describe("ControllerPhaseList — stop toggles route through the live model", () => {
    it("toggling a YOU stop calls toggle(phase, 'self')", () => {
        const toggle = vi.fn();
        renderWith(<ControllerPhaseList onClose={() => {}} />, {}, toggle);
        fireEvent.click(
            screen.getByLabelText("Stop on my turn (PRECOMBAT_MAIN)")
        );
        expect(toggle).toHaveBeenCalledWith("PRECOMBAT_MAIN", "self");
    });

    it("toggling an OPP stop calls toggle(phase, 'opponent')", () => {
        const toggle = vi.fn();
        renderWith(<ControllerPhaseList onClose={() => {}} />, {}, toggle);
        fireEvent.click(
            screen.getByLabelText("Stop on opponent's turn (DRAW)")
        );
        expect(toggle).toHaveBeenCalledWith("DRAW", "opponent");
    });

    it("renders stop toggles for every skippable phase, both sides", () => {
        renderWith(<ControllerPhaseList onClose={() => {}} />);
        for (const phase of SKIPPABLE_PHASES) {
            expect(
                screen.getByLabelText(`Stop on my turn (${phase})`)
            ).toBeTruthy();
            expect(
                screen.getByLabelText(`Stop on opponent's turn (${phase})`)
            ).toBeTruthy();
        }
    });

    it("does NOT render stop toggles for non-skippable phases (untap, cleanup)", () => {
        renderWith(<ControllerPhaseList onClose={() => {}} />);
        expect(screen.queryByLabelText("Stop on my turn (UNTAP)")).toBeNull();
        expect(screen.queryByLabelText("Stop on my turn (CLEANUP)")).toBeNull();
    });
});

describe("ControllerPhasePanel — non-modal click-away", () => {
    it("closes on a pointerdown outside the list", () => {
        const onClose = vi.fn();
        renderWith(<ControllerPhasePanel onClose={onClose} />);
        // A click on the surrounding board (document body) dismisses it.
        fireEvent.pointerDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT close on a pointerdown inside the list", () => {
        const onClose = vi.fn();
        renderWith(<ControllerPhasePanel onClose={onClose} />);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        fireEvent.pointerDown(within(dialog).getByText("Main Phase 1"));
        expect(onClose).not.toHaveBeenCalled();
    });

    it("does NOT close on a pointerdown inside the pod (CTA owns the toggle)", () => {
        const onClose = vi.fn();
        render(
            <div data-controller-pod>
                <button type="button" data-testid="cta">
                    cta
                </button>
                <GameContext
                    value={
                        {
                            gameId: "game-id",
                            phase: "PRECOMBAT_MAIN",
                            turn: 1,
                        } as unknown as React.ContextType<typeof GameContext>
                    }
                >
                    <SkipPhasePrefsContext
                        value={{
                            prefs: DEFAULT_SKIP_PREFS,
                            toggle: () => {},
                            reset: () => {},
                        }}
                    >
                        <ControllerPhasePanel onClose={onClose} />
                    </SkipPhasePrefsContext>
                </GameContext>
            </div>
        );
        fireEvent.pointerDown(screen.getByTestId("cta"));
        expect(onClose).not.toHaveBeenCalled();
    });

    it("is non-modal: no full-screen blocking overlay is rendered", () => {
        const { container } = renderWith(
            <ControllerPhasePanel onClose={() => {}} />
        );
        // The old modal used a `fixed inset-0` catch-all overlay that blocked
        // the board. The non-modal panel must not render one.
        const blockers = container.querySelectorAll(".inset-0");
        expect(blockers.length).toBe(0);
    });
});

describe("ControllerPhaseRow — compact decoder scoped to the portrait sheet (#1860 review round 3, finding 2)", () => {
    it("the portrait sheet renders the tab's compact step word next to the long label", () => {
        renderWith(<ControllerPhaseSheet onClose={() => {}} />);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        // Deleting the decoder left this suite at 60/60 green (zero coverage,
        // #1860 review round 3 finding 1) — this pins its rendered output.
        expect(within(dialog).getByText("(1ST DMG)")).toBeTruthy();
    });

    it("the desktop pod's panel does NOT render the compact decoder (no width budget for it, and its tab already shows the unabridged label)", () => {
        renderWith(<ControllerPhasePanel onClose={() => {}} />);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        expect(within(dialog).queryByText("(1ST DMG)")).toBeNull();
    });
});

/** CR 500.8 (issue #2886) — the extra-combat header marker.
 *
 *  The marker's value is read THROUGH the real wire reducer
 *  (`projectPublicState`) rather than written into the context by hand: the
 *  whole failure mode this guards is a projection that drops
 *  `extraCombatsThisTurn`, which a hand-built view can never see (a green
 *  test on a field the client never receives). `board.tsx` forwards exactly
 *  the projected field onto the context, which is what these render. */
function renderAtProjectedCombat(
    phase: Phase,
    extraCombatsThisTurn: number | undefined
) {
    const state = makeState({ phase, extraCombatsThisTurn });
    const projected = projectPublicState(state, 1, "p1");
    return renderWith(<ControllerPhaseList onClose={() => {}} />, {
        phase: projected.phase,
        turn: 6,
        extraCombatsThisTurn: projected.extraCombatsThisTurn,
    });
}

describe("ControllerPhaseList — extra combat marker (CR 500.8, issue #2886)", () => {
    it("names which combat is being played once the turn has an extra one", () => {
        renderAtProjectedCombat("DECLARE_ATTACKERS", 1);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        expect(
            within(dialog).getByText("Turn 6 — Phases · Combat 2")
        ).toBeTruthy();
    });

    it("counts up with the queue — a second extra combat reads Combat 3", () => {
        renderAtProjectedCombat("DECLARE_ATTACKERS", 2);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        expect(
            within(dialog).getByText("Turn 6 — Phases · Combat 3")
        ).toBeTruthy();
    });

    it("is absent on an ordinary turn's single combat", () => {
        renderAtProjectedCombat("DECLARE_ATTACKERS", undefined);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        expect(within(dialog).getByText("Turn 6 — Phases")).toBeTruthy();
    });

    it("is absent outside a combat phase — it states the CURRENT position", () => {
        renderAtProjectedCombat("POSTCOMBAT_MAIN", 1);
        const dialog = screen.getByRole("dialog", { name: "Turn phases" });
        expect(within(dialog).getByText("Turn 6 — Phases")).toBeTruthy();
    });
});

beforeEach(() => {
    vi.clearAllMocks();
});
