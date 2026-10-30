// `damageAsCounters` — declarative template for the CR 614.1a damage → counters
// clause "If a source you control would deal noncombat damage to a creature an
// opponent controls, put that many -1/-1 counters on that creature instead."
// (Soul-Scar Mage). Expanded at the `expandDefinition` seam into one
// `replacementEffects[]` entry on the `"damage"` event. Unlike wither/infect
// (CR 702.80a / 702.90c — damage IS dealt, its result is counters), the damage
// here is REPLACED: it is never dealt, so no lifelink, no deathtouch and no
// "is dealt damage" trigger follows. The counters are put on by the
// replacement's controller.
import type {
    CardDefinition,
    DamageAsCounters,
    ReplacementEffect,
} from "../types";

export function damageAsCounters(args: {
    id: string;
    oracleText: string;
    counterType: string;
    noncombatOnly?: boolean;
}): ReplacementEffect {
    const { counterType, noncombatOnly } = args;
    return {
        id: args.id,
        oracleText: args.oracleText,
        eventKind: "damage",
        // CR 615.1a — no "prevent" in the text, and the damage is not dealt
        // to another object (CR 614.9): neither lock suppresses it.
        damageEffectKind: "other",
        appliesTo: (event, self, state) => {
            if (event.kind !== "damage") return false;
            if (event.amount <= 0) return false;
            // CR 120.2a — "noncombat damage": anything but combat damage.
            if (noncombatOnly && event.isCombat) return false;
            // CR 109.5 — "a source you control".
            if (event.sourceControllerId !== self.controllerId) return false;
            if (event.target.type !== "permanent") return false;
            const recipientId = event.target.id;
            const recipient = state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === recipientId);
            // "a creature an opponent controls" (CR 102.2).
            return (
                recipient !== undefined &&
                recipient.types.includes("Creature") &&
                recipient.controllerId !== self.controllerId
            );
        },
        // CR 614.1a — "put that many … counters on that creature instead":
        // the damage event is consumed whole.
        replace: (event, ctx) => {
            if (event.kind === "damage" && event.target.type === "permanent")
                ctx.addCounters(event.target.id, counterType, event.amount);
            return { kind: "consumed" };
        },
    };
}

export const DAMAGE_AS_COUNTERS_ORACLE_TEXT = (
    spec: DamageAsCounters
): string =>
    `If a source you control would deal ${spec.noncombatOnly ? "noncombat " : ""}damage to a creature an opponent controls, put that many ${spec.counterType} counters on that creature instead.`;

/** `soul-scar-mage-damage-as-counters` — derived from the name. */
export function damageAsCountersId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug}-damage-as-counters`;
}

/**
 * ADR 0054 seam — rebuild the JSON-pure `CardDefinition.damageAsCounters`
 * declaration into the `replacementEffects[]` entry above and REMOVE the
 * field, for the reason `expandShuffleFromAnywhere` gives.
 */
export function expandDamageAsCounters(base: CardDefinition): CardDefinition {
    const spec = base.damageAsCounters;
    if (spec === undefined) return base;
    const id = damageAsCountersId(base.name);
    const existing = base.replacementEffects ?? [];
    const expanded: CardDefinition = {
        ...base,
        replacementEffects: existing.some((r) => r.id === id)
            ? existing
            : [
                  ...existing,
                  damageAsCounters({
                      id,
                      oracleText: DAMAGE_AS_COUNTERS_ORACLE_TEXT(spec),
                      counterType: spec.counterType,
                      noncombatOnly: spec.noncombatOnly,
                  }),
              ],
    };
    delete expanded.damageAsCounters;
    return expanded;
}
