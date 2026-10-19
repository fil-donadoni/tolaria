import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import CardPreviewBody, {
    type CardPreviewBodyProps,
} from "./card-preview-body";
import { previewSurfaceIsolationProps } from "./preview-surface-isolation";
import {
    ANCHORED_PREVIEW_VIEWPORT_PAD as VIEWPORT_PAD,
    clampAnchoredPreviewPosition,
} from "~/lib/card-preview-placement";

// Beside-the-card preview placement for surfaces that are NOT the in-game board
// (the lobby and the deck builder). Whereas the board docks the preview in its
// fixed right column (CardPreviewDock), here there is no board chrome to dodge,
// so the preview reads better floated next to the hovered card — its original
// placement before the #332 dock. The position is clamped to the viewport
// (`clampAnchoredPreviewPosition`) and RE-measured whenever the panel's size or
// the viewport changes (issue #5664): the height varies with oracle-text length,
// the Live text / Printed card toggle, the engine view and late image loads, so
// a one-shot mount measurement left a hand card's preview hanging off the
// bottom edge. Asserted by tests via the `data-card-preview-anchored` marker.
// Desktop width (QA): 330px, trimmed from 384px alongside the right-column dock
// (360px) — the preview was taking more of the screen than it needed.
const DOCK_WIDTH = 330;

type CardPreviewAnchoredProps = CardPreviewBodyProps & {
    /** The hovered card's container, used as the positioning anchor. */
    anchorRef: RefObject<HTMLDivElement | null>;
};

export default function CardPreviewAnchored({
    anchorRef,
    ...body
}: CardPreviewAnchoredProps) {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const [measured, setMeasured] = useState(false);
    // A copy permanent shows two faces (Current + Original) — double the width;
    // the viewport-clamp below keeps it on screen.
    const width = body.originalBody ? DOCK_WIDTH * 2 : DOCK_WIDTH;

    // Callback ref stores the panel node; the layout effect measures it
    // before first paint (no flash at 0,0) and re-clamps on every panel resize
    // (content toggles, image/text load) and every viewport resize.
    const [panel, setPanel] = useState<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (!panel) return;
        const place = () => {
            const anchor = anchorRef.current;
            if (!anchor) return;
            const panelRect = panel.getBoundingClientRect();
            const next = clampAnchoredPreviewPosition(
                anchor.getBoundingClientRect(),
                panelRect.width,
                panelRect.height,
                { width: window.innerWidth, height: window.innerHeight }
            );
            setPosition((prev) =>
                prev.top === next.top && prev.left === next.left ? prev : next
            );
            setMeasured(true);
        };
        place();
        window.addEventListener("resize", place);
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(place);
        observer?.observe(panel);
        return () => {
            window.removeEventListener("resize", place);
            observer?.disconnect();
        };
    }, [panel, anchorRef]);

    return createPortal(
        <div
            ref={setPanel}
            data-card-preview-anchored
            // Interactive: the pinned preview hosts the Live text / Printed
            // card toggle, so it must receive clicks. `CardPreview`'s
            // outside-pointerdown dismiss treats this panel as "inside".
            // The panel is portal'd but still a REACT descendant of the card,
            // so its events must be isolated or the card's context menu / tap
            // fires from inside the preview area.
            {...previewSurfaceIsolationProps}
            // v4 panel material (ADR 0103 §5, issue #2728): hairline edge +
            // `.panel-physical` instead of the v3 opaque `bg-surface
            // shadow-2xl` — no corner brackets, no glow.
            className="panel-physical hairline pointer-events-auto fixed z-modal flex flex-col rounded-[var(--panel-radius)] overflow-hidden"
            style={{
                top: position.top,
                left: position.left,
                width,
                maxHeight: `calc(100dvh - ${VIEWPORT_PAD * 2}px)`,
                opacity: measured ? 1 : 0,
            }}
        >
            {/* Capped by `maxHeight` above: the body shrinks and scrolls
                instead of being clipped by `overflow-hidden`. */}
            <div data-card-preview-scroll className="min-h-0 overflow-y-auto">
                <CardPreviewBody {...body} />
            </div>
        </div>,
        document.body
    );
}
