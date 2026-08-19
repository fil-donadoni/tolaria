import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdditionalCostLeg } from "@convex/cards/types";
import { Panel } from "@/components/ui/panel";

type AdditionalCostPickerProps = {
    /** The PAYABLE legs of the card's caster-chosen additional cost
     *  (CR 601.2b) — already filtered by `payableAdditionalCostLegsForCard`,
     *  so every row here is one `announceCast` accepts. */
    legs: ReadonlyArray<AdditionalCostLeg>;
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen `AdditionalCostLeg.id`. */
    onSelect: (legId: string) => void;
    onCancel: () => void;
};

/** Cast-time picker for a CASTER-CHOSEN additional cost (CR 601.2b / 118.8 —
 *  Bitter Triumph's "As an additional cost to cast this spell, discard a card
 *  or pay 3 life"). The choice is made at ANNOUNCEMENT, before targets
 *  (CR 601.2c) and before any mana is paid (CR 601.2h), so it is collected here
 *  and dispatched as `announceCast`'s `additionalCostLegId` — the same
 *  plain-argument shape `ModePicker` (CR 700.2) and `AltCostPicker` (CR 118.9)
 *  use, never a server-raised pending choice.
 *
 *  Unlike `AltCostPicker` there is NO "pay the normal cost" row: an additional
 *  cost is paid ALONGSIDE the mana cost (CR 118.8), never instead of it, and a
 *  disjunction obliges exactly one leg. Modeled on `AltCostPicker` so the three
 *  cast-time pickers share look and behaviour. */
export default function AdditionalCostPicker({
    legs,
    cardName,
    position,
    onSelect,
    onCancel,
}: AdditionalCostPickerProps) {
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
    }, [position.x, position.y, legs.length]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-hud" onMouseDown={onCancel} />
            {/* Panel forwards no props — the positioning `style`, the
                clamp-measure `ref` and the board-ESC `data-slot` tag stay on a
                plain fixed wrapper; Panel supplies the chrome inside it. */}
            <div
                ref={ref}
                data-slot="dialog-content"
                className="fixed z-modal"
                style={{ left: clamped.x, top: clamped.y }}
            >
                <Panel
                    density="compact"
                    className="flex min-w-64 max-h-[calc(100vh-16px)] flex-col gap-1 overflow-y-auto p-4"
                >
                    <p className="text-sm font-beleren tracking-wide text-parchment mb-1 px-2">
                        {cardName}
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent mb-1" />
                    {legs.map((leg) => (
                        <button
                            key={leg.id}
                            type="button"
                            data-testid={`additional-cost-leg-${leg.id}`}
                            onClick={() => onSelect(leg.id)}
                            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
                        >
                            <span className="font-beleren text-sm tracking-wide text-text">
                                {leg.label}
                            </span>
                            <span className="text-xs text-text-disabled">
                                Additional cost — paid as well as the mana cost
                            </span>
                        </button>
                    ))}
                </Panel>
            </div>
        </>,
        document.body
    );
}
