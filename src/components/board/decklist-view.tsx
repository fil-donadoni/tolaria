import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckCard } from "~/types/game";
import { buildPreviewBody } from "~/lib/preview-body";
import CardPreviewBody from "~/components/cards/card-preview-body";
import CardBack from "~/components/cards/card-back";
import { HOVER_GRACE_MS } from "~/components/cards/card-preview";
import DecklistSection from "./decklist-section";

type DecklistViewProps = {
    maindeck: DeckCard[];
    sideboard: DeckCard[];
};

/** Read-only registered decklist (issue #2241): the viewer's current Match
 *  deck copy split into Maindeck and Sideboard. Not the live library.
 *  Issue #7388: a fixed preview column beside the list shows the hovered
 *  card, or the card back when nothing is hovered. */
export default function DecklistView({
    maindeck,
    sideboard,
}: DecklistViewProps) {
    const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
    // Close grace (same model as the sideboarding dialog and the board dock):
    // leaving a row or the column only clears the preview after
    // `HOVER_GRACE_MS`, and entering either cancels it.
    const graceRef = useRef<number | undefined>(undefined);
    const cancelHoverClose = useCallback(() => {
        window.clearTimeout(graceRef.current);
    }, []);
    const scheduleHoverClose = useCallback(() => {
        window.clearTimeout(graceRef.current);
        graceRef.current = window.setTimeout(
            () => setHoveredCardId(null),
            HOVER_GRACE_MS
        );
    }, []);
    const handleHoverCard = useCallback(
        (cardId: string | null) => {
            if (cardId === null) {
                scheduleHoverClose();
                return;
            }
            cancelHoverClose();
            setHoveredCardId(cardId);
        },
        [cancelHoverClose, scheduleHoverClose]
    );
    useEffect(() => cancelHoverClose, [cancelHoverClose]);

    const hoveredBody = hoveredCardId ? buildPreviewBody(hoveredCardId) : null;

    return (
        // Fixed height: a long-oracle preview scrolls inside its column and
        // never grows the dialog (same fix as the sideboarding dialog).
        <div className="flex h-[min(30rem,60vh)] gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <DecklistSection
                    title="Maindeck"
                    cards={maindeck}
                    onHoverCard={handleHoverCard}
                />
                <DecklistSection
                    title="Sideboard"
                    cards={sideboard}
                    onHoverCard={handleHoverCard}
                />
            </div>
            <div
                className="hidden h-full w-56 shrink-0 overflow-y-auto sm:block"
                data-testid="decklist-preview-column"
                onPointerEnter={cancelHoverClose}
                onPointerLeave={scheduleHoverClose}
            >
                {hoveredBody ? (
                    <div className="card-preview-dock panel-physical hairline overflow-hidden rounded-[var(--panel-radius)]">
                        <CardPreviewBody
                            {...hoveredBody}
                            size="sm"
                            compactEngineView
                        />
                    </div>
                ) : (
                    <div
                        className="aspect-[5/7] w-full"
                        data-testid="decklist-card-back"
                    >
                        <CardBack />
                    </div>
                )}
            </div>
        </div>
    );
}
