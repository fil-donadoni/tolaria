import { NowSection } from "./NowSection";
import { Stats } from "../Stats";
import { Stat } from "../Stat";
import { Unavailable } from "../Unavailable";
import { SECTION_IDS } from "../../lib/nowLights";
import type { NowPayload } from "../../lib/nowPayload";

/**
 * Queue (issue #3135, ported in PRD #3148 S2): five stat boxes.
 *
 * `queueDepth` is `null` with a sibling `queueDepthError` when the underlying
 * `gh` read failed — rendered as an explicit UNAVAILABLE note, never as a row
 * of zeros, which is indistinguishable from a healthy read that genuinely
 * found nothing.
 */
export function QueueSection({ data }: { data: NowPayload }) {
    const qd = data.queueDepth;
    return (
        <NowSection id={SECTION_IDS.queue} term="section.queue" title="Queue">
            {data.queueDepthError != null || !qd ? (
                <Unavailable
                    reason={data.queueDepthError ?? "the queue read failed"}
                    consequence='cannot tell how deep the queue is — not the same as "queue empty"'
                />
            ) : (
                <Stats>
                    <Stat
                        term="queue.total"
                        label="total waiting"
                        value={String(qd.total)}
                    />
                    <Stat
                        term="queue.P0"
                        label="P0"
                        value={String(qd.P0)}
                        tone={qd.P0 > 0 ? "bad" : undefined}
                    />
                    <Stat
                        term="queue.P1"
                        label="P1"
                        value={String(qd.P1)}
                        tone={qd.P1 > 0 ? "warn" : undefined}
                    />
                    <Stat term="queue.P2" label="P2" value={String(qd.P2)} />
                    <Stat
                        term="queue.unprioritized"
                        label="no priority"
                        value={String(qd.unprioritized)}
                    />
                </Stats>
            )}
        </NowSection>
    );
}
