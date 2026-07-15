// Alternative casting costs (CR 118.9). An alternative cost is paid INSTEAD of
// a spell's mana cost: the caster opts into one at announcement, its mana cost
// is zeroed for that cast, and the chosen cost legs are paid at cast commit
// (CR 601.2h). See `AlternativeCost` in convex/cards/types.ts.
//
// Four orthogonal cost legs compose an alternative cost, any subset present:
//   * PERMANENT leg (`action`/`count`/`filter`) — return / sacrifice N of the
//     caster's permanents (Gush returns two Islands, Fireblast sacrifices two
//     Mountains, Daze returns an Island, Mine Collapse sacrifices a Mountain).
//     WHICH permanents pay is the player's choice, routed through the unified
//     `sacrificeChoice.ts` layer as a `SacrificeSelection`.
//   * LIFE leg (`payLife`) — pay N life (CR 118.4 / 119.4). Snuff Out pays 4,
//     Force of Will / Force of Negation pay 1. Deterministic (no picker).
//   * HAND leg (`handCost`) — exile / discard cards FROM HAND matching a filter
//     (Force of Will exiles a blue card, Foil discards an Island card and
//     another card). WHICH cards pay is the player's choice, routed through the
//     cast's `alternativeCostHandChoice` picker.
//   * CONDITION (`condition`) — a cast-availability gate ("if it's not your
//     turn", "if you control a Swamp"): the variant is only affordable when it
//     holds.
//
// Alternative pitch cost is a CR 118.9 RULES concept with no keyword name, so it
// carries no Mechanics Registry row and is NOT an Effect Script Op — it is
// cost-system infra. The on-resolution effect is authored DSL-first and is
// independent of which cost was paid (ADR 0045).
import type {
    AlternativeCost,
    AlternativeCostCondition,
    CardDefinition,
    EffectCardFilter,
} from "../cards/types";
import { matchesPermanentFilter } from "../cards/filters";
import { getCardColors } from "../cards/colors";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getPlayer } from "./state";
import { liveSupertypesOf } from "./snow";
import { STATIC_EFFECT_CTX } from "./layers";
import { getDefinition, tryGetDefinition } from "../cards";
import type { SacrificeSelection } from "./sacrificeChoice";
import { autoResolveFungible } from "./sacrificeChoice";

/** The caster's own permanents that satisfy an alternative cost's permanent-leg
 *  filter (CR 118.9 — "permanents you control"). Derived colours are folded in
 *  via `STATIC_EFFECT_CTX.getColors` so a `colors` filter reads the same colour
 *  the rest of the engine sees. Empty when the alt cost has no permanent leg. */
export function matchingPermanentsForAltCost(
    player: PlayerState,
    altCost: AlternativeCost
): CardInstanceState[] {
    if (!altCost.filter) return [];
    const filter = altCost.filter;
    return player.battlefield.filter((c) => {
        const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: player.id,
            supertypesOf: liveSupertypesOf,
        });
    });
}

/** Whether the alt cost has a PERMANENT leg (return / sacrifice permanents). */
export function altCostHasPermanentLeg(altCost: AlternativeCost): boolean {
    return (
        altCost.action !== undefined &&
        altCost.count !== undefined &&
        altCost.filter !== undefined
    );
}

/** Match a HAND card against an `EffectCardFilter` (CR 118.9 hand leg). Reads
 *  the card's registry characteristics (types / subtypes / colours / name /
 *  mana value); every present filter field is ANDed, array fields OR within
 *  themselves. `any` (issue #897) is the one disjunctive clause list this
 *  filter supports — recurses through this same matcher — ANDed with every
 *  other top-level field present alongside it. Fail-closed on an unknown card
 *  id. Mirrors the shared hidden-zone matcher `matchesCardFilter`
 *  (`convex/gre/effects/interpreter.ts`) — kept as a separate copy because it
 *  reads a HAND card's registry `CardDefinition` shape rather than the
 *  library/graveyard runtime-card shape `matchesCardFilter` targets. Exported
 *  (issue #901) so the `discardFilter` activation-cost leg
 *  (`ActivatedAbility.cost.discardFilter` — Survival of the Fittest "Discard
 *  a creature card") reuses the exact same hand-card matcher rather than a
 *  third copy. */
export function handCardMatchesFilter(
    card: CardInstanceState,
    filter: EffectCardFilter
): boolean {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;
    const asArray = <T>(v: T | T[] | undefined): T[] | undefined =>
        v === undefined ? undefined : Array.isArray(v) ? v : [v];
    if (filter.name !== undefined && def.name !== filter.name) return false;
    const types = asArray(filter.type);
    if (types !== undefined && !types.some((t) => def.types.includes(t)))
        return false;
    const excludeTypes = asArray(filter.excludeType);
    if (
        excludeTypes !== undefined &&
        excludeTypes.some((t) => def.types.includes(t))
    )
        return false;
    const subtypes = asArray(filter.subtype);
    if (
        subtypes !== undefined &&
        !subtypes.some((s) => (def.subtypes ?? []).includes(s))
    )
        return false;
    if (
        filter.supertype !== undefined &&
        !(def.supertypes ?? []).includes(filter.supertype)
    )
        return false;
    const colors = asArray(filter.color);
    if (colors !== undefined) {
        const cardColors = getCardColors(def);
        if (!colors.some((c) => cardColors.includes(c))) return false;
    }
    // issue #898 — `manaValueAtMost` now also accepts a dynamic `{ X: true }`
    // (Green Sun's Zenith). There is no resolving-spell context (no `ctx`, no
    // chosen X) at alternative-cost hand-leg check time, and no alt-cost card
    // uses a dynamic ceiling — only the literal-number shape is meaningful
    // here; a dynamic value imposes no ceiling (fail-open, matching "field
    // absent" rather than mis-comparing against a non-numeric value).
    if (typeof filter.manaValueAtMost === "number") {
        const mv = def.manaCost
            ? Object.values(def.manaCost).reduce<number>(
                  (acc, v) => acc + (typeof v === "number" ? v : 0),
                  0
              )
            : 0;
        if (mv > filter.manaValueAtMost) return false;
    }
    // issue #897 — OR ACROSS filter dimensions. A filter carrying ONLY `any`
    // (no other field set) must not fail open (match every hand card) — every
    // check above is skipped when its field is absent, so without this the
    // function fell straight through to `return true`.
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) => handCardMatchesFilter(card, clause))
    )
        return false;
    return true;
}

/** The caster's hand cards matching an alt-cost hand requirement, excluding the
 *  cast card itself (it is on the stack, not in hand — CR 118.9) and any
 *  already-reserved card. */
export function matchingHandCardsForAltCost(
    player: PlayerState,
    filter: EffectCardFilter,
    excludeInstanceId: string,
    reserved: ReadonlySet<string> = new Set()
): CardInstanceState[] {
    return player.hand.filter(
        (c) =>
            c.id !== excludeInstanceId &&
            !reserved.has(c.id) &&
            handCardMatchesFilter(c, filter)
    );
}

/** Greedy affordability of the whole hand leg: can every requirement be covered
 *  from DISTINCT hand cards (CR 118.9)? Reserves cards in requirement order. */
export function canPayHandCost(
    player: PlayerState,
    altCost: AlternativeCost,
    excludeInstanceId: string
): boolean {
    if (!altCost.handCost) return true;
    const reserved = new Set<string>();
    for (const req of altCost.handCost.requirements) {
        const cands = matchingHandCardsForAltCost(
            player,
            req.filter,
            excludeInstanceId,
            reserved
        );
        if (cands.length < req.count) return false;
        for (let i = 0; i < req.count; i++) reserved.add(cands[i].id);
    }
    return true;
}

/** Whether an alt cost's cast-availability CONDITION holds (CR 118.9). No
 *  condition means always available. */
export function alternativeCostConditionMet(
    state: GameState,
    playerId: string,
    condition: AlternativeCostCondition | undefined
): boolean {
    if (!condition) return true;
    switch (condition.kind) {
        case "your-turn":
            return state.activePlayerId === playerId;
        case "not-your-turn":
            return state.activePlayerId !== playerId;
        case "control": {
            const player = getPlayer(state, playerId);
            const filter = condition.filter;
            return player.battlefield.some((c) => {
                const view = { ...c, colors: STATIC_EFFECT_CTX.getColors(c) };
                return matchesPermanentFilter(view, filter, {
                    selfControllerId: playerId,
                    supertypesOf: liveSupertypesOf,
                });
            });
        }
    }
}

/** Whether the caster can currently pay this alternative cost in full (CR
 *  118.9): the cast condition holds, the caster controls enough matching
 *  permanents (permanent leg), has enough life (life leg), and has enough
 *  matching hand cards (hand leg). `castInstanceId` is the spell being cast (it
 *  can't pay for its own hand cost). */
export function canPayAlternativeCost(
    state: GameState,
    playerId: string,
    altCost: AlternativeCost,
    castInstanceId?: string
): boolean {
    if (!alternativeCostConditionMet(state, playerId, altCost.condition)) {
        return false;
    }
    const player = getPlayer(state, playerId);
    if (
        altCostHasPermanentLeg(altCost) &&
        matchingPermanentsForAltCost(player, altCost).length <
            (altCost.count ?? 0)
    ) {
        return false;
    }
    // CR 119.4 — a life payment is legal only if the life total is at least the
    // amount paid.
    if (altCost.payLife !== undefined && player.life < altCost.payLife) {
        return false;
    }
    if (
        altCost.handCost &&
        !canPayHandCost(player, altCost, castInstanceId ?? "")
    ) {
        return false;
    }
    return true;
}

/** Look up a card's alternative cost by id, or `undefined` if the card has no
 *  such variant. CR 702.74 — also resolves `def.evoke` (the Evoke cost lives
 *  in its own dedicated field, not `alternativeCosts[]`, so the caster's
 *  chosen alt cost can be IDENTIFIED as "the evoke one" by reference equality
 *  at cast commit — see the doc on `CardDefinition.evoke`), matched by its own
 *  `id` exactly like any array entry. */
export function getAlternativeCost(
    def: CardDefinition | undefined,
    altCostId: string
): AlternativeCost | undefined {
    if (def?.evoke?.id === altCostId) return def.evoke;
    return def?.alternativeCosts?.find((a) => a.id === altCostId);
}

/** The alternative costs of a hand card the caster can currently AFFORD
 *  (CR 118.9). Used to keep "cast" legal when the mana cost can't be paid but an
 *  alternative can. CR 702.74 — also offers `def.evoke` (Evoke IS an
 *  alternative cost, CR 702.74a: "casting a spell for its evoke cost follows
 *  the rules for paying alternative costs in rules 601.2b and 601.2f–h"),
 *  gated by the SAME `canPayAlternativeCost` affordability check as every
 *  other alt cost. */
export function affordableAlternativeCosts(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): AlternativeCost[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return [];
    const variants = [
        ...(def.alternativeCosts ?? []),
        ...(def.evoke ? [def.evoke] : []),
    ];
    if (variants.length === 0) return [];
    return variants.filter((a) =>
        canPayAlternativeCost(state, player.id, a, card.id)
    );
}

/** Build the player-chosen PERMANENT-cost selection for an alternative cost's
 *  permanent leg at cast commit (CR 601.2h / 118.9). Returns `undefined` when
 *  the alt cost has no permanent leg (a pure life / hand cost). The requirement
 *  is the alt cost's filter × count, tagged with its terminal `action`
 *  (return → hand / sacrifice → graveyard). `autoResolveFungible` pre-fills the
 *  picks when the choice isn't real; otherwise the selection is incomplete and
 *  the caller parks the cast until the player picks (via `selectSacrifice`). */
export function buildAlternativeCostChoice(
    state: GameState,
    playerId: string,
    altCost: AlternativeCost,
    reason: string
): SacrificeSelection | undefined {
    if (!altCostHasPermanentLeg(altCost)) return undefined;
    const selection: SacrificeSelection = {
        playerId,
        reason,
        requirements: [{ filter: altCost.filter!, count: altCost.count! }],
        picked: [],
        action: altCost.action === "return" ? "return" : "sacrifice",
    };
    autoResolveFungible(state, selection);
    return selection;
}

/** Build the HAND-cost picker for an alternative cost's hand leg at cast commit
 *  (CR 601.2h / 118.9). Returns `undefined` when there is no hand leg. The
 *  picks are pre-filled (`pickedCardIds`) when the choice is forced (each
 *  requirement's matching hand cards exactly meet the count); otherwise
 *  `pickedCardIds` is left undefined and the caller parks the cast until the
 *  player picks (via `selectCastAlternativeHandCost`). */
export function buildAlternativeCostHandChoice(
    player: PlayerState,
    altCost: AlternativeCost,
    castInstanceId: string
):
    | {
          action: "exile" | "discard";
          requirements: { filter: EffectCardFilter; count: number }[];
          excludeInstanceId: string;
          pickedCardIds?: string[];
      }
    | undefined {
    const handCost = altCost.handCost;
    if (!handCost) return undefined;
    const choice = {
        action: handCost.action,
        requirements: handCost.requirements.map((r) => ({
            filter: r.filter,
            count: r.count,
        })),
        excludeInstanceId: castInstanceId,
    };
    // Auto-resolve when the whole hand cost is forced (each requirement's
    // matching cards, allocated greedily, exactly meet its count — no real
    // choice, Arena-UX auto-resolve).
    const reserved = new Set<string>();
    const forcedPicks: string[] = [];
    let forced = true;
    for (const req of handCost.requirements) {
        const cands = matchingHandCardsForAltCost(
            player,
            req.filter,
            castInstanceId,
            reserved
        );
        if (cands.length === req.count) {
            for (const c of cands) {
                reserved.add(c.id);
                forcedPicks.push(c.id);
            }
        } else {
            forced = false;
            break;
        }
    }
    if (forced) {
        return { ...choice, pickedCardIds: forcedPicks };
    }
    return choice;
}

/** Validate a player's hand-cost picks against the alt cost's requirements
 *  (CR 118.9): exactly the required total, all distinct, in the caster's hand,
 *  not the cast card, and collectively coverable by the requirement filters
 *  (greedy distinct allocation). Throws on any violation; returns silently when
 *  legal. Pure (no ctx) so it is unit-tested directly. */
export function validateAlternativeHandCostPicks(
    player: PlayerState,
    choice: {
        requirements: { filter: EffectCardFilter; count: number }[];
        excludeInstanceId: string;
    },
    cardInstanceIds: string[]
): void {
    const total = choice.requirements.reduce((a, r) => a + r.count, 0);
    if (cardInstanceIds.length !== total) {
        throw new Error(`Must give up exactly ${total} card(s) from your hand`);
    }
    if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
        throw new Error("Duplicate card selected for the alternative cost");
    }
    for (const id of cardInstanceIds) {
        if (id === choice.excludeInstanceId) {
            throw new Error("Can't use the spell itself to pay its own cost");
        }
        if (!player.hand.some((c) => c.id === id)) {
            throw new Error("Selected card is not in your hand");
        }
    }
    // Greedy match: assign each requirement `count` cards from the remaining
    // picks that match its filter.
    const remaining = new Set(cardInstanceIds);
    for (const req of choice.requirements) {
        let need = req.count;
        for (const id of [...remaining]) {
            if (need <= 0) break;
            const card = player.hand.find((c) => c.id === id);
            if (card && handCardMatchesFilter(card, req.filter)) {
                remaining.delete(id);
                need -= 1;
            }
        }
        if (need > 0) {
            throw new Error(
                "Selected cards do not match the alternative cost filter"
            );
        }
    }
}

/** Look up the definition of a hand card (for a resolved characteristic read).
 *  Small re-export so callers needn't import `../cards` directly. */
export function definitionOfHandCard(
    card: CardInstanceState
): CardDefinition | undefined {
    const cardId = (card.card as { id?: string }).id;
    return cardId ? getDefinition(cardId) : undefined;
}
