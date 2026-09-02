import type { ActivatedAbility } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { latestTimestamp, outrankedBy } from "./continuousEffects";
import type { CardInstanceState } from "./state";

/** One entry of a permanent's POST-LAYER activated-ability set: the ability
 *  template plus, when the ability was GRANTED to this permanent by another
 *  card (CR 113.1), the granting card's definition id. */
export interface EffectiveActivatedAbility {
    ability: ActivatedAbility;
    grantedSourceCardId?: string;
}

/** Every activated ability actually available on this permanent POST-LAYER
 *  (CR 611.2a / 613.1f, layer 6): native abilities from its `CardDefinition`
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
    const strippedAt = abilityLossTimestamp(card);
    const out: EffectiveActivatedAbility[] = [];
    if (cardId && strippedAt === null) {
        for (const ability of tryGetDefinition(cardId)?.activatedAbilities ??
            []) {
            out.push({ ability });
        }
    }
    for (const grant of card.grantedActivatedAbilities ?? []) {
        if (grantOutrankedByAbilityLoss(grant.seq, strippedAt)) continue;
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

/** The LATEST layer timestamp among the live "loses all abilities" sources on
 *  `card` (CR 613.1f), or `null` when none apply. The single reader of
 *  `abilitiesSuppressedBy`'s ordering, shared by this module and
 *  `effectiveTriggeredAbilities` (`gre/copy.ts`) so activated and triggered
 *  abilities can never disagree about what a stripper removed. */
export function abilityLossTimestamp(card: CardInstanceState): number | null {
    // ONE reduction, through the S1 ordering authority (`latestTimestamp`) —
    // PRD #2064 S3. `abilitiesSuppressedBy` is now `syncLayer6`'s DERIVED
    // answer, composing BOTH ability-loss arms: the continuous one from a live
    // source's static ability (Titania's Song, Blood Moon), which this function
    // could never see for itself (it takes a card and no board to walk), and
    // the resolving-ability ledger `abilityLossHolds`.
    return latestTimestamp(
        (card.abilitiesSuppressedBy ?? []).map((s) => s.seq)
    );
}

/** CR 613.7 — layer 6 applies grants and removals in timestamp order, so a
 *  "loses all abilities" effect removes only the abilities granted BEFORE it.
 *  A grant with a strictly later timestamp survives (Humility, then Fire Whip);
 *  a grant that predates it — or one written before grants carried a timestamp
 *  at all, which reads as 0 — is removed.
 *
 *  Exported so the CLIENT ability views (`src/lib/card-utils.ts`) mark exactly
 *  the same rows lost as the engine drops; a preview that recomputed the rule
 *  would drift from the board. */
export function grantOutrankedByAbilityLoss(
    grantSeq: number | undefined,
    strippedAt: number | null
): boolean {
    // The comparison itself lives in the registry's ordering authority
    // (`gre/continuousEffects.ts`), not here: #1715 had to harden four sites
    // that each wrote `(a ?? 0) < b` by hand, and PRD #2064 S3 leaves exactly
    // one. This function survives as the NAME the read paths use.
    return outrankedBy(grantSeq, strippedAt);
}
