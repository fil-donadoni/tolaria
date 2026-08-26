import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { buildPreviewBody } from "~/lib/preview-body";
import { useViewportMode } from "~/hooks/useViewportMode";
import CardPreviewFace from "~/components/cards/card-preview-face";
import CardPreviewModeToggle, {
    type CardPreviewMode,
} from "~/components/cards/card-preview-mode-toggle";
import { acceptsShortcut } from "~/lib/keyboard-shortcuts";
import EditingActionButton from "./editing-action-button";
import type { EditingSurfaceAction } from "./editing-surface-action";

/** The scrim's padding per side, in rem — `p-3` in the className below. The
 *  panel's cap subtracts both sides of it, so the two are one number. */
const SCRIM_PAD_REM = 0.75;

/** The overlay's own controls — Oracle/Printed, ‹ ›, × — sit in the header
 *  row marked `data-inspect-controls` below. Tap-anywhere dismissal exempts
 *  them AS A CLASS (issue #2668): ANY interactive element rendered inside
 *  that row matches this selector and is exempt automatically, so a future
 *  control (or the face toggle, which used to be missing) never has to opt
 *  out by hand — the shape that let the toggle silently fall through the
 *  old per-control list. `:is(...)` lists every interactive tag CR-adjacent
 *  UI actually uses, not just `<button>` — a review on this same issue
 *  measured that a `<select>` dropped into the row was NOT exempt under a
 *  `button`-only selector, i.e. it reproduced the exact bug one level up.
 *  Scoped to the header row on purpose: it must NOT reach the action row
 *  below (`actions.length > 0`), whose primary/non-primary distinction is a
 *  separate, unrelated exemption (see `EditingActionButton`'s
 *  `stopPropagation` prop). */
const CONTROL_ROW_SELECTOR =
    '[data-inspect-controls] :is(button, a, input, select, textarea, [role="button"])';

export interface InspectOverlayProps {
    /** Registry card id being inspected. */
    cardId: string;
    /** Surface CTAs, rendered inside the overlay so read → act is one flow. */
    actions?: readonly EditingSurfaceAction[];
    onClose: () => void;
    /** Draft Room (PRD #2405 D15): a tap ANYWHERE closes, so read → back to
     *  picking is one tap. Two things are exempt: the `primary` action (it
     *  must fire, not be swallowed by the dismiss) and the header row's own
     *  controls — Oracle/Printed, ‹ ›, × — exempt as a class (issue #2668),
     *  never a per-control list. Off by default: the deckbuilder wants the
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
 * 1. **It never exceeds `100dvh`** (`100dvh` minus the scrim's own padding,
 *    so the RENDERED box fits too). `dvh`, not `vh`: on mobile Safari/Chrome
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
    const panelRef = useRef<HTMLDivElement>(null);

    // ESCAPE CLOSES, AND FOCUS COMES IN WITH THE OVERLAY (issue #2593).
    //
    // This is `role="dialog" aria-modal="true"` and it shipped (#2583) with
    // neither: dismissal was a scrim TAP or the Close button, so a keyboard
    // user who opened it had no way out that did not involve finding a button
    // they could not see — `aria-modal` tells a screen reader the rest of the
    // page is inert, which makes "just tab back to the surface" wrong as well
    // as unpleasant. Bound on `window` (capture-free) rather than on the panel
    // because focus may legitimately sit on the scrim or on a portalled child.
    //
    // `whileDialogOpen` is the point of the option: every OTHER window
    // shortcut in the app defers to an open dialog, and this binding IS the
    // open dialog's.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            if (!acceptsShortcut(event, { whileDialogOpen: true })) return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // Move focus into the panel on open so the first Tab lands on the
    // overlay's own controls rather than continuing from wherever the surface
    // underneath left it. `-1` tab stop: the panel takes focus, it is not part
    // of the tab ring afterwards.
    useEffect(() => {
        panelRef.current?.focus();
    }, []);
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
                ref={panelRef}
                tabIndex={-1}
                data-inspect-panel
                // v4 panel material (ADR 0103 §5, issue #2728): hairline
                // edge + `.panel-physical` instead of the v3 opaque
                // `border-accent/50 bg-surface shadow-2xl` — no corner
                // brackets, no glow.
                className="panel-physical hairline flex w-full max-w-[720px] flex-col overflow-hidden rounded-[var(--panel-radius)]"
                // The whole contract of this component in one declaration.
                // `- 1.5rem` is the scrim's own `p-3` padding, both sides: a
                // flat `100dvh` panel is TALLER than the padded content box
                // it centres in, so it hangs 12px past each viewport edge
                // (issue #2583 review). Subtracting the padding is what makes
                // "never exceeds 100dvh" true of the rendered box and not
                // just of the declaration.
                style={{ maxHeight: `calc(100dvh - ${SCRIM_PAD_REM * 2}rem)` }}
                onClick={(e) => {
                    if (!tapAnywhereCloses) {
                        e.stopPropagation();
                        return;
                    }
                    // Class-based exemption (issue #2668): any control in
                    // the header row stops the dismiss here, regardless of
                    // which one it is. The row's own buttons no longer need
                    // to `stopPropagation()` themselves — this is the single
                    // place that decides, so a new control added to the row
                    // is exempt for free instead of silently falling through.
                    if ((e.target as Element).closest(CONTROL_ROW_SELECTOR)) {
                        e.stopPropagation();
                    }
                }}
            >
                <div
                    data-inspect-controls
                    className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-2 py-1.5"
                >
                    {onStep && (
                        <button
                            type="button"
                            aria-label="Previous card"
                            disabled={!onStep.previous}
                            onClick={() => onStep.previous?.()}
                            style={{
                                minHeight: "var(--control-h)",
                                minWidth: "var(--control-h)",
                            }}
                            className="flex shrink-0 items-center justify-center rounded-full text-text-muted disabled:opacity-30"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                    )}
                    {/* v4 (ADR 0103 §4): Beleren stays confined to the card
                        domain — this is dialog CHROME naming the card, not
                        the card's own face, so it reads in the Geist
                        display face like the rest of the chrome (the
                        implicit `font-sans` default, no override). */}
                    <div className="min-w-0 flex-1 truncate text-sm text-parchment">
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
                            onClick={() => onStep.next?.()}
                            style={{
                                minHeight: "var(--control-h)",
                                minWidth: "var(--control-h)",
                            }}
                            className="flex shrink-0 items-center justify-center rounded-full text-text-muted disabled:opacity-30"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label="Close inspect overlay"
                        onClick={onClose}
                        style={{
                            minHeight: "var(--control-h)",
                            minWidth: "var(--control-h)",
                        }}
                        className="flex shrink-0 items-center justify-center rounded-full text-text-muted"
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
