import CardImage from "~/components/cards/card-image";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";

interface CardProfilesSweepTileProps {
    card: ScopeCardProfile;
    /** The row's display name ("reanimator", "Provides reanimatable"), the
     *  toggle's accessible name prefix. */
    rowLabel: string;
    tagged: boolean;
    onToggleTag: () => void;
    /** Present on the proposed lane only: marks the card reviewed. */
    onConfirm?: () => void;
    disabled: boolean;
}

/** One card of a sweep lane: its art, its name and its own toggle — the row
 *  carried or not. A proposed tile also offers Confirm. */
export default function CardProfilesSweepTile({
    card,
    rowLabel,
    tagged,
    onToggleTag,
    onConfirm,
    disabled,
}: CardProfilesSweepTileProps) {
    return (
        <li className="flex min-w-0 flex-col gap-1">
            <div className="relative aspect-5/7 w-full overflow-hidden rounded-md">
                <CardImage card={{ id: card.cardId }} lazy sizes="120px" />
            </div>
            <span className="truncate text-xs text-text" title={card.name}>
                {card.name}
            </span>
            <div className="flex items-center justify-between gap-1">
                <Checkbox
                    checked={tagged}
                    disabled={disabled}
                    aria-label={`${rowLabel} for ${card.name}`}
                    onCheckedChange={onToggleTag}
                />
                {onConfirm && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={disabled}
                        aria-label={`Confirm ${card.name}`}
                        onClick={onConfirm}
                    >
                        Confirm
                    </Button>
                )}
            </div>
        </li>
    );
}
