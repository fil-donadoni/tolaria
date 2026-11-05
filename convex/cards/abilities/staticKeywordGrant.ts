// A STATIC grant of a keyword whose trigger comes from a definition-level expander
// (ADR 0054). The `keyword-grant` writes `staticAbilities` on the recipient, which no
// expander reads, so it would give the recipient the word and no trigger. Beside it
// goes a `triggered-grant` of the keyword's trigger under the same `applies`.
//
// Each grant is its own entry on the recipient, printed trigger included, so "each
// instance triggers separately" needs no counting. A one-shot "gains <keyword>" grant
// has no such twin and stays quarantined by the census (`isDefinitionLevelKeyword`).

import type {
    CardDefinition,
    StaticKeywordGrant,
    TriggeredAbility,
} from "../types";

function isUnconditionalGrantOf(
    keyword: string
): (
    effect: NonNullable<CardDefinition["staticEffects"]>[number]
) => effect is StaticKeywordGrant {
    return (effect): effect is StaticKeywordGrant =>
        effect.kind === "keyword-grant" &&
        effect.keyword === keyword &&
        effect.condition === undefined;
}

/** Puts a `triggered-grant` of `template` beside each unconditional static grant
 *  of `keyword`. Returns the input unchanged with no such grant; never mutates it;
 *  idempotent. `template.id` must differ from the printed trigger's: the two live
 *  in different lists and a permanent can carry both. */
export function expandStaticKeywordGrants(
    def: CardDefinition,
    keyword: string,
    template: () => TriggeredAbility
): CardDefinition {
    const grants = (def.staticEffects ?? []).filter(
        isUnconditionalGrantOf(keyword)
    );
    if (grants.length === 0) return def;
    const granted = template();
    if (def.triggeredGrantTemplates?.some((t) => t.id === granted.id)) {
        return def;
    }
    return {
        ...def,
        staticEffects: [
            ...(def.staticEffects ?? []),
            ...grants.map((grant) => ({
                kind: "triggered-grant" as const,
                applies: grant.applies,
                abilityId: granted.id,
            })),
        ],
        triggeredGrantTemplates: [
            ...(def.triggeredGrantTemplates ?? []),
            granted,
        ],
    };
}
