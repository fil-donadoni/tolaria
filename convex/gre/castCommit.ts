// The **Cast Commit** kernel (CONTEXT.md § Flow) — the server's ONE cast commit
// sequence (issue #4445, PRD #4437): pay the mana leg and capture what it
// produced, pay the other cost legs, remove the card from the zone it is cast
// from, build the stack item with its cost record and its Cast Provenance, put
// it on the stack and announce the cast.
//
// Why one module rather than a sequence per site: until issue #4445 the server
// committed a cast at FIVE sites — the deferred `tryAutoCommitPendingCast`
// commit (`convex/gre/activation.ts`), the immediate branch of
// `finalizeTargetSelection` and the two immediate branches of `announceCast`
// (`convex/game.ts`), and the resolution-time `castChosenSpell` primitive of
// the Spell Context (`convex/gre/state.ts`) — each a hand-kept copy of the same
// pay → record → legs → stack steps. Every new cost leg or stack-item stamp was
// written five times, and the copies drifted: the mana-spent capture reached
// two of them (issue #2378), the announced {X} reached three (issue #4439), the
// graveyard play permission and the zone-dependent stack flags never reached
// the alternative-cost branch, and the resolution-time cast paid its mana
// outside the shared payment seam altogether. The search has the same shape in
// `commitCastInSearch` (`convex/gre/applyMove.ts`, issue #4444), and
// `castCommitKernelParity.test.ts` pins that the two produce the same cost
// record.
//
// What the kernel does NOT decide: WHICH payments a cast owes. That stays the
// one owed-payment seam (`nextOwedPayment`, ADR 0091) and the announcement
// paths that build the plan. The kernel takes a `CastCommitPlan` whose legs are
// already answered and applies it; a leg whose pick has vanished since it was
// answered makes the commit STALE (`null`, nothing reaches the stack), which is
// the caller's vanished-card policy to act on.

import { tryGetDefinition } from "../cards";
import type {
    CardDefinition,
    LiveGraveyardPlayPermission,
    TargetSelection,
} from "../cards/types";
import {
    castZoneOwner,
    payAlternativeCostHandChoice,
    payCastManaCost,
    sacrificeSnapshotFromSelection,
} from "./activation";
import { castAsAdventure } from "./adventure";
import { applyBestowCharacteristics } from "./bestow";
import { graveyardCastStackFlags, reboundCastStackFlags } from "./castCost";
import type { CastFromZone } from "./castCost";
import { manaValue } from "./constants";
import { turnFaceDown } from "./faceDown";
import { additionalCostPaymentSnapshot } from "./kicker";
import type { KickerPayments } from "./kicker";
import { announcedModeFields } from "./modeSelection";
import { drainAutoPasses } from "./phases";
import { markGraveyardPlayPermissionUsed } from "./rules";
import type { SacrificeSelection } from "./sacrificeChoice";
import { castAsSplitHalf } from "./splitCast";
import {
    NO_SPELL_MANA_RIDERS,
    commitLandsForCost,
    emitSpellCastEvent,
    getCastManaSubstitutions,
    getOpponentId,
    getPlayer,
    manaRiderStackStamps,
    moveCard,
    processPendingActionTriggers,
    removeFromZone,
    removePermanentTo,
} from "./state";
import type {
    GameState,
    PendingCast,
    SpellManaRiders,
    StackItem,
} from "./state";

/** Cast Provenance (CONTEXT.md): the zone the spell leaves, and the graveyard
 *  play permission that licensed the cast when one did (ADR 0093). The owner
 *  of that zone is derived at commit (`castZoneOwner`), never carried: a
 *  cross-player exile grant (issue #1156) removes from the ACTUAL exile owner. */
export type CastCommitSource = {
    zone: CastFromZone;
    /** CR 601.3 (ADR 0093) — spent at commit, against its own source. */
    graveyardPermission?: LiveGraveyardPlayPermission;
};

/** The non-mana cost legs the announcement answered, in the shape the
 *  `PendingCast` park carries them (ADR 0091). Every leg is optional; a leg
 *  absent from the plan is a leg the cast does not owe. The kernel applies
 *  them, it never gates on them. */
export type CastCommitLegs = {
    /** CR 601.2b / 118.8 / 107.4f — life paid as a cost: the card's own "pay
     *  N life" additional cost, Phyrexian pips paid with life, a life leg of
     *  a chosen additional-cost option. One total, priced by the caller. */
    payLife?: number;
    /** CR 601.2f / 118.8 / 701.21a — the filtered give-up cost: the
     *  fungible/forced additional sacrifice (Drought, the card's own filter)
     *  or the chosen return/sacrifice alternative cost (Thwart, Fireblast). */
    sacrificeSelection?: SacrificeSelection;
    /** CR 406 (Soul Exchange) — the exile additional cost, already picked. */
    exileAdditionalCost?: { pickedId: string };
    /** CR 702.34a / 702.66b / 702.138 — the graveyard (or hand) cards a
     *  flashback / delve / escape cost exiles, already picked. */
    exileFromGraveyardChoice?: NonNullable<
        PendingCast["exileFromGraveyardChoice"]
    >;
    /** CR 702.51a — the creatures a convoke cast taps, already picked. */
    convokeCreatureChoice?: NonNullable<PendingCast["convokeCreatureChoice"]>;
    /** CR 118.9 — the alternative-cost HAND leg (Force of Will's blue card,
     *  Foil's Island + card), already picked. */
    alternativeCostHandChoice?: NonNullable<
        PendingCast["alternativeCostHandChoice"]
    >;
};

/** The announcement record stamped onto the stack item: what the caster chose
 *  at CR 601.2b–d, read back at resolution. */
export type CastCommitRecord = {
    /** CR 601.2c — locked at announcement; omitted for a non-targeted spell. */
    targets?: TargetSelection[];
    /** CR 601.2d — divide-as-you-choose split. */
    targetAmounts?: Record<string, number>;
    /** CR 702.33 / 702.27a — the kicker / buyback payment record, partitioned
     *  by keyword at the write (`additionalCostPaymentSnapshot`, ADR 0085). */
    kickerPayments?: KickerPayments;
    buybackPaid?: boolean;
    /** CR 700.2 — the announced modes. */
    chosenModeIds?: readonly string[];
    modeTargetCounts?: readonly number[];
    /** CR 307.1 / 117.1a / 601.3a (issue #2473) — the ANNOUNCEMENT-time timing
     *  snapshot. Never re-derived at commit: a deferred commit may run in a
     *  mutation whose stack holds a suspended triggered mana ability. */
    castOffSorceryTiming?: boolean;
    /** ADR 0037 — the player making the spell's decisions when that is not its
     *  caster (Word of Command's controlled cast). */
    actingPlayerId?: string;
};

/** CR 601.2b — the cast mode the caster announced, as the markers the
 *  announcement derived from the chosen alternative cost. The kernel stamps
 *  the flag-shaped ones and applies the characteristic-changing ones
 *  (CR 702.103b bestow, 702.37c morph, 715.3b adventure, 709.3b split) on the
 *  built item immediately before it reaches the stack, so no viewer and no
 *  cast trigger ever observes the printed card. */
export type CastModeMarkers = {
    evoked?: boolean;
    dashed?: boolean;
    warped?: boolean;
    overloaded?: boolean;
    bestowed?: boolean;
    morphed?: boolean;
    castAsAdventure?: boolean;
    castAsSplitHalf?: PendingCast["castAsSplitHalf"];
};

/** Where the built item goes and what happens to priority afterwards. */
export type CastCommitPlacement =
    /** An ANNOUNCED cast: pushed on top, priority handed per CR 117.3c (the
     *  caster keeps it only on request — otherwise a single auto-pass hands
     *  the response window to the opponent), triggers flushed, auto-passes
     *  drained. */
    | { kind: "announce"; keepPriority?: boolean }
    /** A cast made DURING RESOLUTION of `resolvingItemId` (CR 608.2g — Word of
     *  Command, the `castDuringResolution` Op): spliced directly BELOW the
     *  resolving item so it becomes the new top once that item pops and
     *  resolves next, with no priority in between. The resolver owns the
     *  trigger pass and the priority that follows. */
    | { kind: "during-resolution"; resolvingItemId: string };

/** Everything a Cast Commit applies. Built by the announcement paths, which
 *  alone decide what the cast owes. */
export type CastCommitPlan = {
    /** CR 601.2a — the spell's controller and `StackItem.castById`. */
    casterId: string;
    cardInstanceId: string;
    /** The definition the payment prices and the stamps read — the
     *  splice-augmented one where a splice was announced (CR 702.47a). */
    cardDef: CardDefinition | null | undefined;
    /** CR 601.2f — the mana leg of the total cost, as announced. Empty for a
     *  zero-cost or free cast. */
    manaCost: Record<string, number>;
    /** CR 107.3 — the announced {X}, priced into `manaCost` already and
     *  threaded to the grant settle so the two agree (issue #4439). */
    chosenX?: number;
    /** CR 601.2g — the caster's resolved generic-mana spend order, when the
     *  payment was ambiguous and parked on it. */
    genericSpendOrder?: readonly string[];
    source: CastCommitSource;
    legs: CastCommitLegs;
    record: CastCommitRecord;
    mode: CastModeMarkers;
    placement: CastCommitPlacement;
};

/** The **Cast Commit** kernel. Applies `plan` to `state` in place and returns
 *  the stack item it put on the stack, or `null` when a leg the plan carries
 *  can no longer be paid — a picked card that vanished between the answer and
 *  the commit — in which case the spell stays where it was and nothing
 *  reaches the stack. Order: mana (CR 601.2h; the one-shot substitution grant
 *  is settled inside the payment seam, before the pool drains), the hand leg,
 *  the graveyard exile picks, convoke, the filtered sacrifice / exile
 *  additional cost, then life (after every leg whose pick can have vanished),
 *  the graveyard permission, the card's move out of its zone, the stack item,
 *  its cast-mode characteristics, the placement and the SPELL_CAST
 *  announcement (CR 601.2i). Every leg is paid before the card moves, but what
 *  keeps the cast card out of its own hand or graveyard cost is the PICK,
 *  built at announcement around it (`excludeInstanceId`), not the order. */
export function commitCast(
    state: GameState,
    plan: CastCommitPlan
): StackItem | null {
    const caster = getPlayer(state, plan.casterId);
    const { legs, record, mode, placement } = plan;

    // CR 601.2h / 106.4 — the mana leg, through the ONE cast-payment
    // seam: it settles the CR 609.4b one-shot grant, drains the pool and
    // captures the CR 106.6 riders plus the per-colour record a `noteManaSpent`
    // card asked for (Soul Burn, Sunburst).
    let riders: SpellManaRiders = { ...NO_SPELL_MANA_RIDERS };
    let notedManaSpent: Record<string, number> | undefined;
    if (Object.keys(plan.manaCost).length > 0) {
        const payment = payCastManaCost(
            state,
            caster,
            plan.manaCost,
            plan.cardDef,
            getCastManaSubstitutions(
                state,
                caster,
                plan.cardInstanceId,
                plan.cardDef,
                plan.manaCost,
                plan.chosenX
            ),
            plan.cardInstanceId,
            plan.genericSpendOrder,
            plan.chosenX
        );
        riders = payment.riders;
        notedManaSpent = payment.notedManaSpent;
        commitLandsForCost(caster, plan.manaCost);
    }
    // CR 118.9 — the alternative-cost HAND leg: move each picked card from
    // hand to exile / graveyard. Vanished-card policy: a pick no longer in
    // hand makes the commit stale.
    if (legs.alternativeCostHandChoice?.pickedCardIds) {
        if (
            !payAlternativeCostHandChoice(
                state,
                plan.casterId,
                legs.alternativeCostHandChoice
            )
        ) {
            return null;
        }
    }
    // CR 702.34a / 702.66b / 702.138 — the flashback / delve / escape exile cost (Flash
    // of Insight): each picked card leaves the caster's own graveyard
    // (default) or hand (`zone: "hand"`, the exile-from-hand flashback cost)
    // for exile. The picks never include the cast card itself (CR 601.2a).
    const exilePicks = legs.exileFromGraveyardChoice;
    if (exilePicks?.pickedCardIds) {
        const exileSourceZone = exilePicks.zone ?? "graveyard";
        const exileSource =
            exileSourceZone === "hand" ? caster.hand : caster.graveyard;
        const stillThere = exilePicks.pickedCardIds.every((id) =>
            exileSource.some((c) => c.id === id)
        );
        if (!stillThere) return null;
        for (const id of exilePicks.pickedCardIds) {
            moveCard(caster, id, exileSourceZone, "exile");
        }
    }
    // CR 702.51a (issue #1338) — pay Convoke: TAP each chosen creature as the
    // spell moves to the stack. Deferred to commit so a cancelled cast leaves
    // the creatures untapped; a chosen creature no longer untapped makes the
    // commit stale.
    const convoke = legs.convokeCreatureChoice;
    if (convoke?.pickedCreatureIds) {
        const stillThere = convoke.pickedCreatureIds.every((id) =>
            caster.battlefield.some((c) => c.id === id && !c.isTapped)
        );
        if (!stillThere) return null;
        for (const id of convoke.pickedCreatureIds) {
            const creature = caster.battlefield.find((c) => c.id === id);
            if (creature) creature.isTapped = true;
        }
    }
    // CR 118.8 / 701.21a — execute the player-chosen filtered sacrifice(s) or
    // returns through the unified layer. The own-cost requirement is
    // snapshot-flagged: its mana value + subtypes ride on the stack item,
    // read at resolve via `SpellContext.getAdditionalSacrificeMv` /
    // `getAdditionalCostSubtypes`.
    let additionalSacrificeSnapshot = sacrificeSnapshotFromSelection(
        legs.sacrificeSelection,
        state
    );
    // CR 406 — the exile additional cost (Soul Exchange). Snapshot the exiled
    // permanent's mv/subtypes ("+2/+2 if the exiled creature was a Thrull"),
    // then exile it (no sacrifice cause to leave-the-battlefield triggers).
    // A picked permanent that has since left makes the commit stale.
    const exileCost = legs.exileAdditionalCost;
    if (exileCost) {
        const exiled = caster.battlefield.find(
            (c) => c.id === exileCost.pickedId
        );
        if (!exiled) return null;
        const exCardId = (exiled.card as { id?: string }).id;
        const exDef = exCardId ? tryGetDefinition(exCardId) : undefined;
        additionalSacrificeSnapshot = {
            cardInstanceId: exiled.id,
            mv: manaValue(exDef?.manaCost),
            ...(exiled.subtypes && exiled.subtypes.length > 0
                ? { subtypes: [...exiled.subtypes] }
                : {}),
        };
        removePermanentTo(state, exiled.id, "exile");
    }
    // CR 601.2b / 119.4 — pay the life leg as the spell moves to the stack
    // (Fire Covenant, a Phyrexian pip paid with life). Affordability was
    // validated at announcement; SBA handles a fatal payment. Paid AFTER every
    // leg whose pick can have vanished, so a stale commit costs no life.
    if (legs.payLife && legs.payLife > 0) {
        caster.life -= legs.payLife;
    }
    // CR 601.3 (ADR 0093) — this cast is enabled by a graveyard play
    // permission: spend the selected permission's once-per-turn use now, at
    // commit, against its own source.
    if (plan.source.graveyardPermission) {
        markGraveyardPlayPermissionUsed(
            state,
            plan.casterId,
            plan.source.graveyardPermission
        );
    }
    // CR 601.3 / 702.34 — remove from the zone the card is actually cast from
    // (hand, exile for Ice Cauldron's noted card, graveyard for Flashback, the
    // library top). issue #1156 — a cross-player exile grant removes from the
    // ACTUAL exile owner, not the caster.
    const castFromZone = plan.source.zone;
    const spellCard = removeFromZone(
        state,
        castZoneOwner(state, caster, plan.cardInstanceId, castFromZone),
        plan.cardInstanceId,
        castFromZone,
        plan.casterId
    );
    const stackItem: StackItem = {
        ...spellCard,
        castById: plan.casterId,
        ...(record.actingPlayerId
            ? { actingPlayerId: record.actingPlayerId }
            : {}),
        ...(record.targets ? { targets: record.targets } : {}),
        ...(plan.chosenX !== undefined ? { chosenX: plan.chosenX } : {}),
        // CR 702.33d / 702.175a (ADR 0085) — ONE partition at the write: the
        // kicked-counting entries land on `kickerPayments`, the rest on
        // `unkickedCostPayments`, so every "was this kicked" reader (including
        // the CLIENT's, which sees a slim item with no definition) stays
        // correct with no edit of its own.
        ...additionalCostPaymentSnapshot(plan.cardDef, record.kickerPayments),
        ...(record.buybackPaid ? { buybackPaid: true } : {}),
        ...(record.targetAmounts
            ? { targetAmounts: record.targetAmounts }
            : {}),
        ...announcedModeFields(record),
        ...(additionalSacrificeSnapshot ? { additionalSacrificeSnapshot } : {}),
        ...(notedManaSpent ? { notedManaSpent } : {}),
        // CR 106.6 riders (issues #1559 / #3354) — mana spent on this cast
        // carried `cantBeCounteredRider` (Delighted Halfling, read by
        // `counter()` alongside the static `CardDefinition.cantBeCountered`)
        // and/or `hasteRider` (Arena of Glory, handed off to the permanent at
        // resolution). One helper stamps both, so no commit path can disagree.
        ...manaRiderStackStamps(riders, { bestowed: mode.bestowed }),
        ...(mode.evoked ? { evoked: true } : {}),
        ...(mode.dashed ? { dashed: true } : {}),
        ...(mode.warped ? { warped: true } : {}),
        // CR 702.96a (issue #3215) — unlike `bestowed` the overload marker is
        // not consumed below: it stays on the stack item, because the text
        // change functions until the spell has finished resolving.
        ...(mode.overloaded ? { overloaded: true } : {}),
        ...(record.castOffSorceryTiming ? { castOffSorceryTiming: true } : {}),
        // CR 702.34 / 702.138 / 702.81a — the zone-dependent stack flags of an
        // ANNOUNCED graveyard cast, read from the SAME helper the search kernel
        // spreads (`gre/castCost.ts`): Flashback's `exileOnResolve`, escape.
        // The helper derives the mechanism from the card's keywords, which is
        // right for an announcement (`locateCastSource` routed a flashback card
        // through its flashback cost) and WRONG for a cast made during
        // resolution under the resolving effect's own permission (Malcolm's
        // free cast of a discarded Think Twice paid no flashback cost, so
        // CR 702.34a exiles nothing): that cast carries only the factual
        // `castFromGraveyard` and the per-card exile rider a graveyard grant
        // stamped (`castFromGraveyardExilesOnResolve`).
        ...(placement.kind === "announce"
            ? graveyardCastStackFlags(state, spellCard, castFromZone)
            : castFromZone === "graveyard"
              ? {
                    castFromGraveyard: true as const,
                    ...(spellCard.castFromGraveyardExilesOnResolve
                        ? { exileOnResolve: true as const }
                        : {}),
                }
              : {}),
        // CR 702.88a — rebound applies to a cast from the caster's hand under
        // either placement (Word of Command's controlled cast leaves a hand).
        ...reboundCastStackFlags(spellCard, castFromZone),
    };
    // CR 702.103b (issue #2388) — "as a spell cast bestowed is put onto the
    // stack, it becomes an Aura enchantment and gains enchant creature".
    // Applied on the built item immediately before it reaches the stack, so
    // everything downstream — the CR 608.2b re-check, the wire projection,
    // cast triggers — sees the Aura and never the creature. The flag on the
    // item is written by `applyBestowCharacteristics` itself, alongside the
    // type line it rewrites, so the two can never be set apart.
    if (mode.bestowed) applyBestowCharacteristics(stackItem);
    // CR 702.37c (issue #2705) — a MORPH cast puts a FACE-DOWN 2/2 on the
    // stack, not the printed card. Turned down BEFORE the placement and before
    // `emitSpellCastEvent`, so a "whenever a player casts a spell" trigger
    // sees the face-down 2/2 with no name — which is what the spell IS at that
    // moment — and the projection never observes a face-up morph spell.
    if (mode.morphed) turnFaceDown(state, stackItem, "morph");
    // CR 715.3b (ADR 0120) — "while on the stack as an Adventure, the spell
    // has only its alternative characteristics." Same seam, same reason.
    if (mode.castAsAdventure) castAsAdventure(stackItem);
    // CR 709.3b (ADR 0121) — "while on the stack, only the characteristics of
    // the half being cast exist." Same seam, same reason.
    if (mode.castAsSplitHalf) castAsSplitHalf(stackItem, mode.castAsSplitHalf);

    if (placement.kind === "during-resolution") {
        // The resolving item is on top of the stack and is popped by
        // `resolveTopOfStack` once its resolve returns. Insert the new spell
        // directly BELOW it so it becomes the new top after the pop — it
        // resolves next, with no priority in between. Mirrors
        // `copyStackItem`'s insert-below-the-resolver discipline.
        const idx = state.stack.findIndex(
            (s) => s.id === placement.resolvingItemId
        );
        if (idx === -1) state.stack.push(stackItem);
        else state.stack.splice(idx, 0, stackItem);
        // CR 601.2i — the spell is cast: make it a public object and let
        // cast triggers fire. The resolver runs the trigger pass once its own
        // resolution completes.
        emitSpellCastEvent(state, stackItem);
        return stackItem;
    }

    state.stack.push(stackItem);
    // CR 117.3c — the caster receives priority after casting. Unless asked to
    // keep it, a single auto-pass hands the response window to the opponent.
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, plan.casterId);
    state.singleShotAutoPass = placement.keepPriority
        ? undefined
        : plan.casterId;
    // CR 601.2i / 603.3 — the spell is now on the stack. Emit SPELL_CAST and
    // run the trigger pass BEFORE draining auto-passes: cast triggers
    // (Verduran Enchantress, the sphere cycle, Ledger Shredder's connive) must
    // be on the stack ABOVE the spell before any player receives priority. The
    // drain can reach two consecutive passes and call `resolveTopOfStack`, so
    // draining first would resolve — or suspend mid-resolution on a choice —
    // the very spell whose trigger has not been placed yet, then bury the
    // half-resolved spell under its own trigger.
    emitSpellCastEvent(state, stackItem);
    processPendingActionTriggers(state);
    drainAutoPasses(state);
    return stackItem;
}
