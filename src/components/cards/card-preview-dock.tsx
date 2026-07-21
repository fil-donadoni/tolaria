import { createPortal } from "react-dom";
import CardPreviewBody, {
    type CardPreviewBodyProps,
} from "./card-preview-body";

// Issue #332 — in-game desktop card preview is a FIXED panel docked to the
// board's RIGHT column, the side that already hosts the libraries/piles and the
// turn-phase pod. One constant location: whichever card is hovered (hand,
// battlefield, piles, stack), the preview always appears here, so the eye never
// chases a panel around the screen. (It used to dock center-LEFT, which clashed
// with the board content; the lobby/deck-builder keep the beside-the-card
// anchored placement via CardPreviewAnchored instead.)
//
// The mobile centered long-press overlay (ADR 0009) is a separate surface and
// is untouched — it stays driven by the touch long-press path in CardPreview.
//
// The position contract (anchored to the right edge, vertically centered within
// the band ABOVE the controller pod) is asserted by tests via the
// `data-card-preview-dock` marker — a contract, not a pixel value.
//
// Vertical bounds: the dock no longer centers on the whole viewport (which let a
// tall card collide with the controller pod at bottom-right). Instead it spans
// from a small top inset down to a reserved bottom safe-area
// (`--preview-bottom-safe`, see index.css) that clears the pod
// (`fixed bottom-32 right-4`, ~150px tall → ~300px reserved), and the card is
// centered within THAT band. `max-h-full` on the inner container caps the card
// to the band, so full-art + oracle-text cards (e.g. City of Brass) scroll/clamp
// inside it rather than overflowing onto the pod. The pod is right-anchored in
// both orientations, so a single bottom reservation clears it in portrait and
// landscape alike.
// Phase 2: the dock grows from 256px to the 420px class (spec: 400–480px).
const DOCK_WIDTH = 420;
const VIEWPORT_PAD = 8;

export default function CardPreviewDock(props: CardPreviewBodyProps) {
    // A copy permanent shows two faces (Current + Original) — double the width.
    const width = props.originalBody ? DOCK_WIDTH * 2 : DOCK_WIDTH;
    return createPortal(
        <div
            data-card-preview-dock
            className="pointer-events-none fixed right-2 z-modal flex items-center justify-end"
            style={{
                top: VIEWPORT_PAD,
                bottom: "var(--preview-bottom-safe)",
            }}
        >
            <div
                className="card-preview-dock pointer-events-none flex max-h-full flex-col overflow-hidden rounded-2xl bg-surface"
                style={{ width }}
            >
                <CardPreviewBody {...props} />
            </div>
        </div>,
        document.body
    );
}
