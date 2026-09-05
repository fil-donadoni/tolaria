// The OWED-PAYMENT seam (ADR 0091, issue #1209) — the single authority for
// "what does this player still owe on an in-progress cast / activation
// announcement?".
//
// A **payment park** is a cost-payment decision suspended inside the
// announcement window of a cast or an activated ability (CR 601.2 / 602.2):
// which permanent to sacrifice, which card to discard or exile, which creatures
// to tap. The announcement is recorded on `pendingCast` / `pendingActivation`
// and its commit is blocked until the payer submits the pick — mana coverage
// alone is never enough. A park is NOT a `PendingChoice`: it happens BEFORE the
// object is on the stack, it lives outside `pendingChoices[]`, and no candidate
// generator (`gre/ai/choiceCandidates.ts`) can see it.
//
// Before this module the authoritative list of parks was the chain of early
// returns inside `tryAutoCommitPendingCast` / `tryAutoCommitPendingActivation`
// (`convex/game.ts`) — a hand-maintained chain that three other places mirrored
// and none of them completely. Every time a park was added, the vs-AI bot
// announced the cast/activation, never submitted the pick, and hung on a move it
// had generated itself. The class was fixed nine times one park at a time
// (#161, #163, #164, #1336, #1338, #1446, #1506, #1507, #1659).
//
// Two things make that structurally impossible now:
//
//  1. **`nextOwedPayment` is the list.** The gates do not CALL it as an extra
//     check, they ARE it (`if (nextOwedPayment(...)) return null`). Order is
//     load-bearing and preserved exactly: convoke BEFORE delve (the convoke
//     pick is what builds the delve picker, `recordConvokeCreaturePick`), and
//     the mana-spend park LAST (evaluated only once mana coverage is reached).
//  2. **The guard is a census over the state's own KEYS**, not a switch over a
//     union of things that already exist. {@link CAST_KEY_CENSUS} /
//     {@link ACTIVATION_KEY_CENSUS} are typed `Record<keyof PendingCast, …>` /
//     `Record<keyof PendingActivation, …>`, so a new field on either container
//     CANNOT COMPILE until it is classified park / non-park — the
//     `PERSISTED_OPTIONAL_KEYS` / `TRANSIENT_KEYS` idiom from `serialize.ts`,
//     adopted deliberately for the same failure mode (silent field loss) so a
//     reader who has met one has met both. Classifying a key as a park then
//     forces a branch in `nextOwedPayment` and a pick in `paymentPicks.ts`
//     (both exhaustive over {@link ParkKind}), which is what turns "a new park
//     stalls the bot" into a build error.
//
// Exhaustiveness is the WHOLE point, so read the census as a checklist rather
// than a list: a key is a **park** only when it is an unanswered PICK the payer
// must submit before commit. A cost that is merely APPLIED at commit
// (`removeCounterCost`, `lifeCost`, `discardAtRandomCount`, `tapSource`) is
// not a park — nobody is waiting on the payer — and treating it as one would
// make the gate never clear.

import { tryGetDefinition } from "../cards/index";
import { getEffectivePower } from "./layers";
import { isSacrificeSelectionComplete } from "./sacrificeChoice";
import type {
    CardInstanceState,
    GameState,
    PendingActivation,
    PendingCast,
    PlayerState,
} from "./state";
import {
    crewPowerContribution,
    isTapOtherSelectionComplete,
    type TapOtherCandidate,
} from "./tapOtherCost";

// ────────────────────────────────────────────────────────────────────────────
// The census
// ────────────────────────────────────────────────────────────────────────────

/** How a key on `PendingCast` / `PendingActivation` relates to commit.
 *  - `"park"`     — an unanswered PICK the payer must submit; blocks commit.
 *  - `"non-park"` — anything else: identity, an announced choice already made,
 *                   a cost applied automatically at commit, a rollback ledger. */
export type ParkClass = "park" | "non-park";

/** Every key of `PendingCast`, classified. `Record<keyof PendingCast, …>` is
 *  the guard: a new field cannot compile until it appears here. */
export const CAST_KEY_CENSUS: Record<keyof PendingCast, ParkClass> = {
    // ── identity / bookkeeping ──────────────────────────────────────────────
    playerId: "non-park",
    cardInstanceId: "non-park",
    manaCost: "non-park",
    /** Rollback ledger, not a decision (CR 601.2h). */
    tappedLandIds: "non-park",
    keepPriority: "non-park",
    /** CR 702.126 — artifacts ALREADY tapped for Improvise; a ledger, and the
     *  generic cost was decremented as each was tapped. */
    improviseTappedArtifactIds: "non-park",

    // ── choices LOCKED IN at announcement (CR 601.2b/601.2d/700.2) ─────────
    /** Chosen before the payment window opens; nothing is waiting on it. */
    chosenX: "non-park",
    chosenModeId: "non-park",
    /** CR 601.2b / 118.8 — WHICH additional-cost leg the caster chose
     *  ("discard a card or pay 3 life"). Named at announcement; by the time
     *  this cast parks the leg has already become a `payLife` scalar, an
     *  `alternativeCostHandChoice` picker or a `sacrificeSelection` — so the
     *  field itself is a record, never a pick anything is waiting on. */
    additionalCostLegId: "non-park",
    targetAmounts: "non-park",
    kickerPayments: "non-park",
    buybackPaid: "non-park",
    evoked: "non-park",
    dashed: "non-park",
    // CR 702.103a — a bestow cast-mode marker, like `evoked`/`dashed`: a
    // snapshot of a choice already made, never a payment the caster still owes.
    bestowed: "non-park",
    // CR 702.37a/c — a morph face-down cast-mode marker, like `bestowed`: a
    // snapshot of a choice already made at announcement, never a payment the
    // caster still owes. The {3} it implies is an ordinary mana cost and parks
    // (or not) through `manaCost` above like any other.
    morphed: "non-park",
    /** CR 601.2 (issue #2473) — a board-state SNAPSHOT taken at announcement
     *  and carried to the commit; the payer decides nothing about it. */
    castOffSorceryTiming: "non-park",
    /** ADR 0037 — who ANSWERS choices, not a choice itself. */
    actingPlayerId: "non-park",
    /** CR 119.4 — a scalar deducted at commit; the payer names nothing. */
    payLife: "non-park",

    // ── PARKS (CR 601.2f/601.2g/118.8/118.9) ───────────────────────────────
    /** CR 601.2f / 701.21a — filtered sacrifice (own additional cost + any
     *  board-wide static tax, Drought). Submitted via `selectSacrifice`. */
    sacrificeSelection: "park",
    /** CR 118.8 — the EXILE additional cost (Soul Exchange). Submitted via
     *  `selectAdditionalCost`. (The sacrifice branch migrated to
     *  `sacrificeSelection`; this picker is exile-only now.) */
    additionalCost: "park",
    /** CR 702.51 — Convoke's creature picker. Submitted via
     *  `selectConvokeCreatures`. Gated BEFORE delve — see `nextOwedPayment`. */
    convokeCreatureChoice: "park",
    /** CR 702.34a / 702.66 / 702.138a — the flashback / escape / delve exile
     *  cost. Submitted via `selectCastExileCost`. */
    exileFromGraveyardChoice: "park",
    /** CR 118.9 — the alternative-cost HAND leg (Force of Will, Foil) and the
     *  Kicker hand legs that ride the same picker (ADR 0079). Submitted via
     *  `selectCastAlternativeHandCost`. */
    alternativeCostHandChoice: "park",
    /** CR 601.2g — the ambiguous generic-mana spend. Submitted via
     *  `resolveManaSpendChoice`. LAST in gate order. */
    manaSpendChoice: "park",
};

/** Every key of `PendingActivation`, classified. Same guard shape as
 *  {@link CAST_KEY_CENSUS}. */
export const ACTIVATION_KEY_CENSUS: Record<keyof PendingActivation, ParkClass> =
    {
        // ── identity / bookkeeping ──────────────────────────────────────────────
        playerId: "non-park",
        cardInstanceId: "non-park",
        abilityId: "non-park",
        manaCost: "non-park",
        tappedLandIds: "non-park",
        keepPriority: "non-park",
        /** CR 113.6 — where the source lives; a lookup hint, not a decision. */
        fromGraveyard: "non-park",
        fromHand: "non-park",
        /** CR 113.1 — the granting card's def id, for template lookup. */
        grantedSourceCardId: "non-park",
        /** CR 106.10 — a flag read at commit (Jeweled Amulet). */
        noteManaSpent: "non-park",

        // ── choices LOCKED IN at announcement (CR 601.2b/602.2b/700.2c) ────────
        chosenX: "non-park",
        chosenModeId: "non-park",
        targets: "non-park",
        targetAmounts: "non-park",

        // ── costs APPLIED at commit — nobody is waiting on the payer ───────────
        /** CR 602.1 — the source's own {T}. */
        tapSource: "non-park",
        /** CR 602.1 — the source sacrifices ITSELF; no victim to name. */
        sacrificeSource: "non-park",
        /** CR 122.6 — counters removed at commit. */
        removeCounterCost: "non-park",
        /** CR 119.4 — life deducted at commit. */
        lifeCost: "non-park",
        /** Jandor's Ring — the card is determined by the game, not the payer. */
        discardLastDrawnSource: "non-park",
        /** CR 702.29a — Cycling discards THIS card; no pick. */
        discardThisSource: "non-park",
        /** CR 702.29c/f — a marker qualifying `discardThisSource`, read at
         *  commit. Nothing to submit, so nobody is waiting on the payer. */
        cyclingCost: "non-park",
        /** CR 702.49a — a marker qualifying `sacrificeSelection` as a ninjutsu
         *  RETURN leg, read at commit. The pick it needs is the selection's
         *  own, so this flag blocks nothing. */
        returnUnblockedAttacker: "non-park",
        /** CR 702.129a — Eternalize exiles THIS card from the graveyard; no
         *  pick. */
        exileThisSource: "non-park",
        /** CR 118.3 — discarded AT RANDOM (Coral Helm): the PRNG picks, not the
         *  payer. A park would never clear. */
        discardAtRandomCount: "non-park",

        // ── PARKS (CR 602.1 / 118) ─────────────────────────────────────────────
        /** CR 701.21 / 118.5 / 601.2f — filtered sacrifice (own leg + static tax).
         *  Submitted via `selectSacrifice`. */
        sacrificeSelection: "park",
        /** CR 118.5 — "exile N cards from a single graveyard" (Night Soil, Grim
         *  Lavamancer). Submitted via `selectActivationExileCost`. */
        exileFromGraveyardChoice: "park",
        /** CR 118.8 / 702.122a — "tap untapped permanents you control" (Hand of
         *  Justice's fixed N, Crew N). Submitted via `selectActivationCost`. */
        tapOtherChoice: "park",
        /** CR 118.3 — "discard a card matching <filter>" (Survival of the
         *  Fittest). Submitted via `selectActivationDiscardCost`. */
        discardFilterChoice: "park",
        /** CR 601.2g — the ambiguous generic-mana spend. Submitted via
         *  `resolveManaSpendChoice`. LAST in gate order. */
        manaSpendChoice: "park",
    };

function keysClassified<K extends string>(
    census: Record<K, ParkClass>,
    want: ParkClass
): K[] {
    return (Object.keys(census) as K[]).filter((k) => census[k] === want);
}

/** The `PendingCast` keys that BLOCK commit until the payer submits a pick. */
export const PARK_KEYS_CAST: readonly (keyof PendingCast)[] = keysClassified(
    CAST_KEY_CENSUS,
    "park"
);
/** The `PendingCast` keys that never block commit. Partitions with
 *  {@link PARK_KEYS_CAST} by construction (both derive from one census). */
export const NON_PARK_KEYS_CAST: readonly (keyof PendingCast)[] =
    keysClassified(CAST_KEY_CENSUS, "non-park");
/** The `PendingActivation` keys that BLOCK commit until a pick is submitted. */
export const PARK_KEYS_ACTIVATION: readonly (keyof PendingActivation)[] =
    keysClassified(ACTIVATION_KEY_CENSUS, "park");
/** The `PendingActivation` keys that never block commit. */
export const NON_PARK_KEYS_ACTIVATION: readonly (keyof PendingActivation)[] =
    keysClassified(ACTIVATION_KEY_CENSUS, "non-park");

// ────────────────────────────────────────────────────────────────────────────
// The seam
// ────────────────────────────────────────────────────────────────────────────

/** A park, container-qualified. The two containers carry same-NAMED parks that
 *  submit through DIFFERENT mutations (`selectCastExileCost` vs
 *  `selectActivationExileCost`), so the container is part of the identity —
 *  collapsing them is exactly the mix-up this seam exists to prevent. */
export type ParkKind =
    | "cast:sacrificeSelection"
    | "cast:additionalCost"
    | "cast:convokeCreatureChoice"
    | "cast:exileFromGraveyardChoice"
    | "cast:alternativeCostHandChoice"
    | "cast:manaSpendChoice"
    | "activation:sacrificeSelection"
    | "activation:exileFromGraveyardChoice"
    | "activation:tapOtherChoice"
    | "activation:discardFilterChoice"
    | "activation:manaSpendChoice";

/** Every park kind, in CANONICAL GATE ORDER (cast parks first, then activation
 *  parks — the two containers are never both owed by the same player). Exported
 *  so the census guard can assert every classified park key appears here. */
export const PARK_KINDS: readonly ParkKind[] = [
    "cast:sacrificeSelection",
    "cast:additionalCost",
    "cast:convokeCreatureChoice",
    "cast:exileFromGraveyardChoice",
    "cast:alternativeCostHandChoice",
    "cast:manaSpendChoice",
    "activation:sacrificeSelection",
    "activation:exileFromGraveyardChoice",
    "activation:tapOtherChoice",
    "activation:discardFilterChoice",
    "activation:manaSpendChoice",
];

/** The first unsatisfied park on a player's in-progress announcement. */
export type OwedPayment = {
    kind: ParkKind;
    /** Which container the park rides on. */
    container: "cast" | "activation";
    /** The state key it rides on — the census entry this park came from. */
    key: keyof PendingCast | keyof PendingActivation;
    /** The card being cast / the ability's source, for logging and for the
     *  pickers that must exclude it (a spell can't pay its own cost). */
    cardInstanceId: string;
};

export type NextOwedPaymentOptions = {
    /** The mana-spend park (CR 601.2g) is the ONE park the commit gates own
     *  rather than read: they re-derive the ambiguity from the LIVE pool on
     *  every entry, so a parked prompt whose ambiguity has since vanished (the
     *  pool changed, a spend order was supplied) is CLEARED and the commit
     *  proceeds. A gate therefore sets this so the seam does not also report
     *  the stale field the gate is about to overwrite — honouring it would turn
     *  a self-clearing prompt into a permanent block. Every other caller (the
     *  bot) leaves it unset and gets the full census. */
    gateOwnsManaSpend?: boolean;
};

/** A tap-other candidate's live crew contribution (CR 702.122a/b, CR 613.4 — a
 *  crewing creature that has been pumped counts the pumped value). Exported so
 *  `paymentPicks.ts` weighs candidates exactly as the paid-check below does. */
export function tapOtherContribution(
    state: GameState,
    card: CardInstanceState
): TapOtherCandidate {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return {
        id: card.id,
        power: crewPowerContribution(
            getEffectivePower(state, card),
            def?.crewPowerBonus ?? 0
        ),
    };
}

/** True once a tap-other picker's picks fully pay the declared cost
 *  (CR 602.1 / 118.8, CR 702.122a). Recomputed from the LIVE battlefield — the
 *  cost is not locked until it is paid (CR 608.2). A pick that has left the
 *  battlefield stays in the list at power 0, so the fixed-cardinal shape keeps
 *  its `pickedIds.length` semantics; commit re-validates every pick. */
export function isTapOtherPaid(
    state: GameState,
    player: PlayerState,
    toc: NonNullable<PendingActivation["tapOtherChoice"]>
): boolean {
    return isTapOtherSelectionComplete(
        toc,
        toc.pickedIds.map((id) => {
            const perm = player.battlefield.find((c) => c.id === id);
            return perm ? tapOtherContribution(state, perm) : { id, power: 0 };
        })
    );
}

/** The first unsatisfied payment park owed by `playerId`, or `null` when the
 *  announcement is fully paid (or there is none).
 *
 *  **The order is behaviour, not style.** It is the chain of early returns the
 *  two commit gates used to carry inline, preserved exactly:
 *
 *   - CAST: `sacrificeSelection` → `additionalCost` → `convokeCreatureChoice`
 *     → `exileFromGraveyardChoice` → `alternativeCostHandChoice`
 *     → `manaSpendChoice`. Convoke MUST precede the exile park: the convoke
 *     pick pays the coloured/hybrid pips and reduces the generic, so the DELVE
 *     picker is only built after convoke resolves (`recordConvokeCreaturePick`)
 *     — reporting delve first offers a pick that does not exist yet.
 *   - ACTIVATION: `sacrificeSelection` → `exileFromGraveyardChoice`
 *     → `tapOtherChoice` → `discardFilterChoice` → `manaSpendChoice`.
 *
 *  `manaSpendChoice` is last in both: it is only meaningful once mana coverage
 *  is reached, which the gates check before calling in (coverage is not a park
 *  — nobody is waiting on the payer, they just need more mana).
 *
 *  Pure: never mutates `state`. */
export function nextOwedPayment(
    state: GameState,
    playerId: string,
    opts?: NextOwedPaymentOptions
): OwedPayment | null {
    const pc = state.pendingCast;
    if (pc && pc.playerId === playerId) {
        const at = (kind: ParkKind, key: keyof PendingCast): OwedPayment => ({
            kind,
            container: "cast",
            key,
            cardInstanceId: pc.cardInstanceId,
        });
        // CR 601.2f / 701.21a — the card's own filtered sacrifice cost AND any
        // board-wide static additional sacrifice (Drought), one selection.
        if (
            pc.sacrificeSelection &&
            !isSacrificeSelectionComplete(pc.sacrificeSelection)
        ) {
            return at("cast:sacrificeSelection", "sacrificeSelection");
        }
        // CR 118.8 — the exile additional cost (Soul Exchange).
        if (pc.additionalCost && !pc.additionalCost.pickedId) {
            return at("cast:additionalCost", "additionalCost");
        }
        // CR 702.51 — Convoke, BEFORE delve (see the doc comment).
        if (
            pc.convokeCreatureChoice &&
            !pc.convokeCreatureChoice.pickedCreatureIds
        ) {
            return at("cast:convokeCreatureChoice", "convokeCreatureChoice");
        }
        // CR 702.34a / 702.66 — flashback / escape / delve exile cost.
        if (
            pc.exileFromGraveyardChoice &&
            !pc.exileFromGraveyardChoice.pickedCardIds
        ) {
            return at(
                "cast:exileFromGraveyardChoice",
                "exileFromGraveyardChoice"
            );
        }
        // CR 118.9 — the alternative-cost / kicker HAND leg (Force of Will).
        if (
            pc.alternativeCostHandChoice &&
            !pc.alternativeCostHandChoice.pickedCardIds
        ) {
            return at(
                "cast:alternativeCostHandChoice",
                "alternativeCostHandChoice"
            );
        }
        // CR 601.2g — last, and only when the gate is not re-deriving it.
        if (!opts?.gateOwnsManaSpend && pc.manaSpendChoice) {
            return at("cast:manaSpendChoice", "manaSpendChoice");
        }
        return null;
    }

    const pa = state.pendingActivation;
    if (pa && pa.playerId === playerId) {
        const at = (
            kind: ParkKind,
            key: keyof PendingActivation
        ): OwedPayment => ({
            kind,
            container: "activation",
            key,
            cardInstanceId: pa.cardInstanceId,
        });
        // CR 602.1 / 118.5 / 701.21a — filtered sacrifice.
        if (
            pa.sacrificeSelection &&
            !isSacrificeSelectionComplete(pa.sacrificeSelection)
        ) {
            return at("activation:sacrificeSelection", "sacrificeSelection");
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard".
        if (
            pa.exileFromGraveyardChoice &&
            !pa.exileFromGraveyardChoice.pickedCardIds
        ) {
            return at(
                "activation:exileFromGraveyardChoice",
                "exileFromGraveyardChoice"
            );
        }
        // CR 602.1 / 118.8 / 702.122a — tap-other / crew.
        const player = state.players.find((p) => p.id === playerId);
        if (
            pa.tapOtherChoice &&
            player &&
            !isTapOtherPaid(state, player, pa.tapOtherChoice)
        ) {
            return at("activation:tapOtherChoice", "tapOtherChoice");
        }
        // CR 602.1 / 118.3 — "discard a card matching <filter>".
        if (pa.discardFilterChoice && !pa.discardFilterChoice.pickedCardIds) {
            return at("activation:discardFilterChoice", "discardFilterChoice");
        }
        // CR 601.2g — last, and only when the gate is not re-deriving it.
        if (!opts?.gateOwnsManaSpend && pa.manaSpendChoice) {
            return at("activation:manaSpendChoice", "manaSpendChoice");
        }
        return null;
    }

    return null;
}
