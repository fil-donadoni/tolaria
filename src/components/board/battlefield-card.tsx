import type { CardInstance } from "~/types/game";
import CardImage from "../cards/card-image";
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "~/components/ui/tooltip";

export type CardVisualState = {
    interactive: boolean;
    enabled: boolean;
    dimmed: boolean;
    combatOffset: string;
    ringClass: string;
    badge: { color: string; index: number } | null;
    tooltip?: string;
};

export default function BattlefieldCard({
    card,
    vs,
    onClick,
    style,
}: {
    card: CardInstance;
    vs: CardVisualState;
    onClick: (e: React.MouseEvent) => void;
    style?: React.CSSProperties;
}) {
    const cardClassName = `relative transition-transform duration-150 ${
        !style ? "w-32" : ""
    } ${card.isTapped ? "rotate-90" : ""} ${vs.combatOffset} ${vs.ringClass} ${
        vs.interactive
            ? vs.enabled
                ? "cursor-pointer"
                : "cursor-not-allowed opacity-60"
            : ""
    } ${vs.dimmed ? "opacity-40" : ""}`;

    const badgeEl = vs.badge && (
        <div
            className={`absolute -top-1 -right-1 w-5 h-5 rounded-full ${vs.badge.color} text-white text-xs font-bold flex items-center justify-center z-10`}
        >
            {vs.badge.index + 1}
        </div>
    );

    if (!vs.tooltip) {
        return (
            <div className={cardClassName} style={style} onClick={onClick}>
                <CardImage card={card.card} />
                {badgeEl}
            </div>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger
                render={<div />}
                className={cardClassName}
                style={style}
                onClick={onClick}
            >
                <CardImage card={card.card} />
                {badgeEl}
            </TooltipTrigger>
            <TooltipContent>{vs.tooltip}</TooltipContent>
        </Tooltip>
    );
}
