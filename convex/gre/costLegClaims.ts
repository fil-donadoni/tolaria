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
// That is strictly stronger than the `satisfies readonly (keyof …)[]` list this
// replaces (`NEVER_AUTO_PAYABLE_COST_LEGS`, below): `satisfies` checks each
// member IS a key, and stays green when a key is added.
//
// What it CANNOT prove: that the enumerator yields a legal, payable Move for
// that leg on a real board. Reachability depends on board state and needs a
// canned position per shape — a behavioural sweep, deliberately out of scope
// here (issue #3007 § Out of scope). A `hole` row is where writing the claim
// found the answer is "it does not".

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
export const COST_LEG_CLAIMS: Record<
    keyof ActivatedAbility["cost"],
    CostLegClaim
> = {
    // ── Gated in the enumerator itself ───────────────────────────────────
    tap: {
        paidBy: {
            file: "convex/gre/moves.ts",
            symbol: "enumerateAbilityMoves",
        },
        why: "CR 602.2a — the branch skips a tapped or summoning-sick permanent before emitting the move, and `enumerateGrantedAbilityMoves` excludes a granted ability carrying it.",
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
        why: "CR 118.4 / 602.1 — a life payment the enumerator gates on directly.",
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
        why: "CR 122.1 / 602.1 — checks the permanent carries enough counters of that type.",
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
        why: "CR 701.21 — always payable (the permanent is on the battlefield by definition), so there is nothing for the enumerator to gate; the search-side application sacrifices it exactly as the mutation does.",
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
        why: "CR 702.29c — a hand-source ability discards itself as the cost; always payable (the card is in hand by definition), so the enumerator gates nothing and the search-side application discards it.",
        autoPayable: false,
    },
    exileThis: {
        paidBy: { file: "convex/gre/state.ts", symbol: "payExileThisCost" },
        why: "CR 118.1 / 601.2h — the single authority for both source zones, dispatched on the ability's declared `activateFromGraveyard`; always payable, so nothing to gate.",
        autoPayable: false,
    },

    // ── Declared holes: writing the claim is what found them ─────────────
    xFromTargetSpellMv: {
        paidBy: { file: "convex/game.ts", symbol: "xFromTargetSpellMv" },
        why: "CR 107.3 — X is DERIVED from the targeted spell's mana value, and only the mutation derives it. `enumerateAbilityMoves` normalizes `cost.mana` with no `chosenX`, so `normalizeManaCost({ X: \"X\" })` yields the empty record: the Bot prices Reflecting Mirror's ability at just {T}, emits the move, and the mutation then charges 2x the spell's mana value.",
        autoPayable: false,
        hole: "#3117",
    },
    cyclingCost: {
        paidBy: { file: "convex/game.ts", symbol: "cyclingCost" },
        why: 'CR 702.29c — not a payable leg at all: it is a MARKER qualifying the `discardThis` payment so the discard carries `cause: "cycling"`. Only the mutation passes it; the search-side discard omits the cause, so a "when you cycle" trigger fires on the real board and not inside the tree.',
        autoPayable: false,
        hole: "#3118",
    },
};

/** CR 602.1 — the legs the AUTOMATIC mana-ability planner may never spend on
 *  the payer's behalf, DERIVED from {@link COST_LEG_CLAIMS} rather than listed.
 *  A new cost leg is excluded until its claim says otherwise, which is what the
 *  hand-maintained list this replaces only claimed to do (issue #3007). */
export const NEVER_AUTO_PAYABLE_COST_LEGS: readonly (keyof ActivatedAbility["cost"])[] =
    (
        Object.entries(COST_LEG_CLAIMS) as [
            keyof ActivatedAbility["cost"],
            CostLegClaim,
        ][]
    )
        .filter(([, claim]) => !claim.autoPayable)
        .map(([leg]) => leg);
