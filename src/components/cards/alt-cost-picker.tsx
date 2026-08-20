import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AlternativeCost } from "@convex/cards/types";
import { Panel } from "@/components/ui/panel";

type AltCostPickerProps = {
    /** The card's alternative casting costs (CR 118.9). */
    altCosts: AlternativeCost[];
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen alternative-cost id, or `undefined` to pay the
     *  normal mana cost. */
    onSelect: (altCostId: string | undefined) => void;
    onCancel: () => void;
};

/** Cast-option picker for a spell with alternative casting costs (CR 118.9 —
 *  Gush / Thwart return Islands, Fireblast sacrifices Mountains). Offers the
 *  normal mana cost plus each declared alternative; selecting one dispatches
 *  `announceCast` with the matching `alternativeCostId`. Modeled on
 *  {@link ModePicker} so the two cast-time pickers share look and behaviour. */
export default function AltCostPicker({
    altCosts,
    cardName,
    position,
    onSelect,
    onCancel,
}: AltCostPickerProps) {
    // ESC closes the picker (matches the board's "ESC dismisses the open
    // overlay" UX). The `data-slot="dialog-content"` tag lets the board's
    // global ESC handler detect this portal and skip opening the pause menu.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    // Clamp the portal inside the viewport (hand cards sit at the bottom, so an
    // anchor at the card's top would grow the dialog off the bottom edge).
    const ref = useRef<HTMLDivElement>(null);
    const [clamped, setClamped] = useState(position);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        const margin = 8;
        const maxLeft = window.innerWidth - width - margin;
        const maxTop = window.innerHeight - height - margin;
        setClamped({
            x: Math.max(margin, Math.min(position.x, maxLeft)),
            y: Math.max(margin, Math.min(position.y, maxTop)),
        });
    }, [position.x, position.y, altCosts.length]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-hud" onMouseDown={onCancel} />
            {/* `Panel` swallows no props but also forwards none — the
                positioning `style`, the clamp-measure `ref` and the
                board-ESC `data-slot` tag all need a real element, so the
                fixed anchor stays a plain wrapper and Panel supplies the
                chrome (bezel + corner filigree) inside it. */}
            <div
                ref={ref}
                data-slot="dialog-content"
                className="fixed z-modal"
                style={{ left: clamped.x, top: clamped.y }}
            >
                <Panel
                    density="compact"
                    className="flex min-w-64 max-h-[calc(100dvh-16px)] flex-col gap-1 overflow-y-auto p-4"
                >
                    <p className="text-sm font-beleren tracking-wide text-parchment mb-1 px-2">
                        {cardName}
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent mb-1" />

                    <button
                        type="button"
                        onClick={() => onSelect(undefined)}
                        className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
                    >
                        <span className="font-beleren text-sm tracking-wide text-text">
                            Pay mana cost
                        </span>
                    </button>
                    {altCosts.map((alt) => (
                        <button
                            key={alt.id}
                            type="button"
                            onClick={() => onSelect(alt.id)}
                            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
                        >
                            <span className="font-beleren text-sm tracking-wide text-text">
                                {alt.description}
                            </span>
                            <span className="text-xs text-text-disabled">
                                {/* CR 702.109a — Dash still pays MANA, just a
                                    DIFFERENT amount (`alt.mana`), unlike every
                                    other alt cost here (Gush/evoke give up a
                                    permanent/life/hand card instead of mana). */}
                                {alt.mana
                                    ? "Alternative cost — a different mana cost"
                                    : "Alternative cost — instead of paying mana"}
                            </span>
                        </button>
                    ))}
                </Panel>
            </div>
        </>,
        document.body
    );
}
