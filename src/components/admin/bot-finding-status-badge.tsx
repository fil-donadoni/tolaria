import {
    FINDING_STATUS_LABEL,
    type FindingStatus,
} from "@convex/gre/ai/botFindingState";

/** `class-fixed` is the point of ADR 0141 § 3's table — evidence a class fix
 *  did NOT generalise to this card — so it reads danger, the loudest tone on
 *  the page. `played-unproven` is calmer amber: waiting on proof, not a
 *  regression. `open` reads neutral, `resolved` reads settled, `harness-bound`
 *  reads as "not a Bot fix at all". Four tones, none shared, issue #4177 review
 *  finding N1. */
const TONE: Record<FindingStatus, string> = {
    open: "border-border-subtle text-text-muted",
    "class-fixed": "border-danger/60 bg-danger/10 text-danger-strong",
    "played-unproven":
        "border-signal-pending/60 bg-signal-pending/10 text-signal-pending-strong",
    resolved: "border-success/50 text-success-strong",
    "harness-bound": "border-secondary-accent/50 text-secondary-accent-strong",
};

export default function BotFindingStatusBadge({
    status,
}: {
    status: FindingStatus;
}) {
    return (
        <span
            data-bot-finding-status={status}
            className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE[status]}`}
        >
            {FINDING_STATUS_LABEL[status]}
        </span>
    );
}
