import { useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronUp } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * The swipe hint on a Draft Room strip (issue #2588, ADR 0101 §6: "a very
 * subtle animated chevron, 1.8s, opacity .45→.9, 3px travel").
 *
 * Reduced motion is honoured TWICE, deliberately. The animation itself lives
 * behind `prefers-reduced-motion: no-preference` in `index.css` (the repo's
 * decorative-motion gate), and this component also reads
 * `useReducedMotion()` and simply does not opt the element in — the same
 * belt-and-braces `ArrivalGlow` uses, and the reason the JS half exists is
 * that it is the half a dom test can assert. Under reduced motion the chevron
 * still RENDERS, a little brighter: it is an affordance, not decoration, and
 * removing it would hide the fact that there is a second pane at all.
 */
export default function DraftSwipeChevron({
    direction,
}: {
    /** Where the OTHER pane is — up the scroller in portrait, left of it in
     *  landscape (the strip sits on the leading edge of the pool pane). */
    direction: "up" | "left";
}) {
    const reduceMotion = useReducedMotion();
    const Icon = direction === "up" ? ChevronUp : ChevronLeft;
    return (
        <Icon
            aria-hidden="true"
            data-draft-chevron={direction}
            data-animated={reduceMotion ? undefined : "true"}
            className={cn(
                "h-3.5 w-3.5 shrink-0 stroke-accent-strong",
                reduceMotion ? "opacity-70" : "opacity-45"
            )}
        />
    );
}
