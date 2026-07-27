import type { LimitedEventView } from "~/hooks/useLimitedEvent";

/** The event's MATCH FORMAT as a compact chip — "Best of 1" / "Best of 3",
 *  plus the round deadline when the creator configured one (PRD #1628 stories
 *  1-4, issue #1640).
 *
 *  Sits beside `LimitedStatusBadge` in the event header so a participant can
 *  see what kind of event they are in BEFORE they draft — the whole point of
 *  persisting the choice at creation rather than at the first pairing.
 *
 *  `matchFormat` is definite on the wire (`projectLimitedEvent` resolves the
 *  stored optional through `resolveMatchFormat`), so this never re-implements
 *  the Bo3 default. */
export default function LimitedMatchFormatBadge({
    event,
}: {
    event: Pick<LimitedEventView, "matchFormat" | "roundDeadlineMinutes">;
}) {
    const formatLabel = event.matchFormat === "bo1" ? "Best of 1" : "Best of 3";
    const deadline = event.roundDeadlineMinutes;
    return (
        <span className="rounded-sm border border-border-subtle/40 bg-surface-elevated/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {deadline === undefined
                ? formatLabel
                : `${formatLabel} · ${deadline} min rounds`}
        </span>
    );
}
