// PROTOTYPE — throwaway. The board's own preview face (CardPreviewBody, the
// body the right-column dock renders, Live text / Printed toggle included) in
// the dock's own frame — reused, not re-drawn.
import { useState } from "react";
import { buildPreviewBody } from "~/lib/preview-body";
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";
import { getPreviewPreferenceDefault } from "~/lib/preview-preference-store";
import CardPreviewBody from "~/components/cards/card-preview-body";
import { cn } from "~/lib/utils";

// The viewer's last choice outlives the card AND the dialog: hovering another
// card keeps Printed, and the next between-games window opens on it too.
// (Real impl: a session-scoped store beside preview-preference-store.)
let lastView: CardPreviewView | null = null;

export default function ProtoPreview({
    cardId,
    size = "md",
    className,
    onPointerEnter,
    onPointerLeave,
}: {
    cardId: string;
    size?: "sm" | "md";
    className?: string;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
}) {
    const body = buildPreviewBody(cardId);
    const [view, setView] = useState<CardPreviewView>(
        () => lastView ?? getPreviewPreferenceDefault()
    );
    const choose = (v: CardPreviewView) => {
        lastView = v;
        setView(v);
    };
    return (
        <div
            className={cn(
                "card-preview-dock panel-physical hairline flex max-h-full flex-col overflow-hidden rounded-[var(--panel-radius)]",
                className
            )}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
        >
            <div className="min-h-0 overflow-y-auto">
                {body && (
                    <CardPreviewBody
                        key={cardId}
                        {...body}
                        size={size}
                        view={view}
                        onViewChange={choose}
                    />
                )}
            </div>
        </div>
    );
}
