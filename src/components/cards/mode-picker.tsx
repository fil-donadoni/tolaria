import { useEffect } from "react";
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
            className="flex flex-col items-start gap-0.5 rounded-sm px-3 py-2.5 text-left hover:bg-white/5 border border-transparent hover:border-zinc-700/50 transition-colors cursor-pointer"
        >
            <span className="font-beleren text-sm tracking-wide text-zinc-100">
                {mode.label}
            </span>
            <span className="text-xs text-zinc-500">{mode.oracleText}</span>
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

    return createPortal(
        <>
            <div className="fixed inset-0 z-40" onMouseDown={onCancel} />
            <div
                data-slot="dialog-content"
                className="fixed z-50 flex min-w-64 flex-col gap-1 rounded-sm bg-[#0c0d12]/95 border border-zinc-800/80 backdrop-blur-md p-3 shadow-[0_0_50px_rgba(0,0,0,0.8)]"
                style={{ left: position.x, top: position.y }}
            >
                <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-zinc-500/40" />
                <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-zinc-500/40" />
                <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-zinc-500/40" />
                <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-zinc-500/40" />

                <p className="text-sm font-beleren tracking-wide text-[#f1f1e8] mb-1 px-2">
                    {cardName}
                </p>
                <div className="h-[1px] w-full bg-gradient-to-r from-zinc-600 via-zinc-500/40 to-transparent mb-1" />
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
