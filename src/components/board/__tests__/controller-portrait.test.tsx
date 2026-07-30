// Portrait controller (#335), redesigned as variant D (#1759): the right
// control column collapses to a fixed app tab bar (You · Zones · Phase · Menu)
// plus a morphing command row, below the `md:` breakpoint. The contracts
// tested here are the acceptance criteria:
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
//   6. The viewer's zone chips (GY/LIB/EXL) render INLINE in the bar's own
//      "Zones" cell (#1815 review fixup) — not a board-level row, not a
//      toggled drawer. #1815 first tried the board-level mirror; reviewed and
//      reverted (portrait's vertical budget has no spare band for a 44px chip
//      row without overlapping the battlefield). Always mounted, always
//      visible: no tap needed to reach them, unlike the pre-#1815 drawer.
//   7. The You tab is a REAL self-target surface (#1766): a pending player
//      target dispatches the SAME `selectTarget` mutation the nameplate would,
//      with the viewer's own id, and wears the same pulsing ring while
//      targetable.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import { CONTROLLER_BAR_HEIGHT_VAR } from "~/lib/controller-bar-metrics";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { SkipPhasePrefsContext } from "~/hooks/useSkipPhasePreferences";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { DEFAULT_SKIP_PREFS, type Side } from "~/lib/skip-phase-prefs";
import { phaseCompact, phaseGroupShort, phaseLabel } from "~/lib/phase-labels";
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
// never decides the branch. Mocked at `useViewportMode` (not the `useIsPortrait`
// projection) since #1769 made the seam three-way; `useIsPortrait` reads through
// this mock, so both spellings stay consistent.
let portrait = true;
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => (portrait ? "portrait" : "desktop"),
}));

// Chrome irrelevant to these contracts.
vi.mock("../hotkeys-legend", () => ({ default: () => <div /> }));
vi.mock("../pause-menu-button", () => ({ default: () => <button /> }));
// `BoardPileChips` itself is NOT mocked: the bar's "Zones" cell is the sole
// portrait mount of PlayerLibrary / PlayerGraveyard / PlayerExile for the
// viewer, which own the blocking pile choice surfaces, and a stub would mask
// exactly the softlock the tests below exist to prevent. Only the leaf card
// renderers — pure art — are stubbed out.
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
        engineTurn: 1,
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
        // Caption `T<n>·<groupShort>` form (#1818, `controller-phase-tab.tsx`)
        // — see that component's doc comment for the char/px budget this
        // satisfies. The full step name (which varies in width) stays inside
        // the sheet.
        expect(screen.getByText("T1·MAI")).toBeTruthy();
        // The granular step word is now its own prominent value element
        // (#1818 review fixup: a readable word, not a 2-letter code).
        expect(screen.getByText("MAIN 1")).toBeTruthy();
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
});

describe("Bottom bar tab set (#1815 review fixup, finding 4; widened round 2)", () => {
    it("pins 4 cells (You / Zones-chips / Phase / Menu) to a grid-cols-6, the zone-chips cell spanning 3", () => {
        // Round 2: the zone-chips cell went from an equal quarter
        // (`grid-cols-4`) to HALF the bar (`grid-cols-6` + `col-span-3`) — it
        // holds THREE chips, so it needs 3x a single tap target's width, not
        // 1x. See `controller-bottom-bar.tsx`'s module doc comment and
        // `pile-chip.tsx`'s `compact` doc comment for the touch-target math
        // this fixes (#1815 review fixup round 2, finding 1).
        const { container } = renderController();
        const row = container.querySelector(
            "[data-controller-bottom-bar] .grid"
        ) as HTMLElement;
        expect(row.className).toContain("grid-cols-6");
        expect(row.children.length).toBe(4);

        // Cell 1: You (life tab) — `ControllerTabButton` IS the grid cell
        // itself (the aria-label lives on the cell, not a descendant), so
        // identify each cell by reference rather than `within(cell)`.
        const youTab = screen.getByLabelText(/Your life total/);
        expect(youTab.parentElement).toBe(row);
        expect(row.children[0]).toBe(youTab);

        // Cell 2: the viewer's zone chips, inline — the testid is on the
        // cell itself, not a descendant. `col-span-3` gives it half the bar.
        const zoneChipsCell = screen.getByTestId("controller-bar-zone-chips");
        expect(row.children[1]).toBe(zoneChipsCell);
        expect(zoneChipsCell.className).toContain("col-span-3");
        expect(within(zoneChipsCell).getByTestId(`pile-chips-me`)).toBeTruthy();

        // Cell 3: Phase.
        const phaseTab = screen.getByLabelText(/Toggle phase list/);
        expect(row.children[2]).toBe(phaseTab);

        // Cell 4: Menu.
        const menuTab = screen.getByLabelText("Open game menu");
        expect(row.children[3]).toBe(menuTab);
    });
});

describe("Phase tab caption — compact, untruncated at the 320px floor (#1815 review fixup round 3, finding 1)", () => {
    // Char/px budget: at `grid-cols-6` the Phase tab is 1/6 of the bar — ~53px
    // @320px, ~65px @390px (see `controller-bottom-bar.tsx`'s module doc
    // comment). `ControllerTabButton`'s label span's own `px-1` eats ~8px,
    // leaving ~45-57px of usable text width. At `text-[9px]` uppercase with
    // `tracking-[0.14em]` (~1.26px letter-spacing/char atop a ~5-6px average
    // glyph advance) that usable width fits ~7 characters at the 320px floor.
    // The old `T{turn} · {phaseGroupLabel}` form was 11 chars for EVERY group
    // ("T1 · MAIN 1", "T1 · MAIN 2", "T1 · COMBAT") — well past that budget.
    // #1818's `T{turn}·{phaseGroupShort}` form is at most 7 chars ("T1·COM",
    // "T1·MAI", "T1·BEG", "T1·END") — inside the same budget every one of
    // these earlier fixups established.
    //
    // Review fixup: the previous version of this test asserted
    // `caption.length <= 7` against the LITERAL from its own `it.each` table
    // — that always passes regardless of what the component renders, since
    // it measures a string the test itself wrote, not the component's
    // output. The budget check below now runs against the actual DOM node's
    // `textContent`, and the expected string is derived from the same
    // `phaseGroupShort` the production code calls, not a hand-maintained
    // parallel table.
    it.each([
        "PRECOMBAT_MAIN",
        "POSTCOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
    ] as const)("renders %s's caption within the char budget", (phase) => {
        renderController({ phase: phase as Phase, turn: 1 });
        const expected = `T1·${phaseGroupShort(phase as Phase)}`;
        const captionEl = screen.getByText(expected);
        // Asserts on the RENDERED node's own text, not the literal used to
        // find it.
        expect(captionEl.textContent).toBe(expected);
        expect(captionEl.textContent!.length).toBeLessThanOrEqual(7);
    });

    it("renders the caption untruncated for a double-digit turn too", () => {
        renderController({ phase: "DECLARE_ATTACKERS", turn: 12 });
        const captionEl = screen.getByText("T12·COM");
        expect(captionEl.textContent).toBe("T12·COM");
        expect(captionEl.textContent!.length).toBeLessThanOrEqual(7);
    });
});

describe("Phase tab step value — visible difference between the 6 combat sub-steps, as readable words (#1818 review fixup)", () => {
    // The granular step WORD (`phaseCompact`) is now its own prominent
    // element (`data-controller-phase-step`), distinct from the compact
    // group caption tested above — see `controller-phase-tab.tsx`'s doc
    // comment. This is the AC this issue exists for: a player must be able
    // to tell Declare Attackers from Declare Blockers from Combat Damage
    // WITHOUT opening the phase sheet, and without first learning a 2-letter
    // code legend (the review fixup's whole point — a bare code is still not
    // "readable").
    it.each([
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
    ] as const)(
        "renders %s's step value as its distinct readable word",
        (phase) => {
            const { container } = renderController({ phase: phase as Phase });
            const stepEl = container.querySelector(
                "[data-controller-phase-step]"
            );
            expect(stepEl?.textContent).toBe(phaseCompact(phase));
        }
    );

    it("Declare Attackers and Declare Blockers render visibly different step values, not just different DOM attributes", () => {
        const attackers = renderController({ phase: "DECLARE_ATTACKERS" });
        const attackersStep = attackers.container.querySelector(
            "[data-controller-phase-step]"
        )?.textContent;
        attackers.unmount();

        const blockers = renderController({ phase: "DECLARE_BLOCKERS" });
        const blockersStep = blockers.container.querySelector(
            "[data-controller-phase-step]"
        )?.textContent;

        expect(attackersStep).toBe("ATTACK");
        expect(blockersStep).toBe("BLOCK");
        expect(attackersStep).not.toBe(blockersStep);
    });

    it("renders no Flag glyph — the value row is the step word alone (review fixup)", () => {
        // The first pass of #1818 kept a static `Flag` icon (`lucide-react`)
        // next to the promoted step value; review fixup: it never changed
        // and cost width the value row needed for a full word instead of a
        // 2-letter code. It must not render at all now.
        const { container } = renderController({ phase: "DECLARE_ATTACKERS" });
        const stepEl = container.querySelector("[data-controller-phase-step]");
        expect(stepEl?.querySelector("svg")).toBeNull();
    });
});

describe("Phase tab aria-label — granular phase reaches screen readers (#1818 review fixup)", () => {
    it("names the tab with the turn and the full-word phase label, not just the static toggle hint", () => {
        renderController({ phase: "DECLARE_ATTACKERS", turn: 3 });
        const expected = `Turn 3, ${phaseLabel("DECLARE_ATTACKERS")}. Toggle phase list`;
        expect(screen.getByLabelText(expected)).toBeTruthy();
    });
});

describe("Zone chips, inline in the bar (#1815 review fixup)", () => {
    it("mounts the viewer's real pile chips ALWAYS visible — no toggle, no drawer", () => {
        // Driven through the REAL BoardPileChips (no stub): it is the sole
        // portrait mount of PlayerLibrary / PlayerGraveyard / PlayerExile for
        // the viewer, and those own the blocking choice surfaces. Always
        // mounted AND always visible this time — there is no `hidden` wrapper
        // and no toggle state to drive.
        const { container } = renderController();
        const cell = container.querySelector(
            "[data-testid='controller-bar-zone-chips']"
        ) as HTMLElement;
        expect(cell).toBeTruthy();
        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();
        expect(screen.getByTestId("chip-library-me")).toBeTruthy();
    });

    it("tapping the viewer's graveyard chip opens the EXISTING reveal view directly", () => {
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
                        {
                            id: "g2",
                            card: { id: "def-g2" },
                            controllerId: "me",
                            ownerId: "me",
                            zone: "graveyard",
                            isTapped: false,
                        } as CardInstance,
                    ],
                }),
            ],
        });

        fireEvent.click(screen.getByTestId("chip-graveyard-me"));

        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getAllByText(/Graveyard \(2\)/).length
        ).toBeGreaterThan(0);
    });

    it("a blocking graveyard pick surfaces its picker with zero taps — no drawer to open first", () => {
        // The softlock regression, end to end through the real components:
        // PendingChoicePrompt renders nothing for a pile-owned choice, so if
        // this cell were ever hidden the chooser would get NO UI. It never is.
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

        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain(
            "Choose a card from your graveyard"
        );
    });

    it("a blocking exile pick (choose-exile-card, CR 608.2) surfaces its picker with zero taps", () => {
        const choice = {
            kind: "choose-exile-card",
            playerId: "me",
            zone: "exile",
            count: 1,
            prompt: "Choose an exiled card",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
        } as unknown as PendingChoice;

        renderController({
            allPlayers: [
                makePlayer({
                    id: "me",
                    exile: [
                        {
                            id: "x1",
                            card: { id: "def-x1" },
                            controllerId: "me",
                            ownerId: "me",
                            zone: "exile",
                            isTapped: false,
                        } as CardInstance,
                    ],
                }),
            ],
            pendingChoices: [choice],
        });

        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain("Choose an exiled card");
    });

    it("a blocking library order pick (order-top, CR 701.22 scry) surfaces the drag picker with zero taps", () => {
        // `order-top`/`reorder-library` route through `LibraryOrderPicker`
        // (`createPortal` to `document.body`, not a GameDialog `role=dialog`)
        // — the one force-open branch the pre-fixup coverage never exercised
        // (#1815 review finding 3).
        const choice = {
            kind: "order-top",
            playerId: "me",
            zone: "library",
            count: 1,
            prompt: "Order the top of your library",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            destination: "none",
        } as unknown as PendingChoice;

        renderController({
            allPlayers: [
                makePlayer({
                    id: "me",
                    libraryPeek: [
                        {
                            id: "l1",
                            card: { id: "def-l1" },
                            controllerId: "me",
                            ownerId: "me",
                            zone: "library",
                            isTapped: false,
                        } as CardInstance,
                    ],
                }),
            ],
            pendingChoices: [choice],
        });

        expect(screen.getByText("Order the top of your library")).toBeTruthy();
        expect(screen.getByLabelText("Minimize choice dialog")).toBeTruthy();
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
    // grown bar covered the hand strip's bottom edge (eating taps) and (pre
    // #1815) the Zones drawer's own edge; the viewer's zone chips are back in
    // the bar itself now (#1815 review fixup), so they need no separate
    // consumer of this variable any more — only the hand strip does. The bar
    // therefore PUBLISHES what it measures and the consumer anchors to that
    // variable.
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
});

describe("Portrait phase sheet — same stop-toggle path", () => {
    it("opens from the phase chip and toggles a YOU stop via useSkipPhasePreferences", () => {
        const toggle = vi.fn();
        renderController({}, toggle);
        // The chip is the toggle for the phase list (aria-label).
        fireEvent.click(screen.getByLabelText(/Toggle phase list/));
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
        fireEvent.click(screen.getByLabelText(/Toggle phase list/));
        fireEvent.click(
            screen.getByLabelText("Stop on opponent's turn (PRECOMBAT_MAIN)")
        );
        expect(toggle).toHaveBeenCalledWith("PRECOMBAT_MAIN", "opponent");
    });
});
