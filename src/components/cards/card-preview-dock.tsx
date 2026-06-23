import { createPortal } from "react-dom";
import CardPreviewBody, {
    type CardPreviewBodyProps,
} from "./card-preview-body";

// Issue #332 — desktop card preview is a FIXED panel docked center-LEFT of the
// board. One constant location: whichever card is hovered (hand, battlefield,
// piles, stack), the preview always appears here, so the eye never chases a
// panel around the screen. This retires the former beside-the-card lateral
// placement (the old `clampZoomPosition`).
//
// The mobile centered long-press overlay (ADR 0009) is a separate surface and
// is untouched — it stays driven by the touch long-press path in CardPreview.
//
// The position contract (anchored to the left edge, vertically centered) is
// asserted by tests via the `data-card-preview-dock` marker — a contract, not
// a pixel value.
const DOCK_WIDTH = 128 * 2;
const VIEWPORT_PAD = 8;

export default function CardPreviewDock(props: CardPreviewBodyProps) {
    return createPortal(
        <div
            data-card-preview-dock
            className="pointer-events-none fixed left-2 top-1/2 -translate-y-1/2 z-100 flex flex-col rounded-2xl shadow-2xl bg-surface overflow-hidden"
            style={{
                width: DOCK_WIDTH,
                maxHeight: `calc(100vh - ${VIEWPORT_PAD * 2}px)`,
            }}
        >
            <CardPreviewBody {...props} />
        </div>,
        document.body
    );
}
