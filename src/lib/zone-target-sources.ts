import type { TargetSelection } from "@convex/cards/types";
import type { StackItem } from "~/types/game";

/** The announced-target type naming a card in each zone pile. Only
 *  `graveyard-card` exists in the engine today; exile is wired for the day an
 *  exile-card target type ships (issue #9326 designs for it, out of scope to
 *  build). */
const ZONE_TARGET_TYPE: Record<
    "graveyard" | "exile",
    TargetSelection["type"] | null
> = {
    graveyard: "graveyard-card",
    exile: null,
};

/** Every card of `ownerId`'s `zone` that a stack object targets → the stack
 *  objects targeting it, in stack order (issue #9326). Empty when nothing on
 *  the stack targets that zone. */
export function zoneTargetSources(
    stack: readonly StackItem[],
    ownerId: string,
    zone: "graveyard" | "exile"
): Map<string, StackItem[]> {
    const type = ZONE_TARGET_TYPE[zone];
    const out = new Map<string, StackItem[]>();
    if (!type) return out;
    for (const item of stack) {
        for (const t of item.targets ?? []) {
            if (t.type !== type || t.playerId !== ownerId) continue;
            const sources = out.get(t.id) ?? [];
            if (!sources.includes(item)) sources.push(item);
            out.set(t.id, sources);
        }
    }
    return out;
}
