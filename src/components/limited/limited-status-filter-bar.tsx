import { Button } from "@/components/ui/button";
import {
    LIMITED_EVENT_STATUS_CHIPS,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";
import { LIMITED_HUB_CHIP_LABEL } from "~/lib/limited/limitedHub";

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
    return (
        <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap gap-1.5"
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
