/**
 * Overload — CR 702.96 (issue #3215).
 *
 * "Overload [cost]" is two static abilities that function while the spell is on
 * the stack (CR 702.96a): "You may choose to pay [cost] rather than pay this
 * spell's mana cost", and "If you chose to pay this spell's overload cost,
 * change its text by replacing all instances of the word 'target' with the word
 * 'each.'"
 *
 * The COST half is ordinary alternative-cost infra — 702.96a says in so many
 * words that an overload cast "follows the rules for paying alternative costs
 * in rules 601.2b and 601.2f–h" — so `CardDefinition.overload` is an
 * `AlternativeCost` and `alternativeCost.ts` resolves it exactly as it resolves
 * Evoke, Dash and Bestow. Cost increases and reductions therefore apply to the
 * overload cost for free, by the same `applyCostModifiers` pass every other
 * alternative cost goes through (CR 601.2f).
 *
 * The TEXT-CHANGING half (CR 702.96c — a rule-612 effect) needs no rewriting
 * machinery, and that is the whole design. In this engine a spell's "text" is
 * its Effect Script, and the script already has one construct meaning "every
 * object this spell is affecting": `forEach { set: "targets" }` (issue #1083),
 * which iterates `SpellContext.targets`. An overload card therefore ships ONE
 * script, and the two cast modes differ only in what that set contains:
 *
 *   - printed cost   → the announced targets;
 *   - overload cost  → {@link overloadAffectedTargets} below.
 *
 * CR 702.96b is what makes the second set more than "the legal targets": "that
 * spell won't require any targets. It may affect objects that couldn't be
 * chosen as legal targets if the spell were cast without its overload cost
 * being paid." So the sweep keeps every INTRINSIC filter the printed
 * requirement states (Winds of Abandon still only hits creatures you don't
 * control) and drops every TARGETING restriction (hexproof CR 702.11b, shroud
 * CR 702.18, protection CR 702.16b). That split is not invented here — it is the
 * one `getLegalTargets` already draws internally between
 * `checkPermanentTargetFilters` and the guard/protection gates, exposed through
 * its `ignoreTargetingRestrictions` option so the offered set and this set stay
 * ONE scan (ADR 0068 — no second target-filter authority).
 *
 * Because an overloaded spell announces no targets, `StackItem.targets` stays
 * empty and the CR 608.2b legality gate (`targetLegalityGate`, `state.ts`)
 * treats it as untargeted: it can never fizzle, and nothing prunes the swept
 * set mid-resolution. It also cannot be countered by "counter target spell that
 * targets…" — for the same structural reason, with no special case anywhere.
 */

import { tryGetDefinition } from "../cards";
import type {
    AlternativeCost,
    CardDefinition,
    TargetSelection,
} from "../cards/types";
import { getLegalTargets, targetingSourceFromCard } from "./rules";
import type { CardInstanceState, GameState } from "./state";

/** CR 702.96a — is `alt` the card's OWN overload cost? Compared by reference,
 *  the `isBestowAlternativeCost` idiom: `getAlternativeCost` resolves
 *  `def.overload` for its own id, so the object identity is the whole test and
 *  a card whose `alternativeCosts[]` happened to reuse the id cannot be
 *  mistaken for an overload cast. */
export function isOverloadAlternativeCost(
    def: CardDefinition | undefined,
    alt: AlternativeCost | undefined
): boolean {
    return alt !== undefined && alt === def?.overload;
}

/** The by-id form of {@link isOverloadAlternativeCost}, for the call sites that
 *  hold a `Move.alternativeCostId` string rather than a resolved cost object
 *  (`applyMove` / `search`, via the cast-mode census). Fail-closed: the card
 *  must actually declare an overload cost with that id. */
export function isOverloadCastId(
    def: CardDefinition | undefined,
    altCostId: string | undefined
): boolean {
    return altCostId !== undefined && def?.overload?.id === altCostId;
}

/** CR 702.96b — the objects an OVERLOADED cast affects: every object matching
 *  the card's printed `targetRequirement`, with targeting restrictions
 *  bypassed. Empty for a card with no printed requirement (nothing to rewrite —
 *  "each" of nothing), and for an item whose definition cannot be resolved.
 *
 *  Computed at resolution rather than announcement, because CR 702.96a's second
 *  ability is a CONTINUOUS text-changing effect that functions while the spell
 *  is on the stack: what the spell affects is read as it resolves, off the board
 *  it resolves against, not the board it was announced on. `forEach` freezes the
 *  member set at its first iteration (`selectForEachMembers`), so a resolution
 *  that suspends for a choice mid-sweep still finishes against the set it
 *  started with. */
export function overloadAffectedTargets(
    state: GameState,
    item: CardInstanceState,
    casterId: string
): TargetSelection[] {
    const def = overloadDefinitionOf(item);
    const requirement = def?.targetRequirement;
    if (!requirement) return [];
    return getLegalTargets(
        state,
        requirement,
        // CR 113.3 — a resolving spell is still a spell, so source-quality
        // filters ("target creature an opponent controls", a colour-quality
        // read) judge it the same way the announcement would have.
        targetingSourceFromCard(item, true),
        casterId,
        undefined,
        [],
        undefined,
        { ignoreTargetingRestrictions: true }
    );
}

function overloadDefinitionOf(
    item: CardInstanceState
): CardDefinition | undefined {
    const id = (item.card as { id?: string }).id;
    if (!id) return undefined;
    return tryGetDefinition(id) ?? undefined;
}
