import { Swords } from "lucide-react";
import { Banner } from "~/components/ui/banner";
import CardImage from "~/components/cards/card-image";
import type { AttackChooserSummary } from "~/lib/attack-chooser-summary";

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
    chooser = null,
}: {
    /** Whether the defending player controls a planeswalker — only then is
     *  the retarget hint relevant. */
    planeswalkerPresent: boolean;
    /** Creatures are waiting for their attack target. */
    choosingTarget?: boolean;
    /** Who is choosing (issue #9500): named, with its place in the
     *  "Attack with all" walk and who comes next. `null` → generic copy. */
    chooser?: AttackChooserSummary | null;
}) {
    if (choosingTarget && chooser) {
        const walk = chooser.total !== undefined && chooser.total > 1;
        return (
            <Banner
                tone="info"
                icon={
                    <span
                        className="relative block w-8 shrink-0 overflow-hidden rounded-[6%]"
                        style={{ aspectRatio: "5 / 7" }}
                    >
                        <CardImage
                            card={chooser.card}
                            sizes="32px"
                            includeThumb
                        />
                    </span>
                }
                className="panel-physical pointer-events-none max-w-lg"
            >
                <span data-testid="attack-chooser">
                    <span className="font-semibold">
                        {chooser.names.join(", ")}
                    </span>
                    {walk && (
                        <span className="ml-1.5 rounded bg-accent-strong/20 px-1.5 text-xs tabular-nums">
                            {chooser.position} of {chooser.total}
                        </span>
                    )}
                    : attack the opponent or a planeswalker?
                </span>
                <span className="block text-xs text-text-muted">
                    Select the opponent&apos;s nameplate or a planeswalker.
                    {walk &&
                        (chooser.nextNames.length > 0
                            ? ` Then: ${chooser.nextNames.join(", ")}.`
                            : " Last one.")}
                </span>
            </Banner>
        );
    }
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
