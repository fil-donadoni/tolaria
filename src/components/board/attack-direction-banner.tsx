import { Swords } from "lucide-react";
import { Banner } from "~/components/ui/banner";

/**
 * Declare-attackers guidance (QA): while the active player is declaring
 * attackers, an info strip spells out what can be selected — your creatures to
 * attack, then (CR 508.1b) the enemy planeswalker or player they attack, and
 * where to confirm. Purely informational: pointer-events are
 * disabled so it never steals a board click.
 *
 * Layout-neutral wording (issue #1762 review) — "click" assumes a mouse;
 * this banner renders identically on a touch/portrait board, where the
 * affordance is a tap, not a click. "Select" reads correctly either way.
 */
export default function AttackDirectionBanner({
    planeswalkerPresent,
    choosingTarget = false,
}: {
    /** Whether the defending player controls a planeswalker — only then is
     *  the retarget hint relevant. */
    planeswalkerPresent: boolean;
    /** Creatures are waiting for their attack target. */
    choosingTarget?: boolean;
}) {
    return (
        <Banner
            tone="info"
            icon={<Swords className="h-4 w-4 text-accent-strong" />}
            // v4 (ADR 0103 §5, issue #2730): floats over the battlefield, so
            // it keeps SOME elevation — but the shared `.panel-physical`
            // material (same soft shadow every v4 panel uses) instead of a
            // bespoke raw `shadow-[0_10px_30px_rgba(0,0,0,0.5)]` arbitrary
            // value.
            className="panel-physical pointer-events-none max-w-lg"
        >
            {choosingTarget ? (
                <>
                    <span className="font-semibold">What do they attack?</span>{" "}
                    Select an enemy planeswalker or the opponent&apos;s
                    nameplate for the highlighted creatures.
                </>
            ) : (
                <>
                    <span className="font-semibold">Declare attackers:</span>{" "}
                    select your creatures to send them into combat.
                    {planeswalkerPresent &&
                        " You then choose whether they attack the player or a planeswalker."}
                    {" Confirm Attackers when done."}
                </>
            )}
        </Banner>
    );
}
