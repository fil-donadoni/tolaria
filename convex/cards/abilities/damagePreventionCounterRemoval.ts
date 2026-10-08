// `damagePreventionCounterRemoval` — declarative template for CR 615's
// self-referential "If damage would be dealt to <this creature>, prevent that
// damage. Remove a +1/+1 counter from <this creature>." (the Phantom cycle:
// Phantom Centaur, Phantom Nishoba, Phantom Tiger …).
//
// Two entries, because the two sentences answer to different locks. The first
// sentence uses the word "prevent" (CR 615.1a), so it is a prevention effect
// and "damage can't be prevented" suppresses it. The second sentence is an
// ADDITIONAL effect of that prevention effect, and CR 615.12 says that under
// unpreventable damage "any applicable prevention effects are still applied
// to it. Those effects won't prevent any damage, but any additional effects
// they have will take place" — so the counter must still come off. The engine
// skips a lock-suppressed `damageEffectKind: "prevention"` entry ENTIRELY
// (`damageLockSuppresses`), so the removal lives in its own `"other"` entry
// (never suppressed) listed FIRST; it rewrites nothing and the loop then
// reaches the prevention entry, which consumes the event unless locked.
//
// The counter is removed once per damage EVENT, not per point of damage, unlike
// Rock Hydra's "for each 1 damage" wording. `ctx.removeCounter` clamps to
// availability, so a permanent with no counter left still prevents the damage
// and removes nothing (CR 615.6 — an impossible instruction is ignored).
import type { CardDefinition, ReplacementEffect } from "../types";

export function damagePreventionCounterRemoval(args: {
    id: string;
    oracleText: string;
    counterOracleText: string;
}): readonly [ReplacementEffect, ReplacementEffect] {
    const hitsSelf: ReplacementEffect["appliesTo"] = (event, self) =>
        event.kind === "damage" &&
        event.target.type === "permanent" &&
        event.target.id === self.id;
    return [
        {
            id: `${args.id}-counter`,
            // The second sentence only: an entry whose text says "prevent" must
            // be a prevention (`damageReplacementKinds.test.ts`, CR 615.1a).
            oracleText: args.counterOracleText,
            eventKind: "damage",
            damageEffectKind: "other",
            appliesTo: hitsSelf,
            replace: (event, ctx) => {
                ctx.removeCounter("+1/+1", 1);
                return { kind: "modified", event };
            },
        },
        {
            id: args.id,
            oracleText: args.oracleText,
            eventKind: "damage",
            damageEffectKind: "prevention",
            appliesTo: hitsSelf,
            replace: () => ({ kind: "consumed" }),
        },
    ];
}

/** The clause as printed, with the card's own name (CR 201.5) where Oracle
 *  says "this creature". */
export function damagePreventionCounterRemovalOracleText(name: string): string {
    return `If damage would be dealt to ${name}, prevent that damage. Remove a +1/+1 counter from ${name}.`;
}

/** `phantom-tiger-damage-prevention` — derived from the name so a compiled
 *  card and a hand-written twin carry one id. */
export function damagePreventionCounterRemovalId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug}-damage-prevention`;
}

/**
 * ADR 0054 seam — rebuild the Oracle compiler's JSON-pure
 * `CardDefinition.damagePreventionCounterRemoval` flag into the
 * `replacementEffects[]` entry above and REMOVE the flag, for the reason
 * `expandShuffleFromAnywhere` gives.
 */
export function expandDamagePreventionCounterRemoval(
    base: CardDefinition
): CardDefinition {
    if (base.damagePreventionCounterRemoval !== true) return base;
    const id = damagePreventionCounterRemovalId(base.name);
    const existing = base.replacementEffects ?? [];
    const expanded: CardDefinition = {
        ...base,
        replacementEffects: existing.some((r) => r.id === id)
            ? existing
            : [
                  ...existing,
                  ...damagePreventionCounterRemoval({
                      id,
                      oracleText: damagePreventionCounterRemovalOracleText(
                          base.name
                      ),
                      counterOracleText: `Remove a +1/+1 counter from ${base.name}.`,
                  }),
              ],
    };
    delete expanded.damagePreventionCounterRemoval;
    return expanded;
}
