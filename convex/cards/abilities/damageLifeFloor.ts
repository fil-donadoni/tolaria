// `damageLifeFloor` — declarative template for the CR 614 life-floor clause
// "If you control a creature, damage that would reduce your life total to less
// than 1 reduces it to 1 instead." (Worship). Expanded at the
// `expandDefinition` seam into one `replacementEffects[]` entry on the
// `"damage-lifeloss"` event: the RESULT of damage (CR 120.4c), seen after
// prevention, so the damage itself (lifelink, triggers) is untouched.
import type {
    CardDefinition,
    CardType,
    DamageLifeFloor,
    ReplacementEffect,
} from "../types";

export function damageLifeFloor(args: {
    id: string;
    oracleText: string;
    floor: number;
    whileControlling?: CardType;
}): ReplacementEffect {
    const { floor, whileControlling } = args;
    return {
        id: args.id,
        oracleText: args.oracleText,
        eventKind: "damage-lifeloss",
        // CR 120.4c — only the life loss damage causes to the controller.
        appliesTo: (event, self, state) => {
            if (event.kind !== "damage-lifeloss") return false;
            if (event.playerId !== self.controllerId) return false;
            const me = state.players.find((p) => p.id === self.controllerId);
            if (me === undefined) return false;
            if (
                whileControlling !== undefined &&
                !me.battlefield.some(
                    (c) =>
                        c.controllerId === self.controllerId &&
                        c.types.includes(whileControlling)
                )
            )
                return false;
            return me.life - event.amount < floor;
        },
        // CR 614.1 — "reduces it to N instead": the life lost becomes exactly
        // what leaves the total at `floor`. A total already at or below
        // `floor` loses nothing (the clause never raises life).
        replace: (event, ctx) => {
            if (event.kind !== "damage-lifeloss") return { kind: "consumed" };
            const life =
                ctx.state.players.find((p) => p.id === event.playerId)?.life ??
                0;
            return {
                kind: "modified",
                event: { ...event, amount: Math.max(0, life - floor) },
            };
        },
    };
}

export const DAMAGE_LIFE_FLOOR_ORACLE_TEXT = (spec: DamageLifeFloor): string =>
    `${spec.whileControlling ? `If you control a ${spec.whileControlling.toLowerCase()}, d` : "D"}amage that would reduce your life total to less than ${spec.floor} reduces it to ${spec.floor} instead.`;

/** `worship-damage-life-floor` — derived from the name. */
export function damageLifeFloorId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug}-damage-life-floor`;
}

/**
 * ADR 0054 seam — rebuild the JSON-pure `CardDefinition.damageLifeFloor`
 * declaration into the `replacementEffects[]` entry above and REMOVE the
 * field, for the reason `expandShuffleFromAnywhere` gives.
 */
export function expandDamageLifeFloor(base: CardDefinition): CardDefinition {
    const spec = base.damageLifeFloor;
    if (spec === undefined) return base;
    const id = damageLifeFloorId(base.name);
    const existing = base.replacementEffects ?? [];
    const expanded: CardDefinition = {
        ...base,
        replacementEffects: existing.some((r) => r.id === id)
            ? existing
            : [
                  ...existing,
                  damageLifeFloor({
                      id,
                      oracleText: DAMAGE_LIFE_FLOOR_ORACLE_TEXT(spec),
                      floor: spec.floor,
                      whileControlling: spec.whileControlling,
                  }),
              ],
    };
    delete expanded.damageLifeFloor;
    return expanded;
}
