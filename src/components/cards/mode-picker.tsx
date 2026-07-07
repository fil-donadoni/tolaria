import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SpellMode } from "@convex/cards/types";
import GameDialog from "~/components/ui/game-dialog";

type ModePickerProps = {
    modes: SpellMode[];
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
    mode: SpellMode;
    onSelect: (id: string) => void;
}) {
    return (
        <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-surface-elevated border border-transparent hover:border-border-subtle transition-colors cursor-pointer"
        >
            <span className="font-beleren text-sm tracking-wide text-text">
                {mode.label}
            </span>
            <span className="text-xs text-text-disabled">
                {mode.oracleText}
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
            <div className="fixed inset-0 z-40" onMouseDown={onCancel} />
            <div
                ref={ref}
                data-slot="dialog-content"
                className="fixed z-100 flex min-w-64 max-h-[calc(100vh-16px)] flex-col gap-1 overflow-y-auto rounded-sm bg-surface border border-border-subtle p-3 shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                style={{ left: clamped.x, top: clamped.y }}
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-border-accent/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-border-accent/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-border-accent/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-border-accent/40" />

                <p className="text-sm font-beleren tracking-wide text-parchment mb-1 px-2">
                    {cardName}
                </p>
                <div className="h-[1px] w-full bg-gradient-to-r from-border-accent via-border-accent/40 to-transparent mb-1" />
                {modes.map((mode) => (
                    <ModeRow key={mode.id} mode={mode} onSelect={onSelect} />
                ))}
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
