import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";

export interface LimitedDraftMenuState {
    x: number;
    y: number;
    /** `aria-label` for the popup — distinguishes the Booster's own menu from
     *  the Pool's / the Sideboard's for assistive tech. */
    label: string;
    actions: readonly EditingSurfaceAction[];
}

/**
 * The Draft Room's card context menu (ADR 0060, issue #1248; generalised to
 * every card surface — Booster, Pool, Sideboard — by issue #2861). Renders
 * whatever {@link EditingSurfaceAction}s its caller built, the SAME
 * descriptors the Peek Panel / Inspect Overlay are built from elsewhere in
 * the app — so a label or behavior can never diverge between the Booster's
 * menu, the Pool's, and the Sideboard's.
 *
 * A small self-contained menu (position-anchored at the click point, closes
 * on outside click/Escape/an item choice) rather than the app's shared
 * `~/components/ui/context-menu` — that shared wrapper is a Popper anchored
 * to its TRIGGER element, and this menu already carries its own click-point
 * anchor from before issue #2861 generalised it; re-deriving it onto a
 * trigger-anchored primitive would be a second popover implementation for no
 * behavioral gain. It opens on a LEFT click (re-bound from the Booster's
 * original real right-click by issue #2861: a real right-click now opens the
 * Inspect Overlay directly, matching what right-click already means
 * everywhere else in the app).
 */
export default function LimitedPickContextMenu({
    state,
    onClose,
}: {
    state: LimitedDraftMenuState;
    onClose: () => void;
}) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            const el = menuRef.current;
            if (el && e.target instanceof Node && el.contains(e.target)) {
                return;
            }
            onClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            role="menu"
            aria-label={state.label}
            style={{ position: "fixed", top: state.y, left: state.x }}
            // v4 (ADR 0103 §5, issue #2731): "bespoke lookalikes... adopt the
            // same tokens" — the hairline frame + panel radius in place of the
            // legacy `ring-foreground/10`, and a `--menu-row-gap` column so
            // the two rows get real spacing, WITHOUT switching this menu onto
            // the shared `ContextMenu` primitive itself — see the doc comment
            // above for why.
            className="z-modal flex min-w-40 flex-col gap-[var(--menu-row-gap)] rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
            {state.actions.map((action) => (
                <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    className="flex min-h-[var(--menu-row-h)] w-full items-center rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => {
                        action.onSelect();
                        onClose();
                    }}
                >
                    {action.label}
                </button>
            ))}
        </div>,
        document.body
    );
}
