import { useCallback, useState } from "react";
import {
    draftStopAtOffset,
    draftStopOffset,
    type DraftPhoneOrientation,
    type DraftSnapStop,
} from "./draftSnapStops";

/** The scroller and the stop it has settled on, plus the programmatic swipe.
 *  Handed to the pane components so THEY stay markup: every question about
 *  where the scroller is lives here or in `draftSnapStops.ts`. */
export interface DraftSnapController {
    stop: DraftSnapStop;
    /** Wire to the scroller's `onScroll` — this is what makes the strip a
     *  LIVE tab (it follows a swipe, not only a tap). */
    onScroll: () => void;
    snapTo: (stop: DraftSnapStop) => void;
}

/**
 * The Draft Room's two-stop snap scroller (issue #2588, ADR 0101 §6).
 *
 * The AXIS is the only thing the orientation changes: portrait swipes
 * vertically (`scrollTop` / `scrollHeight`), landscape horizontally
 * (`scrollLeft` / `scrollWidth`). Everything else — the two stops, the early
 * bias, the clamp — is the shared pure arithmetic in `draftSnapStops.ts`, so
 * the two arrangements can never drift into two different snap models.
 */
export function useDraftSnapStops(
    /** The scroller element. Owned by the CALLER, not returned from here: a
     *  hook that hands back a ref inside an object makes that whole object a
     *  ref to the React Compiler's lint, and every `snap.stop` read in a pane
     *  then trips `react-hooks/refs` ("Cannot access refs during render"). The
     *  ref goes straight to a `ref=` prop, which is not a render read. */
    scrollerRef: React.RefObject<HTMLDivElement | null>,
    orientation: DraftPhoneOrientation
): DraftSnapController {
    const [stop, setStop] = useState<DraftSnapStop>("pack");
    const horizontal = orientation === "landscape";

    const onScroll = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const offset = horizontal ? el.scrollLeft : el.scrollTop;
        const maxOffset = horizontal
            ? el.scrollWidth - el.clientWidth
            : el.scrollHeight - el.clientHeight;
        setStop(draftStopAtOffset(offset, maxOffset));
    }, [horizontal, scrollerRef]);

    const snapTo = useCallback(
        (next: DraftSnapStop) => {
            const el = scrollerRef.current;
            // The state moves even when the element cannot scroll (happy-dom
            // measures every box as zero): a tap on the strip must still
            // switch what the strip SAYS, and the browser's own scroll event
            // will correct the reading the moment there is a layout to read.
            setStop(next);
            if (!el) return;
            const maxOffset = horizontal
                ? el.scrollWidth - el.clientWidth
                : el.scrollHeight - el.clientHeight;
            const offset = draftStopOffset(next, maxOffset);
            el.scrollTo(
                horizontal
                    ? { left: offset, behavior: "smooth" }
                    : { top: offset, behavior: "smooth" }
            );
        },
        [horizontal, scrollerRef]
    );

    return { stop, onScroll, snapTo };
}
