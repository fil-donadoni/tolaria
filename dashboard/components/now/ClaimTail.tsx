import { cn } from "@/lib/utils";
import { toneFillClass } from "../../lib/tones";
import type { ClaimItem } from "../../lib/nowTimeline";

/**
 * A claim's open tail on the timeline (#2631, ported in PRD #3148 S2) — from
 * its (proxy) take time to "now".
 *
 * ITS OWN COMPONENT, and rendered as a whole layer BENEATH the pins rather
 * than beside each one. Interleaved, a later claim's tail paints over an
 * earlier claim's pin, and a 1px line is enough to steal the click:
 * `elementFromPoint` at pin #2717's own centre returned its neighbour's tail
 * (measured in the browser at 1440×900). Two passes — every tail, then every
 * pin — is the same "hit targets last" ordering the activity chart uses.
 *
 * `left` and `width` are percentages OF THE LANE, so this must be a direct
 * child of the lane; a wrapper would re-base the width on its own content.
 */
export function ClaimTail({ item }: { item: ClaimItem }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "absolute top-1/2 h-px -translate-y-1/2 opacity-50",
                toneFillClass(item.tone)
            )}
            style={{
                left: `${item.left.toFixed(2)}%`,
                width: `${item.tailWidth.toFixed(2)}%`,
            }}
        />
    );
}
