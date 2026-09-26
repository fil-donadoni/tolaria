// The opener grid every overlay-specimen section on /admin/design-system uses
// (§ 16 board dialogs, issue #4419; § 17 cross-cutting overlays, issue #4423;
// § 18 cast pickers, issue #4420 — slices of the `check:ui` census debt issue
// #4402).
//
// ONE AT A TIME, BY DESIGN. A specimen here is a real portal overlay at
// `position: fixed` (or, for an inline one, a single live mount): mounting a
// family together would stack its scrims on one screen and measure whichever
// landed on top. So the grid mounts exactly the one its opener selected, and
// `scripts/ui-gate/surfaces.ts` walks one row per opener.
import { useState } from "react";
import type { AnchorPoint } from "~/components/ui/anchored-picker";
import { Specimen, Where } from "./lib";

export type OverlaySpecimen = {
    /** Opener seam value and the lane's `<prefix>-<slug>` surface id. */
    slug: string;
    label: string;
    /** Module the census row is keyed on, under `src/components/`. */
    file: string;
    /** `anchor` is where the opener was pressed: an anchored picker opens
     *  there, the way a real one opens next to the card that was cast. */
    render: (close: () => void, anchor: AnchorPoint) => React.ReactNode;
};

export default function OverlaySpecimens({
    specimens,
    openerAttribute,
    wrap,
}: {
    specimens: readonly OverlaySpecimen[];
    /** The `data-*` attribute each opener carries, e.g.
     *  `data-board-dialog-specimen` — the seam the lane's walk presses. */
    openerAttribute: `data-${string}`;
    /** Providers the mounted specimen needs, wrapped around it
     *  unconditionally so no per-specimen exception list has to be kept. */
    wrap: (mounted: React.ReactNode) => React.ReactNode;
}) {
    const [open, setOpen] = useState<{
        slug: string;
        anchor: AnchorPoint;
    } | null>(null);
    const close = () => setOpen(null);
    const mounted = specimens.find((s) => s.slug === open?.slug);

    return (
        <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {specimens.map((s) => (
                    <Specimen key={s.slug} label={s.label} tone="plain">
                        <button
                            type="button"
                            {...{ [openerAttribute]: s.slug }}
                            className="btn-base btn-tone-secondary w-full px-3 py-1.5 text-xs"
                            onClick={(e) =>
                                setOpen({
                                    slug: s.slug,
                                    anchor: { x: e.clientX, y: e.clientY },
                                })
                            }
                        >
                            Open {s.label}
                        </button>
                        <Where>{s.file}</Where>
                    </Specimen>
                ))}
            </div>
            {open && (
                // The one reset every specimen shares (issue #4687): a
                // GameDialog specimen neither dismisses on Escape nor shows a
                // close glyph, and its footer plates may be disabled until a
                // choice is made — so `check:ui`'s census rows close the
                // specimen they measured through this seam and press the next
                // opener on the same page instead of reloading it. Mounted
                // only while a specimen is open, so a closed page is exactly
                // what it was.
                <button
                    type="button"
                    data-specimen-close
                    onClick={close}
                    className="btn-base btn-tone-secondary mt-3 px-3 py-1.5 text-xs"
                >
                    Close specimen
                </button>
            )}
            {wrap(mounted && open ? mounted.render(close, open.anchor) : null)}
        </>
    );
}
