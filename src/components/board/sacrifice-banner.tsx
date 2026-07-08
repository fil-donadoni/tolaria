import type { SacrificeSelection } from "~/types/game";
import { useDraggable } from "~/hooks/useDraggable";
import { describeSacrificeChoice } from "~/lib/sacrifice-selection";

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
    const { offset, dragHandlers } = useDraggable();

    return (
        <div
            className="absolute top-1/2 left-1/2 z-100"
            style={{
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
        >
            <div
                {...dragHandlers}
                className="relative bg-surface border border-border-subtle backdrop-blur-md rounded-sm px-5 py-3 shadow-[0_0_50px_rgba(0,0,0,0.8)] cursor-move select-none"
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40" />

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
            </div>
        </div>
    );
}
