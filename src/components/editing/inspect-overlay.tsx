import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { buildPreviewBody } from "~/lib/preview-body";
import { useViewportMode } from "~/hooks/useViewportMode";
import CardPreviewFace from "~/components/cards/card-preview-face";
import CardPreviewModeToggle, {
    type CardPreviewMode,
} from "~/components/cards/card-preview-mode-toggle";
import EditingActionButton from "./editing-action-button";
import type { EditingSurfaceAction } from "./editing-surface-action";

export interface InspectOverlayProps {
    /** Registry card id being inspected. */
    cardId: string;
    /** Surface CTAs, rendered inside the overlay so read → act is one flow. */
    actions?: readonly EditingSurfaceAction[];
    onClose: () => void;
    /** Draft Room (PRD #2405 D15): a tap ANYWHERE closes, so read → back to
     *  picking is one tap. The `primary` action is exempt — it must fire, not
     *  be swallowed by the dismiss. Off by default: the deckbuilder wants the
     *  overlay to stay put while the player reads. */
    tapAnywhereCloses?: boolean;
    /** ‹ › step through the surface's current row / column. Omit an end to
     *  disable that arrow. */
    onStep?: { previous?: () => void; next?: () => void };
    /** Override the viewport-derived split. */
    layout?: "stacked" | "split";
}

/**
 * The Inspect Overlay (PRD #2405, issue #2583) — the editing surfaces' full
 * card read.
 *
 * The two things that make it different from the board's long-press preview
 * (`CardPreview`'s overlay, ADR 0009, untouched):
 *
 * 1. **It never exceeds `100dvh`.** `dvh`, not `vh`: on mobile Safari/Chrome
 *    `100vh` is the LARGE viewport — the height the page has once the URL bar
 *    has scrolled away — so a `90vh` panel genuinely overflows a 390px-tall
 *    landscape phone that still has its chrome. `dvh` tracks the viewport as
 *    it actually is.
 * 2. **Landscape splits art | text.** At 844×390 a stacked art-over-text
 *    preview leaves the oracle text a ~120px slit; side by side, the art gets
 *    the height and the text scrolls beside it (`CardPreviewFace layout="split"`).
 *
 * Off the board there is no game state, so the face toggle reads
 * Oracle / Printed rather than Live text / Printed card — same component,
 * different vocabulary.
 */
export default function InspectOverlay({
    cardId,
    actions = [],
    onClose,
    tapAnywhereCloses = false,
    onStep,
    layout,
}: InspectOverlayProps) {
    const viewportMode = useViewportMode();
    const [mode, setMode] = useState<CardPreviewMode>("computed");
    // No `CardInstance`, no `GameContext`: an editing surface holds card
    // IDENTITIES, never permanents, so the face is the printed/oracle card.
    const body = buildPreviewBody(cardId);
    const split =
        (layout ?? (viewportMode === "portrait" ? "stacked" : "split")) ===
        "split";

    return createPortal(
        <div
            data-inspect-overlay
            role="dialog"
            aria-modal="true"
            aria-label={body.displayName}
            className="z-modal modal-scrim fixed inset-0 flex items-center justify-center p-3"
            onClick={onClose}
        >
            <div
                data-inspect-panel
                className="flex w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-accent/50 bg-surface shadow-2xl"
                // The whole contract of this component in one declaration.
                style={{ maxHeight: "100dvh" }}
                onClick={(e) => {
                    if (!tapAnywhereCloses) e.stopPropagation();
                }}
            >
                <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-2 py-1.5">
                    {onStep && (
                        <button
                            type="button"
                            aria-label="Previous card"
                            disabled={!onStep.previous}
                            onClick={(e) => {
                                e.stopPropagation();
                                onStep.previous?.();
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted disabled:opacity-30"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                    )}
                    <div className="min-w-0 flex-1 truncate font-beleren text-sm text-parchment">
                        {body.displayName}
                    </div>
                    {body.printedImageSrc && (
                        <CardPreviewModeToggle
                            mode={mode}
                            onChange={setMode}
                            computedLabel="Oracle"
                            printedLabel="Printed"
                            className="mx-0 shrink-0"
                        />
                    )}
                    {onStep && (
                        <button
                            type="button"
                            aria-label="Next card"
                            disabled={!onStep.next}
                            onClick={(e) => {
                                e.stopPropagation();
                                onStep.next?.();
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted disabled:opacity-30"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Close inspect overlay"
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div
                    data-inspect-content={split ? "split" : "stacked"}
                    className={`flex min-h-0 flex-1 ${
                        split ? "flex-row" : "flex-col overflow-y-auto"
                    }`}
                >
                    {mode === "printed" && body.printedImageSrc ? (
                        <img
                            src={body.printedImageSrc}
                            alt={`${body.displayName} (printed)`}
                            className="mx-auto max-h-full w-auto object-contain"
                        />
                    ) : (
                        <CardPreviewFace
                            {...body}
                            size="md"
                            layout={split ? "split" : "stacked"}
                        />
                    )}
                </div>

                {actions.length > 0 && (
                    <div className="flex shrink-0 flex-wrap gap-2 border-t border-border-subtle p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                        {actions.map((action) => (
                            <EditingActionButton
                                key={action.label}
                                action={action}
                                stopPropagation={
                                    tapAnywhereCloses && action.primary
                                }
                                className="flex-1"
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
