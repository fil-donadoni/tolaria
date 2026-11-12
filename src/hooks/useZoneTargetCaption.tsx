import type { ReactNode } from "react";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { zoneTargetSources } from "~/lib/zone-target-sources";
import { stackNumber, zonePosition } from "~/lib/stack-target-line";
import ZoneTargetCaption from "~/components/board/zone-target-caption";

/**
 * `captionFor` for a graveyard / exile viewer (issue #9326): while something
 * on the stack targets a card in THIS zone, every card shows its position
 * "#N" — the numbers the stack rows' target lines name — and a targeted card
 * also shows a thumbnail + stack number of each object targeting it. With no
 * target in the zone: `undefined`, no captions at all.
 */
export function useZoneTargetCaption(
    player: Player,
    zone: "graveyard" | "exile"
): ((card: CardInstance) => ReactNode) | undefined {
    const { stackItems } = useGameContext();
    const sourcesOf = zoneTargetSources(stackItems, player.id, zone);
    if (sourcesOf.size === 0) return undefined;
    const zoneCards = zone === "graveyard" ? player.graveyard : player.exile;
    return (card) => {
        const position = zonePosition(zoneCards, card.id);
        const sources = sourcesOf.get(card.id);
        if (!sources) return `#${position}`;
        return (
            <ZoneTargetCaption
                position={position}
                sources={sources.map((item: StackItem) => ({
                    item,
                    stackNumber: stackNumber(stackItems, item.id),
                }))}
            />
        );
    };
}
