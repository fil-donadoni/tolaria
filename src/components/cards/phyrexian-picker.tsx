import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhyrexianSplitChoice } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import { Panel } from "@/components/ui/panel";

type PhyrexianPickerProps = {
    /** The affordable mana-vs-life split options (CR 107.4f). */
    choices: PhyrexianSplitChoice[];
    cardName: string;
    /** Anchor position (client px) — the picker opens next to the cast card. */
    position: { x: number; y: number };
    /** Called with the chosen number of `{C/P}` pips to pay with life. */
    onSelect: (lifePips: number) => void;
    onCancel: () => void;
};

/** Cast-time split picker for a Phyrexian-mana spell (CR 107.4f — each `{C/P}`
 *  pip is paid with the colour of mana OR 2 life, the caster's choice). Shown
 *  only when BOTH legs are affordable for at least one pip (the projection gates
 *  this via `phyrexianOptions`); each button pays a distinct number of pips with
 *  life, and selecting one dispatches `announceCast` with the matching
 *  `phyrexianLifePips`. Modeled on {@link AltCostPicker} so the cast-time
 *  pickers share look and behaviour. */
export default function PhyrexianPicker({
    choices,
    cardName,
    position,
    onSelect,
    onCancel,
}: PhyrexianPickerProps) {
    // ESC closes the picker (matches the board's overlay-dismiss UX). The
    // `data-slot="dialog-content"` tag lets the board's global ESC handler skip
    // opening the pause menu.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            onCancel();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onCancel]);

    // Clamp the portal inside the viewport (hand cards sit at the bottom).
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
    }, [position.x, position.y, choices.length]);

    return createPortal(
        <>
            <div
                className="fixed inset-0 z-hud modal-scrim"
                onMouseDown={onCancel}
            />
            {/* `Panel` forwards no props, so the positioning `style`, the
                clamp-measure `ref` and the board-ESC `data-slot` tag stay on
                a plain fixed wrapper; Panel supplies the chrome (bezel +
                corner filigree) inside it. */}
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
                    <p className="text-xs text-text-disabled px-2 mb-1">
                        Pay Phyrexian mana ({"{C/P}"} = colour or 2 life)
                    </p>
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent mb-1" />

                    {choices.map((choice) => (
                        <button
                            key={choice.lifePips}
                            type="button"
                            onClick={() => onSelect(choice.lifePips)}
                            className="flex items-center gap-1 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
                        >
                            <span className="font-beleren text-sm tracking-wide text-text inline-flex items-center gap-1">
                                <span>Pay</span>
                                <span className="inline-flex items-center">
                                    {formatOracleText(choice.label)}
                                </span>
                            </span>
                        </button>
                    ))}
                </Panel>
            </div>
        </>,
        document.body
    );
}
