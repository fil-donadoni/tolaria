// PROTOTYPE — throwaway. Click peek for the small cards of the ratings dialogs.
import { useState } from "react";
import CardImage from "~/components/cards/card-image";

export function usePeek() {
    const [peek, setPeek] = useState<{
        cardId: string;
        x: number;
        y: number;
    } | null>(null);
    const onPeek = (cardId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setPeek((cur) =>
            cur?.cardId === cardId
                ? null
                : { cardId, x: e.clientX, y: e.clientY }
        );
    };
    const layer = peek && (
        <button
            type="button"
            aria-label="Close peek"
            onClick={(e) => {
                e.stopPropagation();
                setPeek(null);
            }}
            className="fixed inset-0 z-modal cursor-default bg-transparent"
        >
            <span
                className="absolute block w-56 overflow-hidden rounded-md shadow-2xl ring-1 ring-border-subtle/60"
                style={{
                    left: Math.min(peek.x + 12, window.innerWidth - 240),
                    top: Math.max(
                        8,
                        Math.min(peek.y - 160, window.innerHeight - 330)
                    ),
                }}
            >
                <span className="relative block aspect-5/7 w-full">
                    <CardImage card={{ id: peek.cardId }} sizes="224px" />
                </span>
            </span>
        </button>
    );
    return { onPeek, layer };
}
