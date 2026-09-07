import { WatchButton } from "./WatchButton";
import { OriginBadge } from "./OriginBadge";
import { StateBadge } from "../StateBadge";
import { fmtAgoMs } from "../../lib/format";
import { LIVENESS, sessionLabel } from "../../lib/nowClaims";
import type { ClaimRow, NowPayload } from "../../lib/nowPayload";

/**
 * The session cell of a claim row (issue #3135, ported in PRD #3148 S2).
 *
 * `live.byIssue[issue]` lists the transcripts that name this issue most, most
 * recently. The first is offered as a Watch button; the row also says how long
 * ago that transcript was written to, which is the one fact the claim itself
 * cannot carry — whether ANYONE is typing on it right now.
 *
 * The TRIGGER badge rides on the CANDIDATE, not on the claim: a claim is a
 * GitHub label and carries no origin of its own, so what this cell can
 * honestly say is "the session most likely on this issue was started by X" —
 * which inherits the mention heuristic's uncertainty on top of the origin's
 * own (issue #3144). One renderer, `OriginBadge`, never a second copy of the
 * word list.
 *
 * THREE OUTCOMES, not two. A claim with no candidate says "no session found";
 * a FAILED live read says nothing at all here and lets the table-level
 * UNAVAILABLE note speak, because a per-row "none" would be indistinguishable
 * from a successful lookup that found none.
 */
export function ClaimSessionCell({
    claim,
    data,
    nowMs,
}: {
    claim: ClaimRow;
    data: NowPayload;
    nowMs: number;
}) {
    if (data.liveError != null) {
        return <span className="text-muted-foreground">—</span>;
    }
    const candidates = data.live?.byIssue?.[claim.issue] ?? [];
    if (candidates.length === 0) {
        return (
            <span className="text-muted-foreground text-xs">
                no session found
            </span>
        );
    }
    const best = candidates[0];
    const tone = (LIVENESS[best.liveness] ?? LIVENESS.idle).tone;
    return (
        <span className="flex flex-wrap items-center gap-1.5">
            <WatchButton
                session={best.session}
                label={sessionLabel(best)}
                issue={claim.issue}
            />
            <StateBadge
                tone={tone}
                term={(LIVENESS[best.liveness] ?? LIVENESS.idle).term}
            >
                {fmtAgoMs(best.lastWriteMs, nowMs)}
            </StateBadge>
            <OriginBadge session={best} />
            {candidates.length > 1 ? (
                <span className="text-muted-foreground text-xs">
                    +{candidates.length - 1} more
                </span>
            ) : null}
        </span>
    );
}
