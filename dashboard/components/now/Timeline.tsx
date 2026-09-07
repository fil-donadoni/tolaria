import { NowSection } from "./NowSection";
import { TimelineTrack } from "./TimelineTrack";
import { PassBlock } from "./PassBlock";
import { ClaimPin } from "./ClaimPin";
import { ClaimTail } from "./ClaimTail";
import { MergeTick } from "./MergeTick";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import {
    claimItems,
    mergeItems,
    passItems,
    TIMELINE_SECTION_ID,
    WINDOW_HOURS,
} from "../../lib/nowTimeline";
import type { NowPayload } from "../../lib/nowPayload";

/**
 * The 24-hour timeline (#2631, ported in PRD #3148 S2) — passes as blocks,
 * claims as pins with a tail, merges as ticks, on one shared time axis.
 *
 * THREE WAYS TO BE INCOMPLETE, each stated on its own:
 *
 *   - `claimsError` / `recentMergesError` — a FAILED `gh` read. The pins or
 *     ticks that would have been drawn are simply not knowable.
 *   - `recentMergesTruncated` — a SUCCESSFUL page that hit its fetch limit
 *     (#2842 review finding). Real merges came back, so it is never treated as
 *     unavailable — but presenting a possibly partial page as complete is the
 *     same "everything is here" lie in a smaller shape.
 *
 * An empty WINDOW is a sentence, not a blank box (AC) — and only when nothing
 * failed, because "nothing ran" and "we could not tell what ran" are different
 * statements.
 */
export function Timeline({ data, nowMs }: { data: NowPayload; nowMs: number }) {
    const passes = passItems(data, nowMs);
    const claims = claimItems(data, nowMs);
    const merges = mergeItems(data, nowMs);
    const claimsUnavailable = data.claimsError != null;
    const mergesUnavailable = data.recentMergesError != null;
    const mergesTruncated =
        !mergesUnavailable && data.recentMergesTruncated === true;
    const nothingKnown =
        passes.length === 0 &&
        claims.length === 0 &&
        merges.length === 0 &&
        !claimsUnavailable &&
        !mergesUnavailable;

    return (
        <NowSection
            id={TIMELINE_SECTION_ID}
            term="section.timeline"
            title={`Last ${WINDOW_HOURS} hours`}
        >
            <div className="flex flex-col gap-2">
                {claimsUnavailable ? (
                    <Unavailable
                        reason={data.claimsError!}
                        consequence="claim pins may be incomplete"
                    />
                ) : null}
                {mergesUnavailable ? (
                    <Unavailable
                        reason={data.recentMergesError!}
                        consequence="merge ticks may be incomplete"
                    />
                ) : null}
                {mergesTruncated ? (
                    <Unavailable
                        reason="merge history hit its fetch limit"
                        consequence="merge ticks may be incomplete"
                    />
                ) : null}

                {nothingKnown ? (
                    <EmptyNote>
                        {`Nothing ran, was claimed or merged in the last ${WINDOW_HOURS} hours.`}
                    </EmptyNote>
                ) : (
                    <>
                        <TimelineTrack label="Passes">
                            {passes.map((p) => (
                                <PassBlock key={p.pass} item={p} />
                            ))}
                        </TimelineTrack>
                        <TimelineTrack label="Claims">
                            {/* Every tail, THEN every pin. Interleaved, a
                                later claim's 1px tail paints over an earlier
                                claim's pin and takes its clicks — measured in
                                the browser. */}
                            {claims.map((c) => (
                                <ClaimTail key={`tail-${c.issue}`} item={c} />
                            ))}
                            {claims.map((c) => (
                                <ClaimPin key={c.issue} item={c} />
                            ))}
                        </TimelineTrack>
                        <TimelineTrack label="Merges">
                            {merges.map((m) => (
                                <MergeTick key={m.number} item={m} />
                            ))}
                        </TimelineTrack>
                        <div className="text-muted-foreground flex justify-between pl-16 text-[11px]">
                            <span>{WINDOW_HOURS}h ago</span>
                            <span>now</span>
                        </div>
                    </>
                )}
            </div>
        </NowSection>
    );
}
