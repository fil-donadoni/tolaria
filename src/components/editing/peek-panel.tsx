import { useEffect } from "react";
import { X } from "lucide-react";
import { acceptsShortcut } from "~/lib/keyboard-shortcuts";
import { getImageUrl, resolveCardImageId } from "~/lib/images";
import EditingActionButton from "./editing-action-button";
import {
    usePeekPanelLayout,
    PEEK_PANEL_RAIL_WIDTH,
    type PeekPanelLayout,
} from "./usePeekPanelLayout";
import type { EditingSurfaceAction } from "./editing-surface-action";

export interface PeekPanelProps {
    /** Registry card id of the selected card. */
    cardId: string;
    name: string;
    /** One line under the name — the surface's own summary (type line, "MV 3",
     *  "Maindeck ×2"). */
    subtitle?: string;
    /** The surface's CTA set; rendered in order, primary filled. */
    actions: readonly EditingSurfaceAction[];
    onClose: () => void;
    /** Override the viewport-derived layout (a surface that already knows it
     *  is in its landscape arrangement should say so rather than re-deriving
     *  it). */
    layout?: PeekPanelLayout;
}

/**
 * The Peek Panel (PRD #2405 D16, issue #2583) — the PRIMARY move path on
 * touch. Tapping a card selects it and opens this: thumbnail, name, subtitle
 * and a row of ≥44px CTAs supplied by the surface.
 *
 * **Non-modal by construction.** There is no scrim and no focus trap: tapping
 * another card must simply RETARGET the panel (the surface re-renders it with
 * a new `cardId`), and the surface underneath must stay scrollable and
 * tappable while it is open. That is the whole reason this is not built on
 * `ui/dialog.tsx` or `ui/action-sheet.tsx` — `ActionSheet` is modal, portals
 * to a scrim and dismisses on any outside touch, which would make "tap the
 * next card" a two-tap gesture.
 *
 * It sits at `--z-sheet`, below `--z-modal`, so the Inspect Overlay that one
 * of its own CTAs opens paints above it.
 */
export default function PeekPanel({
    cardId,
    name,
    subtitle,
    actions,
    onClose,
    layout,
}: PeekPanelProps) {
    // The SAME resolver the adopting surface calls to size its reserve — the
    // panel choosing an axis the surface did not reserve is exactly the
    // occlusion this shared hook exists to prevent (issue #2583 review).
    const resolved: PeekPanelLayout = usePeekPanelLayout(layout);
    const printId = resolveCardImageId(cardId);
    const thumb = printId ? getImageUrl(printId) : null;

    // ESCAPE DISMISSES THE SELECTION (issue #2593). The panel is non-modal by
    // construction — no scrim, no focus trap — so there is no outside-click to
    // dismiss it with and, before this, no keyboard dismissal either: a
    // keyboard user who selected a card was stuck with the panel until they
    // tabbed to its Close button.
    //
    // Plain `acceptsShortcut` (no `whileDialogOpen`) is what orders it against
    // the Inspect Overlay one of its own CTAs opens: while that dialog is up it
    // owns Escape, and the panel underneath must not close out from under it.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (!acceptsShortcut(event)) return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const close = (
        <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${name} panel`}
            style={{
                minHeight: "var(--control-h)",
                minWidth: "var(--control-h)",
            }}
            className="flex shrink-0 items-center justify-center rounded-full text-text-muted hover:text-parchment"
        >
            <X className="h-4 w-4" />
        </button>
    );

    const identity = (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {thumb && (
                <img
                    src={thumb}
                    alt=""
                    draggable={false}
                    className="w-10 shrink-0 card-corner"
                />
            )}
            <div className="min-w-0 flex-1">
                <div className="truncate text-display text-sm text-parchment">
                    {name}
                </div>
                {subtitle && (
                    <div className="truncate text-[11px] text-text-muted">
                        {subtitle}
                    </div>
                )}
            </div>
        </div>
    );

    if (resolved === "rail") {
        return (
            <aside
                data-peek-panel="rail"
                aria-label={`Selected card: ${name}`}
                // Width from the shared constant, not a `w-[224px]` literal:
                // it is the number the surface reserves, and two copies of it
                // is how they drift apart.
                style={{ width: PEEK_PANEL_RAIL_WIDTH }}
                className="z-sheet fixed top-0 right-0 bottom-0 flex flex-col gap-2 border-l border-accent bg-surface p-2.5 pr-[max(0.625rem,env(safe-area-inset-right))]"
            >
                <div className="flex items-start gap-2">
                    {identity}
                    {close}
                </div>
                <div className="flex flex-col gap-1.5">
                    {actions.map((action) => (
                        <EditingActionButton
                            key={action.label}
                            action={action}
                        />
                    ))}
                </div>
            </aside>
        );
    }

    return (
        <div
            data-peek-panel="sheet"
            aria-label={`Selected card: ${name}`}
            className="z-sheet fixed right-0 bottom-0 left-0 border-t border-accent bg-surface px-3 pt-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
            <div className="flex items-center gap-2.5">
                {identity}
                {close}
            </div>
            <div
                className="mt-2 grid gap-2"
                style={{
                    gridTemplateColumns: `repeat(${Math.max(actions.length, 1)}, minmax(0,1fr))`,
                }}
            >
                {actions.map((action) => (
                    <EditingActionButton key={action.label} action={action} />
                ))}
            </div>
        </div>
    );
}
