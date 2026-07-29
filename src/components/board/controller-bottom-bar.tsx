import { useState } from "react";
import { Menu } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { useControllerBarHeight } from "~/hooks/useControllerBarHeight";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import BoardPileChips from "./board-pile-chips";
import ControllerCommandRow from "./controller-command-row";
import ControllerLifeTab from "./controller-life-tab";
import ControllerTabButton from "./controller-tab-button";
import ControllerPhaseTab from "./controller-phase-tab";
import ControllerPhaseSheet from "./controller-phase-sheet";
import AttackAllConfirmDialog from "./attack-all-confirm-dialog";

/** Portrait controller (#335), redesigned as variant D "Refined fusion"
 *  (#1758/#1759, user-approved from the `prototype/mobile-bottom-bar` audit).
 *
 *  An app tab bar owns the bottom edge — **You** (own life, opponent's as a
 *  `vs N` subline) · **Zones** (the viewer's GY/LIB/EXL chips, inline) ·
 *  **Phase** · **Menu** — with a floating command row above it. The three
 *  complaints the audit raised are structural, not cosmetic, so the layout
 *  answers each one directly:
 *
 *  - *Own life and the zone chips were buried under the bar.* Life is now ON
 *    the bar (and is the self-target surface).
 *  - *Buttons appeared and disappeared, so the bar reflowed constantly.* There
 *    is exactly ONE fixed-size primary slot that morphs (see
 *    {@link selectCommandSlots}), Pass Turn is always mounted and merely greys
 *    out, and every tab is a fixed quarter of the width — the phase label
 *    truncates instead of resizing its neighbours.
 *  - *The priority border was a chunky colour slab.* Priority is a 2px gradient
 *    hairline on the bar's top edge.
 *
 *  **Zone chips, inline, not a drawer (#1815, review fixup).** #1815 first
 *  tried mounting the viewer's GY/LIB/EXL row on the BOARD itself, mirroring
 *  the opponent's top-left placement to the bottom-left. Reviewed and
 *  reverted: portrait's vertical budget is fully accounted for
 *  (`portrait-board-bands.ts`) and has no spare ~44px band for a chip row
 *  without either overlapping the battlefield's back row or starving its
 *  ≥44px card-width floor (the #1760 bug class, from a new angle). The
 *  second-place slot this freed up — this bar's own third tab, "Zones" before
 *  #1815 removed it — is where the chips land instead: {@link BoardPileChips}
 *  in `compact` mode, mounted directly in the grid cell, ALWAYS visible (no
 *  toggle, no drawer to open — the previous "Zones" tab opened a floating
 *  drawer; this is simpler, one tap fewer). That makes the bar asymmetric
 *  with the board (opponent's row lives on the board, the viewer's lives in
 *  the bar) — accepted: a true mirror is geometrically impossible without
 *  starving the battlefield, and the asymmetry this ticket actually needed to
 *  kill was the EXTRA TAP through a drawer, not the chips' screen position.
 *  Because the cell is always mounted and always visible, the pile
 *  components' own blocking choice surfaces (`LibraryOrderPicker`, the
 *  `forceOpen` pile grids) are on-screen the instant a choice goes pending —
 *  no force-open plumbing needed, unlike the old drawer (which had to force
 *  itself open past a `hidden` wrapper).
 *
 *  **The zone-chips cell is DOUBLE-WIDTH (#1815 review fixup, round 2).**
 *  Round 1 gave the chips cell an equal quarter of the bar (`grid-cols-4`),
 *  same as You/Phase/Menu — but a quarter is ONE tap target's worth of width,
 *  and this cell holds THREE (GY/LIB/EXL). Splitting ~80-97.5px three ways
 *  landed each chip at 23-29px, under both the #1770 44px floor and the raw
 *  24px WCAG minimum. The grid is now `grid-cols-6` with the chips cell at
 *  `col-span-3` (half the bar) and You/Phase/Menu at one column each
 *  (1+3+1+1=6) — the chips cell alone is now what a full quarter used to be
 *  ×1.5, giving each of its 3 chips ≈48-65px across the 320-390px range (see
 *  `pile-chip.tsx`'s `compact` doc comment for the exact math and the
 *  `min-w-11` backstop). You/Phase/Menu drop from ~80-97.5px to ~53-65px —
 *  still well above the 44px floor for a single (non-subdivided) tap target,
 *  and their labels already truncate (`ControllerTabButton`) rather than
 *  reflow the bar.
 *
 *  **The Phase tab's label is compacted, not just left to truncate (#1815
 *  review fixup round 3, finding 1).** At `grid-cols-6` the Phase tab is a
 *  single column — ~53px @320px, ~65px @390px — and `ControllerTabButton`'s
 *  label span eats ~8px of that in its own `px-1`, leaving ~45-57px of usable
 *  text. At `text-[9px]` uppercase with `tracking-[0.14em]` (~1.26px of
 *  letter-spacing per character on top of a ~5-6px average glyph advance),
 *  that usable width holds only ~7 characters at the 320px floor. The old
 *  `T{turn} · {phaseGroupLabel}` form was 11 characters for both Main phases
 *  ("T1 · MAIN 1", "T1 · MAIN 2") and for Combat ("T1 · COMBAT") — well past
 *  the ~7-char budget, so it truncated mid-word and lost the Main 1 vs Main 2
 *  digit entirely. The compact `T{turn}·{phaseShort(phase)}` form
 *  (`phase-labels.ts`'s `PhaseStep.short`, 2 letters) is 5 characters for a
 *  single-digit turn — "T1·M1" / "T1·M2" for the two mains, "T1·BC" /
 *  "T1·DA" / "T1·DB" / "T1·FD" / "T1·CD" / "T1·EC" for the six combat
 *  sub-steps — comfortably inside the budget, so every one of those stays
 *  distinct and untruncated at 320px.
 *
 *  **The granular step is now its own prominent element, not just buried in
 *  the compact string (#1818).** The compact form above IS technically
 *  distinct per sub-step, but only as a 2-letter code embedded in 9px text —
 *  readable once you already know the codes, cryptic otherwise. #1818 extracts
 *  the tab into its own file, {@link ControllerPhaseTab}, which mirrors the
 *  desktop pod's caption/value split (`controller-pod.tsx`): the step code
 *  moves to a bold, larger "value" row (replacing the static Flag glyph this
 *  bar used to show), and this bar's caption slot now carries only
 *  `T{turn}·{phaseGroupShort}` (the broad group, e.g. "T1·COM" for every
 *  combat sub-step) — see that component's doc comment for the full design
 *  rationale and char/px budget.
 *
 *  **NIT (round 3, finding 4, comment-only): the zone-chips cell's 3×
 *  `min-w-11` floor has its own lower bound.** `pile-chip.tsx`'s `compact`
 *  math assumes the `col-span-3` cell has room for 3 × 44px (132px); below
 *  ~304px total bar width the cell can't give all three chips their
 *  `min-w-11` floor and they overflow their row instead of shrinking under
 *  it (an overflow reads better than a silently-too-small tap target, but is
 *  still a visual regression). 320px (the supported floor elsewhere in this
 *  file and `pile-chip.tsx`) stays comfortably above that ~304px line, so no
 *  code change — this is the documented margin, not a live bug.
 *
 *  It stays a pure presentation fork of {@link ControllerPod}: it reads the SAME
 *  `useControllerActions` descriptors, so every control dispatches the IDENTICAL
 *  mutation, and the phase sheet reuses the SAME `useSkipPhasePreferences`
 *  stop-toggle path. Exactly one of pod/bar mounts (the #335 seam), so the
 *  hook — and its keyboard shortcuts — never doubles. No GRE changes. */
export default function ControllerBottomBar({
    onOpenMenu,
}: {
    onOpenMenu: () => void;
}) {
    const { phase, turn, activePlayerId, playerId, allPlayers } =
        useGameContext();
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    // The bar's height is state-dependent (the command row wraps), so nothing
    // may reserve a fixed inset for it — it publishes what it measures and the
    // hand strip anchors to that. See controller-bar-metrics.ts.
    const barRef = useControllerBarHeight<HTMLDivElement>();

    // Same derivation the board uses; the context's `playerId` IS the viewer.
    const me = allPlayers.find((p) => p.id === playerId);
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const isMyTurn = activePlayerId === playerId;
    const slots = selectCommandSlots(actions);

    return (
        <>
            <div
                ref={barRef}
                data-controller-bottom-bar
                data-cue={cue}
                className="fixed inset-x-0 bottom-0 z-40 flex flex-col md:hidden"
            >
                <ControllerCommandRow slots={slots} />

                {/* Priority hairline — the whole priority signal, 2px tall. */}
                <div
                    data-controller-priority-hairline
                    className={`h-0.5 bg-gradient-to-r from-transparent to-transparent ${
                        isMyTurn ? "via-signal-self" : "via-signal-opponent/70"
                    }`}
                />

                <div
                    className="grid grid-cols-6 bg-gradient-to-t from-surface-base to-surface-base/85 backdrop-blur-xl"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    {/* A missing viewer seat is not a real game state, but the
                        placeholder keeps the grid at 6 columns regardless. */}
                    {me ? (
                        <ControllerLifeTab
                            me={me}
                            opponent={opponent}
                            isMyTurn={isMyTurn}
                        />
                    ) : (
                        <span />
                    )}

                    {/* The viewer's zone chips, inline (#1815 review fixup —
                        see the module doc comment). Always mounted, always
                        visible: no toggle state, unlike the other three
                        tabs. `col-span-3` (review fixup round 2): this cell
                        holds THREE chips, so it gets half the bar instead of
                        an equal quarter — see the module doc comment for the
                        touch-target math this fixes. */}
                    {me ? (
                        <div
                            className="col-span-3 flex h-[3.25rem] items-center justify-center px-1"
                            data-testid="controller-bar-zone-chips"
                        >
                            <BoardPileChips player={me} compact />
                        </div>
                    ) : (
                        <span className="col-span-3" />
                    )}

                    <ControllerPhaseTab
                        phase={phase}
                        turn={turn}
                        open={sheetOpen}
                        onToggle={() => setSheetOpen((v) => !v)}
                    />

                    <ControllerTabButton
                        label="Menu"
                        ariaLabel="Open game menu"
                        onClick={onOpenMenu}
                    >
                        <Menu className="h-[1.1rem] w-[1.1rem]" aria-hidden />
                    </ControllerTabButton>
                </div>
            </div>

            {sheetOpen && (
                <ControllerPhaseSheet onClose={() => setSheetOpen(false)} />
            )}

            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </>
    );
}
