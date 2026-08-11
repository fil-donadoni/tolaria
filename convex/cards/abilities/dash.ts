// `dashTrigger` — declarative template for the SECOND half of Dash (CR
// 702.109a): "When this creature enters, if its dash cost was paid, it gains
// haste and it's returned to its owner's hand at the beginning of the next
// end step."
//
// 702.109a: "Dash [cost]" represents two abilities: a static ability that
//           functions while the card is in a player's hand ("you may cast
//           this creature by paying [cost] rather than paying its mana
//           cost") and a triggered ability that functions on the
//           battlefield ("when this creature enters, if its dash cost was
//           paid, it gains haste and it's returned to its owner's hand at
//           the beginning of the next end step"). Casting a spell using its
//           dash ability follows the rules for paying alternative costs
//           (601.2b, 601.2f-h).
//
// The FIRST half (the alternative cast permission) is cost-system infra,
// NOT this file: `CardDefinition.dash` (reuses the `AlternativeCost` shape,
// CR 118.9 already governs paying it — extended with a `mana` leg since
// Dash, unlike Gush/Evoke, is a mana-for-mana swap rather than a mana-for-
// something-else substitution) is resolved by `convex/gre/alternativeCost.ts`'s
// `getAlternativeCost` / `affordableAlternativeCosts` alongside the generic
// `alternativeCosts[]` array; the cast-commit sites in `convex/game.ts` tag
// the resulting stack item `dashed: true` whenever the chosen alt cost ===
// `CardDefinition.dash` (compared by reference). That flag rides onto the
// entering permanent for free — a stack item IS its `CardInstanceState`,
// the same object — mirroring how CR 702.138b's `escaped` marker and CR
// 702.74a's `evoked` marker already survive the stack→battlefield transition.
//
// This file is only the SECOND half: a `TriggeredAbility` a card adds to its
// own `triggeredAbilities[]` ALONGSIDE its real ETB effect(s) — CR 702.109a is
// explicitly one triggered ability with two clauses (haste grant + delayed
// return), both DSL Ops already shipped and exercised elsewhere: `grantAbility`
// (CR 611.2a / 613.1f, issue #843) and `delayedTrigger` (CR 603.7, ADR 0048,
// issue #838). The "if its dash cost was paid" clause is a CR 603.4 CHECK-TIME
// predicate (`condition`, evaluated once when the trigger would go on the
// stack) rather than an intervening-if — `dashed` cannot change between the
// ETB event firing and this trigger resolving (nothing un-dashes a permanent),
// so no CR 603.4 resolve-time re-check plumbing is needed.
import type { TriggeredAbility } from "../types";
import { enteredTrigger } from "./triggers/enteredTrigger";

/** Builds the Dash haste-and-return trigger (CR 702.109a). Add alongside the
 *  card's own ETB triggered ability/abilities (if any). `cardName` feeds the
 *  oracle-text reminder shown on the stack. */
export function dashTrigger(cardName: string): TriggeredAbility {
    return enteredTrigger({
        id: "dash-haste-and-return",
        oracleText: `When ${cardName} enters, if its dash cost was paid, it gains haste and it's returned to its owner's hand at the beginning of the next end step.`,
        scope: "self",
        // Deliberately a plain `condition`, NOT the decidable
        // `conditionOnSelf` its sibling `evokeTrigger` uses (issue #1936, PR
        // review of #1962) — so the gate stays UNDECIDABLE to the bot's value
        // model and this trigger's script value keeps being charged equally to
        // both cast modes.
        //
        // Why: the value model currently scores this trigger's own body
        // WRONG-SIGNED. `delayedTrigger{ moveZone $source → hand }` is valued
        // as a generic bounce (+55 "tempo" — correct for bouncing an
        // OPPONENT's permanent, backwards for returning your own creature),
        // plus `grantAbility(haste)` +40. Deciding the gate would therefore
        // hand the bot a +95 board-eval BONUS for dashing:
        // `dslRealizedAbilityValueById(Ragavan, Nimble Pilferer)` measures 165
        // dashed vs 70 hard-cast. Undecided, that 165 is charged to both modes
        // — a constant that cannot bias the cast-mode choice, which is the
        // status quo ante and strictly safer than an active wrong incentive.
        //
        // tracked-by: #1964 — model a `$source`-targeted `moveZone` as a COST
        // (mirroring the `sacrifice` valuer's `SAC_SELF_COST` branch). Flip
        // this back to `conditionOnSelf: (self) => self.dashed === true` once
        // that lands.
        condition: (_event, self) => self.dashed === true,
        effects: [
            // CR 702.109a — "it gains haste". No explicit duration is printed;
            // an `end-of-turn` (CLEANUP) grant is functionally equivalent here
            // since the delayed return below always relocates the permanent to
            // hand before CLEANUP is reached (haste is moot once the permanent
            // has left the battlefield either way).
            {
                op: "grantAbility",
                target: { ref: "$source" },
                ability: "haste",
                duration: { phase: "end-of-turn" },
            },
            // CR 702.109a / 603.7a — "it's returned to its owner's hand at the
            // beginning of the next end step".
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText:
                    "Return this creature to its owner's hand at the beginning of the next end step.",
                capture: { $self: { ref: "$source" } },
                effects: [
                    { op: "moveZone", target: { ref: "$self" }, to: "hand" },
                ],
            },
        ],
    });
}
