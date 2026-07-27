// Unreviewed Card Profile badge (issue #1612: "surface unreviewed profiles
// visibly"). A Card Profile is LLM-seeded and human-reviewed (ADR 0072); one
// with `reviewed: false` (`convex/limited/cardProfiles.ts`) must be obvious
// wherever the card it describes appears in a pick. Renders nothing for a
// card with no profile at all, or an already-reviewed one.
import type { CardProfile } from "@convex/limited/cardProfilesCore";

export default function DraftLabProfileBadge({
    profile,
}: {
    profile: CardProfile | null;
}) {
    if (!profile || profile.reviewed) return null;
    return (
        <span
            title="Card Profile is LLM-seeded and has not been human-reviewed"
            className="rounded-sm bg-signal-opponent/20 px-1 py-0.5 text-[9px] font-bold tracking-wide text-signal-opponent uppercase"
        >
            unreviewed
        </span>
    );
}
