import { StateBadge } from "../StateBadge";
import { LIVENESS } from "../../lib/nowClaims";

/** How recently a session's transcript was written to, as a word (#3135). */
export function LivenessBadge({ liveness }: { liveness: string }) {
    const l = LIVENESS[liveness] ?? LIVENESS.idle;
    return (
        <StateBadge tone={l.tone} term={l.term}>
            {l.word}
        </StateBadge>
    );
}
