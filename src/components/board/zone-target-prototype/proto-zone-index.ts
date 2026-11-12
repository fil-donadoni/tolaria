// PROTOTYPE (zone-target highlight) — position numbers (owner feedback
// 2026-11-12, variant B chosen): a target line names WHERE its target is AND
// which one — the stack row's own number on the stack, the card's position in
// a graveyard / exile. The zone viewer shows those numbers on its cards ONLY
// while something on the stack targets that zone.
//
// Numbering follows what the player sees: the stack panel numbers from the
// top (row 1 resolves next); a zone viewer lays its cards out in array order,
// left to right, so card #n is the n-th from the left.
import { useGameContext } from "~/hooks/useGameContext";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { useZoneProtoVariant } from "./zone-proto-store";

/** The stack panel's row number for `id` (1 = top of the stack). */
export function stackNumber(stack: readonly StackItem[], id: string): number {
    const i = stack.findIndex((s) => s.id === id);
    return i < 0 ? 0 : stack.length - i;
}

export function zoneNumber(zoneCards: readonly CardInstance[], id: string) {
    return zoneCards.findIndex((c) => c.id === id) + 1;
}

/** `captionFor` for a graveyard/exile viewer: "#n" on every card while the
 *  zone is targeted (B2 only), "#n · targeted" on the targeted ones. */
export function useProtoZoneCaption(
    player: Player,
    zone: "graveyard" | "exile"
): ((card: CardInstance) => string | null) | undefined {
    const variant = useZoneProtoVariant();
    const { stackItems } = useGameContext();
    if (variant !== "B2") return undefined;
    // Only `graveyard-card` exists in the engine today; exile is wired for the
    // day an exile target type ships.
    const targetType = zone === "graveyard" ? "graveyard-card" : null;
    const targeted = new Set(
        stackItems.flatMap((s) =>
            (s.targets ?? [])
                .filter(
                    (t) => t.type === targetType && t.playerId === player.id
                )
                .map((t) => t.id)
        )
    );
    if (targeted.size === 0) return undefined;
    const zoneCards = zone === "graveyard" ? player.graveyard : player.exile;
    return (card) => {
        const n = zoneNumber(zoneCards, card.id);
        return targeted.has(card.id) ? `#${n} · targeted` : `#${n}`;
    };
}
