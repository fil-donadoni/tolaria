// Translates a bot Move into the EXISTING granular game mutations that realise
// it (ADR 0001, issue #110). No new Convex move surface: the bot drives the
// same mutation sequence a human's clicks would, validated server-side
// identically (CR 720 — the server stays authoritative; an illegal Move is
// rejected here, not applied).
//
// Each Move kind maps to a fixed, ordered call sequence:
//   play-land        → playCard
//   summon-companion → summonCompanion (CR 116.2 / 702.139a, ADR 0064)
//   turn-face-up     → turnPermanentFaceUp (CR 116.2b / 702.37e, issue #2705)
//   cast-spell       → announceCast → selectTargets? [→ confirmTargets] → tapForPayment?
//   activate-ability → activateAbility → selectTargets? [→ confirmTargets] → tapForActivationPayment*
//   declare-attackers→ toggleAttacker* → confirmAttackers
//   declare-blockers → (selectBlocker → assignBlockerTarget)* → confirmBlockers
//   mulligan         → declareMulligan
//   mulligan-bottom  → submitResolutionChoice (kind "mulligan-bottom")
//   resolution-choice→ submitResolutionChoice (any zone-pick kind, ADR 0016)
//   may-pay          → submitMayPay (yes-no family, ADR 0016)
//   submit-target    → selectTargets? [→ confirmTargets] (the STANDALONE answer
//                      to an engine-raised target selection — CR 603.3d
//                      targeted trigger / CR 115.7 retarget / CR 707.10c copy
//                      retarget, issue #2283; nothing is announced or paid)
//   pass             → passPriority
//
// Mana payment is explicit (the engine never auto-taps): the Move carries a
// `tapPlan` computed by `planManaPayment`, and tapForPayment auto-commits the
// spell once the pool covers the cost — so an empty tapPlan means the cost was
// already covered by floating mana and no tap is fired.
//
// issue #1779 / PRD #1776 T4 — the bot already knows its whole target set and
// tap plan BEFORE dispatch (both are computed by search up front), so the
// cast-spell/activate-ability cases below submit them as ONE batched
// `selectTargets` call and (for cast-spell) ONE batched `tapForPayment` call,
// instead of one mutation per target/land — the "auto-tap path" collapse the
// issue calls out. `tapForActivationPayment` stays per-item (out of this
// issue's named scope).

import type { Id } from "@convex/_generated/dataModel";
import type { Move } from "@convex/gre";

type GP = { gameId: Id<"games">; playerId: string };

/** The granular mutation callables the executor drives. These are the exact
 *  public mutations in `convex/game.ts` — the bot uses no private surface. */
export type MoveMutations = {
    playCard: (a: GP & { cardInstanceId: string }) => Promise<unknown>;
    /** CR 116.2 / 702.139a (ADR 0064) — the `summon-companion` special
     *  action. No card id (the source is the player's companion slot, not a
     *  hand card); the {3} is solved and applied server-side in one call. */
    summonCompanion: (a: GP) => Promise<unknown>;
    /** CR 116.2b / 702.37e — the turn-face-up special action. Per-permanent
     *  (hence `cardInstanceId`) and variable-cost, unlike `summonCompanion`;
     *  the morph cost is solved and paid server-side in this one call. */
    turnPermanentFaceUp: (
        a: GP & { cardInstanceId: string }
    ) => Promise<unknown>;
    announceCast: (
        a: GP & {
            cardInstanceId: string;
            chosenX?: number;
            chosenModeId?: string;
            /** CR 118.9 / 702.103a — chosen alternative casting cost (Bestow
             *  today, issue #2388). */
            alternativeCostId?: string;
            /** CR 601.2b / 118.8 — the chosen leg of a caster-chosen ADDITIONAL
             *  cost ("discard a card or pay 3 life"). Named at announcement,
             *  like the mode; the server rejects the cast without it when the
             *  card declares a disjunction. */
            additionalCostLegId?: string;
            /** CR 702.33 (issue #2081) — which of this spell's Kickers the
             *  search actually valued and charged
             *  (`applyKickerPermanentLegForSearch` / `payLife` for the
             *  non-mana legs, `tapPlan` for the mana leg), keyed by
             *  `KickerCost.id`. Omitting it here would announce an unkicked
             *  cast the search never evaluated — the bot-freeze shape this
             *  issue exists to close for Kicker. */
            kickerPayments?: Record<string, number>;
            /** CR 702.27 Buyback (issue #2081) — whether the bot paid this
             *  cost (the extra mana already rides on `tapPlan`). */
            buyback?: boolean;
        }
    ) => Promise<unknown>;
    selectTarget: (
        a: GP & {
            targetType: "permanent" | "player" | "spell" | "graveyard-card";
            targetId: string;
            targetPlayerId?: string;
        }
    ) => Promise<unknown>;
    /** Batched form of `selectTarget` (issue #1779 / PRD #1776 T4): applies a
     *  full ordered array of target selections in ONE mutation call instead
     *  of one call per target. */
    selectTargets: (
        a: GP & {
            targets: {
                targetType: "permanent" | "player" | "spell" | "graveyard-card";
                targetId: string;
                targetPlayerId?: string;
            }[];
        }
    ) => Promise<unknown>;
    confirmTargets: (a: GP) => Promise<unknown>;
    /** Batched form (issue #1779 / PRD #1776 T4): applies a full ordered
     *  `payments` array in ONE mutation call instead of one call per land. */
    tapForPayment: (
        a: GP & {
            payments: { cardInstanceId: string; manaChoiceIndex?: number }[];
        }
    ) => Promise<unknown>;
    /** CR 605.1a / 605.3c (issue #2420) — activates a NON-tap mana ability
     *  (Urza, Lord High Artificer's `tapOtherFilter` leg; Farrelite Priest's
     *  pure `cost.mana`) rather than tapping the source. Dispatched for any
     *  `tapPlan` entry carrying `abilityId`, in BOTH the cast-spell and the
     *  activate-ability branches below — the executor's mirror of
     *  `convex/game.ts`'s `activateManaAbility`, which is legal mid-payment
     *  (CR 605.3b) for exactly this reason. */
    activateManaAbility: (
        a: GP & {
            cardInstanceId: string;
            abilityId: string;
            manaChoiceIndex?: number;
            tapOtherIds?: string[];
        }
    ) => Promise<unknown>;
    activateAbility: (
        a: GP & {
            cardInstanceId: string;
            abilityId: string;
            chosenX?: number;
            /** CR 700.2c (issue #1341) — mode of a modal activated ability. */
            chosenModeId?: string;
        }
    ) => Promise<unknown>;
    /** CR 113.1b (issue #2903) — activates a PLAYER-level granted ability
     *  (Channel's "Pay 1 life: Add {C}."). No card id (the grant hangs off the
     *  player, not a permanent); the mutation resolves the template from the
     *  grant instance id. */
    activatePlayerAbility: (
        a: GP & { grantedAbilityInstanceId: string }
    ) => Promise<unknown>;
    tapForActivationPayment: (
        a: GP & { cardInstanceId: string; manaChoiceIndex?: number }
    ) => Promise<unknown>;
    /** CR 701.21 / 118.5 — names ONE permanent to sacrifice for a
     *  `sacrificeFilter` activation cost (Fallen Angel, Atog) or a static
     *  additional-sacrifice tax. One call per victim. */
    selectSacrifice: (a: GP & { cardInstanceId: string }) => Promise<unknown>;
    /** CR 701.13 / 118.8 — names the single permanent exiled for a cast's
     *  `additionalCosts.exileFilter` additional cost (Soul Exchange). */
    selectAdditionalCost: (
        a: GP & { cardInstanceId: string }
    ) => Promise<unknown>;
    /** CR 602.1 / 118.8 — names ONE permanent to tap for a `tapOtherFilter`
     *  activation cost (Hand of Justice, Crew N). One call per permanent. */
    selectActivationCost: (
        a: GP & { cardInstanceId: string }
    ) => Promise<unknown>;
    /** CR 602.1 / 118.5 — names the cards exiled from ONE graveyard for an
     *  `exileFromGraveyard` activation cost (Grim Lavamancer, Night Soil). */
    selectActivationExileCost: (
        a: GP & { graveyardOwnerId: string; cardInstanceIds: string[] }
    ) => Promise<unknown>;
    /** CR 602.1 / 118.3 — names the hand cards discarded for a `discardFilter`
     *  activation cost (Survival of the Fittest). */
    selectActivationDiscardCost: (
        a: GP & { cardInstanceIds: string[] }
    ) => Promise<unknown>;
    toggleAttacker: (a: GP & { cardInstanceId: string }) => Promise<unknown>;
    confirmAttackers: (a: GP) => Promise<unknown>;
    selectBlocker: (a: GP & { cardInstanceId: string }) => Promise<unknown>;
    assignBlockerTarget: (a: GP & { attackerId: string }) => Promise<unknown>;
    confirmBlockers: (a: GP) => Promise<unknown>;
    /** Confirm the bot's portion of combat-damage assignment (CR 510.1c). Not a
     *  GRE `Move`: the damage step is resolved by the driver's gate (the search
     *  auto-confirms it in playout), so this is driven directly, not via
     *  `executeMove`. The engine pre-fills the default assignment on step entry,
     *  so the bot only needs to confirm. */
    confirmDamage: (a: GP) => Promise<unknown>;
    declareMulligan: (
        a: GP & { decision: "keep" | "mull" }
    ) => Promise<unknown>;
    submitResolutionChoice: (
        a: GP & {
            stackItemId: string;
            step: number;
            choiceId: string;
            cardInstanceIds: string[];
        }
    ) => Promise<unknown>;
    submitMayPay: (
        a: GP & {
            accept: boolean;
            sacrificeIds?: string[];
            /** CR 701.9 / 118.3 (issue #899 / #1507) — chosen hand card id(s)
             *  for a may-pay discard-leg pick. Mirrors `sacrificeIds`. */
            discardIds?: string[];
        }
    ) => Promise<unknown>;
    submitLandEntryChoice: (a: GP & { accept: boolean }) => Promise<unknown>;
    submitDrawReplacementPay: (a: GP & { accept: boolean }) => Promise<unknown>;
    submitMadnessDecline: (a: GP) => Promise<unknown>;
    submitReboundDecline: (a: GP) => Promise<unknown>;
    submitNameCard: (a: GP & { cardName: string }) => Promise<unknown>;
    submitRandomRevealAck: (
        a: GP & { stackItemId: string; choiceId: string }
    ) => Promise<unknown>;
    passPriority: (a: GP) => Promise<unknown>;
};

/** Realise one `tapPlan` (issue #2420), splitting it into runs of PLAIN taps
 *  — handed to `sendPlain` as one batch each — and individual `abilityId`
 *  entries — handed to `sendAbility` one at a time, via
 *  `mutations.activateManaAbility`. Order is preserved: `planManaPayment`
 *  always orders a mana-cost ability's OWN funding taps (plain) before its
 *  activation entry, so the pool already covers the ability's cost by the
 *  time `sendAbility` runs for it. */
async function runTapPlan(
    tapPlan: {
        cardInstanceId: string;
        manaChoiceIndex?: number;
        abilityId?: string;
        tapOtherIds?: string[];
    }[],
    sendPlain: (
        batch: { cardInstanceId: string; manaChoiceIndex?: number }[]
    ) => Promise<unknown>,
    sendAbility: (tap: {
        cardInstanceId: string;
        abilityId: string;
        manaChoiceIndex?: number;
        tapOtherIds?: string[];
    }) => Promise<unknown>
): Promise<void> {
    let i = 0;
    while (i < tapPlan.length) {
        const tap = tapPlan[i];
        if (tap.abilityId) {
            await sendAbility({
                cardInstanceId: tap.cardInstanceId,
                abilityId: tap.abilityId,
                manaChoiceIndex: tap.manaChoiceIndex,
                tapOtherIds: tap.tapOtherIds,
            });
            i++;
            continue;
        }
        const batch: { cardInstanceId: string; manaChoiceIndex?: number }[] =
            [];
        while (i < tapPlan.length && !tapPlan[i].abilityId) {
            batch.push({
                cardInstanceId: tapPlan[i].cardInstanceId,
                manaChoiceIndex: tapPlan[i].manaChoiceIndex,
            });
            i++;
        }
        await sendPlain(batch);
    }
}

export type MoveExecContext = {
    gameId: Id<"games">;
    botId: string;
    mutations: MoveMutations;
};

/** Replay `move` through the existing mutations on the bot's seat. Sub-mutations
 *  are awaited in order; a server rejection propagates so the driver can retry
 *  the window on the next state change. */
export async function executeMove(
    move: Move,
    ctx: MoveExecContext
): Promise<void> {
    const { gameId, botId, mutations } = ctx;
    const base: GP = { gameId, playerId: botId };

    switch (move.kind) {
        case "pass":
            await mutations.passPriority(base);
            return;

        case "mulligan":
            await mutations.declareMulligan({
                ...base,
                decision: move.decision,
            });
            return;

        case "mulligan-bottom":
        case "resolution-choice":
            // Both submit through the same `submitResolutionChoice` mutation
            // (CR 608.2 / ADR 0016); the choice identity travels on the Move.
            await mutations.submitResolutionChoice({
                ...base,
                stackItemId: move.stackItemId,
                step: move.step,
                choiceId: move.choiceId,
                cardInstanceIds: move.cardInstanceIds,
            });
            return;

        case "may-pay":
            // Yes/no family (CR 117.3a / 118.4) — a SEPARATE entry point from
            // submitResolutionChoice (ADR 0016). CR 701.21a — a sacrifice-leg
            // pick rides along as `sacrificeIds`; CR 701.9 discard / 118.3 (issue
            // #899 / #1507) — a discard-leg pick rides along as `discardIds`.
            await mutations.submitMayPay({
                ...base,
                accept: move.accept,
                ...(move.sacrificeIds
                    ? { sacrificeIds: move.sacrificeIds }
                    : {}),
                ...(move.discardIds ? { discardIds: move.discardIds } : {}),
            });
            return;

        case "land-entry":
            // Shock-land pay-choice (CR 614.12 / ADR 0051) — its own entry
            // point (`submitLandEntryChoice`); a played land has no stack item.
            await mutations.submitLandEntryChoice({
                ...base,
                accept: move.accept,
            });
            return;

        case "draw-replacement":
            // Zur's Weirding pay-choice (CR 614 / issue #735) — its own entry
            // point (`submitDrawReplacementPay`); the turn-based draw step has no
            // stack item. Only the boolean travels.
            await mutations.submitDrawReplacementPay({
                ...base,
                accept: move.accept,
            });
            return;

        case "madness-decline":
            // CR 702.35a — decline the reflexive Madness cast-choice (send the
            // card to the graveyard). Its own entry point (submitMadnessDecline);
            // no data travels, the server reads the head choice.
            await mutations.submitMadnessDecline(base);
            return;

        case "rebound-decline":
            // CR 702.88c — decline the reflexive Rebound cast-choice (the card
            // remains exiled). Its own entry point (submitReboundDecline); no
            // data travels, the server reads the head choice.
            await mutations.submitReboundDecline(base);
            return;

        case "name-card":
            // Name-a-card family (CR 202.3 / ADR 0016) — a SEPARATE entry point
            // (submitNameCard); only the name string travels on the Move.
            await mutations.submitNameCard({
                ...base,
                cardName: move.cardName,
            });
            return;

        case "random-reveal-ack":
            // CR 705.2 / ADR 0023 — acknowledge an engine-drawn coin flip to
            // resume resolution. No data travels; the choice identity is on the
            // Move (read from the head pending choice).
            await mutations.submitRandomRevealAck({
                ...base,
                stackItemId: move.stackItemId,
                choiceId: move.choiceId,
            });
            return;

        case "submit-target": {
            // CR 603.3d / 115.7 / 707.10b (issue #2283) — answer an
            // ENGINE-RAISED target selection (a targeted trigger, a retarget, a
            // spell copy's retarget). A STANDALONE submission: unlike the
            // target tuple that rides on `cast-spell` / `activate-ability`,
            // nothing was announced and no cost is paid, so this is the whole
            // sequence. Same two mutations a human's clicks make.
            //
            // `selectTargets` rejects an empty array, so an "up to N" selection
            // the bot declines (targets: []) is confirm-only.
            // See the matching comment in the "cast-spell" branch below:
            // `"hand-card"` is never a real announced target (issue #1101), so
            // narrow it away rather than widening the mutation's validator.
            const targetInputs: {
                targetType: "permanent" | "player" | "spell" | "graveyard-card";
                targetId: string;
                targetPlayerId?: string;
            }[] = [];
            for (const t of move.targets) {
                if (t.type === "hand-card") continue;
                targetInputs.push({
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                });
            }
            if (targetInputs.length > 0) {
                await mutations.selectTargets({
                    ...base,
                    targets: targetInputs,
                });
            }
            // CR 601.2c — a fixed-N selection auto-finalized on the last pick
            // and MUST NOT be confirmed (the selection is already gone and the
            // server throws); a range needs the explicit confirm.
            if (move.confirmTargets) {
                await mutations.confirmTargets(base);
            }
            return;
        }

        case "play-land":
            await mutations.playCard({
                ...base,
                cardInstanceId: move.cardInstanceId,
            });
            return;

        case "summon-companion":
            await mutations.summonCompanion(base);
            return;

        // CR 116.2b / 702.37e — the turn-face-up special action. One mutation,
        // no payment round-trip: the morph cost is auto-tapped server-side
        // (`turnPermanentFaceUp`, game.ts), exactly like the companion's {3}.
        case "turn-face-up":
            await mutations.turnPermanentFaceUp({
                ...base,
                cardInstanceId: move.cardInstanceId,
            });
            return;

        case "cast-spell": {
            await mutations.announceCast({
                ...base,
                cardInstanceId: move.cardInstanceId,
                chosenX: move.chosenX,
                chosenModeId: move.chosenModeId,
                // CR 118.9 / 702.103a (issue #2388) — the chosen alternative
                // casting cost. The enumerator emits it for Bestow, whose
                // choice must reach the mutation BEFORE targets: the bestow
                // cast is an Aura spell and the target group the executor
                // sends next is the one `announceCast` derives from this id.
                alternativeCostId: move.alternativeCostId,
                // CR 601.2b — the leg the search actually valued and charged
                // (`applyAdditionalCostLegForSearch`). Omitting it here would
                // make `announceCast` throw "must choose which additional cost
                // to pay" and stall the bot on a move it generated itself.
                additionalCostLegId: move.additionalCostLegId,
                // CR 702.33 (issue #2081) — the Kicker payment the search
                // actually valued and charged. Without this line the server is
                // never told anything was kicked, however correctly the
                // enumerator and both search sandboxes priced it — the exact
                // gap this issue's title names.
                kickerPayments: move.kickerPayments,
                // CR 702.27 (issue #2081) — same forwarding for Buyback.
                buyback: move.buybackPaid,
            });
            // issue #1101 — `TargetSelection.type` grew a "hand-card" member
            // for `lookDistribute`'s internal `bind` resolution, but it is never a
            // real ANNOUNCED target (CR 601.2c): `getLegalTargets` /
            // `enumerateTargetTuples` never produce it, so `move.targets`
            // never actually carries one. Narrow it away here rather than
            // widening `selectTargets`'s validator to accept a kind it must
            // never receive.
            const targetInputs: {
                targetType: "permanent" | "player" | "spell" | "graveyard-card";
                targetId: string;
                targetPlayerId?: string;
            }[] = [];
            for (const t of move.targets) {
                if (t.type === "hand-card") continue;
                targetInputs.push({
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                });
            }
            if (targetInputs.length > 0) {
                // issue #1779 / PRD #1776 T4 — one batched call instead of N
                // sequential `selectTarget` round-trips.
                await mutations.selectTargets({
                    ...base,
                    targets: targetInputs,
                });
            }
            // CR 601.2c — `move.confirmTargets` ALONE decides this, exactly as
            // in the standalone `submit-target` branch above (issue #2870). The
            // extra `move.targets.length > 0` term used to suppress the confirm
            // for a DECLINED "up to N" selection — the only possible answer
            // when the board offers no legal target — so no mutation at all was
            // sent, the `PendingTarget` stayed live, and the `tapForPayment`
            // below threw against an expected input of `"target"`.
            if (move.confirmTargets) {
                await mutations.confirmTargets(base);
            }
            // CR 601.2f / 701.21 / 701.13 (issue #2135) — the MANDATORY
            // additional-cost parks (the card's own filtered sacrifice plus
            // Drought's static sacrifice, and the exile additional cost, Soul
            // Exchange). The server parks a `pendingCast` carrying an unanswered
            // picker for each and refuses to commit until every one is named;
            // the picks travel ON the move (the same shape the activation side
            // already used for `costPicks`), so the search valued exactly what
            // this now names. Submitted AFTER targeting — while a
            // `pendingTarget` is live the expected input is "target", and each
            // picker asserts "priority". One pick per call (ADR 0091 decision 5).
            const castPicks = move.castCostPicks;
            if (castPicks) {
                for (const cardInstanceId of castPicks.sacrificeIds ?? []) {
                    await mutations.selectSacrifice({
                        ...base,
                        cardInstanceId,
                    });
                }
                if (castPicks.additionalCostCardId) {
                    await mutations.selectAdditionalCost({
                        ...base,
                        cardInstanceId: castPicks.additionalCostCardId,
                    });
                }
            }
            if (move.tapPlan.length > 0) {
                // issue #1779 / PRD #1776 T4 — one batched call instead of N
                // sequential `tapForPayment` round-trips for the PLAIN runs;
                // `planManaPayment` already computed the whole plan before
                // dispatch. issue #2420 — an `abilityId` entry (Urza,
                // Farrelite Priest) instead activates the ability via
                // `activateManaAbility`, never `tapForPayment`.
                await runTapPlan(
                    move.tapPlan,
                    (batch) =>
                        mutations.tapForPayment({ ...base, payments: batch }),
                    (tap) => mutations.activateManaAbility({ ...base, ...tap })
                );
            }
            return;
        }

        case "activate-ability": {
            await mutations.activateAbility({
                ...base,
                cardInstanceId: move.cardInstanceId,
                abilityId: move.abilityId,
                chosenX: move.chosenX,
                // CR 700.2c (issue #1341) — a modal activated ability locks its
                // mode as it is announced, before targets are selected below.
                chosenModeId: move.chosenModeId,
            });
            // See the matching comment in the "cast-spell" branch above.
            const targetInputs: {
                targetType: "permanent" | "player" | "spell" | "graveyard-card";
                targetId: string;
                targetPlayerId?: string;
            }[] = [];
            for (const t of move.targets) {
                if (t.type === "hand-card") continue;
                targetInputs.push({
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                });
            }
            if (targetInputs.length > 0) {
                // issue #1779 / PRD #1776 T4 — `selectTargets` batches BOTH
                // cast and activated-ability targeting (CR 601.2c / 602.2).
                await mutations.selectTargets({
                    ...base,
                    targets: targetInputs,
                });
            }
            // CR 601.2c / 602.2b — same as the cast branch above (issue
            // #2870): the flag alone, never the tuple's length. A variable-count
            // ability requirement answered with zero targets is a confirm-ONLY
            // submission, and suppressing it strands the activation at an owed
            // `"target"` input the Bot has no move for.
            if (move.confirmTargets) {
                await mutations.confirmTargets(base);
            }
            // CR 602.1 / 118 — the DEFERRED cost legs. The server parks a
            // `pendingActivation` carrying an unanswered picker for each of
            // them and refuses to commit until every one is named; an
            // activation left half-paid is rolled back when the payer next
            // gives up priority (`rollbackPendingActivation`), which is what
            // produced the tap-a-land-then-untap-it loop before the picks
            // travelled on the move. Submitted AFTER targeting: while a
            // `pendingTarget` is live the expected input is "target", and each
            // picker asserts "priority".
            const picks = move.costPicks;
            if (picks) {
                // CR 701.21 — one call per victim; the server routes it to
                // whichever in-flight action awaits a sacrifice choice.
                for (const cardInstanceId of picks.sacrificeIds ?? []) {
                    await mutations.selectSacrifice({
                        ...base,
                        cardInstanceId,
                    });
                }
                for (const cardInstanceId of picks.tapOtherIds ?? []) {
                    await mutations.selectActivationCost({
                        ...base,
                        cardInstanceId,
                    });
                }
                if (picks.exileFromGraveyard) {
                    await mutations.selectActivationExileCost({
                        ...base,
                        graveyardOwnerId:
                            picks.exileFromGraveyard.graveyardOwnerId,
                        cardInstanceIds:
                            picks.exileFromGraveyard.cardInstanceIds,
                    });
                }
                if (picks.discardIds && picks.discardIds.length > 0) {
                    await mutations.selectActivationDiscardCost({
                        ...base,
                        cardInstanceIds: picks.discardIds,
                    });
                }
            }
            // `tapForActivationPayment` batching is out of #1779's named
            // scope (item 1 is `tapForPayment` only) — stays per-item. issue
            // #2420 — an `abilityId` entry (this activation's OWN cost
            // co-funded by Urza / Farrelite Priest) instead activates the
            // ability via `activateManaAbility`, never `tapForActivationPayment`.
            await runTapPlan(
                move.tapPlan,
                async (batch) => {
                    for (const tap of batch) {
                        await mutations.tapForActivationPayment({
                            ...base,
                            ...tap,
                        });
                    }
                },
                (tap) => mutations.activateManaAbility({ ...base, ...tap })
            );
            return;
        }

        case "activate-granted-ability": {
            // CR 113.1b (issue #2903) — a player-level granted ability (Channel).
            // ONE mutation, no card id and no payment round-trip: the life cost
            // is paid server-side by `activatePlayerAbility`, which resolves the
            // template from the grant instance id.
            await mutations.activatePlayerAbility({
                ...base,
                grantedAbilityInstanceId: move.grantedAbilityInstanceId,
            });
            return;
        }

        case "declare-attackers": {
            // Each id starts undeclared, so toggle adds it. Forced attackers not
            // in the set are auto-included by confirmAttackers (CR 508.1d).
            for (const id of move.attackerIds) {
                await mutations.toggleAttacker({ ...base, cardInstanceId: id });
            }
            await mutations.confirmAttackers(base);
            return;
        }

        case "declare-blockers": {
            for (const { blockerId, attackerId } of move.assignments) {
                await mutations.selectBlocker({
                    ...base,
                    cardInstanceId: blockerId,
                });
                await mutations.assignBlockerTarget({ ...base, attackerId });
            }
            await mutations.confirmBlockers(base);
            return;
        }

        default:
            // COMPILE-TIME EXHAUSTIVE (issue #2705). This switch is the client
            // seam where a Move becomes real mutations, so an unhandled kind
            // is not a no-op: the driver believes it acted, the server state
            // never changes, and the bot re-enumerates the same move forever —
            // a freeze, not a misplay. Before this line a new `Move` kind
            // compiled cleanly and fell straight through, which is how the
            // `turn-face-up` special action would have shipped inert.
            return assertNever(move);
    }
}

function assertNever(x: never): never {
    throw new Error(`Unhandled move kind: ${JSON.stringify(x)}`);
}
