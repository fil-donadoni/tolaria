import type { SacrificeSelection } from "~/types/game";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { describeSacrificeChoice } from "~/lib/sacrifice-selection";
import { Panel } from "~/components/ui/panel";

/** Prompt for the attack-declaration land tax (CR 508.1c/1g / 701.21a —
 *  Flooded Woodlands, Reclamation). The declaration is suspended server-side on
 *  `combat.pendingAttackSacrifice` until the controller picks lands to
 *  sacrifice; without this banner the board looks frozen because the cost has
 *  no on-screen explanation. Purely informational — the legal lands are
 *  highlighted/clickable on the battlefield (`useBattlefieldVisualState`) and a
 *  click fires `selectSacrifice`. The cost is mandatory once attackers are
 *  confirmed (the server already verified enough lands exist), so there is no
 *  cancel affordance. */
export default function SacrificeBanner({
    selection,
}: {
    selection: SacrificeSelection;
}) {
    // Issue #1813 — always pinned: the legal lands are highlighted/clickable
    // ON THE BATTLEFIELD (see docstring above), so a vertically centered
    // panel would sit directly on top of what the player must tap.
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel density="compact" className="px-5 py-3">
                    {/* v4 (ADR 0103 §4, issue #2730): title off Beleren onto
                        the chrome display face; the shared `.panel-rule`
                        hairline replaces the repeated gold-gradient divider. */}
                    <p className="text-display text-sm text-text">
                        Attack cost
                    </p>
                    <div className="panel-rule my-1.5 h-px w-full" />
                    <p className="text-text-muted text-xs">
                        {describeSacrificeChoice(selection)} to attack
                    </p>
                    {selection.reason && (
                        <p className="mt-1 max-w-xs text-[0.65rem] leading-snug text-text-disabled italic">
                            {selection.reason}
                        </p>
                    )}
                </Panel>
            </div>
        </div>
    );
}
