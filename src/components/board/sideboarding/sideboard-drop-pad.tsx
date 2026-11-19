import type { SideboardZone } from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";

/** One drop target inside a lit zone: "1 copy → X" or, with `all`,
 *  "All N → X" (`data-drop-all` tells the drag to move every copy). */
export default function SideboardDropPad({
    zone,
    all = false,
    active,
    label,
}: {
    zone: SideboardZone;
    all?: boolean;
    active: boolean;
    label: string;
}) {
    return (
        <div
            data-drop-zone={zone}
            data-drop-all={all ? "" : undefined}
            className={cn(
                "flex h-14 min-w-0 flex-1 basis-auto items-center justify-center rounded-lg border-2 px-2 text-center text-xs font-semibold shadow-lg backdrop-blur transition-colors sm:h-16 sm:px-3 sm:text-sm",
                active
                    ? "border-accent bg-accent text-surface-base"
                    : "border-accent/50 bg-surface-elevated/90 text-parchment"
            )}
        >
            {label}
        </div>
    );
}
