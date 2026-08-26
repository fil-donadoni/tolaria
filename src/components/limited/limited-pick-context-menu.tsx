import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface LimitedPickContextMenuState {
    pickId: string;
    x: number;
    y: number;
}

/**
 * Right-click context menu on a Booster card (ADR 0060, issue #1248, PRD
 * #1107 story 26): "Pick" (commits into the card's Mana-Value column, same
 * as a double-click) and "Pick to sideboard" (commits AND parks the new
 * Pool card straight into the Sideboard). A small self-contained menu
 * (position-anchored at the click point, closes on outside click/Escape/an
 * item choice) rather than the app's shared `~/components/ui/context-menu`
 * — that shared wrapper deliberately reserves a REAL right-click for the
 * card-zoom preview everywhere else in the app (`card-preview.tsx`) and only
 * opens on a synthesized left-click instead; the Booster explicitly wants a
 * genuine right-click to open ITS menu (the literal ADR 0060 gesture), so
 * reusing that wrapper would fight its own convention rather than serve it.
 */
export default function LimitedPickContextMenu({
    state,
    onPick,
    onPickToSideboard,
    onClose,
}: {
    state: LimitedPickContextMenuState;
    onPick: (pickId: string) => void;
    onPickToSideboard: (pickId: string) => void;
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
            aria-label="Draft pick actions"
            style={{ position: "fixed", top: state.y, left: state.x }}
            // v4 (ADR 0103 §5, issue #2731): "bespoke lookalikes... adopt the
            // same tokens" — the hairline frame + panel radius in place of the
            // legacy `ring-foreground/10`, and a `--menu-row-gap` column so
            // the two rows get real spacing, WITHOUT switching this menu onto
            // the shared `ContextMenu` primitive itself: this popup
            // deliberately opens on a genuine right-click (the ADR 0060
            // Booster gesture), while `ContextMenuTrigger` elsewhere
            // synthesizes that event from a left-click and reserves real
            // right-click/long-press for the card preview — reusing it here
            // would fight that convention rather than serve it.
            className="z-modal flex min-w-40 flex-col gap-[var(--menu-row-gap)] rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
            <button
                type="button"
                role="menuitem"
                className="flex min-h-[var(--menu-row-h)] w-full items-center rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                    onPick(state.pickId);
                    onClose();
                }}
            >
                Pick
            </button>
            <button
                type="button"
                role="menuitem"
                className="flex min-h-[var(--menu-row-h)] w-full items-center rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => {
                    onPickToSideboard(state.pickId);
                    onClose();
                }}
            >
                Pick to sideboard
            </button>
        </div>,
        document.body
    );
}
