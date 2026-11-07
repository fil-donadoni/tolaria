import { getEffectiveColors } from "../cards/effectiveColors";
import { tryGetDefinition } from "../cards/registry";
import { liveSupertypesOf } from "../cards/snowReads";
import type { PermanentView, TriggerStateView } from "../cards/types";
import type { CardInstanceState } from "./state/declarations";

type TriggerViewPlayer = TriggerStateView["players"][number];
type TriggerViewPermanent = TriggerViewPlayer["battlefield"][number];
type TriggerViewGraveyardCard = NonNullable<
    TriggerViewPlayer["graveyard"]
>[number];

/** One battlefield row of a `TriggerStateView`, the shape a `canActivate`
 *  predicate reads (CR 602.5b). The ONE row both builders fill — the client's
 *  `buildTriggerStateView` and the server's `minimalManaGateView` — so the two
 *  views of one board cannot disagree on which fields are live.
 *
 *  `pt` is the caller's: the row carries EFFECTIVE P/T (CR 613.4), but each
 *  builder holds its own layer view to read them through. */
export function triggerViewPermanent(
    c: CardInstanceState,
    pt: { power?: number; toughness?: number }
) {
    const cardId = (c.card as { id?: string }).id;
    return {
        id: c.id,
        controllerId: c.controllerId,
        ownerId: c.ownerId,
        types: c.types ?? [],
        subtypes: c.subtypes ?? [],
        staticAbilities: c.staticAbilities ?? [],
        // CR 613.4 — EFFECTIVE P/T, not the instance's base values. Counters
        // (layer 7c) and anthems/pump (7d) are applied at READ time by the
        // layer system and are never baked into `c.power`, so weighing the base
        // value made a predicate disagree with the server's own
        // `getEffectivePower` (a creature pumped over a threshold had the
        // ability hidden; a shrunk one was offered and then rejected).
        power: pt.power,
        toughness: pt.toughness,
        isTapped: c.isTapped === true,
        // CR 702.171b — the saddled designation, for a cost filter narrowed by
        // it (none shipped; populated so it never fails open).
        saddled: c.saddled === true,
        // CR 202.2 / 613.1d — effective colours for a tapOtherFilter colour
        // clause (Hand of Justice), via the single colour authority: layer-5
        // override SETS, `grantedColors` UNION.
        colors: getEffectiveColors(c as unknown as PermanentView),
        // CR 702.122b — "crews Vehicles as though its power were N greater"
        // (Shorikai's Pilot token) feeds the Crew N affordability hint; without
        // it a board that CAN crew only thanks to the bonus is never offered
        // the ability.
        crewPowerBonus: cardId
            ? tryGetDefinition(cardId)?.crewPowerBonus
            : undefined,
        // CR 205.4a — LIVE supertypes, for a `sacrificeFilter` activation cost
        // narrowed by supertype (Sunstone / Glacial Crevasses / Whiteout's
        // "sacrifice a snow land"). Printed supertypes alone miss a snow status
        // granted by a `supertype-set` static effect or indefinite mutation
        // (Melting / Arcum's Weathervane), which the server's cost resolution
        // honours through this same `liveSupertypesOf`.
        supertypes: liveSupertypesOf(c),
        // CR 111.5 / 701.21 — token-ness, for a `sacrificeFilter` activation
        // cost narrowed by `isToken` (Thopter Foundry's "sacrifice a NONTOKEN
        // artifact", Caribou Range's "sacrifice a Caribou TOKEN"). Left
        // unpopulated it reads `undefined`, which `matchesPermanentFilter`
        // treats as `false`: a token-sacrifice ability hidden with tokens on
        // board, a nontoken-only one offered with only tokens to give up.
        isToken: c.isToken === true,
        // CR 508/509 — combat-role filters (a `sacrificeFilter`/`tapOtherFilter`
        // scoped to attackers/blockers). Same fail-closed-vs-fail-open class as
        // `isToken` above.
        isAttacking: c.isAttacking === true,
        isBlocking: c.isBlocking === true,
        // CR 111 / 707.1 — token provenance, for a `sacrificeFilter` scoped to
        // "tokens created with <this>" (Tetravus-style).
        createdBy: c.createdBy,
        // CR 307.1 / 117.1a — the cast-time snapshot a CR 603.4 check-time
        // condition reads off the permanent itself (Necromancy's "if you cast it
        // any time a sorcery couldn't have been cast", issue #2392). Unpopulated
        // it reads `undefined`, which every `=== true` condition treats as "cast
        // at sorcery speed" — the wrong answer for EVERY off-window cast.
        castOffSorceryTiming: c.castOffSorceryTiming === true,
        // CR 602.5 — the definition reference and the CR 613.1f suppression
        // list an `activation-restriction` scan reads to find a Cursed Totem on
        // either battlefield (`activationRestrictionViolation`). Dropping them
        // hides the lock from every affordance built on this view.
        card: c.card as unknown as TriggerViewPermanent["card"],
        abilitiesSuppressedBy: c.abilitiesSuppressedBy,
    };
}

/** One graveyard row of a `TriggerStateView`. CR 118.5 — graveyard contents
 *  feed the exile-from-graveyard activation-cost affordability hint (Grim
 *  Lavamancer, Night Soil); CR 701.59b — collect evidence prices the pile by
 *  mana value, read off the definition id (`gre/collectEvidence.ts`). */
export function triggerViewGraveyardCard(
    c: CardInstanceState
): TriggerViewGraveyardCard {
    return {
        card: c.card as unknown as TriggerViewGraveyardCard["card"],
        id: c.id,
        ownerId: c.ownerId,
        types: c.types ?? [],
    };
}
