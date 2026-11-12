import { useEffect, useRef, type ReactNode } from "react";
import { acceptsShortcut, isDialogOpen } from "~/lib/keyboard-shortcuts";
import { cyclePreviewView, previewViewsOf } from "~/lib/preview-views";
import type { CardPreviewView } from "~/lib/preview-views";

export type { CardPreviewMode, CardPreviewView } from "~/lib/preview-views";

/** Phase-2 toggle (winner B), reshaped by issue #9162: a bottom segmented
 *  control pinned under the preview, cycled with ←/→ while the preview is
 *  open, with a dots pager and a "1/3" hint. The computed live-text face is
 *  the default (modern oracle, granted/lost abilities, effective P/T); the
 *  "printed" face shows the original printing as-is. Hidden by its hosts when
 *  the card has no printed identity (tokens).
 *
 *  Two hosts, two vocabularies (PRD #2405): in a game the computed face is
 *  LIVE text (it reflects what the permanent says right now), while on an
 *  editing surface — deckbuilder, Draft Room — there is no game state, so the
 *  same face is simply the card's ORACLE text. The labels are props rather
 *  than a second component because the behaviour is identical. */
export default function CardPreviewModeToggle({
    mode,
    onChange,
    computedLabel = "Live text",
    printedLabel = "Printed card",
    className = "",
    showRulings = false,
    hideComputed = false,
    trailing,
    compact = false,
}: {
    mode: CardPreviewView;
    onChange: (mode: CardPreviewView) => void;
    /** Adds the third `Rulings` entry (issue #4816). */
    showRulings?: boolean;
    /** Drops the computed entry: a Manual Game card has no live text to show
     *  (ADR 0080), so its toggle reads `Printed card | Rulings` (issue #4817). */
    hideComputed?: boolean;
    computedLabel?: string;
    printedLabel?: string;
    className?: string;
    /** Rides the hint row's right edge (the preview's report button). */
    trailing?: ReactNode;
    /** Just the tab strip, inline: no pinned bar, pager or hint. For a host
     *  that carries the control inside its own header (Inspect Overlay). */
    compact?: boolean;
}) {
    const barRef = useRef<HTMLDivElement>(null);
    const views = previewViewsOf(showRulings, hideComputed);
    const idx = Math.max(0, views.indexOf(mode));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // A key another handler already took stays taken (Draft Room pick
            // selection, deck-tile focus). With a dialog open the arrows are
            // the TOP dialog's own: this bar acts only when it lives in it
            // (Inspect Overlay) and never for a preview underneath one.
            if (!acceptsShortcut(e, { whileDialogOpen: true })) return;
            if (e.shiftKey) return;
            if (isDialogOpen()) {
                const dialogs = document.querySelectorAll("[role=dialog]");
                if (!dialogs[dialogs.length - 1]?.contains(barRef.current))
                    return;
            }
            const step =
                e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!step || views.length < 2) return;
            e.preventDefault();
            onChange(cyclePreviewView(views, mode, step));
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    const label = (m: CardPreviewView) =>
        m === "computed"
            ? computedLabel
            : m === "printed"
              ? printedLabel
              : "Rulings";

    return (
        <div
            ref={barRef}
            data-preview-mode-bar
            className={
                compact
                    ? className
                    : `sticky bottom-0 flex flex-col gap-1 border-t border-border-subtle bg-surface-elevated px-3 pb-1.5 pt-2 ${className}`
            }
        >
            <div
                role="tablist"
                aria-label="Card preview view"
                className="flex rounded-full bg-surface-base/70 p-0.5"
            >
                {views.map((m) => (
                    <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        data-preview-mode={m}
                        onClick={() => onChange(m)}
                        className={`flex-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${
                            mode === m
                                ? "bg-accent-soft/50 text-parchment"
                                : "text-text-muted hover:text-parchment"
                        }`}
                    >
                        {label(m)}
                    </button>
                ))}
            </div>
            {!compact && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
                    <span className="flex items-center gap-2">
                        <span className="flex gap-1" aria-hidden>
                            {views.map((m, i) => (
                                <span
                                    key={m}
                                    className={`h-1.5 rounded-full ${
                                        i === idx
                                            ? "w-4 bg-accent"
                                            : "w-1.5 bg-text-muted/50"
                                    }`}
                                />
                            ))}
                        </span>
                        <span data-preview-mode-hint>
                            {idx + 1}/{views.length} · ← → to switch
                        </span>
                    </span>
                    {trailing}
                </div>
            )}
        </div>
    );
}
