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
            <span className="text-zinc-400">{opponent.name}:</span>
            {opponent.ready ? (
                <span className="rounded-sm border border-emerald-500/45 bg-emerald-700/25 px-2 py-0.5 font-beleren tracking-wide text-emerald-200">
                    ready
                </span>
            ) : (
                <span className="rounded-sm border border-zinc-600/45 bg-zinc-800/40 px-2 py-0.5 font-beleren tracking-wide text-zinc-300">
                    sideboarding…
                </span>
            )}
        </div>
    );
}
