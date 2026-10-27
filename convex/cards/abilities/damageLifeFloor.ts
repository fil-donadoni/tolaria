// `damageLifeFloor` — declarative template for the CR 614 life-floor clause
// "If you control a creature, damage that would reduce your life total to less
// than 1 reduces it to 1 instead." (Worship). Expanded at the
// `expandDefinition` seam into one `replacementEffects[]` entry, so the damage
// pipeline (`runDamageReplacement`) needs no new hook.
import type {
    CardDefinition,
    CardType,
    DamageLifeFloor,
    ReplacementEffect,
} from "../types";

/** CR 120.3a — only damage from a source without infect causes life loss;
 *  infect damage gives poison counters (CR 120.3b) and never touches life. */
function causesLifeLoss(sourceStaticAbilities: ReadonlyArray<string>): boolean {
    return !sourceStaticAbilities.includes("infect");
}

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
        eventKind: "damage",
        // CR 615.1a — the clause never says "prevent": a rewrite, not a shield.
        damageEffectKind: "other",
        // CR 614.1a — the damage event is replaced when it would take the
        // controller's life total below `floor`.
        appliesTo: (event, self, state) => {
            if (event.kind !== "damage") return false;
            if (event.target.type !== "player") return false;
            if (event.target.id !== self.controllerId) return false;
            if (!causesLifeLoss(event.sourceStaticAbilities)) return false;
            if (
                whileControlling !== undefined &&
                !state.players.some(
                    (p) =>
                        p.id === self.controllerId &&
                        p.battlefield.some(
                            (c) =>
                                c.controllerId === self.controllerId &&
                                c.types.includes(whileControlling)
                        )
                )
            )
                return false;
            const life = state.players.find(
                (p) => p.id === self.controllerId
            )?.life;
            return life !== undefined && life - event.amount < floor;
        },
        // CR 119.3 / 614.1 — "reduces it to N instead": the damage dealt
        // becomes exactly what leaves the life total at `floor`. A life total
        // already at or below `floor` takes no damage (the clause never raises
        // life).
        replace: (event, ctx) => {
            if (event.kind !== "damage") return { kind: "consumed" };
            const life =
                ctx.state.players.find((p) => p.id === event.target.id)?.life ??
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
