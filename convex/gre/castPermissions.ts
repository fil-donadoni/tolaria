// Board-granted CASTING PERMISSIONS (CR 601.3 / 118.9 / 702.8a) — the
// grant-polarity sibling of `convex/cards/castRestrictions.ts`.
//
// A `cast-permission` static (`StaticCastPermission`, `cards/types.ts`) on a
// battlefield permanent lets a player cast a CLASS of cards on terms the
// permission states: without paying the mana cost, and/or as though the card
// had flash. Aluren ("Any player may cast creature spells with mana value 3 or
// less without paying their mana costs and as though they had flash") is the
// shape this module exists for; the mechanism is card-agnostic — a declarative
// `EffectCardFilter` plus two independent booleans (ADR 0102: fix the class,
// never the card).
//
// This module is the SINGLE authority both halves read, so the five surfaces
// that must agree about a permission cannot drift:
//
//   - the timing gate      `castTimingBaseLegal`  (gre/rules.ts)
//   - the cast-option list `castOptionAlternativeCosts` (here) — read by the
//     legality gate, the client's cast picker (`src/lib/card-utils.ts`) and
//     the cast mutation
//   - the cast mutation    `announceCast`         (convex/game.ts)
//   - the Bot's enumerator `enumerateCastMoves`   (gre/moves.ts)
//   - the wire projection, which needs nothing: every input here (both
//     battlefields, the caster's hand card) survives `projectPublicState`
//     unchanged, so the client evaluates the identical predicate (ADR 0074).
//
// Read-time only, exactly like `cast-restriction`: nothing is materialized onto
// a permanent, so a permission auto-reverts when its source leaves play.
//
// KNOWN BOUNDARY, shared with `cast-restriction` but with a worse polarity than
// it has: the scan reads `staticEffects` off the registry definition, so a
// source whose abilities have been REMOVED (an `ability-loss` static, CR 613.1f
// layer 6) still grants its permission. Over-applying a restriction is
// conservative; over-applying a GRANT makes an illegal cast legal, and under
// `withoutPayingManaCost` it makes it legal for free. A face-down permanent is
// already safe (`FACE_DOWN_CARD_ID` resolves to the vanilla 2/2 sentinel, which
// declares nothing). No shipped card combination reaches it — nothing in this
// pool strips an enchantment's abilities — and the fix belongs with the
// layer-6-aware read the whole family needs, not in this module alone.
// tracked-by: #3272
//
// THE COST HALF IS AN ALTERNATIVE COST (CR 118.9 — "a cost … applied to it from
// another effect that its controller may pay rather than paying the spell's
// mana cost"), never a silent waiver: CR 118.5 is explicit that a cost of {0}
// "is not automatically paid", and CR 601.2b has the caster ANNOUNCE the
// alternative cost. So a free cast is one entry in the same cast-option list
// evoke / dash / bestow / morph already occupy, mutually exclusive with them
// for free (CR 118.9a — only one alternative cost per spell), and the ordinary
// paid cast stays available beside it inside the caster's own sorcery window.

import { declaresCastPermission, tryGetDefinition } from "../cards";
import type {
    AlternativeCost,
    CardDefinition,
    StaticCastPermission,
} from "../cards/types";
import {
    affordableAlternativeCosts,
    handCardMatchesFilter,
} from "./alternativeCost";
import type { CastFromZone } from "./castCost";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** Namespace prefix for the `alternativeCostId` a permission's free cast is
 *  addressed by on the wire (`announceCast.alternativeCostId`,
 *  `Move.alternativeCostId`). Namespaced so a permission id can never collide
 *  with a card-declared `alternativeCosts[].id` — the two live in the same
 *  string space and are resolved by the same lookup
 *  ({@link resolveCastAlternativeCost}). */
export const CAST_PERMISSION_ALT_COST_PREFIX = "cast-permission:";

/** `true` when `altCostId` addresses a board-granted permission's free cast
 *  rather than one of the card's own alternative costs. */
export function isCastPermissionAltCostId(altCostId: string): boolean {
    return altCostId.startsWith(CAST_PERMISSION_ALT_COST_PREFIX);
}

/** The `alternativeCostId` that addresses `permission`'s free cast. */
export function castPermissionAltCostId(
    permission: StaticCastPermission
): string {
    return `${CAST_PERMISSION_ALT_COST_PREFIX}${permission.id}`;
}

/** Every `cast-permission` static on EITHER battlefield that covers `casterId`
 *  casting `card` from `castFromZone`, in battlefield order, deduplicated by
 *  permission id (two Alurens grant the one permission, not two cast options —
 *  CR 601.2b would let the caster announce only one of them anyway).
 *
 *  Zone: HAND only, and load-bearing. The permission this kind models IS the
 *  CR 601.3 "rule or effect allows that player to cast it", and what it widens
 *  is the base permission every card type states for itself — CR 302.1 for a
 *  creature: "A player who has priority may cast a creature card from their
 *  hand during a main phase of their turn when the stack is empty." Aluren
 *  relaxes the WHEN and the COST of that; it names no other zone, and a card in
 *  one needs its own permission (Flashback, Escape, Yawgmoth's Will) to be
 *  castable at all — that permission, not this one, states what its cast costs
 *  and when it may happen.
 *
 *  So a non-hand cast must be left strictly ALONE, not merely unsweetened: an
 *  Aluren that granted flash to an escape cast, or made one owe a free cast
 *  that cannot resolve for that zone, would turn a legal sorcery-speed cast
 *  into an uncastable one. That is why every caller threads its real zone
 *  through `castTimingBaseLegal` and `castPermissionRequiredFor` instead of
 *  taking the hand default.
 *
 *  Mirrors `isCastTimingSorcerySpeedLocked`'s scan shape exactly: read off each
 *  permanent's registry `staticEffects`, never a materialized per-instance
 *  flag. */
export function collectCastPermissions(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    castFromZone: CastFromZone = "hand"
): StaticCastPermission[] {
    if (castFromZone !== "hand") return [];
    const found: StaticCastPermission[] = [];
    const seen = new Set<string>();
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const sourceId = (source.card as { id?: string }).id;
            if (!sourceId) continue;
            // Derived-membership precheck (`cards/registry.ts`): almost no
            // permanent declares this kind, and the cast path asks this scan up
            // to four times per hand card — which the ISMCTS search then pays
            // at every node it expands. A `Set.has` answers for the whole board
            // without one `expandDefinition`.
            if (!declaresCastPermission(sourceId)) continue;
            const def = tryGetDefinition(sourceId);
            if (!def?.staticEffects) continue;
            for (const effect of def.staticEffects) {
                if (effect.kind !== "cast-permission") continue;
                if (seen.has(effect.id)) continue;
                // CR 601.3 — the permission is handed to a PLAYER. Aluren's
                // "Any player may cast" reaches both; the commoner "You may
                // cast" reaches the source's controller alone.
                if (
                    effect.grantee === "controller" &&
                    source.controllerId !== casterId
                ) {
                    continue;
                }
                if (!handCardMatchesFilter(card, effect.filter)) continue;
                seen.add(effect.id);
                found.push(effect);
            }
        }
    }
    return found;
}

/** CR 601.3b / 702.8a — `true` when a covering permission lets `casterId` cast
 *  `card` "as though it had flash", i.e. any time they could cast an instant.
 *  Folded into the PLAYER-GRANT leg of `castTimingBaseLegal` (`gre/rules.ts`)
 *  beside Teferi's `castTimingFlashGrants`, never as a fourth parallel leg. */
export function hasCastPermissionFlash(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    castFromZone: CastFromZone = "hand"
): boolean {
    return collectCastPermissions(state, casterId, card, castFromZone).some(
        (p) => p.asThoughFlash === true
    );
}

/** The zero-mana `AlternativeCost` a `withoutPayingManaCost` permission offers.
 *  CR 118.9 — an alternative cost "applied to it from another effect"; the cost
 *  itself is nothing at all, which is a legal `CostLegs` (Gush's shape minus
 *  the return leg) and therefore always affordable. */
function altCostFor(permission: StaticCastPermission): AlternativeCost {
    return {
        id: castPermissionAltCostId(permission),
        description: permission.oracleText,
    };
}

/** The free-cast options a board permission offers `casterId` for `card`.
 *  Empty for a permission that only widens TIMING (Vedalken Orrery's shape):
 *  such a cast pays the printed cost, so it is not a cast OPTION at all — the
 *  timing gate alone lets it through. */
export function castPermissionAltCosts(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    castFromZone: CastFromZone = "hand"
): AlternativeCost[] {
    return collectCastPermissions(state, casterId, card, castFromZone)
        .filter((p) => p.withoutPayingManaCost === true)
        .map(altCostFor);
}

/** THE cast-option list: every alternative cost `player` may announce for
 *  `card` right now — the card's own affordable ones
 *  (`affordableAlternativeCosts`: `alternativeCosts[]`, evoke, dash, bestow,
 *  synthesized morph) plus every board-granted free cast.
 *
 *  Call THIS, never `affordableAlternativeCosts` directly, from any site that
 *  asks "what can this cast pay instead": the legality gate (`gre/rules.ts`),
 *  the client picker (`src/lib/card-utils.ts`), the cast mutation
 *  (`convex/game.ts`) and the Bot (`gre/moves.ts`) must offer the identical
 *  list or a Move/click is generated that the mutation then refuses. */
export function castOptionAlternativeCosts(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    castFromZone: CastFromZone = "hand"
): AlternativeCost[] {
    return [
        ...affordableAlternativeCosts(state, player, card),
        ...castPermissionAltCosts(state, player.id, card, castFromZone),
    ];
}

/** Resolve an announced `alternativeCostId` against BOTH spaces: the card's own
 *  declarations (`getAlternativeCost`, passed in as `fromDefinition` so this
 *  module needs no import cycle back through the cost resolver) and the
 *  board-granted permissions. `undefined` when the id names neither, which the
 *  mutation turns into a hard rejection. */
export function resolveCastAlternativeCost(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    altCostId: string,
    fromDefinition: AlternativeCost | undefined,
    castFromZone: CastFromZone = "hand"
): AlternativeCost | undefined {
    if (!isCastPermissionAltCostId(altCostId)) return fromDefinition;
    return castPermissionAltCosts(state, casterId, card, castFromZone).find(
        (a) => a.id === altCostId
    );
}

/** CR 601.3c / 118.9b — `true` when this cast can happen ONLY under a free-cast
 *  permission, so announcing that permission's alternative cost is MANDATORY
 *  rather than optional ("An effect that allows you to cast a spell may require
 *  a certain alternative cost to be paid").
 *
 *  The exact mirror of `flashSurchargeRequired` (`gre/rules.ts`), and it owes
 *  nothing in the same four situations, checked in the same order:
 *
 *   1. no covering permission waives the mana cost — there is nothing to force;
 *   2. a covering permission grants flash WITHOUT waiving the cost (Vedalken
 *      Orrery's shape) — the off-window cast is licensed at the printed price,
 *      so the free cast stays optional;
 *   3. the spell is castable at instant speed anyway — intrinsically (CR 304.1
 *      / CR 702.8) or under a player-scoped flash grant, both of which the
 *      caller has already folded into `otherwiseInstantSpeed`;
 *   4. the caster IS inside their own sorcery-speed window (CR 307.1), where
 *      the spell was already castable for its printed cost.
 *
 *  Deliberately takes the two timing facts as ARGUMENTS rather than recomputing
 *  them: `gre/rules.ts` owns the timing authority and this module must not grow
 *  a second copy of it that can disagree. */
export function castPermissionRequired(
    state: GameState,
    casterId: string,
    card: CardInstanceState,
    timing: {
        otherwiseInstantSpeed: boolean;
        inOwnSorceryWindow: boolean;
    },
    castFromZone: CastFromZone = "hand"
): boolean {
    const covering = collectCastPermissions(
        state,
        casterId,
        card,
        castFromZone
    );
    if (!covering.some((p) => p.withoutPayingManaCost === true)) return false;
    if (covering.some((p) => p.asThoughFlash && !p.withoutPayingManaCost)) {
        return false;
    }
    if (timing.otherwiseInstantSpeed) return false;
    return !timing.inOwnSorceryWindow;
}

/** Catalogue helper: every `cast-permission` static a definition declares.
 *  Its one consumer is the catalogue-wide id-uniqueness guard
 *  (`convex/cards/__tests__/castPermissionIds.test.ts`): `collectCastPermissions`
 *  deduplicates by the BARE `effect.id` across every definition on both
 *  battlefields, so two cards sharing an id would silently suppress one
 *  another's permission. */
export function declaredCastPermissions(
    def: CardDefinition
): StaticCastPermission[] {
    return (def.staticEffects ?? []).filter(
        (e): e is StaticCastPermission & typeof e =>
            e.kind === "cast-permission"
    );
}
