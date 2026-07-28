import { Swords } from "lucide-react";
import { Banner } from "~/components/ui/banner";

/**
 * Declare-attackers guidance (QA): while the active player is declaring
 * attackers, an info strip spells out what can be selected — your creatures to
 * attack, an enemy planeswalker to direct the most recent attacker at it
 * (CR 508.1a), and where to confirm. Purely informational: pointer-events are
 * disabled so it never steals a board click.
 *
 * Layout-neutral wording (issue #1762 review) — "click" assumes a mouse;
 * this banner renders identically on a touch/portrait board, where the
 * affordance is a tap, not a click. "Select" reads correctly either way.
 */
export default function AttackDirectionBanner({
    planeswalkerPresent,
}: {
    /** Whether the defending player controls a planeswalker — only then is
     *  the retarget hint relevant. */
    planeswalkerPresent: boolean;
}) {
    return (
        <Banner
            tone="info"
            icon={<Swords className="h-4 w-4 text-accent-strong" />}
            className="pointer-events-none max-w-lg shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
        >
            <span className="font-semibold">Declare attackers:</span> select
            your creatures to send them into combat.
            {planeswalkerPresent &&
                " Select an enemy planeswalker to direct your most recent attacker at it — select the attacker again to send it back to the player."}
            {" Confirm Attackers when done."}
        </Banner>
    );
}
