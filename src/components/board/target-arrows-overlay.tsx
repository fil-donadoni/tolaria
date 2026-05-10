import { useMemo } from "react";
import type { StackItem } from "~/types/game";
import { useLeaderLines, type ArrowSpec } from "~/hooks/use-leader-lines";

const ARROW_DEFAULTS = {
    path: "fluid" as const,
    startSocket: "auto" as const,
    endSocket: "auto" as const,
    color: "rgba(245, 158, 11, 0.92)",
    size: 3,
    endPlug: "arrow2" as const,
    startPlug: "behind" as const,
    dropShadow: { dx: 0, dy: 1, blur: 3, opacity: 0.45 },
};

type Props = {
    stack: StackItem[];
};

export default function TargetArrowsOverlay({ stack }: Props) {
    const arrows = useMemo(() => buildArrows(stack), [stack]);
    useLeaderLines(arrows, { defaults: ARROW_DEFAULTS });
    return null;
}

function buildArrows(stack: StackItem[]): ArrowSpec[] {
    const arrows: ArrowSpec[] = [];
    for (const item of stack) {
        if (!item.targets || item.targets.length === 0) continue;
        const sourceSelector = `[data-arrow-anchor-stack="${cssEscape(item.id)}"]`;
        for (const target of item.targets) {
            const targetSelector = targetToSelector(target);
            if (!targetSelector) continue;
            arrows.push({
                key: `${item.id}->${target.type}:${target.id}:${target.playerId ?? ""}`,
                sourceSelector,
                targetSelector,
            });
        }
    }
    return arrows;
}

function targetToSelector(
    target: NonNullable<StackItem["targets"]>[number]
): string | null {
    switch (target.type) {
        case "permanent":
            return `[data-arrow-anchor-permanent="${cssEscape(target.id)}"]`;
        case "player":
            return `[data-arrow-anchor-player="${cssEscape(target.id)}"]`;
        case "spell":
            return `[data-arrow-anchor-stack="${cssEscape(target.id)}"]`;
        case "graveyard-card":
            if (!target.playerId) return null;
            return `[data-arrow-anchor-graveyard="${cssEscape(target.playerId)}"]`;
        default:
            return null;
    }
}

function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
}
