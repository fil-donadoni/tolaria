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
            className="z-modal min-w-40 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
            <button
                type="button"
                role="menuitem"
                className="block w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
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
                className="block w-full rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
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
