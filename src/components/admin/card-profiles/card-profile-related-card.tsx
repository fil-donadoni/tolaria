import CardImage from "~/components/cards/card-image";
import CardPreview from "~/components/cards/card-preview";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";

interface CardProfileRelatedCardProps {
    cardId: string;
    name: string;
    /** The related card's own tags in the line's layer, shown in the peek
     *  so the reviewer sees WHY it sits on this line. */
    tags: string;
}

/** One related card of a focus-dialog line (issue #8904): a thumbnail of a
 *  scope card tagged with the line's row. Three reads, one per gesture:
 *  HOVER shows the card larger (the app's hover dock is board-only, so the
 *  admin surface previews through a tooltip); RIGHT-CLICK pins the app's
 *  full `CardPreview`; CLICK opens a quick peek — the image plus the card's
 *  own tags in this layer. */
export default function CardProfileRelatedCard({
    cardId,
    name,
    tags,
}: CardProfileRelatedCardProps) {
    return (
        <CardPreview cardId={cardId} cardName={name} holdPreview={false}>
            <Popover>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <PopoverTrigger
                                aria-label={`Peek at ${name}`}
                                data-related-card={cardId}
                                className="relative block aspect-5/7 w-6 shrink-0 overflow-hidden rounded-xs ring-border-subtle hover:ring-1"
                            />
                        }
                    >
                        <CardImage card={{ id: cardId }} lazy sizes="24px" />
                    </TooltipTrigger>
                    <TooltipContent
                        side="top"
                        className="bg-transparent p-0"
                        data-related-card-hover={cardId}
                    >
                        <span className="relative block aspect-5/7 w-40">
                            <CardImage card={{ id: cardId }} sizes="160px" />
                        </span>
                    </TooltipContent>
                </Tooltip>
                <PopoverContent
                    side="left"
                    className="flex w-60 flex-col gap-2"
                    data-related-card-peek={cardId}
                >
                    <span className="relative block aspect-5/7 w-full">
                        <CardImage card={{ id: cardId }} sizes="216px" />
                    </span>
                    <span className="text-sm text-text">{name}</span>
                    <span className="text-xs text-text-muted">{tags}</span>
                </PopoverContent>
            </Popover>
        </CardPreview>
    );
}
