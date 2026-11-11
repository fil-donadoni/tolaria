// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-zoom=C`). Never merge.
// Variant C: reading does not need a control at all. The card under the
// pointer enlarges IN PLACE (over its own tile, no side dock) to a size where
// the oracle text is readable; ⌘/Ctrl + wheel over the pack resizes the whole
// grid, and a hint toast teaches both. The enlarged copy is `pointer-events:
// none`, so click / double-click / drag still land on the real tile beneath.
import { useEffect, useRef, useState } from "react";
import { openedPrintId } from "@convex/limited/poolArrangement";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import CardImage from "~/components/cards/card-image";
import type { PrototypeZoom } from "./usePrototypeZoom";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

const TILE = "[data-draft-pick-tile]";
const ENLARGED_MIN_W = 320;
const ENLARGED_MAX_W = 440;
const MARGIN = 8;
const HINT_MS = 12000;

interface Hovered {
    pickId: string;
    left: number;
    top: number;
    width: number;
}

function place(tile: Element): Hovered | null {
    const pickId = tile.getAttribute("data-pick-id");
    if (!pickId) return null;
    const rect = tile.getBoundingClientRect();
    const width = Math.min(
        ENLARGED_MAX_W,
        Math.max(ENLARGED_MIN_W, rect.width * 1.8),
        ((window.innerHeight - 2 * MARGIN) * 5) / 7
    );
    const height = (width * 7) / 5;
    const clamp = (v: number, size: number, max: number) =>
        Math.min(Math.max(MARGIN, v), max - size - MARGIN);
    return {
        pickId,
        width,
        left: clamp(
            rect.left + rect.width / 2 - width / 2,
            width,
            window.innerWidth
        ),
        top: clamp(
            rect.top + rect.height / 2 - height / 2,
            height,
            window.innerHeight
        ),
    };
}

export default function PrototypeZoomHoverEnlarge({
    pack,
    zoom,
}: {
    pack: DraftPackCard[];
    zoom: PrototypeZoom;
}) {
    const [hovered, setHovered] = useState<Hovered | null>(null);
    // Shown on every mount so the reviewer always sees it; the real one would
    // remember "seen" in localStorage and show once per player.
    const [hint, setHint] = useState(true);
    const zoomRef = useRef(zoom);
    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        const id = setTimeout(() => setHint(false), HINT_MS);
        return () => clearTimeout(id);
    }, []);

    useEffect(() => {
        const onOver = (e: PointerEvent) => {
            if (e.pointerType !== "mouse" || e.buttons !== 0) return;
            const tile =
                e.target instanceof Element ? e.target.closest(TILE) : null;
            setHovered(tile ? place(tile) : null);
        };
        const hide = () => setHovered(null);
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (
                !(e.target instanceof Element) ||
                !e.target.closest('[data-slot="draft-stacked-booster"]')
            )
                return;
            e.preventDefault();
            const z = zoomRef.current;
            z.set(z.value + (e.deltaY < 0 ? 0.1 : -0.1));
            setHovered(null);
            setHint(false);
        };
        document.addEventListener("pointerover", onOver);
        document.addEventListener("pointerdown", hide);
        document.addEventListener("scroll", hide, true);
        window.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            document.removeEventListener("pointerover", onOver);
            document.removeEventListener("pointerdown", hide);
            document.removeEventListener("scroll", hide, true);
            window.removeEventListener("wheel", onWheel);
        };
    }, []);

    const card = hovered
        ? pack.find((c) => c.pickId === hovered.pickId)
        : undefined;

    return (
        <>
            <style>{`
@keyframes prototype-hover-enlarge {
    from { transform: scale(0.6); opacity: 0.4; }
    to { transform: scale(1); opacity: 1; }
}`}</style>
            {hovered && card && (
                <div
                    key={hovered.pickId}
                    data-prototype="zoom-hover-enlarge"
                    aria-hidden="true"
                    className="pointer-events-none fixed z-[900] aspect-5/7 card-corner shadow-[0_24px_60px_rgba(0,0,0,0.85)]"
                    style={{
                        left: hovered.left,
                        top: hovered.top,
                        width: hovered.width,
                        animation: "prototype-hover-enlarge 0.12s ease-out",
                    }}
                >
                    <CardImage
                        card={{ id: openedPrintId(card) ?? card.cardId }}
                        sizes={`${Math.round(hovered.width)}px`}
                        holdPreview={false}
                    />
                </div>
            )}
            {hint && (
                <div
                    data-prototype="zoom-hint-toast"
                    role="status"
                    className="fixed bottom-6 left-1/2 z-[950] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border-accent/60 bg-surface-elevated px-5 py-2.5 text-sm text-text shadow-2xl"
                >
                    <span>
                        <strong>Hover</strong> a card to read it ·{" "}
                        <kbd className="rounded-sm border border-border-accent/50 px-1.5 font-mono text-xs">
                            ⌘/Ctrl
                        </kbd>{" "}
                        + <strong>scroll</strong> to resize the whole pack
                    </span>
                    <button
                        type="button"
                        aria-label="Dismiss hint"
                        onClick={() => setHint(false)}
                        className="text-text-muted hover:text-parchment"
                    >
                        ✕
                    </button>
                </div>
            )}
        </>
    );
}
