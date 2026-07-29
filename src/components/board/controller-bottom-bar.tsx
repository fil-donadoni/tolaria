import { useState } from "react";
import { Flag, Menu } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { useControllerBarHeight } from "~/hooks/useControllerBarHeight";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import { phaseGroupLabel } from "~/lib/phase-labels";
import ControllerCommandRow from "./controller-command-row";
import ControllerLifeTab from "./controller-life-tab";
import ControllerTabButton from "./controller-tab-button";
import ControllerPhaseSheet from "./controller-phase-sheet";
import AttackAllConfirmDialog from "./attack-all-confirm-dialog";

/** Portrait controller (#335), redesigned as variant D "Refined fusion"
 *  (#1758/#1759, user-approved from the `prototype/mobile-bottom-bar` audit).
 *
 *  An app tab bar owns the bottom edge — **You** (own life, opponent's as a
 *  `vs N` subline) · **Phase** · **Menu** — with a floating command row above
 *  it. The three complaints the audit raised are structural, not cosmetic, so
 *  the layout answers each one directly:
 *
 *  - *Own life and the zone chips were buried under the bar.* Life is now ON
 *    the bar (and is the self-target surface). The viewer's pile chips are no
 *    longer bar chrome at all — #1815 moved them onto the BOARD itself
 *    ({@link BoardPortraitChips}), always visible and mirroring the
 *    opponent's, so there is no "Zones" tab left to reflow or reach through.
 *  - *Buttons appeared and disappeared, so the bar reflowed constantly.* There
 *    is exactly ONE fixed-size primary slot that morphs (see
 *    {@link selectCommandSlots}), Pass Turn is always mounted and merely greys
 *    out, and every tab is a fixed third of the width — the phase label
 *    truncates instead of resizing its neighbours.
 *  - *The priority border was a chunky colour slab.* Priority is a 2px gradient
 *    hairline on the bar's top edge.
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
    // hand strip / viewer pile chips anchor to that. See
    // controller-bar-metrics.ts.
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
                    className="grid grid-cols-3 bg-gradient-to-t from-surface-base to-surface-base/85 backdrop-blur-xl"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    {/* A missing viewer seat is not a real game state, but the
                        placeholder keeps the grid at three cells regardless. */}
                    {me ? (
                        <ControllerLifeTab
                            me={me}
                            opponent={opponent}
                            isMyTurn={isMyTurn}
                        />
                    ) : (
                        <span />
                    )}

                    <ControllerTabButton
                        label={`T${turn} · ${phaseGroupLabel(phase)}`}
                        ariaLabel="Toggle phase list"
                        ariaExpanded={sheetOpen}
                        active={sheetOpen}
                        onClick={() => setSheetOpen((v) => !v)}
                    >
                        <Flag className="h-[1.1rem] w-[1.1rem]" aria-hidden />
                    </ControllerTabButton>

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
