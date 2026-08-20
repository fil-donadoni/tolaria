import { getImageUrl, resolveCardImageId } from "~/lib/images";
import EditingActionButton from "~/components/editing/editing-action-button";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import { cn } from "~/lib/utils";

/**
 * The Selected Card's CTA row ON A PHONE STRIP (issue #2588, ADR 0101 §4:
 * "the CTA row is the PRIMARY move path on touch").
 *
 * This is the Peek Panel's content, inlined into the strip that is already on
 * screen — and the Draft Room mounts the Peek Panel itself only OFF the phone
 * regimes because of it. Two `fixed` panels is the failure mode
 * (`limited-draft-pool.tsx` § "no touch move-to path" records the same
 * collision): the Peek Panel's landscape arrangement is a 224px right rail,
 * and the right of a landscape phone is precisely where the sneak-peek column
 * lives. The strip IS the peek bar here — which is also how ADR 0101 §6 names
 * it ("the pack pane's last 15% is its status / Peek bar").
 *
 * The action SET is not re-derived: it is the same `EditingSurfaceAction[]`
 * the Peek Panel and the Inspect Overlay are handed, built once in
 * `limited-draft-table.tsx`, so `Pick` / `→ Side` / `Inspect` mean the same
 * thing through every door.
 */
export default function DraftSelectionActions({
    cardId,
    cardName,
    actions,
    axis,
    stopPropagation = false,
}: {
    cardId: string;
    cardName: string;
    actions: readonly EditingSurfaceAction[];
    /** `"row"` on a portrait strip (a wide, short band); `"column"` in a
     *  landscape sneak-peek column (narrow and tall). */
    axis: "row" | "column";
    /** Keep the taps off an ancestor's "tap to go back to the pack" handler. */
    stopPropagation?: boolean;
}) {
    const printId = resolveCardImageId(cardId);
    const thumb = printId ? getImageUrl(printId) : null;
    return (
        <div
            data-slot="draft-selection-actions"
            className={cn(
                "flex min-w-0 gap-1.5",
                axis === "row" ? "items-center" : "flex-col"
            )}
        >
            <div
                className={cn(
                    "flex min-w-0 items-center gap-1.5",
                    axis === "row" ? "flex-1" : "justify-center"
                )}
            >
                {thumb && axis === "row" && (
                    <img
                        src={thumb}
                        alt=""
                        draggable={false}
                        className="w-7 shrink-0 rounded-[6%]"
                    />
                )}
                <span className="truncate font-beleren text-[13px] text-parchment">
                    {cardName}
                </span>
            </div>
            <div
                className={cn(
                    "flex shrink-0 gap-1.5",
                    axis === "column" && "flex-col"
                )}
            >
                {actions.map((action) => (
                    <EditingActionButton
                        key={action.label}
                        action={action}
                        stopPropagation={stopPropagation}
                    />
                ))}
            </div>
        </div>
    );
}
