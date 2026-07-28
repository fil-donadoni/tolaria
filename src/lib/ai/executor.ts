// Translates a bot Move into the EXISTING granular game mutations that realise
// it (ADR 0001, issue #110). No new Convex move surface: the bot drives the
// same mutation sequence a human's clicks would, validated server-side
// identically (CR 720 — the server stays authoritative; an illegal Move is
// rejected here, not applied).
//
// Each Move kind maps to a fixed, ordered call sequence:
//   play-land        → playCard
//   summon-companion → summonCompanion (CR 116.2 / 702.139f, ADR 0064)
//   cast-spell       → announceCast → selectTarget* [→ confirmTargets] → tapForPayment*
//   activate-ability → activateAbility → selectTarget* [→ confirmTargets] → tapForActivationPayment*
//   declare-attackers→ toggleAttacker* → confirmAttackers
//   declare-blockers → (selectBlocker → assignBlockerTarget)* → confirmBlockers
//   mulligan         → declareMulligan
//   mulligan-bottom  → submitResolutionChoice (kind "mulligan-bottom")
//   resolution-choice→ submitResolutionChoice (any zone-pick kind, ADR 0016)
//   may-pay          → submitMayPay (yes-no family, ADR 0016)
//   pass             → passPriority
//
// Mana payment is explicit (the engine never auto-taps): the Move carries a
// `tapPlan` computed by `planManaPayment`, and tapForPayment auto-commits the
// spell once the pool covers the cost — so an empty tapPlan means the cost was
// already covered by floating mana and no tap is fired.

import type { Id } from "@convex/_generated/dataModel";
import type { Move } from "@convex/gre";

type GP = { gameId: Id<"games">; playerId: string };

/** The granular mutation callables the executor drives. These are the exact
 *  public mutations in `convex/game.ts` — the bot uses no private surface. */
export type MoveMutations = {
    playCard: (a: GP & { cardInstanceId: string }) => Promise<unknown>;
    /** CR 116.2 / 702.139f (ADR 0064) — the `summon-companion` special
     *  action. No card id (the source is the player's companion slot, not a
     *  hand card); the {3} is solved and applied server-side in one call. */
    summonCompanion: (a: GP) => Promise<unknown>;
    announceCast: (
        a: GP & {
            cardInstanceId: string;
            chosenX?: number;
            chosenModeId?: string;
        }
    ) => Promise<unknown>;
    selectTarget: (
        a: GP & {
            targetType: "permanent" | "player" | "spell" | "graveyard-card";
            targetId: string;
            targetPlayerId?: string;
        }
    ) => Promise<unknown>;
    confirmTargets: (a: GP) => Promise<unknown>;
    tapForPayment: (
        a: GP & { cardInstanceId: string; manaChoiceIndex?: number }
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
    tapForActivationPayment: (
        a: GP & { cardInstanceId: string; manaChoiceIndex?: number }
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
            // submitResolutionChoice (ADR 0016). CR 701.16b — a sacrifice-leg
            // pick rides along as `sacrificeIds`; CR 701.9 / 118.3 (issue
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
            // CR 702.35d — decline the reflexive Madness cast-choice (send the
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

        case "play-land":
            await mutations.playCard({
                ...base,
                cardInstanceId: move.cardInstanceId,
            });
            return;

        case "summon-companion":
            await mutations.summonCompanion(base);
            return;

        case "cast-spell": {
            await mutations.announceCast({
                ...base,
                cardInstanceId: move.cardInstanceId,
                chosenX: move.chosenX,
                chosenModeId: move.chosenModeId,
            });
            for (const t of move.targets) {
                // issue #1101 — `TargetSelection.type` grew a "hand-card"
                // member for `digToHand`'s internal `bind` resolution, but
                // it is never a real ANNOUNCED target (CR 601.2c):
                // `getLegalTargets` / `enumerateTargetTuples` never produce
                // it, so `move.targets` never actually carries one. Narrow
                // it away here rather than widening `selectTarget`'s
                // validator to accept a kind it must never receive.
                if (t.type === "hand-card") continue;
                await mutations.selectTarget({
                    ...base,
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                });
            }
            if (move.confirmTargets && move.targets.length > 0) {
                await mutations.confirmTargets(base);
            }
            for (const tap of move.tapPlan) {
                await mutations.tapForPayment({
                    ...base,
                    cardInstanceId: tap.cardInstanceId,
                    manaChoiceIndex: tap.manaChoiceIndex,
                });
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
            for (const t of move.targets) {
                // See the matching comment in the "cast-spell" branch above.
                if (t.type === "hand-card") continue;
                await mutations.selectTarget({
                    ...base,
                    targetType: t.type,
                    targetId: t.id,
                    targetPlayerId: t.playerId,
                });
            }
            if (move.confirmTargets && move.targets.length > 0) {
                await mutations.confirmTargets(base);
            }
            for (const tap of move.tapPlan) {
                await mutations.tapForActivationPayment({
                    ...base,
                    cardInstanceId: tap.cardInstanceId,
                    manaChoiceIndex: tap.manaChoiceIndex,
                });
            }
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
    }
}
