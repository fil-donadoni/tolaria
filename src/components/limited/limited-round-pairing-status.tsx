import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { LimitedViewerPairingView } from "@convex/limited/eventProjection";

/** The status of an UNDECIDED, non-bye round pairing: "not played yet" only
 *  while its Match has not started; once the pairing has a Match, "in progress"
 *  with the live game score when the viewer's own active Match is that Match
 *  (`myActiveGame.matchScore`, viewer's side). */
export default function LimitedRoundPairingStatus({
    pairing,
}: {
    pairing: LimitedViewerPairingView;
}) {
    const activeGame = useQuery(api.gameReads.myActiveGame);
    const started = pairing.matchId !== null;
    const score =
        started && activeGame && activeGame.matchId === pairing.matchId
            ? activeGame.matchScore
            : null;

    return (
        <span className="text-text-muted" data-testid="round-pairing-status">
            {started ? "— in progress" : "— not played yet"}
            {score && (
                <>
                    {" · "}
                    <span className="tabular-nums">
                        {score.wins}-{score.losses}
                    </span>
                </>
            )}
        </span>
    );
}
