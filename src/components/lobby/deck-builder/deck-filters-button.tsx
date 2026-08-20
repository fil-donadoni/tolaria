import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import BottomSheet from "~/components/ui/bottom-sheet";
import { useSurfaceClass } from "~/hooks/useSurfaceClass";
import { cn } from "~/lib/utils";

export interface DeckFiltersButtonProps {
    /** How many filters are applied — the badge, and `0` means no badge. */
    activeCount: number;
    /** Live result count, for the sheet's footer CTA. */
    resultCount: number;
    /** The filter controls themselves. Laid out as a COLUMN by this component;
     *  the caller supplies the same nodes it used to hand to the header band. */
    children: ReactNode;
}

const TRIGGER_CLASS =
    "inline-flex items-center gap-1.5 rounded-md border border-border-subtle/60 bg-surface-elevated/40 px-2.5 text-sm text-parchment transition hover:border-accent/60";

/**
 * The deckbuilder's Filters ENTRY POINT (issue #2585, PRD #2405 slice 6).
 *
 * The filter controls used to be a permanent second header row at every
 * viewport wider than a phone. They are now behind this one button, in one of
 * two shapes:
 *
 *  - **phone → bottom sheet**, with a footer CTA carrying the live result
 *    count. Closing IS applying: every control writes straight through to the
 *    URL-backed filter set as it is touched, so there is no draft state to
 *    commit and the CTA is a dismiss, not a submit. (A staged copy would be a
 *    second source of truth for the same filters — see `useFilterSearchParams`.)
 *  - **tablet / desktop → popover** anchored under the button. Esc and an
 *    outside tap close it; both come from the base-ui primitive.
 *
 * **The split is `useSurfaceClass()`, NOT `useViewportMode()`** — and that
 * distinction is the whole point of the slice. `useViewportMode()` files tablet
 * portrait (820×1180, wider than its 767px bound) under `"desktop"`, so reusing
 * it would have given a phone a sheet and a tablet a popover *by accident*,
 * while leaving the same conflation in place for the next caller. `useSurfaceClass`
 * asks the question this component actually has ("is there room to anchor, and
 * is the pointer coarse?") and answers it in one place.
 */
export default function DeckFiltersButton({
    activeCount,
    resultCount,
    children,
}: DeckFiltersButtonProps) {
    const surface = useSurfaceClass();
    const [sheetOpen, setSheetOpen] = useState(false);

    const label = (
        <>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline short-viewport:hidden">
                Filters
            </span>
            {activeCount > 0 && (
                <span
                    data-filter-count=""
                    className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-surface-base"
                >
                    {activeCount}
                </span>
            )}
        </>
    );

    const accessibleName =
        activeCount > 0 ? `Filters (${activeCount} applied)` : "Filters";

    const panel = <div className="flex flex-col gap-4">{children}</div>;

    if (surface === "phone") {
        return (
            <>
                <button
                    type="button"
                    aria-label={accessibleName}
                    aria-haspopup="dialog"
                    aria-expanded={sheetOpen}
                    onClick={() => setSheetOpen(true)}
                    style={{ minHeight: "var(--control-h)" }}
                    className={TRIGGER_CLASS}
                >
                    {label}
                </button>
                <BottomSheet
                    open={sheetOpen}
                    onClose={() => setSheetOpen(false)}
                    title="Filters"
                    marker="data-filters-sheet"
                    footer={
                        <div className="border-t border-border-subtle/40 px-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setSheetOpen(false)}
                                style={{ minHeight: "var(--control-h)" }}
                                className="w-full rounded-md bg-accent px-3 font-semibold text-surface-base"
                            >
                                Show {resultCount}{" "}
                                {resultCount === 1 ? "card" : "cards"}
                            </button>
                        </div>
                    }
                >
                    <div className="px-3 py-2">{panel}</div>
                </BottomSheet>
            </>
        );
    }

    return (
        <Popover>
            <PopoverTrigger
                aria-label={accessibleName}
                style={{ minHeight: "var(--control-h)" }}
                className={cn(TRIGGER_CLASS, "cursor-pointer")}
            >
                {label}
            </PopoverTrigger>
            <PopoverContent
                data-filters-popover=""
                side="bottom"
                align="start"
                className="max-h-[70dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto text-sm"
            >
                {panel}
            </PopoverContent>
        </Popover>
    );
}
