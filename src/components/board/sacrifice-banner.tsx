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
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition();

    return (
        <div className={outerClassName} style={outerStyle}>
            {/* Drag chrome stays on a plain wrapper — Panel forwards no
                handlers, so the frame lives inside it. */}
            <div
                {...dragHandlers}
                className={`cursor-move select-none ${innerClassName}`.trim()}
            >
                <Panel density="compact" className="px-5 py-3">
                    <p className="font-beleren text-sm tracking-wide text-parchment">
                        Attack cost
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent my-1.5" />
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
