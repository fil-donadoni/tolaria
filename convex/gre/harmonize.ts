// Harmonize (CR 702.180) — a keyword-cast capability that lets a card be cast
// from its owner's graveyard for an alternative cost, reduced by the power of a
// creature its caster taps, and exiles the card any time it leaves the stack.
//
// 702.180a Harmonize represents three static abilities: one that functions
//          while the card is in a player's graveyard and two that function
//          while the spell with harmonize is on the stack. "Harmonize [cost]"
//          means "You may cast this card from your graveyard by paying [cost]
//          and tapping up to one untapped creature you control rather than
//          paying this spell's mana cost," "If you cast this spell using its
//          harmonize ability, its total cost is reduced by an amount of
//          generic mana equal to the tapped creature's power," and "If the
//          harmonize cost was paid, exile this card instead of putting it
//          anywhere else any time it would leave the stack."
// 702.180b You choose which creature to tap as you choose to pay a spell's
//          harmonize cost (see rule 601.2b), and then tap that creature as you
//          pay the total cost.
//
// Engine/cost-system infrastructure, NOT an Effect Script Op — the card's
// effect stays DSL; only the cast permission, its cost and its exile live
// here. The three abilities map onto three seams:
//   (1) the graveyard cast — `castRawManaCost` / `graveyardCastMechanism`
//       (`gre/castCost.ts`) price it at `CardDefinition.harmonize`;
//   (2) the reduction — the creature is an ANNOUNCEMENT choice (CR 702.180b,
//       601.2b), carried as `announceCast`'s `harmonizeCreatureId` and on
//       `PendingCast.harmonizeTapCreatureId`; {@link applyHarmonizeReduction}
//       takes its power off the generic part of the already-modified total
//       (CR 601.2f), and the cast commit taps it (CR 601.2h);
//   (3) the exile — `graveyardCastStackFlags` stamps the exile-any-time-it-
//       leaves-the-stack flags, flashback's.
//
// The tap is not a {T} cost, so a summoning-sick creature may be tapped
// (CR 302.6 restricts only abilities with the tap symbol in their cost).
import type { ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import { isCreature } from "./constants";
import { reduceGenericCost } from "./emerge";
import { getEffectivePower } from "./layers";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "./state/declarations";

/** CR 702.180a — the printed harmonize cost of `card`, or `undefined` when it
 *  has none. */
export function getHarmonizeCost(
    card: CardInstanceState
): ManaCost | undefined {
    const id = (card.card as { id?: string }).id;
    return id ? tryGetDefinition(id)?.harmonize : undefined;
}

/** CR 702.180a — true iff `card` carries a harmonize cost. */
export function hasHarmonize(card: CardInstanceState): boolean {
    return getHarmonizeCost(card) !== undefined;
}

/** CR 702.180a — the card in `player`'s graveyard with `instanceId` that can be
 *  cast via harmonize right now, or undefined. */
export function findHarmonizeCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    return card && hasHarmonize(card) ? card : undefined;
}

/** CR 702.180a — the untapped creatures `player` controls that a harmonize cast
 *  may tap. Summoning-sick creatures are eligible (CR 302.6). */
export function harmonizeEligibleCreatures(
    player: PlayerState
): CardInstanceState[] {
    return player.battlefield.filter((c) => isCreature(c) && !c.isTapped);
}

/** CR 702.180a / 601.2f — the generic mana tapping `creature` takes off the
 *  total: its power, a negative power reducing nothing. */
export function harmonizeReductionFor(
    state: GameState,
    creature: CardInstanceState
): number {
    return Math.max(0, getEffectivePower(state, creature));
}

/** The largest reduction any creature `player` could tap buys — what the
 *  castability gate prices a harmonize cast at. 0 with no eligible creature. */
export function largestHarmonizeReduction(
    state: GameState,
    player: PlayerState
): number {
    return harmonizeEligibleCreatures(player).reduce(
        (best, c) => Math.max(best, harmonizeReductionFor(state, c)),
        0
    );
}

/** The eligible creature buying the largest reduction, or undefined when none
 *  buys any — the one the Bot's enumerator names on its tapping variant. */
export function largestHarmonizeCreature(
    state: GameState,
    player: PlayerState
): CardInstanceState | undefined {
    let best: CardInstanceState | undefined;
    let bestReduction = 0;
    for (const c of harmonizeEligibleCreatures(player)) {
        const r = harmonizeReductionFor(state, c);
        if (r > bestReduction) {
            best = c;
            bestReduction = r;
        }
    }
    return best;
}

/** CR 702.180a/b — why `creatureId` cannot be the creature this harmonize cast
 *  taps, or `undefined` when it can: it must be an untapped creature the
 *  caster controls. */
export function harmonizeCreatureError(
    player: PlayerState,
    creatureId: string
): string | undefined {
    const creature = player.battlefield.find((c) => c.id === creatureId);
    if (!creature || !isCreature(creature)) {
        return "Harmonize must tap a creature you control";
    }
    if (creature.isTapped) return "Harmonize must tap an untapped creature";
    return undefined;
}

/** CR 702.180a / 601.2f — reduce a harmonize cast's total cost by the power of
 *  the creature it taps. Applied to the total the cost modifiers produced, the
 *  emerge reduction's position. Mutates `cost`. No-op without a creature. */
export function applyHarmonizeReduction(
    state: GameState,
    player: PlayerState,
    cost: Record<string, number>,
    creatureId: string | undefined
): void {
    if (creatureId === undefined) return;
    const creature = player.battlefield.find((c) => c.id === creatureId);
    if (creature) {
        reduceGenericCost(cost, harmonizeReductionFor(state, creature));
    }
}
