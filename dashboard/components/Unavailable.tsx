/**
 * A FAILED read, never confused with an empty one (PRD #3148 S2).
 *
 * The single most important component on this page. At 0/5000 GraphQL quota
 * the Now panel once rendered "no claimed issues" — an idle, drained loop — at
 * the exact moment GitHub was unreachable (#2519 round 3, finding 5). Every
 * `*Error` sibling in the payload renders THIS, and `consequence` is what
 * stops the banner from being read as a shrug: it names what the operator now
 * cannot know, in the same sentence.
 */
export function Unavailable({
    reason,
    consequence,
}: {
    reason: string;
    consequence?: string;
}) {
    return (
        <div
            role="status"
            className="border-state-unknown bg-muted/40 text-state-unknown rounded-md border border-l-2 px-3 py-2 text-xs"
        >
            <span aria-hidden="true">⚠ </span>
            {reason}
            {consequence ? (
                <span className="text-muted-foreground block">
                    {consequence}
                </span>
            ) : null}
        </div>
    );
}
