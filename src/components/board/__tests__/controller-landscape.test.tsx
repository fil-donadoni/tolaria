// Landscape-compact controls (#1769). On a phone held sideways the viewport is
// wide but VERY short, so the desktop pod — ~13rem wide, ~200px of stacked
// content pinned 128px off the bottom, with an oversized two-line phase box —
// does not fit and eats the board. It is replaced by a THIN right-edge control
// strip that reuses the variant-D idioms from the portrait bar (#1759).
//
// The contracts tested here are the acceptance criteria:
//   1. The seam maps each of the THREE `useViewportMode` values to exactly one
//      controls branch — portrait bar / landscape strip / desktop pod.
//   2. Exactly ONE `useControllerActions` instance is mounted in every mode, so
//      the keyboard-shortcut effect and the mutations never double (#335).
//   3. The strip renders the morphing primary CTA and an always-mounted,
//      disabled-aware Pass Turn — the same `selectCommandSlots` rule the
//      portrait bar uses, not a second copy of it.
//   4. Every strip control dispatches the SAME mutation the desktop pod does.
//   5. The phase label opens a phase surface, and its stop toggles route
//      through the SAME `useSkipPhasePreferences` path.
//   6. Zero layout shift: the primary slot and Pass Turn stay mounted at a
//      fixed size regardless of priority.
//   7. The strip publishes its measured WIDTH, and the phase panel anchors to
//      that variable rather than a hard-coded inset.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import {
    BESIDE_CONTROLLER_STRIP,
    CONTROLLER_STRIP_WIDTH_VAR,
} from "~/lib/controller-bar-metrics";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { DEFAULT_SKIP_PREFS, type Side } from "~/lib/skip-phase-prefs";
import type { ViewportMode } from "~/hooks/useViewportMode";
import type { Phase } from "@convex/gre/types";
import type { CardInstance, Player } from "~/types/game";

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
            autoTapForAttackTax: "autoTapForAttackTax",
            cancelAttackTax: "cancelAttackTax",
            toggleAttacker: "toggleAttacker",
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
let mode: ViewportMode = "landscape-compact";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => mode,
}));

// Counts LIVE `useControllerActions` instances (mount/unmount balanced, so it
// is immune to re-renders and StrictMode double-invocation). The real hook is
// still what runs — only an instrumentation wrapper is added — so the mutation
// assertions below exercise the genuine wiring.
const live = { count: 0 };
vi.mock("~/hooks/useControllerActions", async (importOriginal) => {
    const mod =
        await importOriginal<typeof import("~/hooks/useControllerActions")>();
    const { useEffect } = await import("react");
    return {
        ...mod,
        useControllerActions: () => {
            useEffect(() => {
                live.count += 1;
                return () => {
                    live.count -= 1;
                };
            }, []);
            return mod.useControllerActions();
        },
    };
});

// Chrome irrelevant to these contracts.
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
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
                    <MinimizedChoiceContext value={noopMinimized}>
                        <Controller onOpenMenu={() => {}} />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </SkipPhasePrefsContext>
        </GameContext>
    );
}

const SURFACES = {
    portrait: "[data-controller-bottom-bar]",
    "landscape-compact": "[data-controller-landscape-strip]",
    desktop: "[data-controller-pod]",
} as const satisfies Record<ViewportMode, string>;

beforeEach(() => {
    calls.length = 0;
    live.count = 0;
    mode = "landscape-compact";
});

afterEach(() => {
    document.documentElement.style.removeProperty(CONTROLLER_STRIP_WIDTH_VAR);
});

describe("Controller seam — mode → controls branch (#335, #1769)", () => {
    // The whole point of the seam: three modes, three surfaces, and NEVER two
    // at once. Two mounted surfaces would run `useControllerActions` twice,
    // double-binding its keydown listener (one Space = two passed priorities).
    for (const m of Object.keys(SURFACES) as ViewportMode[]) {
        it(`${m} mounts exactly its own controls branch`, () => {
            mode = m;
            const { container } = renderController();

            expect(container.querySelector(SURFACES[m])).toBeTruthy();
            for (const other of Object.keys(SURFACES) as ViewportMode[]) {
                if (other === m) continue;
                expect(container.querySelector(SURFACES[other])).toBeNull();
            }
        });

        it(`${m} mounts exactly ONE useControllerActions instance`, () => {
            mode = m;
            const { unmount } = renderController();
            expect(live.count).toBe(1);
            unmount();
            expect(live.count).toBe(0);
        });
    }
});

describe("Landscape strip — same controls, same mutations (#1769)", () => {
    it("shows the fixed-width phase label and a primary Pass action", () => {
        renderController();
        // Fixed-width `T<n> · <group>` form — the step name (which varies in
        // width, and made the pod's phase box oversized) stays in the panel.
        expect(screen.getByText("T1 · Main 1")).toBeTruthy();
        // The primary action is the SAME "Pass" the desktop pod renders.
        fireEvent.click(screen.getByText(/^Pass$/));
        const pass = calls.find((c) => c.ref === "passPriority");
        expect(pass?.args).toMatchObject({ gameId: "game-id", playerId: "me" });
    });

    it("Pass Turn dispatches endTurn", () => {
        renderController();
        fireEvent.click(screen.getByLabelText("Pass Turn"));
        const end = calls.find((c) => c.ref === "endTurn");
        expect(end?.args).toMatchObject({ gameId: "game-id", playerId: "me" });
    });

    it("declaring attackers: the primary morphs to Confirm Attackers and dispatches it", () => {
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

    it("auto-passing: the status pill occupies the primary slot and cancels", () => {
        renderController({ autoPassPlayers: ["me"], priorityPlayerId: "opp" });
        fireEvent.click(screen.getByText(/Auto-passing\.\.\. \(cancel\)/));
        expect(calls.map((c) => c.ref)).toContain("cancelAutoPass");
    });

    it("Space still routes through the shared hook in landscape", () => {
        renderController();
        fireEvent.keyDown(window, { code: "Space" });
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });
});

describe("Landscape strip — no layout shift (#1769)", () => {
    it("mounts exactly one primary slot and always mounts Pass Turn", () => {
        // Priority: Pass owns the primary slot, Pass Turn is enabled.
        const { unmount } = renderController();
        expect(screen.getByText(/^Pass$/)).toBeTruthy();
        expect(
            screen.getByLabelText("Pass Turn").hasAttribute("disabled")
        ).toBe(false);
        unmount();

        // No priority: the SAME two slots are still mounted — the strip cannot
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
        // primary slot; the remaining actions stay reachable as side pills, and
        // Pass Turn keeps its own dedicated row.
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
});

describe("Landscape phase surface — the panel, not the md:hidden sheet (#1769)", () => {
    // A landscape phone is ≥768px WIDE, so `ControllerPhaseSheet`'s `md:hidden`
    // would render it invisible; and a `max-h-[70vh]` bottom sheet would spend
    // 70% of the one dimension this mode is short of. The panel is right-edge,
    // vertically centred and capped at `100vh - 24px` with internal scroll.
    it("opens from the phase label and toggles a YOU stop via useSkipPhasePreferences", () => {
        const toggle = vi.fn();
        const { container } = renderController({}, toggle);

        expect(screen.queryByRole("dialog")).toBeNull();
        fireEvent.click(screen.getByLabelText("Toggle phase list"));

        const panel = screen.getByRole("dialog");
        expect(panel).toBeTruthy();
        // Not the portrait bottom sheet: that surface must not mount here.
        expect(container.querySelector("[data-phase-sheet]")).toBeNull();

        // A YOU stop toggle routes through the identical path the desktop panel
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

    it("the strip's own phase button closes the panel again, not the click-away", () => {
        // Regression guard for the click-away owner list: a pointerdown inside
        // the strip must be ignored by the panel, otherwise it closes a tick
        // before the button's click reopens it and the toggle is one-way.
        renderController();
        const phaseButton = screen.getByLabelText("Toggle phase list");

        fireEvent.click(phaseButton);
        expect(screen.getByRole("dialog")).toBeTruthy();

        fireEvent.pointerDown(phaseButton);
        fireEvent.click(phaseButton);
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("Strip width seam — the panel anchors to what the strip measures", () => {
    // jsdom does no layout, so the contract under test is the plumbing, not
    // pixels: the strip is observed, the observed WIDTH is what gets written,
    // and the panel references the variable rather than a constant.
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
            CONTROLLER_STRIP_WIDTH_VAR
        );
    });

    afterEach(() => {
        globalThis.ResizeObserver = realRO;
    });

    it("publishes the strip's observed width, and removes it on unmount", () => {
        const { container, unmount } = renderController();
        const strip = container.querySelector(
            "[data-controller-landscape-strip]"
        ) as HTMLElement;
        const root = document.documentElement;

        // Seeded on mount, before any observer callback fires.
        expect(root.style.getPropertyValue(CONTROLLER_STRIP_WIDTH_VAR)).toMatch(
            /^[\d.]+px$/
        );

        // The STRIP itself is the observed element, and WIDTH is what is
        // published (the lateral twin of the portrait bar's height).
        const entry = observed.find((o) => o.target === strip);
        expect(entry).toBeTruthy();
        strip.getBoundingClientRect = () =>
            ({ width: 160, height: 124 }) as DOMRect;
        entry!.cb();
        expect(root.style.getPropertyValue(CONTROLLER_STRIP_WIDTH_VAR)).toBe(
            "160px"
        );

        // Removed with the strip, so the desktop pod's phase panel falls back
        // to its historical `right-3`.
        unmount();
        expect(root.style.getPropertyValue(CONTROLLER_STRIP_WIDTH_VAR)).toBe(
            ""
        );
    });

    it("anchors the phase panel beside the strip via the variable, not a fixed inset", () => {
        renderController();
        fireEvent.click(screen.getByLabelText("Toggle phase list"));
        const panel = screen.getByRole("dialog").parentElement as HTMLElement;

        expect(panel.className).toContain(BESIDE_CONTROLLER_STRIP);
        expect(panel.className).toContain(CONTROLLER_STRIP_WIDTH_VAR);
        expect(panel.className).not.toContain("right-3");
    });

    it("the desktop pod mounts no strip, so the panel falls back to its own inset", () => {
        mode = "desktop";
        renderController();
        expect(
            document.documentElement.style.getPropertyValue(
                CONTROLLER_STRIP_WIDTH_VAR
            )
        ).toBe("");
    });
});
