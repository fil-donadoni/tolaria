// Which code pays each activation-cost leg — the exhaustive claim table
// (issue #3007, slice of #2998 Gap 2).
//
// A new `ActivatedAbility["cost"]` leg the Move enumerator does not build is a
// card the Bot cannot play, and NO suite reds: legality lives in
// `enumerateMoves` (`gre/moves.ts`), payment is spread across `gre/state.ts`,
// `gre/applyMove.ts` and `gre/activationCostPicks.ts` BY DESIGN, and nothing
// relates the two to the type. "Does `moves.ts` mention this key" is not the
// test — it false-positives on the three legs paid entirely through shared
// helpers.
//
// What this table proves, and it is a completeness property over the TYPE
// rather than over the board: every cost leg has been deliberately adjudicated
// by a human, and a newly added leg cannot land unadjudicated. It is a total
// `Record<keyof ActivatedAbility["cost"], CostLegClaim>`, so `tsc` reds on the
// next key — the `EvalTerms` / `eval-term-labels.ts` idiom
// `.claude/rules/bot-development.md` already mandates for a different table.
// Be precise about what that improves on, because the first draft of this file
// got it wrong and review caught it. The list it replaces
// (`NEVER_AUTO_PAYABLE_COST_LEGS`) was `as const satisfies readonly (keyof …)[]`,
// and `satisfies` alone IS weak — it checks each member is a key and stays green
// when a key is added. But the list was never alone: `constants.ts` carries a
// compile-time witness, `_manaAbilityCostLegsExhaustive`, that `Exclude`s the
// admitted three plus the never-list from the key union and asserts the
// remainder is `never`. That already red on a new leg.
//
// So this table does not ADD the property, it moves it somewhere a human reads:
// the witness proved a leg had been put on one list or the other, and said
// nothing about anyone having thought about it. What matters is that the witness
// stays LIVE, and a runtime array typed `readonly (keyof …)[]` silently kills it
// — `[number]` widens to the whole key union and the `Exclude` becomes
// unconditionally `never`. Hence `NeverAutoPayableCostLeg` below: the never-list
// is derived at the TYPE level as well as at runtime, and `constants.ts`
// consumes the type. Both guards red on a new leg; that is the bar this had to
// clear, and the first draft did not.
//
// What it CANNOT prove: that the enumerator yields a legal, payable Move for
// that leg on a real board. Reachability depends on board state and needs a
// canned position per shape — a behavioural sweep, deliberately out of scope
// here (issue #3007 § Out of scope). A `hole` row is where writing the claim
// found the answer is "it does not".

// SCOPE — one activation surface, not both. Every row below is written against
// `enumerateAbilityMoves` and `applyActivationCostsForSearch`. The OTHER surface,
// `enumerateGrantedAbilityMoves` (`moves.ts`) into `search.ts`'s
// `activate-granted-ability` case, gates only `tap` / `sacrifice` / `mana` and
// pays only `life`: every other leg on a player-scoped GRANT is both ungated and
// free. Vacuous today (Channel is the only such grant, and its cost is `life`),
// but a future leg's row will read "paidBy applyActivationCostsForSearch" and be
// silently false for that path. Widening the table to both surfaces is the right
// follow-up if a second granted ability ever ships.

import type { ActivatedAbility } from "../cards/types";

/** One leg's adjudication. `paidBy` is checked at runtime by
 *  `costLegClaims.bot.test.ts` — a claim naming a function that no longer
 *  exists is a stale row, the same failure `opValuerCoverage.bot.test.ts`
 *  catches for valuers. */
export type CostLegClaim = {
    /** The site that makes this leg reachable and payable FOR THE BOT: the
     *  `moves.ts` branch that gates it, or the shared helper that pays it. */
    paidBy: { file: string; symbol: string };
    /** Why that site is the whole answer for this leg. One line. */
    why: string;
    /** CR 602.1 — may the AUTOMATIC mana-ability planner
     *  (`isAutoPayableManaAbilityCost`) spend this leg on the player's behalf?
     *  True for exactly the three legs that cost the player no decision.
     *  `NEVER_AUTO_PAYABLE_COST_LEGS` is derived from this field, so the two
     *  can no longer drift. */
    autoPayable: boolean;
    /** Set when the adjudication is that the Bot CANNOT reach or pay the leg.
     *  Carries the sibling issue that tracks the fix — a hole is a declared
     *  finding, never a silent one. */
    hole?: `#${number}`;
};

/** Every leg of `ActivatedAbility["cost"]`, and what answers for it.
 *  TOTAL BY CONSTRUCTION — adding a key to the type without a row here is a
 *  `tsc` error, which is the entire point of the table. */
export const COST_LEG_CLAIMS = {
    // ── Gated in the enumerator itself ───────────────────────────────────
    tap: {
        paidBy: {
            file: "convex/gre/moves.ts",
            symbol: "enumerateAbilityMoves",
        },
        why: "CR 118.3 / 302.6 — the branch skips a permanent that is already tapped (nothing left to pay with) or summoning-sick, before emitting the move; `enumerateGrantedAbilityMoves` excludes a granted ability carrying it.",
        autoPayable: true,
    },
    mana: {
        paidBy: { file: "convex/gre/moves.ts", symbol: "planManaPayment" },
        why: "CR 602.1 — normalized through `normalizeManaCost`, then funded by the planner, which emits the `tapPlan` the move carries.",
        autoPayable: true,
    },
    tapOtherFilter: {
        paidBy: {
            file: "convex/gre/tapOtherCost.ts",
            symbol: "canPayTapOtherCost",
        },
        why: "CR 602.1 — the enumerator collects the untapped candidates and asks this predicate before emitting; the picks ride on the move.",
        autoPayable: true,
    },
    life: {
        paidBy: { file: "convex/gre/state.ts", symbol: "canPayLifeCost" },
        why: "CR 119.4 / 602.1 — a life payment is legal only down to zero, and the enumerator gates on that directly.",
        autoPayable: false,
    },
    loyalty: {
        paidBy: {
            file: "convex/gre/loyalty.ts",
            symbol: "loyaltyActivationViolation",
        },
        why: "CR 606.3/606.4 — the once-per-turn, sorcery-speed and enough-counters restrictions are one pure-engine predicate the enumerator calls, so the Bot never emits a loyalty move the server would reject.",
        autoPayable: false,
    },
    removeCounter: {
        paidBy: {
            file: "convex/gre/state.ts",
            symbol: "canPayRemoveCounterCost",
        },
        why: "CR 118.3 / 122.1 — checks the permanent carries enough counters of that type to pay in full.",
        autoPayable: false,
    },
    discardLastDrawn: {
        paidBy: {
            file: "convex/gre/state.ts",
            symbol: "canPayDiscardLastDrawn",
        },
        why: "CR 701.9 — gated on the player having a last-drawn card still in hand.",
        autoPayable: false,
    },
    discardAtRandom: {
        paidBy: {
            file: "convex/gre/state.ts",
            symbol: "canPayDiscardAtRandom",
        },
        why: "CR 701.9 — gated on a non-empty hand; the victim is the seeded stream's, not a pick.",
        autoPayable: false,
    },
    discardFilter: {
        paidBy: {
            file: "convex/gre/activationCostPicks.ts",
            symbol: "activationDiscardCandidates",
        },
        why: "CR 701.9 — the enumerator counts matching hand cards, and this helper enumerates which ones the move names.",
        autoPayable: false,
    },
    exileFromGraveyard: {
        paidBy: {
            file: "convex/gre/activationCostPicks.ts",
            symbol: "enumerateActivationCostPicks",
        },
        why: "CR 406.2 / 602.1 — the enumerator counts matching graveyard cards, and the picks enumerator produces the named victims.",
        autoPayable: false,
    },
    manaEqualToEnchantedCreatureCost: {
        paidBy: {
            file: "convex/gre/moves.ts",
            symbol: "enumerateAbilityMoves",
        },
        why: "CR 602.1 — a cost-SHAPING field: the branch folds the enchanted creature's mana value into the generic total before `planManaPayment` funds it.",
        autoPayable: false,
    },
    manaEqualToCounterCount: {
        paidBy: {
            file: "convex/gre/moves.ts",
            symbol: "enumerateAbilityMoves",
        },
        why: "CR 602.1 — the same shaping, off the permanent's counter count.",
        autoPayable: false,
    },
    selfReduction: {
        paidBy: { file: "convex/gre/state.ts", symbol: "getCostModifiers" },
        why: "CR 601.2f (ADR 0096) — a cost REDUCTION, not a payment: folded into the shared cost-modifier read that both the enumerator and the mutation call, so the Bot funds the reduced price the server charges.",
        autoPayable: false,
    },

    // ── Paid through a shared helper; no enumerator branch, by design ─────
    sacrifice: {
        paidBy: {
            file: "convex/gre/applyMove.ts",
            symbol: "applyActivationCostsForSearch",
        },
        why: "CR 701.21 — for a BATTLEFIELD-source ability, always payable (the permanent is there by definition), so there is nothing for the enumerator to gate; the search-side application sacrifices it exactly as the mutation does. A hand- or graveyard-source ability declaring this leg would be neither gated nor paid — unreachable today, and the shape to check if one ever ships.",
        autoPayable: false,
    },
    sacrificeFilter: {
        paidBy: {
            file: "convex/gre/activationCostPicks.ts",
            symbol: "buildActivationSacrificeSelection",
        },
        why: "CR 701.21 — the enumerator gates on enough matching permanents existing; WHICH ones is a pick this helper enumerates and `applySacrificeSelection` applies.",
        autoPayable: false,
    },
    sacrificeFilterCount: {
        paidBy: {
            file: "convex/gre/activationCostPicks.ts",
            symbol: "buildActivationSacrificeSelection",
        },
        why: "CR 701.21 — the count modifier on `sacrificeFilter`; the same gate and the same pick builder read it, never separately.",
        autoPayable: false,
    },
    returnUnblockedAttacker: {
        paidBy: {
            file: "convex/gre/applyMove.ts",
            symbol: "applyActivationCostsForSearch",
        },
        why: "CR 702.49a ninjutsu — a HAND-source ability, reached through the `activateFromHand` branch, and its return leg is paid by the same `activationSacrificePayment`/`applySacrificeSelection` pair the battlefield branch uses.",
        autoPayable: false,
    },
    discardThis: {
        paidBy: {
            file: "convex/gre/applyMove.ts",
            symbol: "applyActivationCostsForSearch",
        },
        why: "CR 118.1 / 601.2h — a hand-source ability discards itself as the cost. Cycling is the common carrier but not the only one (Harvester of Misery), so this is the generic leg, not CR 702.29a. For a HAND-source ability it is always payable — the card is in hand by definition — so the enumerator gates nothing and the search-side application discards it.",
        autoPayable: false,
    },
    exileThis: {
        paidBy: {
            file: "convex/gre/applyMove.ts",
            symbol: "applyActivationCostsForSearch",
        },
        why: "CR 118.1 / 601.2h — always payable, so nothing to gate. Named here rather than at `payExileThisCost` (`gre/state.ts`) because that authority answers only HALF the Bot path: the graveyard leg delegates to it, while the battlefield leg exiles the permanent directly. Same outcome today, two code paths — the drift seam a claim must not paper over.",
        autoPayable: false,
    },

    // ── Declared holes: writing the claim is what found them ─────────────
    xFromTargetSpellMv: {
        paidBy: { file: "convex/game.ts", symbol: "finalizeTargetSelection" },
        why: "CR 107.3 — X is DERIVED from the targeted spell's mana value, and only the mutation derives it. `enumerateAbilityMoves` normalizes `cost.mana` with no `chosenX`, so `normalizeManaCost({ X: \"X\" })` yields the empty record: the Bot prices Reflecting Mirror's ability at just {T}, emits the move, and the mutation then charges 2x the spell's mana value.",
        autoPayable: false,
        hole: "#3117",
    },
    cyclingCost: {
        paidBy: { file: "convex/game.ts", symbol: "activateAbilityOnState" },
        why: 'CR 702.29c — not a payable leg at all: it is a MARKER qualifying the `discardThis` payment so the discard carries `cause: "cycling"`. Only the mutation passes it; the search-side discard omits the cause, so a "when you cycle" trigger (CR 702.29c) would fire on the real board and not inside the tree. LATENT, not live: `cycledTrigger` (`cards/abilities/cycling.ts`) has no call site in `cards/sets/**` yet, so no shipped card is mis-valued today — it becomes a real defect with the first cycling trigger.',
        autoPayable: false,
        hole: "#3118",
    },
} as const satisfies Record<keyof ActivatedAbility["cost"], CostLegClaim>;

/** CR 602.1 — the legs whose claim says the automatic mana-ability planner may
 *  NOT spend them, as a TYPE. `as const` on the table keeps each `autoPayable` a
 *  literal, so this is a real projection rather than a union of every key.
 *
 *  It exists because the runtime array below cannot carry the property.
 *  `constants.ts`' `_manaAbilityCostLegsExhaustive` witness `Exclude`s the
 *  never-list from the key union and asserts the remainder is `never`; fed
 *  `(typeof ARRAY)[number]` where the array is typed `readonly (keyof …)[]`,
 *  that `Exclude` is unconditionally `never` and the witness is vacuous — a
 *  silent fail-open where a new leg marked `autoPayable: true` is admitted by
 *  `isAutoPayableManaAbilityCost` and never paid. The witness consumes THIS type
 *  instead. */
export type NeverAutoPayableCostLeg = {
    [K in keyof typeof COST_LEG_CLAIMS]: (typeof COST_LEG_CLAIMS)[K]["autoPayable"] extends true
        ? never
        : K;
}[keyof typeof COST_LEG_CLAIMS];

/** The runtime twin of {@link NeverAutoPayableCostLeg}, derived from the same
 *  field so the two cannot disagree. */
export const NEVER_AUTO_PAYABLE_COST_LEGS: readonly NeverAutoPayableCostLeg[] =
    (
        Object.entries(COST_LEG_CLAIMS) as [
            keyof ActivatedAbility["cost"],
            CostLegClaim,
        ][]
    )
        .filter(([, claim]) => !claim.autoPayable)
        .map(([leg]) => leg as NeverAutoPayableCostLeg);
