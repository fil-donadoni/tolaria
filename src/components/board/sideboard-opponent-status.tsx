import type { PublicMatch } from "@convex/matches";

type SideboardOpponentStatusProps = {
    /** The opponent seat as projected for the viewer (deck stripped, ready
     *  flag public — PRD #387 user story 21 / #397). */
    opponent: PublicMatch["players"][number];
};

/** Shows the opponent's between-Games ready state ("sideboarding…" / "ready")
 *  in a 2-player Match (PRD #387 user story 21 / #397). The projection hides
 *  the opponent's deck contents and swaps; only their `ready` flag crosses the
 *  wire, so this is the only thing the viewer can — and should — see about the
 *  other side during Sideboarding. */
export default function SideboardOpponentStatus({
    opponent,
}: SideboardOpponentStatusProps) {
    return (
        <div className="flex items-center justify-center gap-2 text-xs">
            <span className="text-text-muted">{opponent.name}:</span>
            {/* v4 (ADR 0103 §4, issue #2729): Beleren retired from chrome —
                these status badges are dialog chrome, not a card face. */}
            {opponent.ready ? (
                <span className="rounded-sm border border-success bg-success-soft px-2 py-0.5 tracking-wide text-success-strong">
                    ready
                </span>
            ) : (
                <span className="rounded-sm border border-border-accent/40 bg-surface-elevated px-2 py-0.5 tracking-wide text-text-muted">
                    sideboarding…
                </span>
            )}
        </div>
    );
}
