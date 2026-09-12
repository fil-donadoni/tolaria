import { cn } from "@/lib/utils";
import { useDebugSheetOpen } from "~/hooks/debugSheetContext";
import { DEBUG_SHEET_PUSH_CLASS } from "./debug-sheet-metrics";

/**
 * The game route's board wrapper (issue #3493): at `lg` and wider it gives up
 * the debug sheet's width while the sheet is OPEN, so the sheet sits BESIDE
 * the board instead of painting over it.
 *
 * The board itself learns nothing about the sheet — it is handed a narrower
 * box and reflows, which is all its own layout needs to know. Below `lg` the
 * class is inert (`lg:` only), so the sheet keeps the overlay behaviour a
 * phone has no room to improve on and the board's width does not depend on the
 * open flag at all.
 *
 * A left MARGIN, not padding: the acceptance criterion is the board's MEASURED
 * width, and padding leaves the element's own border box exactly as wide as
 * before. This is the flex column's stretched child, so a margin takes its used
 * width down by precisely the sheet's width.
 */
export default function DebugBoardArea({
    children,
}: {
    children: React.ReactNode;
}) {
    const open = useDebugSheetOpen();
    return (
        <div
            data-board-area=""
            data-debug-sheet-open={open ? "" : undefined}
            // `flex-1 min-h-0`, not a bare wrapper (issue #2594): Board's OWN
            // root is `h-full` — with the orientation hint band above sharing
            // this flex column, `h-full` must resolve against a sibling with a
            // DEFINITE remaining-space height, the same `flex-1 min-h-0`
            // contract `<main>` uses in `app-shell.tsx`, not against the
            // column's full `h-dvh` (which would make the two siblings compete
            // for space via flex-shrink instead of the hint band simply taking
            // its own content height off the top).
            className={cn(
                "flex-1 min-h-0 motion-safe:transition-[margin-left] motion-safe:duration-200",
                open && DEBUG_SHEET_PUSH_CLASS
            )}
        >
            {children}
        </div>
    );
}
