import CardPreviewBody from "~/components/cards/card-preview-body";
import type { CardPreviewView } from "~/components/cards/card-preview-mode-toggle";
import { buildPreviewBody } from "~/lib/preview-body";
import { cn } from "~/lib/utils";

/** The board's preview body (Live text / Printed / Rulings) in the dock's own
 *  frame (issue #9820), on a controlled mode so the viewer's choice outlives
 *  the card. */
export default function SideboardCardPreview({
    cardId,
    view,
    onViewChange,
    className,
}: {
    cardId: string;
    view: CardPreviewView;
    onViewChange: (view: CardPreviewView) => void;
    className?: string;
}) {
    const body = buildPreviewBody(cardId);
    return (
        <div
            data-testid="sideboard-preview"
            className={cn(
                "card-preview-dock panel-physical hairline flex max-h-full flex-col overflow-hidden rounded-[var(--panel-radius)]",
                className
            )}
        >
            <div className="min-h-0 overflow-y-auto">
                <CardPreviewBody
                    key={cardId}
                    {...body}
                    size="md"
                    view={view}
                    onViewChange={onViewChange}
                />
            </div>
        </div>
    );
}
