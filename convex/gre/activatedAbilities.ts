import type { ActivatedAbility } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { CardInstanceState } from "./state";

/** One entry of a permanent's POST-LAYER activated-ability set: the ability
 *  template plus, when the ability was GRANTED to this permanent by another
 *  card (CR 113.1), the granting card's definition id. */
export interface EffectiveActivatedAbility {
    ability: ActivatedAbility;
    grantedSourceCardId?: string;
}

/** Every activated ability actually available on this permanent POST-LAYER
 *  (CR 611.1b / 613.1f, layer 6): native abilities from its `CardDefinition`
 *  — dropped entirely while `abilitiesSuppressedBy` holds a "loses all
 *  abilities" suppression (Titania's Song) — PLUS every ability granted to it
 *  by another source (CR 113.1, e.g. Zombie Master's "{B}: Regenerate ~"
 *  continuous static effect, or a resolving ability's `grantActivatedAbility`
 *  / `grantActivatedAbilityPermanent`), already materialized onto
 *  `grantedActivatedAbilities`.
 *
 *  This is the single authority every consumer of "what can this permanent
 *  actually do" reads: `resolveActivatedAbility` (the activation entry point
 *  in `game.ts`), the blade harness's `setup` `activate` step (issue #1522),
 *  and — since issue #1880 — the mana-ability probes in `gre/constants.ts`
 *  (`getActivatedManaAbility`, `hasManaAbility`, `getManaTapOptionsDetailed`),
 *  which used to read `cardDef.activatedAbilities` alone and therefore made a
 *  GRANTED `{T}: Add …` invisible to the auto-tap solver and the castability
 *  probe.
 *
 *  Lives here, at GRE level, rather than in `convex/game.ts` (where it was
 *  defined until #1880) so the deliberately-leaf `gre/constants.ts` can reach
 *  it without importing the Convex module layer; `game.ts` re-exports it for
 *  back-compat. Pure.
 *
 *  Resolves definitions with the NON-throwing `tryGetDefinition`: the mana-seam
 *  probes that now read this function (`hasNonManaActivatedAbility`,
 *  `getManaTapOptionsDetailed`, the client mirrors in `src/lib/card-utils.ts`)
 *  are best-effort call sites that historically tolerated an unregistered id,
 *  and an unknown card must read as "no abilities" rather than throw. */
export function getEffectiveActivatedAbilities(
    card: CardInstanceState
): EffectiveActivatedAbility[] {
    const cardId = (card.card as { id?: string }).id;
    const suppressed = (card.abilitiesSuppressedBy?.length ?? 0) > 0;
    const out: EffectiveActivatedAbility[] = [];
    if (cardId && !suppressed) {
        for (const ability of tryGetDefinition(cardId)?.activatedAbilities ??
            []) {
            out.push({ ability });
        }
    }
    for (const grant of card.grantedActivatedAbilities ?? []) {
        const tmpl = tryGetDefinition(grant.sourceCardId)?.grantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (tmpl) {
            out.push({
                ability: tmpl,
                grantedSourceCardId: grant.sourceCardId,
            });
        }
    }
    return out;
}
