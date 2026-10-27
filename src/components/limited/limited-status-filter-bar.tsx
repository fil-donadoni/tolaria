import { Button } from "@/components/ui/button";
import {
    LIMITED_EVENT_STATUS_CHIPS,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";
import { LIMITED_HUB_CHIP_LABEL } from "~/lib/limited/limitedHub";
import { useScrollEdges } from "~/hooks/useScrollEdges";

const FADE = "1.5rem";

/** Mask hiding only the edges that still have content beyond them. */
function edgeFadeMask(edges: { start: boolean; end: boolean }) {
    if (!edges.start && !edges.end) return undefined;
    const from = edges.start ? `transparent, #000 ${FADE}` : "#000";
    const to = edges.end ? `#000 calc(100% - ${FADE}), transparent` : "#000";
    return `linear-gradient(to right, ${from}, ${to})`;
}

/** The hub's status chips (issue #2590, reworded by #5388): Waiting /
 *  Drafting / Building / Playing narrow the live sections; History swaps the
 *  hub for the finished events. Each carries its count. Toggling the ACTIVE
 *  chip clears back to the plain hub rather than needing a separate "All"
 *  button, which is also why `value` is `undefined` for "no chip" rather than
 *  an "all" member of the union. */
export default function LimitedStatusFilterBar({
    value,
    counts,
    onChange,
}: {
    value: LimitedEventStatusChip | undefined;
    counts: Record<LimitedEventStatusChip, number>;
    onChange: (next: LimitedEventStatusChip | undefined) => void;
}) {
    const { ref, edges, onScroll } = useScrollEdges<HTMLDivElement>(counts);
    const mask = edgeFadeMask(edges);
    return (
        <div
            ref={ref}
            role="group"
            aria-label="Filter by status"
            data-slot="status-filter-scroller"
            onScroll={onScroll}
            style={{ maskImage: mask, WebkitMaskImage: mask }}
            className="-my-1 flex min-w-0 max-w-full scroll-px-6 flex-nowrap gap-1.5 py-1 overflow-x-auto overscroll-x-contain"
        >
            {LIMITED_EVENT_STATUS_CHIPS.map((chip) => {
                const active = value === chip;
                return (
                    <Button
                        key={chip}
                        type="button"
                        variant={active ? "secondary" : "ghost"}
                        size="xs"
                        aria-pressed={active}
                        onClick={() => onChange(active ? undefined : chip)}
                    >
                        {LIMITED_HUB_CHIP_LABEL[chip]} {counts[chip]}
                    </Button>
                );
            })}
        </div>
    );
}
