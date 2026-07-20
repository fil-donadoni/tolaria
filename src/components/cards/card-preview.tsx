import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GameContext } from "~/hooks/useGameContext";
import { useLongPress } from "~/hooks/useLongPress";
import { useRightPressPreview } from "~/hooks/useRightPressPreview";
import type { CardInstance } from "~/types/game";
import { buildPreviewBody } from "~/lib/preview-body";
import { releasePreview, requestOpenPreview } from "./card-preview-singleton";
import CardPreviewBody from "./card-preview-body";
import CardPreviewDock from "./card-preview-dock";
import CardPreviewAnchored from "./card-preview-anchored";

const OVERLAY_WIDTH = 128 * 2;

type CardPreviewProps = {
    cardId: string;
    cardName: string;
    cardInstance?: CardInstance;
    /** Render a `Copy` badge on the preview (spell copy on the stack, CR
     *  707.10). Permanent copies show a second face instead — driven by
     *  `cardInstance.copiedFrom`, not this flag. */
    showCopyBadge?: boolean;
    children: React.ReactNode;
};

export default function CardPreview({
    cardId,
    cardName,
    cardInstance,
    showCopyBadge,
    children,
}: CardPreviewProps) {
    // Desktop preview is CLICK-driven (Arena model, #332). The RIGHT button
    // owns it — left-click stays a gameplay action. A quick right-click toggles
    // an anchored preview beside the card (board + lobby alike); holding the
    // right button past the threshold shows the big preview in the board's
    // right-column dock while held. Mobile long-press overlay (`showOverlay`) is
    // a separate, untouched surface.
    const gameCtx = useContext(GameContext);
    const [showAnchored, setShowAnchored] = useState(false);
    const [showZoomDock, setShowZoomDock] = useState(false);
    const [imgLoaded, setImgLoaded] = useState(false);
    // Mirrors `showAnchored` for synchronous reads inside event handlers (the
    // quick-click toggle and the outside-click listener run before React has
    // committed the state update).
    const anchoredOpenRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const longPress = useLongPress({});
    // Preview is visible during the peek window and once locked; only `idle`
    // and `pressing` keep it hidden (ADR 0009 peek/lock).
    const showOverlay =
        longPress.phase === "longPressed" || longPress.phase === "locked";
    const sawTouchRef = useRef(false);

    // Latest close handle, read by the singleton (one-open-at-a-time) from a
    // stable identity so open/close don't need it in their dep arrays.
    const closeRef = useRef<() => void>(() => {});

    const closeAnchored = useCallback(() => {
        anchoredOpenRef.current = false;
        setShowAnchored(false);
        releasePreview(closeRef.current);
    }, []);
    useEffect(() => {
        closeRef.current = closeAnchored;
    }, [closeAnchored]);

    const openAnchored = useCallback(() => {
        requestOpenPreview(closeRef.current);
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
            closeAnchored();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeAnchored();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [showAnchored, closeAnchored]);

    // Release the singleton handle on unmount so a card that leaves the tree
    // (zone change, cleanup) never leaves a dangling open handle.
    useEffect(() => {
        return () => releasePreview(closeRef.current);
    }, []);

    const rightPress = useRightPressPreview({
        onQuickClick: () => {
            if (anchoredOpenRef.current) closeAnchored();
            else openAnchored();
        },
        // Hold-zoom is a board feature (needs the right-column dock). In the
        // lobby/deck-builder there is no dock, so the hold does nothing extra.
        onZoomStart: () => {
            if (!gameCtx) return;
            if (anchoredOpenRef.current) closeAnchored();
            setImgLoaded(false);
            setShowZoomDock(true);
        },
        onZoomEnd: () => setShowZoomDock(false),
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
    }, [onRightPress]);

    const dismissOverlay = useCallback(() => {
        longPress.dismiss();
    }, [longPress]);

    // Current (presented) face — identical to the pre-refactor behavior:
    // effective P/T, counters, color override, owner, granted abilities.
    const currentBody = buildPreviewBody(
        cardId,
        cardInstance,
        gameCtx,
        cardName
    );
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
            {...longPress.handlers}
            onTouchStart={(e) => {
                sawTouchRef.current = true;
                longPress.handlers.onTouchStart(e);
            }}
        >
            {children}
            {/* Mobile long-press centered overlay (ADR 0009) — UNCHANGED. */}
            {showOverlay &&
                createPortal(
                    <div
                        className="fixed inset-0 z-modal flex items-center justify-center bg-scrim backdrop-blur-sm"
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => {
                            e.preventDefault();
                            dismissOverlay();
                        }}
                        onClick={dismissOverlay}
                    >
                        <div
                            className="flex flex-col rounded-2xl shadow-2xl bg-surface overflow-hidden max-h-[90vh] max-w-[90vw]"
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
            {/* Desktop hold-zoom (board only): the big preview in the fixed
                right-column dock while the right button is held. It supersedes
                the anchored preview — only one desktop surface shows at a time. */}
            {showZoomDock && gameCtx && (
                <CardPreviewDock
                    {...currentBody}
                    originalBody={originalBody}
                    showCopyBadge={showCopyBadge}
                    size="md"
                    imageLoaded={imageSrc ? imgLoaded : true}
                    onImageLoaded={() => setImgLoaded(true)}
                />
            )}
            {/* Desktop quick-click preview: anchored beside the card, board and
                lobby alike, clamped fully inside the viewport. Hidden while the
                hold-zoom dock is up. */}
            {showAnchored && !showZoomDock && (
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
