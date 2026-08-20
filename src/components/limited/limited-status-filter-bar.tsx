import { Button } from "@/components/ui/button";
import {
    LIMITED_EVENT_STATUS_CHIPS,
    type LimitedEventStatusChip,
} from "~/lib/limitedEventStatus";

const CHIP_LABEL: Record<LimitedEventStatusChip, string> = {
    open: "Open",
    drafting: "Drafting",
    building: "Building",
    playing: "Playing",
    done: "Done",
};

/** The merged `/limited` list's status filter (issue #2590): open / drafting
 *  / building / playing / done, plus an implicit "All" (no chip pressed).
 *  Toggling the ACTIVE chip clears back to "All" rather than needing a
 *  separate "All" button to keep the row's element count fixed at five,
 *  which is also why `value` is `undefined` for "All" rather than an "all"
 *  member of the chip union — the union stays exactly the five values a row
 *  in the list can actually resolve to (`limitedEventStatusChip`). */
export default function LimitedStatusFilterBar({
    value,
    onChange,
}: {
    value: LimitedEventStatusChip | undefined;
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
                        {CHIP_LABEL[chip]}
                    </Button>
                );
            })}
        </div>
    );
}
