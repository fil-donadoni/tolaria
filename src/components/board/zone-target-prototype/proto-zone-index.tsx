// PROTOTYPE (zone-target highlight) — position numbers (owner feedback
// 2026-11-12, variant B chosen): a target line names WHERE its target is AND
// which one — the stack row's own number on the stack, the card's position in
// a graveyard / exile. The zone viewer shows those numbers on its cards ONLY
// while something on the stack targets that zone; a targeted card's caption
// also shows a thumbnail of each stack object targeting it (+ its stack #).
//
// Numbering follows what the player sees: the stack panel numbers from the
// top (row 1 resolves next); a zone viewer lays its cards out in array order,
// left to right, so card #n is the n-th from the left.
import type { ReactNode } from "react";
import { useGameContext } from "~/hooks/useGameContext";
import type { CardInstance, Player, StackItem } from "~/types/game";
import ProtoThumb, { Crosshair } from "./proto-thumb";
import { protoName } from "./use-zone-target-model";
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
 *  zone is targeted (B2 only); on a targeted card, "#n" + crosshair + a
 *  thumbnail of every stack object targeting it. */
export function useProtoZoneCaption(
    player: Player,
    zone: "graveyard" | "exile"
): ((card: CardInstance) => ReactNode) | undefined {
    const variant = useZoneProtoVariant();
    const { stackItems } = useGameContext();
    if (variant !== "B2") return undefined;
    // Only `graveyard-card` exists in the engine today; exile is wired for the
    // day an exile target type ships.
    const targetType = zone === "graveyard" ? "graveyard-card" : null;
    const sourcesOf = new Map<string, StackItem[]>();
    for (const s of stackItems)
        for (const t of s.targets ?? [])
            if (t.type === targetType && t.playerId === player.id)
                sourcesOf.set(t.id, [...(sourcesOf.get(t.id) ?? []), s]);
    if (sourcesOf.size === 0) return undefined;
    const zoneCards = zone === "graveyard" ? player.graveyard : player.exile;
    return (card) => {
        const n = zoneNumber(zoneCards, card.id);
        const sources = sourcesOf.get(card.id);
        if (!sources) return `#${n}`;
        return (
            <span className="inline-flex items-center gap-1 text-text">
                <span className="font-semibold">#{n}</span>
                <span className="text-accent-strong">
                    <Crosshair size={10} />
                </span>
                {sources.map((s) => (
                    <span
                        key={s.id}
                        title={`Targeted by ${protoName(s)} (#${stackNumber(stackItems, s.id)} on the stack)`}
                        className="inline-flex items-center gap-0.5"
                    >
                        <ProtoThumb card={s} width={20} />
                        <span className="text-[9px] text-text-muted">
                            #{stackNumber(stackItems, s.id)}
                        </span>
                    </span>
                ))}
            </span>
        );
    };
}
