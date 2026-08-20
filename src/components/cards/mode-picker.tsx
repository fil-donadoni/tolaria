import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Color, ModeOption } from "@convex/cards/types";
import GameDialog from "~/components/ui/game-dialog";
import { Panel } from "@/components/ui/panel";
import ManaSymbol from "~/components/cards/mana-symbol";
import { formatOracleText } from "~/lib/oracle-text";

/** What the picker renders: the shared {@link ModeOption} display surface, plus
 *  the OPTIONAL colour pip. `color` lives on `SpellMode`, not on the shared
 *  base — a colour choice (Prismatic Ward, Sleight of Mind) is a modal-SPELL
 *  concern, and `AbilityMode` (CR 602.2b, issue #1341) has no such half. The
 *  picker is shared by both, so it reads the field structurally rather than
 *  forcing it onto the base type. */
type PickerMode = ModeOption & { color?: Color };

type ModePickerProps = {
    modes: ReadonlyArray<PickerMode>;
    cardName: string;
    variant?: "dialog" | "portal";
    position?: { x: number; y: number };
    onSelect: (modeId: string) => void;
    onCancel: () => void;
};

function ModeRow({
    mode,
    onSelect,
}: {
    mode: PickerMode;
    onSelect: (id: string) => void;
}) {
    return (
        <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
        >
            <span className="flex items-center gap-1.5 font-beleren text-sm tracking-wide text-text">
                {mode.color && (
                    <ManaSymbol symbol={mode.color} className="size-4" />
                )}
                {formatOracleText(mode.label)}
            </span>
            <span className="text-xs text-text-disabled">
                {formatOracleText(mode.oracleText)}
            </span>
        </button>
    );
}

function ModePickerPortal({
    modes,
    cardName,
    position,
    onSelect,
    onCancel,
}: ModePickerProps & { position: { x: number; y: number } }) {
    // ESC closes the picker (matches the dialog-wide "ESC dismisses the open
    // overlay" UX). The `data-slot="dialog-content"` tag below lets the board's
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

    // Clamp the portal inside the viewport (issue: hand cards sit at the bottom,
    // so an anchor at `rect.top` grows the dialog off the bottom edge with no
    // way to scroll or reach the lower modes). Measure after layout and shift up
    // / left so the whole picker stays on-screen; `max-h` + scroll below is the
    // safety net when even a fully-clamped dialog is taller than the viewport.
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
    }, [position.x, position.y, modes.length]);

    return createPortal(
        <>
            <div className="fixed inset-0 z-hud" onMouseDown={onCancel} />
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
                    <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent mb-1" />
                    {modes.map((mode) => (
                        <ModeRow
                            key={mode.id}
                            mode={mode}
                            onSelect={onSelect}
                        />
                    ))}
                </Panel>
            </div>
        </>,
        document.body
    );
}

export default function ModePicker({
    modes,
    cardName,
    variant = "dialog",
    position,
    onSelect,
    onCancel,
}: ModePickerProps) {
    if (variant === "portal" && position) {
        return (
            <ModePickerPortal
                modes={modes}
                cardName={cardName}
                position={position}
                onSelect={onSelect}
                onCancel={onCancel}
            />
        );
    }

    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title={cardName}
            dismissable
        >
            <div className="flex flex-col gap-1.5 mt-2">
                {modes.map((mode) => (
                    <ModeRow key={mode.id} mode={mode} onSelect={onSelect} />
                ))}
            </div>
        </GameDialog>
    );
}
