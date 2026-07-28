import { Heart } from "lucide-react";
import type { Player } from "~/types/game";
import { useSelfTargetTab } from "~/hooks/useSelfTargetTab";
import ControllerTabButton from "./controller-tab-button";

type ControllerLifeTabProps = {
    me: Player;
    opponent: Player | undefined;
    /** The viewer is the active player — tints the heart with the self signal. */
    isMyTurn: boolean;
};

/** The "You" tab of the portrait bar (variant D, #1759).
 *
 *  Owns the acceptance criterion "own life always visible": the viewer's life
 *  total lives on the bottom edge itself instead of on a nameplate the bar used
 *  to cover, with the opponent's total as a `vs N` subline so both seats read
 *  at a glance without opening anything.
 *
 *  It is also the viewer's player-target surface — see {@link useSelfTargetTab}
 *  for the seam; the full reachability pass is tracked-by: #1766. */
export default function ControllerLifeTab({
    me,
    opponent,
    isMyTurn,
}: ControllerLifeTabProps) {
    const selfTarget = useSelfTargetTab(me);

    return (
        <ControllerTabButton
            label={opponent ? `vs ${opponent.life}` : "You"}
            ariaLabel={`Your life total: ${me.life}`}
            highlightClassName={selfTarget.ringClass}
            onClick={selfTarget.onClick}
        >
            <span
                data-controller-self-life
                className="flex items-baseline gap-1 font-beleren text-lg font-bold leading-none text-text"
            >
                <Heart
                    className={`h-3 w-3 self-center ${
                        isMyTurn
                            ? "text-signal-self-strong"
                            : "text-text-disabled"
                    }`}
                    aria-hidden
                />
                {me.life}
            </span>
        </ControllerTabButton>
    );
}
