import { useState } from "react";
import { Flag, Layers, Menu } from "lucide-react";
import { useGameContext } from "~/hooks/useGameContext";
import { useControllerActions } from "~/hooks/useControllerActions";
import { selectCommandSlots } from "~/lib/controller-action-slots";
import { phaseGroupLabel } from "~/lib/phase-labels";
import ControllerCommandRow from "./controller-command-row";
import ControllerLifeTab from "./controller-life-tab";
import ControllerTabButton from "./controller-tab-button";
import ControllerZonesDrawer from "./controller-zones-drawer";
import ControllerPhaseSheet from "./controller-phase-sheet";
import AttackAllConfirmDialog from "./attack-all-confirm-dialog";

/** Portrait controller (#335), redesigned as variant D "Refined fusion"
 *  (#1758/#1759, user-approved from the `prototype/mobile-bottom-bar` audit).
 *
 *  An app tab bar owns the bottom edge — **You** (own life, opponent's as a
 *  `vs N` subline) · **Zones** · **Phase** · **Menu** — with a floating command
 *  row above it. The three complaints the audit raised are structural, not
 *  cosmetic, so the layout answers each one directly:
 *
 *  - *Own life and the zone chips were buried under the bar.* Life is now ON
 *    the bar (and is the self-target surface); the viewer's pile chips moved
 *    into the Zones drawer, which floats clear of it.
 *  - *Buttons appeared and disappeared, so the bar reflowed constantly.* There
 *    is exactly ONE fixed-size primary slot that morphs (see
 *    {@link selectCommandSlots}), Pass Turn is always mounted and merely greys
 *    out, and every tab is a fixed quarter of the width — the phase label
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
    const { phase, turn, activePlayerId, playerId, stackCount, allPlayers } =
        useGameContext();
    const { cue, actions, attackAllConfirm } = useControllerActions();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [zonesOpen, setZonesOpen] = useState(false);

    // Same derivation the board uses; the context's `playerId` IS the viewer.
    const me = allPlayers.find((p) => p.id === playerId);
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const isMyTurn = activePlayerId === playerId;
    const slots = selectCommandSlots(actions);

    return (
        <>
            <div
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
                    className="grid grid-cols-4 bg-gradient-to-t from-surface-base to-surface-base/85 backdrop-blur-xl"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    {/* A missing viewer seat is not a real game state, but the
                        placeholder keeps the grid at four cells regardless. */}
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
                        label={
                            stackCount > 0 ? `Zones · ${stackCount}` : "Zones"
                        }
                        ariaLabel="Toggle your zones"
                        ariaExpanded={zonesOpen}
                        active={zonesOpen}
                        onClick={() => setZonesOpen((v) => !v)}
                    >
                        <Layers className="h-[1.1rem] w-[1.1rem]" aria-hidden />
                    </ControllerTabButton>

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

            {zonesOpen && me && <ControllerZonesDrawer player={me} />}

            {sheetOpen && (
                <ControllerPhaseSheet onClose={() => setSheetOpen(false)} />
            )}

            <AttackAllConfirmDialog confirm={attackAllConfirm} />
        </>
    );
}
