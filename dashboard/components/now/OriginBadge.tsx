import { StateBadge } from "../StateBadge";
import {
    ORIGIN,
    ORIGIN_SOURCE_TITLE,
    isInferredOrigin,
} from "../../lib/nowOrigin";
import type { SessionView } from "../../lib/nowPayload";

/**
 * Who started this session (issue #3144), ported to React with PRD #3148 S2.
 *
 * ONE renderer for both surfaces — the live-sessions table's `trigger` column
 * and the claim row's session cell — so the word list exists once.
 *
 * A DASHED edge when the answer was inferred rather than recorded. That is
 * `tones.ts`'s `confidence` modifier, which S1 shipped for exactly this: a
 * modifier ON a tone, never a sixth tone, because "probably afk" is still the
 * amber verdict and giving it its own colour would make confidence and verdict
 * the same axis.
 */
export function OriginBadge({ session }: { session: SessionView }) {
    const o = ORIGIN[session.origin ?? "unknown"] ?? ORIGIN.unknown;
    const source = session.originSource ?? "none";
    return (
        <StateBadge
            tone={o.tone}
            term={o.term}
            confidence={isInferredOrigin(source) ? "inferred" : "certain"}
            title={ORIGIN_SOURCE_TITLE[source] ?? ORIGIN_SOURCE_TITLE.none}
        >
            {o.word}
        </StateBadge>
    );
}
