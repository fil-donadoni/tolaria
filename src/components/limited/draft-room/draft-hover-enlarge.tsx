import { useEffect, useState } from "react";
import { openedPrintId } from "@convex/limited/poolArrangement";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import CardImage from "~/components/cards/card-image";
import { enlargedPlacement, type EnlargedPlacement } from "./draftHoverEnlarge";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

const TILE = "[data-draft-pick-tile]";

type Hovered = EnlargedPlacement & { pickId: string };

function place(tile: Element): Hovered | null {
    const pickId = tile.getAttribute("data-pick-id");
    if (!pickId) return null;
    const r = tile.getBoundingClientRect();
    return {
        pickId,
        ...enlargedPlacement(
            { left: r.left, top: r.top, width: r.width, height: r.height },
            { width: window.innerWidth, height: window.innerHeight }
        ),
    };
}

/**
 * The hovered pack card enlarges IN PLACE (issue #9166, prototype variant C):
 * a `pointer-events: none` copy over its own tile, so click / double-click /
 * drag still land on the real tile beneath. Mouse only — touch has no hover.
 */
export default function DraftHoverEnlarge({
    pack,
    enabled,
}: {
    pack: DraftPackCard[];
    enabled: boolean;
}) {
    const [hovered, setHovered] = useState<Hovered | null>(null);

    useEffect(() => {
        if (!enabled) return;
        const onOver = (e: PointerEvent) => {
            if (e.pointerType !== "mouse" || e.buttons !== 0) return;
            const tile =
                e.target instanceof Element ? e.target.closest(TILE) : null;
            setHovered(tile ? place(tile) : null);
        };
        const hide = () => setHovered(null);
        document.addEventListener("pointerover", onOver);
        document.addEventListener("pointerdown", hide);
        document.addEventListener("scroll", hide, true);
        document.addEventListener("wheel", hide, true);
        return () => {
            document.removeEventListener("pointerover", onOver);
            document.removeEventListener("pointerdown", hide);
            document.removeEventListener("scroll", hide, true);
            document.removeEventListener("wheel", hide, true);
            setHovered(null);
        };
    }, [enabled]);

    const card = hovered
        ? pack.find((c) => c.pickId === hovered.pickId)
        : undefined;

    if (!hovered || !card) return null;
    return (
        <div
            key={hovered.pickId}
            data-slot="draft-hover-enlarge"
            aria-hidden="true"
            className="pointer-events-none fixed z-[900] aspect-5/7 card-corner shadow-[0_24px_60px_rgba(0,0,0,0.85)]"
            style={{
                left: hovered.left,
                top: hovered.top,
                width: hovered.width,
            }}
        >
            <CardImage
                card={{ id: openedPrintId(card) ?? card.cardId }}
                sizes={`${Math.round(hovered.width)}px`}
                holdPreview={false}
            />
        </div>
    );
}
