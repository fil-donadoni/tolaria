import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GameContext } from "~/hooks/useGameContext";
import { useLongPress } from "~/hooks/useLongPress";
import { useRightPressPreview } from "~/hooks/useRightPressPreview";
import type { CardInstance } from "~/types/game";
import { buildPreviewBody, type PreviewBodyContent } from "~/lib/preview-body";
import { releasePreview, requestOpenPreview } from "./card-preview-singleton";
import CardPreviewBody from "./card-preview-body";
import CardPreviewDock from "./card-preview-dock";
import CardPreviewAnchored from "./card-preview-anchored";
import { previewSurfaceIsolationProps } from "./preview-surface-isolation";

const OVERLAY_WIDTH = 128 * 2;
/** Desktop hover-intent (phase 2): dwell this long on a card and the dock
 *  opens — the discoverable trigger that replaces right-hold. */
export const HOVER_DWELL_MS = 250;
/** Small close grace so the dock doesn't flicker when the pointer brushes
 *  past a card on its way elsewhere. */
export const HOVER_GRACE_MS = 120;

type CardPreviewProps = {
    cardId: string;
    cardName: string;
    cardInstance?: CardInstance;
    /** Render a `Copy` badge on the preview (spell copy on the stack, CR
     *  707.10). Permanent copies show a second face instead — driven by
     *  `cardInstance.copiedFrom`, not this flag. */
    showCopyBadge?: boolean;
    /** Pre-built preview face that bypasses `buildPreviewBody`'s registry
     *  resolution. Used for objects that aren't card registry entries but
     *  still want the full preview UX — command-zone emblems (CR 114, issue
     *  #1221), built via `buildEmblemPreviewBody`. When set, this is the
     *  CURRENT face verbatim (never a copy, so no second/original face). */
    bodyOverride?: PreviewBodyContent;
    /** Touch long-press opens the centered preview overlay (ADR 0009). TRUE
     *  everywhere by default — the board, the piles, the lobby — and FALSE on
     *  the EDITING surfaces (deckbuilder tiles, draft pack cards, search
     *  results), where a 250ms hold is the DRAG (PRD #2405 gesture model A,
     *  issue #2583) and a preview opening under the finger would fight it.
     *  Those surfaces read a card through the Peek Panel's Inspect CTA
     *  instead (`~/components/editing/inspect-overlay.tsx`).
     *
     *  Only the TOUCH gesture is suppressed: the desktop right-click pin and
     *  the board-only hover dock are mouse paths and keep working. */
    holdPreview?: boolean;
    /** Suppress the desktop right-click pin entirely — no anchored preview
     *  opens and the native `contextmenu` is left unhandled (issue #2861).
     *  The Draft Room's desktop Pool/Sideboard tiles set this: there, a real
     *  right-click means "open the Inspect Overlay" instead of the preview
     *  pin, which a caller can only own by having this component get out of
     *  the way of the native event first. Defaults to `false` — every other
     *  usage (board, piles, lobby, every other editing-surface tile) is
     *  unchanged. */
    disableRightClickPreview?: boolean;
    children: React.ReactNode;
};

export default function CardPreview({
    cardId,
    cardName,
    cardInstance,
    showCopyBadge,
    bodyOverride,
    holdPreview = true,
    disableRightClickPreview = false,
    children,
}: CardPreviewProps) {
    // Desktop preview (phase 2): HOVER-INTENT is the discoverable trigger —
    // dwell 250ms on a card and the board's right-column dock opens, leaving
    // closes it after a small grace. The RIGHT button is the power path: a
    // quick right-click PINS an anchored preview beside the card (board +
    // lobby alike). Mobile long-press overlay (`showOverlay`) is a separate,
    // untouched surface.
    const gameCtx = useContext(GameContext);
    const [showAnchored, setShowAnchored] = useState(false);
    const [showHoverDock, setShowHoverDock] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);
    // Mirrors the open states for synchronous reads inside event handlers
    // (the quick-click toggle and the outside-click listener run before React
    // has committed the state update).
    const anchoredOpenRef = useRef(false);
    const hoverOpenRef = useRef(false);
    const dwellRef = useRef<number | undefined>(undefined);
    const graceRef = useRef<number | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);

    const longPress = useLongPress({});
    // Preview is visible during the peek window and once locked; only `idle`
    // and `pressing` keep it hidden (ADR 0009 peek/lock).
    const showOverlay =
        holdPreview &&
        (longPress.phase === "longPressed" || longPress.phase === "locked");
    const sawTouchRef = useRef(false);

    // Latest close handle, read by the singleton (one-open-at-a-time) from a
    // stable identity so open/close don't need it in their dep arrays. Closes
    // EVERY desktop surface of this card (pin and hover alike).
    const closeRef = useRef<() => void>(() => {});
    const closeAll = useCallback(() => {
        anchoredOpenRef.current = false;
        setShowAnchored(false);
        hoverOpenRef.current = false;
        setShowHoverDock(false);
        releasePreview(closeRef.current);
    }, []);
    useEffect(() => {
        closeRef.current = closeAll;
    }, [closeAll]);

    const openAnchored = useCallback(() => {
        requestOpenPreview(closeRef.current);
        // The pin supersedes the hover dock — only one desktop surface shows.
        hoverOpenRef.current = false;
        setShowHoverDock(false);
        anchoredOpenRef.current = true;
        setImgLoaded(false);
        setShowAnchored(true);
    }, []);

    // While the anchored preview is open, a document pointerdown that lands
    // OUTSIDE this card closes it, and Escape closes it. A pointerdown INSIDE
    // the card is ignored here so the quick-click toggle (below) can shut it —
    // otherwise a second right-click would close then immediately re-open.
    useEffect(() => {
        if (!showAnchored) return;
        const onPointerDown = (e: PointerEvent) => {
            // Clicks INSIDE the pinned panel (the Live text / Printed card
            // toggle) must not dismiss it — the panel is portal'd to body, so
            // it is never a DOM descendant of the card.
            if (
                e.target instanceof Element &&
                e.target.closest("[data-card-preview-anchored]")
            )
                return;
            const el = containerRef.current;
            // The board flattens this card's subtree (CardTilt3D `preserve-3d`
            // + `overflow-hidden`), so an INSIDE right-click hit-tests to the
            // tilt root ABOVE this container. Use the tilt root (when present)
            // as the "inside" boundary so the quick-click toggle can close the
            // preview instead of this listener racing it closed-then-reopened.
            const boundary =
                el?.closest<HTMLElement>("[data-card-tilt-root]") ?? el;
            if (
                boundary &&
                e.target instanceof Node &&
                boundary.contains(e.target)
            )
                return;
            closeAll();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeAll();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [showAnchored, closeAll]);

    // Release the singleton handle on unmount so a card that leaves the tree
    // (zone change, cleanup) never leaves a dangling open handle.
    useEffect(() => {
        return () => releasePreview(closeRef.current);
    }, []);

    const rightPress = useRightPressPreview({
        onQuickClick: () => {
            if (anchoredOpenRef.current) closeAll();
            else openAnchored();
        },
        // Right-HOLD no longer drives the dock (phase 2): hover-intent owns
        // that surface — see the pointerenter/leave binding below.
    });
    // Stable across renders (the hook memoises it), unlike the freshly-built
    // `rightPress.handlers` object — depend on the function, not the wrapper.
    const onRightPress = rightPress.handlers.onPointerDown;

    // Bind the desktop right-press gesture on the element that ACTUALLY receives
    // the pointer event. On the spatial board the card is wrapped in CardTilt3D
    // (`transform-style: preserve-3d`) around an `overflow-hidden` box; per CSS,
    // `overflow:hidden` inside a preserve-3d context flattens the subtree into a
    // single plane, so a real right-click on a (hover-)tilted card hit-tests to
    // that flattening wrapper — an ANCESTOR of this container — and never reaches
    // a handler bound on the container (this is exactly why a card-local
    // `onPointerDown`/`onContextMenu` fired only intermittently on the board).
    // Binding on the OUTERMOST tilt element, to which the flattened event
    // bubbles, catches it deterministically. Off the board there is no tilt and
    // we bind on the container itself. A battlefield permanent with an
    // activated-ability menu still binds here: right-click / long-press is the
    // preview (Arena click model), and the menu opens on LEFT click instead
    // (a synthesized, untrusted `contextmenu` — see ui/context-menu.tsx), so
    // the two gestures no longer collide.
    useEffect(() => {
        if (disableRightClickPreview) return;
        const container = containerRef.current;
        if (!container) return;
        const cardEl =
            container.closest<HTMLElement>("[data-card-tilt-root]") ??
            container;
        const onPointerDown = (e: PointerEvent) => {
            // Desktop-only, right button only. A touch device sets sawTouchRef
            // and must never trigger the mouse preview.
            if (e.button !== 2 || sawTouchRef.current) return;
            onRightPress(e as unknown as React.PointerEvent);
        };
        // Kill the native "Save image…" menu at the same guaranteed-ancestor
        // spot (preventDefault only — no stopPropagation — so nothing above that
        // legitimately wants the contextmenu is starved).
        const onContextMenu = (e: MouseEvent) => e.preventDefault();
        cardEl.addEventListener("pointerdown", onPointerDown);
        cardEl.addEventListener("contextmenu", onContextMenu);
        return () => {
            cardEl.removeEventListener("pointerdown", onPointerDown);
            cardEl.removeEventListener("contextmenu", onContextMenu);
        };
    }, [onRightPress, disableRightClickPreview]);

    // Bind the mobile long-press gesture on the same resolved host as the
    // right-press/hover gestures above, instead of as React `onTouch*` props
    // directly on `containerRef` (the pre-#1994-round-4 shape). On the
    // spatial board a TAPPED permanent's presentational layer
    // (`[data-tap-visual]`, `board-battlefield-card.tsx`) rotates the art —
    // this container included — and goes `pointer-events: none` so its
    // overhang can never be hit-tested; a real touch landing on that art
    // never reaches a listener bound as a plain prop on THIS element, because
    // the browser's hit test falls straight through the inert subtree to
    // whatever's genuinely painted underneath. `[data-card-tilt-root]`
    // (`card-tilt-3d.tsx`) now wraps that rotated layer instead of living
    // inside it (round 4), so it stays fully hit-testable on a tapped
    // permanent — binding here instead of on `container` restores long-press
    // preview on a tapped card. Off the board (no tilt-root ancestor, e.g.
    // the lobby/deck-builder) `closest` falls back to `container` itself, so
    // behaviour there is unchanged. `sawTouchRef` is set here (not in a JSX
    // wrapper) so a later mouse-only gesture (right-press, hover-dwell) on
    // the same touch device still gets suppressed.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const cardEl =
            container.closest<HTMLElement>("[data-card-tilt-root]") ??
            container;
        // `sawTouchRef` is set even with the hold-preview off: it is what
        // suppresses the MOUSE preview paths on a touch device, and an
        // editing surface must not start hover-previewing because its own
        // long-press was disabled.
        const onTouchStart = (e: TouchEvent) => {
            sawTouchRef.current = true;
            if (!holdPreview) return;
            longPress.handlers.onTouchStart(e as unknown as React.TouchEvent);
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!holdPreview) return;
            longPress.handlers.onTouchMove(e as unknown as React.TouchEvent);
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (!holdPreview) return;
            longPress.handlers.onTouchEnd(e as unknown as React.TouchEvent);
        };
        const onTouchCancel = () => {
            if (!holdPreview) return;
            longPress.handlers.onTouchCancel();
        };
        // touchend calls `preventDefault()` (peek dismiss / lock) — needs a
        // non-passive listener or the browser ignores the call and warns.
        cardEl.addEventListener("touchstart", onTouchStart, {
            passive: true,
        });
        cardEl.addEventListener("touchmove", onTouchMove, { passive: true });
        cardEl.addEventListener("touchend", onTouchEnd, { passive: false });
        cardEl.addEventListener("touchcancel", onTouchCancel);
        return () => {
            cardEl.removeEventListener("touchstart", onTouchStart);
            cardEl.removeEventListener("touchmove", onTouchMove);
            cardEl.removeEventListener("touchend", onTouchEnd);
            cardEl.removeEventListener("touchcancel", onTouchCancel);
        };
        // `longPress.handlers` is a fresh object every render (only its
        // individual callbacks are memoised) — depend on the specific
        // handler functions, same reasoning as `onRightPress` above.
        // `cardInstance?.isTapped` is included defensively: `cardEl`'s
        // identity doesn't itself depend on tap state in this component (the
        // rotation/inertness lives one component up), but re-running the
        // resolution on a tap toggle costs nothing and guards against this
        // effect silently going stale if a future ancestor DOES restructure
        // around tap state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        longPress.handlers.onTouchStart,
        longPress.handlers.onTouchMove,
        longPress.handlers.onTouchEnd,
        longPress.handlers.onTouchCancel,
        cardInstance?.isTapped,
        holdPreview,
    ]);

    // Close grace shared by the card's own pointerleave and the dock's (hovering
    // the dock keeps it open so its controls are usable).
    const scheduleHoverClose = useCallback(() => {
        window.clearTimeout(graceRef.current);
        graceRef.current = window.setTimeout(() => {
            hoverOpenRef.current = false;
            setShowHoverDock(false);
            releasePreview(closeRef.current);
        }, HOVER_GRACE_MS);
    }, []);
    const cancelHoverClose = useCallback(() => {
        window.clearTimeout(graceRef.current);
    }, []);

    // Desktop hover-intent (board only — the dock lives in the right column).
    // Dwell 250ms → open the dock through the singleton (closing any other
    // card's surface); leave → close after a small grace. Touch pointers are
    // ignored (the long-press overlay owns touch).
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !gameCtx) return;
        const cardEl =
            container.closest<HTMLElement>("[data-card-tilt-root]") ??
            container;
        const onEnter = (e: PointerEvent) => {
            if (e.pointerType !== "mouse" || sawTouchRef.current) return;
            window.clearTimeout(dwellRef.current);
            window.clearTimeout(graceRef.current);
            dwellRef.current = window.setTimeout(() => {
                // A pinned anchored preview supersedes hover — stay out.
                if (anchoredOpenRef.current) return;
                requestOpenPreview(closeRef.current);
                hoverOpenRef.current = true;
                setImgLoaded(false);
                setShowHoverDock(true);
            }, HOVER_DWELL_MS);
        };
        const onLeave = (e: PointerEvent) => {
            window.clearTimeout(dwellRef.current);
            if (!hoverOpenRef.current) return;
            // The dock can render directly on top of the card that opened it
            // (a right-column pile sits inside the dock's own reserved
            // footprint) — the hit-test target then changes to the dock
            // without the pointer ever really leaving, which still fires a
            // native pointerleave. `relatedTarget` names the element the
            // pointer is entering; when it's part of this card's OWN preview
            // surface, scheduling a close here would expose the card again
            // (or fight the dock's own onPointerEnter), re-trigger the dwell,
            // and reopen right back — an open/close flash loop. A real leave
            // enters something outside the preview surface.
            const related = e.relatedTarget;
            if (
                related instanceof Element &&
                related.closest(
                    "[data-card-preview-dock], [data-card-preview-anchored]"
                )
            ) {
                return;
            }
            scheduleHoverClose();
        };
        cardEl.addEventListener("pointerenter", onEnter);
        cardEl.addEventListener("pointerleave", onLeave);
        return () => {
            cardEl.removeEventListener("pointerenter", onEnter);
            cardEl.removeEventListener("pointerleave", onLeave);
            window.clearTimeout(dwellRef.current);
            window.clearTimeout(graceRef.current);
        };
    }, [gameCtx, scheduleHoverClose]);

    const dismissOverlay = useCallback(() => {
        longPress.dismiss();
    }, [longPress]);

    // Current (presented) face — identical to the pre-refactor behavior:
    // effective P/T, counters, color override, owner, granted abilities. A
    // `bodyOverride` (emblem, issue #1221) short-circuits the registry-driven
    // build since the object has no CardDefinition.
    const currentBody =
        bodyOverride ??
        buildPreviewBody(cardId, cardInstance, gameCtx, cardName);
    // Original (printed) face — only for a copy permanent (CR 707.2). Built
    // from the preserved printed id with NO instance/context, so it is the
    // pure printed identity (name, art, type line, oracle, printed P/T).
    const originalBody = cardInstance?.copiedFrom
        ? buildPreviewBody(cardInstance.copiedFrom)
        : null;
    const imageSrc = currentBody.imageSrc;
    // Two faces double the surface width; keep the mobile overlay clamped by
    // its max-w so it never exceeds the viewport.
    const overlayFactor = originalBody ? 3 : 1.5;

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={longPress.scaleStyle}
        >
            {/* Long-press touch handlers are bound imperatively above (see
                the `useEffect` next to `onRightPress`), not as React props
                here — this container can sit inside a tapped permanent's
                inert rotated layer on the board, where a plain prop here
                would never receive the touch. */}
            {children}
            {/* Mobile long-press centered overlay (ADR 0009) — UNCHANGED. */}
            {showOverlay &&
                createPortal(
                    <div
                        className="fixed inset-0 z-modal flex items-center justify-center modal-scrim"
                        // Portal'd, yet a REACT descendant of the card — isolate
                        // every pointer/mouse event so the card instance's own
                        // handlers (tap, cast, ability context menu) never fire
                        // from inside the preview area.
                        {...previewSurfaceIsolationProps}
                        onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            dismissOverlay();
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            dismissOverlay();
                        }}
                    >
                        <div
                            // `max-h-[100dvh]`, not `-[90vh]` (round-2 review
                            // finding 5, #2589): `vh` is the LARGE viewport
                            // unit — on a phone with retracting browser
                            // chrome, `90vh` can EXCEED `100dvh` (e.g. lvh
                            // 844 / dvh 740 gives `0.9*844=759.6px >
                            // 740px`). ADR 0101 §5 mandates
                            // `max-height: 100dvh` always; `100dvh` alone
                            // (no `90%` shrink) is the correct translation —
                            // the surrounding `fixed inset-0` wrapper is
                            // already the 100dvh viewport, so this box need
                            // only cap itself at that same height, not a
                            // fraction smaller than it.
                            //
                            // v4 panel material (ADR 0103 §5, issue #2728):
                            // hairline edge + `.panel-physical` (flat surface,
                            // one top-light gradient, soft elevation shadow)
                            // instead of the v3 opaque `bg-surface shadow-2xl`
                            // — no corner brackets, no glow.
                            className="panel-physical hairline flex flex-col rounded-[var(--panel-radius)] overflow-hidden max-h-[100dvh] max-w-[90vw]"
                            style={{ width: OVERLAY_WIDTH * overlayFactor }}
                            onTouchEnd={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <CardPreviewBody
                                {...currentBody}
                                originalBody={originalBody}
                                showCopyBadge={showCopyBadge}
                                size="md"
                            />
                        </div>
                    </div>,
                    document.body
                )}
            {/* Desktop hover-intent dock (board only): opens on dwell, closes
                on leave. Superseded by the pinned anchored preview. */}
            {showHoverDock && gameCtx && (
                <CardPreviewDock
                    {...currentBody}
                    originalBody={originalBody}
                    showCopyBadge={showCopyBadge}
                    size="md"
                    imageLoaded={imageSrc ? imgLoaded : true}
                    onImageLoaded={() => setImgLoaded(true)}
                    onPointerEnter={cancelHoverClose}
                    onPointerLeave={scheduleHoverClose}
                    // Desktop lateral zoom (ADR 0103 issue body, issue
                    // #2728): compact badge + "Alt: engine view" hint, not
                    // the full slot — the dock has no room for the tree well.
                    compactEngineView
                />
            )}
            {/* Desktop quick-click preview: anchored beside the card, board and
                lobby alike, clamped fully inside the viewport. */}
            {showAnchored && (
                <CardPreviewAnchored
                    {...currentBody}
                    originalBody={originalBody}
                    showCopyBadge={showCopyBadge}
                    size="sm"
                    imageLoaded={imageSrc ? imgLoaded : true}
                    onImageLoaded={() => setImgLoaded(true)}
                    anchorRef={containerRef}
                />
            )}
        </div>
    );
}
