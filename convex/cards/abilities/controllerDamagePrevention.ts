// `controllerDamagePrevention` — declarative template for CR 615's
// "Prevent all damage that would be dealt to you." (Solitary Confinement,
// Glacial Chasm): an unconditional prevention shield around the controller of
// the source permanent. Same entry the hand-written catalogue spells out by
// hand, so a compiled card and its twin carry one behaviour.
import type { CardDefinition, ReplacementEffect } from "../types";

export function controllerDamagePrevention(args: {
    id: string;
    oracleText: string;
}): ReplacementEffect {
    return {
        id: args.id,
        oracleText: args.oracleText,
        eventKind: "damage",
        damageEffectKind: "prevention",
        // CR 615.1 — a player-targeted damage event aimed at the controller.
        appliesTo: (event, self) =>
            event.kind === "damage" &&
            event.target.type === "player" &&
            event.target.id === self.controllerId,
        replace: () => ({ kind: "consumed" }),
    };
}

export const CONTROLLER_DAMAGE_PREVENTION_ORACLE_TEXT =
    "Prevent all damage that would be dealt to you.";

/** `solitary-confinement-damage-prevention` — derived from the name. */
export function controllerDamagePreventionId(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${slug}-damage-prevention`;
}

/**
 * ADR 0054 seam — rebuild the Oracle compiler's JSON-pure
 * `CardDefinition.preventsDamageToController` flag into the
 * `replacementEffects[]` entry above and REMOVE the flag, for the reason
 * `expandShuffleFromAnywhere` gives.
 */
export function expandControllerDamagePrevention(
    base: CardDefinition
): CardDefinition {
    if (base.preventsDamageToController !== true) return base;
    const id = controllerDamagePreventionId(base.name);
    const existing = base.replacementEffects ?? [];
    const expanded: CardDefinition = {
        ...base,
        replacementEffects: existing.some((r) => r.id === id)
            ? existing
            : [
                  ...existing,
                  controllerDamagePrevention({
                      id,
                      oracleText: CONTROLLER_DAMAGE_PREVENTION_ORACLE_TEXT,
                  }),
              ],
    };
    delete expanded.preventsDamageToController;
    return expanded;
}
