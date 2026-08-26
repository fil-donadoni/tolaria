import type { EngineViewBadge } from "~/lib/preview-body";

// The Engine View slot's DSL/protocol chip (ADR 0103 §9, issue #2728), split
// out of `card-preview-engine-view.tsx` so that file holds exactly one
// component (CLAUDE.md § Code Organization, `.claude/rules/frontend-
// components.md`: "ONE component per file — no exceptions").
//
// The chip is a CLAIM about how the engine reads the card, so it renders
// only when there is something to claim: a card with no resolution body at
// all (`kind: "none"` — a vanilla creature, a basic land, a pure-
// `staticEffects[]` anthem) gets no chip, because a bare `DSL` there would
// assert an Effect Script the definition does not have.
const BADGE_TONE: Record<"dsl" | "protocol", string> = {
    dsl: "bg-signal-self/15 text-signal-self-strong",
    protocol: "bg-signal-pending/15 text-signal-pending-strong",
};

export default function EngineViewBadgeChip({
    badge,
}: {
    badge: EngineViewBadge;
}) {
    if (badge.kind === "none") return null;
    const label =
        badge.kind === "protocol"
            ? "Protocol"
            : badge.opCount > 0
              ? `DSL · ${badge.opCount}`
              : "DSL";
    return (
        <span
            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONE[badge.kind]}`}
        >
            {label}
        </span>
    );
}
