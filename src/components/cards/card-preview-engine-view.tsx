import type { EngineViewBadge } from "~/lib/preview-body";

// The "Engine view" slot (ADR 0103 §9, issue #2728) — #2704's keyword /
// target / effect / triggered / activated tree lands INSIDE `[data-engine-
// view-tree]` below, read from the same real `CardDefinition` this badge
// already reads. Until then the slot renders only the badge: what the
// definition IS (a DSL-first Effect Script vs a hand-written `resolve()`
// protocol card, ADR 0045) plus, for a script, a rough Op-count chip.
//
// `compact` is the desktop lateral zoom (`CardPreviewDock`, ADR 0103 issue
// body: "carries an Alt: engine view affordance") — no room there for the
// header + tree well, so it renders just the badge and a discoverability
// hint instead. The full slot (mobile long-press overlay, the anchored pin,
// the editing surfaces' `InspectOverlay`) renders the eyebrow header and an
// EMPTY `[data-engine-view-tree]` well beneath it — #2704 fills that well
// without touching this header or the surrounding layout, which is the
// whole point of "mounts without layout change".
const BADGE_TONE: Record<EngineViewBadge["kind"], string> = {
    dsl: "bg-signal-self/15 text-signal-self-strong",
    protocol: "bg-signal-pending/15 text-signal-pending-strong",
};

function badgeLabel(badge: EngineViewBadge): string {
    if (badge.kind === "protocol") return "Protocol";
    return badge.opCount > 0 ? `DSL · ${badge.opCount}` : "DSL";
}

function EngineViewBadgeChip({ badge }: { badge: EngineViewBadge }) {
    return (
        <span
            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONE[badge.kind]}`}
        >
            {badgeLabel(badge)}
        </span>
    );
}

export default function CardPreviewEngineView({
    badge,
    compact = false,
}: {
    /** `null`/`undefined` — no `CardDefinition` to read (an emblem/
     *  designation face, or an unresolved id) — renders nothing. */
    badge?: EngineViewBadge | null;
    compact?: boolean;
}) {
    if (!badge) return null;

    if (compact) {
        return (
            <div className="flex items-center gap-2 border-t border-border-subtle pt-2 text-xs">
                <EngineViewBadgeChip badge={badge} />
                <span className="text-text-muted">Alt: engine view</span>
            </div>
        );
    }

    return (
        <div
            data-engine-view-slot
            className="border-t border-border-subtle pt-2 space-y-1.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-label">Engine view</span>
                <EngineViewBadgeChip badge={badge} />
            </div>
            {/* #2704 mounts its keyword/target/effect tree here. */}
            <div data-engine-view-tree />
        </div>
    );
}
