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
 * regimes because of it. The strip IS the peek bar here, which is how issue
 * #2588 words it: "the pack pane's last 15% is its status / Peek bar".
 *
 * That DEVIATES from ADR 0101 §4, which prescribes the Peek Panel as a
 * portrait bottom sheet and a landscape right rail on every editing surface.
 * The reason is a collision the ADR did not foresee on this surface: in
 * landscape the rail is 224px on the right edge, and the right edge of a
 * landscape phone is exactly where §6's sneak-peek column lives — two `fixed`
 * surfaces fighting for one edge (`limited-draft-pool.tsx` § "no touch
 * move-to path" records the same collision). In portrait the bottom sheet was
 * the MEASURED source of the `cardsOcc 3` budget debt at 390x844, deleted from
 * `scripts/ui-gate/budgets.json` by this change. What §4 actually asks for —
 * the 44px CTA row as the primary move path on touch — is preserved: the row
 * is the same `EditingSurfaceAction[]`, just hosted by the strip.
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
                        className="w-7 shrink-0 card-corner"
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
