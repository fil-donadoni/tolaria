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
    /** Which list on `grantedSourceCardId`'s definition the template came from
     *  (issue #2943). Travels with `grantedSourceCardId` everywhere it goes —
     *  onto the stack item at activation commit — so the RESOLUTION sites look
     *  the ability up in exactly the list the grant named. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
}

/** Which list on the granting card's definition a CR 113.1 granted activated
 *  ability is read from (issue #2943).
 *
 *  - `"grant-template"` (the default when the field is absent) — the granting
 *    card's `grantTemplates[]`, deliberately kept OFF `activatedAbilities` so
 *    the source itself does not expose a native copy of what it lords out.
 *    Every grant written before #2943, persisted or live, is this one.
 *  - `"card-abilities"` — the named card's OWN `activatedAbilities[]`. The
 *    ability-COPY shape (CR 706.2 / 607.2a): Agatha's Soul Cauldron grants the
 *    abilities of arbitrary creature cards in its linked exile pile, and those
 *    cards declare no `grantTemplates` at all.
 *
 *  An EXPLICIT discriminator, never a `grantTemplates`-then-`activatedAbilities`
 *  fallback: a fallback turns a genuinely missing template — a typo'd
 *  `abilityId`, a card whose templates were renamed — into a grant that works
 *  by accident, and it was five hand-rolled `find(...)` calls (two of them
 *  client-side, both failing silently) that made that possible. */
export type GrantedAbilityOrigin = "grant-template" | "card-abilities";

/** THE grant → `ActivatedAbility` resolver (issue #2943). Every site that
 *  turns a `{ sourceCardId, abilityId, origin }` triple back into a template
 *  calls this one — the engine's activation authority
 *  (`getEffectiveActivatedAbilities`), the three stack-item resolution sites
 *  in `gre/state.ts`, and BOTH client ability views in `src/lib/card-utils.ts`.
 *
 *  Exported for the same reason `grantOutrankedByAbilityLoss` is: the client
 *  ability list must resolve exactly the rows the engine resolves. The two
 *  client sites used to hand-roll `def.grantTemplates?.find(...)` and drop a
 *  miss silently (`return null` / `continue`), so a Cauldron-shaped grant —
 *  whose `sourceCardId` is an exiled CREATURE card, which has no
 *  `grantTemplates` at all — rendered as nothing while the engine offered it.
 *
 *  Non-throwing (`tryGetDefinition`): an unregistered id reads as "no such
 *  ability", the tolerance every historic call site here already had. */
export function resolveGrantedActivatedAbility(
    sourceCardId: string,
    abilityId: string,
    origin: GrantedAbilityOrigin | undefined
): ActivatedAbility | undefined {
    const def = tryGetDefinition(sourceCardId);
    if (!def) return undefined;
    const list =
        origin === "card-abilities"
            ? def.activatedAbilities
            : def.grantTemplates;
    return list?.find((a) => a.id === abilityId);
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
 *  in `gre/activation.ts`), the blade harness's `setup` `activate` step
 *  (issue #1522),
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
        const tmpl = resolveGrantedActivatedAbility(
            grant.sourceCardId,
            grant.abilityId,
            grant.origin
        );
        if (tmpl) {
            out.push({
                ability: tmpl,
                grantedSourceCardId: grant.sourceCardId,
                ...(grant.origin ? { grantedAbilityOrigin: grant.origin } : {}),
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
