// The zone a cast comes from, what it PAYS from there, and the stack flags it
// stamps — the one authority every cast site reads (issue #2971).
//
// These four helpers used to live in `convex/game.ts`, beside the mutations
// that call them. That was fine while the only readers were mutations; it
// stopped being fine the moment the Bot's move enumerator (`gre/moves.ts`)
// needed the same answers, because `game.ts` imports the enumerator — so a
// direct import would be a cycle, and the alternative (a second, parallel
// cost table inside the enumerator) is precisely the divergence every comment
// in here warns about. Moved down into `gre/` unchanged; `game.ts` re-exports
// them, so every existing importer — including a dozen tests that pull them
// from `"../../game"` — is untouched.
//
// Nothing here reads a mutation, a ctx, or the database: it is a pure function
// of `GameState` plus the card, which is what makes the move legal to make.

import { getInstanceManaCost, tryGetDefinition } from "../cards";
import type {
    AdditionalCostSpec,
    AlternativeCost,
    ManaCost,
} from "../cards/types";
import type {
    CardInstanceState,
    CastFromZone,
    GameState,
    PendingCast,
    PlayerState,
} from "./state/declarations";
import type { Zone } from "./types";
import { alternativeCostConditionMet } from "./alternativeCost";
import { getForetellCost, isForetellCast } from "./foretell";
import { getMadnessCost } from "./madness";
import {
    countDistinctCardTypes,
    getEscapeExileSpec,
    hasEscape,
    getEscapeManaCost,
} from "./escape";
import {
    flashbackExileEligibleCount,
    getFlashbackAdditionalCost,
    getFlashbackCost,
    hasFlashback,
} from "./flashback";
import { isExileCostEligible } from "../cards/exileCostEligibility";
import { hasRetrace } from "./retrace";
import { hasJumpStart } from "./jumpStart";
import { isAdventureCastId } from "./adventure";
import { castSubjectView, isFaceChoiceCastId } from "./castMode";
import {
    castableModalBackTwin,
    modalBackCastAltCostId,
    modalBackCastLicensedInZone,
} from "./modalBackCast";
import { isSorceryTimingFor } from "./phases";
import { hasRebound } from "./rebound";
import {
    canCastFromGraveyardByPermission,
    graveyardPlayPermissionCovers,
    libraryTopCastGrant,
    libraryTopCastLifeCost,
    selectGraveyardPlayPermission,
} from "./rules";

// A state type (it rides the stack item as `StackItem.castFromZone`),
// re-exported here for the cast-path modules that already import it from here.
export type { CastFromZone };

/** CR 702.34a / 702.133a — the stack flags of a spell exiled "any time it would
 *  leave the stack": `exileOnResolve` for the resolution branch, and
 *  `exileAnyTimeLeavesStack` for every other departure. */
export const EXILE_ANY_TIME_LEAVES_STACK_FLAGS = {
    exileOnResolve: true,
    exileAnyTimeLeavesStack: true,
} as const;

/** CR 702.34 — the stack-item flag a Flashback cast (from the graveyard) adds:
 *  `exileOnResolve` (so `finalizeSpellResolution` exiles the card instead of
 *  returning it to the graveyard). The provenance itself is the commit site's
 *  `castFromZone` stamp, not a flag of this mechanism. Empty for a normal
 *  hand/exile cast. Exported for the flashback integration test (issue #944
 *  pattern). */
export function flashbackStackFlags(zone: CastFromZone): {
    exileOnResolve?: true;
    exileAnyTimeLeavesStack?: true;
} {
    return zone === "graveyard" ? EXILE_ANY_TIME_LEAVES_STACK_FLAGS : {};
}

/** CR 702.34 / 702.138 / 305.1-analog / 118.9 — the MECHANISM flags a
 *  graveyard cast adds, choosing between Escape, Flashback, and every OTHER
 *  graveyard-cast mechanism by the card's live capability. The provenance
 *  ("cast from a graveyard") is not one of them: every commit site stamps
 *  `castFromZone` itself, for every zone.
 *   - Escape (CR 702.138b): `escaped` — the resulting permanent escaped. NO
 *     `exileOnResolve` (the card resolves normally).
 *   - Flashback (CR 702.34a): `exileOnResolve` — the card is exiled as it
 *     leaves the stack.
 *   - Permission cast (CR 305.1-analog / 601, issue #1149, Yawgmoth's Will)
 *     OR a per-card grant (issue #1344, Malcolm, Alluring Scoundrel):
 *     nothing — the card resolves and lands in the graveyard normally,
 *     exactly like a hand cast, no exile / no `escaped`. Both share this same
 *     fallback branch — a granted card is never also Flashback/Escape in
 *     practice, so no extra disambiguation is needed.
 *  A non-graveyard cast adds nothing. Exported for the escape integration test. */
export function graveyardCastStackFlags(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): {
    exileOnResolve?: true;
    exileAnyTimeLeavesStack?: true;
    escaped?: true;
} {
    if (zone !== "graveyard") return {};
    if (hasEscape(state, card)) {
        return { escaped: true };
    }
    if (hasFlashback(card)) {
        return flashbackStackFlags(zone);
    }
    // CR 614.1 / 400.7 (issue #2380) — a per-card grant may carry an
    // "if that spell would be put into your graveyard, exile it instead"
    // rider (Jace, Telepath Unbound's −3). Checked BEFORE the plain-grant
    // fallback below and routed through the SAME `exileOnResolve` flag
    // Flashback uses, so there is exactly one exile-as-it-leaves-the-stack
    // path rather than a second parallel one.
    if (card.castFromGraveyardExilesOnResolve) {
        return { exileOnResolve: true };
    }
    // CR 702.81a (issue #2358) — a RETRACE cast.
    //
    // THIS BRANCH IS DOCUMENTATION, NOT CONTROL FLOW: it returns exactly the
    // same object as the fallback three lines below, so deleting it changes no
    // behaviour and reds no test (issue #2358 review, finding 3 — the original
    // proof-of-failure claim for it was wrong; only ADDING `exileOnResolve`
    // here reds `retrace.test.ts`). It is kept deliberately, because the
    // ABSENCE of `exileOnResolve` is the mechanic's headline divergence from
    // Flashback and is worth stating where the choice between mechanisms is
    // made: CR 702.81a says nothing about exiling, so a retraced instant or
    // sorcery finishes resolving and is put into its owner's graveyard
    // (CR 608.2m) — which is exactly what makes it retraceable again, bounded
    // only by the lands left in hand to discard. `escaped` is likewise absent:
    // retrace is an ADDITIONAL cost, not the escape alternative cost, so
    // nothing escaped. The behaviour itself IS asserted, on the fallback's
    // output, by `retrace.test.ts`'s `graveyardCastStackFlags` and end-to-end
    // resolve cases.
    if (hasRetrace(state, card)) {
        return {};
    }
    // CR 305.1-analog / 601 (issue #1149) / 118.9 (issue #1344) —
    // neither Escape nor Flashback: this is a plain cast under the BROAD
    // graveyard-cast permission (Yawgmoth's Will) or a per-card grant
    // (Malcolm). No exile-on-resolve, no `escaped` — the card resolves and
    // lands in the graveyard exactly like any other spell (CR 608.2m).
    return {};
}

/** CR 702.88a — the stack-item flag a Rebound cast adds: `reboundFromHand`,
 *  read by `finalizeSpellResolution` (state.ts) to redirect the resolving
 *  spell to exile (instead of the graveyard) and schedule its next-upkeep
 *  reflexive Cast/Decline trigger. Gated on BOTH the card having rebound AND
 *  the cast originating from HAND — this single gate is what makes CR
 *  702.88a free: the later exile recast has `zone === "exile"`, so it never
 *  re-stamps the flag and can never rebound again. Empty for every other
 *  cast (a card with no rebound, or a rebound card recast from exile/
 *  graveyard). Exported for symmetry with `flashbackStackFlags` / a future
 *  integration test. */
export function reboundCastStackFlags(
    card: CardInstanceState,
    zone: CastFromZone
): { reboundFromHand?: true } {
    return zone === "hand" && hasRebound(card) ? { reboundFromHand: true } : {};
}

/** CR 118.9-analog / 119.4 / 107.3b (issue #2398, Bolas's Citadel) — the
 *  payment a cast owes INSTEAD of its mana cost when it comes off the top of
 *  the caster's library under a permission that replaces the mana cost.
 *  `undefined` for every other cast (including a library-top cast under a
 *  permission with no replacement — Vizier of the Menagerie's shape — which
 *  simply pays the printed cost).
 *
 *  The caster is the library's OWNER: `zone === "library"` is only ever
 *  produced by `locateCastSource`'s own-library branch, and no cross-player
 *  library-cast primitive exists (mirroring `castZoneOwner`'s reasoning for
 *  the graveyard).
 *
 *  One helper feeds BOTH halves of the substitution — `castRawManaCost` zeroes
 *  the mana, and each of the two cast-commit life accumulators (the targeted
 *  `finalizeTargetSelection` path and the no-target `announceCast` path) adds
 *  `.life` — so the two can never disagree about whether this cast is free.
 *  It is ALSO the CR 107.3b / 601.2b discriminator at announcement: an `{X}`
 *  is locked to 0 and no alternative cost may ride along on this cast. */
export function libraryTopCastPayment(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone,
    /** CR 709.3b (issue #3344) — the announced cast option. Bolas's Citadel
     *  charges "life equal to its mana value", and "it" is the SPELL, which
     *  once a split half is announced is that half (CR 709.4b's Assault
     *  example: "the resulting spell is a red spell with a mana value of 1").
     *  Absent means the printed card. */
    alternativeCostId?: string,
    /** CR 601.2b / 118.9 (issue #7525) — the announced permission choice
     *  off the top of the library: `true` casts under a grant that KEEPS the
     *  mana cost (Mystic Forge beside Bolas's Citadel). Absent picks the
     *  replacing grant when one covers the cast. */
    declineManaCostReplacement?: boolean
): { life: number } | undefined {
    if (zone !== "library") return undefined;
    const owner = state.players.find((p) => p.id === card.ownerId);
    if (!owner) return undefined;
    const grant = libraryTopCastGrant(
        state,
        owner,
        card,
        alternativeCostId,
        declineManaCostReplacement
    );
    if (grant?.manaCostReplacement !== "life-equal-to-mana-value") {
        return undefined;
    }
    return {
        life: libraryTopCastLifeCost(
            state,
            owner,
            card,
            alternativeCostId,
            declineManaCostReplacement
        ),
    };
}

/** Whether a cast of `card` from exile by the priority holder is made under a
 *  route that pays no mana at all (CR 118.9). */
function exileCastPricedFree(
    state: GameState,
    card: CardInstanceState,
    declineManaCostReplacement?: boolean
): boolean {
    const route = exileCastRoute(
        state,
        card,
        state.priorityPlayerId,
        declineManaCostReplacement
    );
    return route !== undefined && exileRoutePrice(card, route) === "free";
}

/** CR 118.9 — the cast from exile pays the alternative cost its grant states,
 *  so an Adventure's own cost is no price here either: only one alternative
 *  cost applies to a spell (CR 118.9a), and that is the grant's. */
function exileCastPricedByGrant(
    state: GameState,
    card: CardInstanceState,
    declineManaCostReplacement?: boolean
): boolean {
    return (
        card.castFromExileAlternativeCost !== undefined &&
        exileCastRoute(
            state,
            card,
            state.priorityPlayerId,
            declineManaCostReplacement
        ) === "grant"
    );
}

/** CR 709.3 (issue #3344) — the alternative cost a cast ACTUALLY pays once the
 *  zone it comes from is known.
 *
 *  Identity for every announcement but one: a FACE CHOICE — a split half, or
 *  a modal double-faced card's back face (CR 712.11b, `isFaceChoiceCastId`) —
 *  cast from outside the hand. That announcement rides the CR 601.2b alternative-cost channel (it is
 *  how "which half" is said at all, `gre/splitCast.ts`) but it is NOT an
 *  alternative cost in the CR 118.9 sense — the half's printed cost is a price
 *  only when the permission licensing the cast says the spell pays its mana
 *  cost. From a graveyard under Underworld Breach the cast pays the ESCAPE
 *  cost; off a Bolas's Citadel it pays life and no mana at all. Both live in
 *  `castRawManaCost`, so the fix is to let it, not this channel, name the
 *  mana — otherwise the caster pays the half's printed cost on top of, or
 *  instead of, what the permission demands.
 *
 *  The Adventure joins them only under a permission that replaces the mana cost
 *  (issue #7570, `ridesManaCostReplacement`): its `{1}{U}` would otherwise be
 *  charged on top of the life. In every other zone it keeps its own cost, which
 *  CR 715.3a makes the only one evaluated.
 *
 *  Applied at the ONE place both commit paths resolve the announced option
 *  (`resolveCastAlternativeCost`'s two call sites in `convex/game.ts`), so the
 *  legality gate, the payment and the park cannot disagree. */
export function castAlternativeCostForZone(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone,
    alternativeCostId: string | undefined,
    resolved: AlternativeCost | undefined,
    /** CR 601.2b / 118.9 (issue #7525) — the announced permission choice
     *  off the top of the library: `true` casts under a grant that KEEPS the
     *  mana cost (Mystic Forge beside Bolas's Citadel). Absent picks the
     *  replacing grant when one covers the cast. */
    declineManaCostReplacement?: boolean
): AlternativeCost | undefined {
    if (!resolved || zone === "hand") return resolved;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    const zonePriced =
        isFaceChoiceCastId(def ?? undefined, alternativeCostId) ||
        (isAdventureCastId(def ?? undefined, alternativeCostId) &&
            libraryTopCastPayment(
                state,
                card,
                zone,
                alternativeCostId,
                declineManaCostReplacement
            ) !== undefined) ||
        // CR 702.170d / 118.9 — the Adventure rides a free cast from exile the
        // way it rides a library-top replacement: "Effects that allow you to
        // cast a spell … without paying its mana cost may allow you to apply
        // those to the Adventure" (Gatherer ruling, 2019-10-04).
        (isAdventureCastId(def ?? undefined, alternativeCostId) &&
            zone === "exile" &&
            (exileCastPricedFree(state, card, declineManaCostReplacement) ||
                exileCastPricedByGrant(
                    state,
                    card,
                    declineManaCostReplacement
                )));
    if (!zonePriced) return resolved;
    const mana = castRawManaCost(
        state,
        card,
        zone,
        alternativeCostId,
        declineManaCostReplacement
    );
    // The `mana` key is DROPPED, never zeroed, when the zone's cost has no
    // mana portion (CR 702.34a — Lava Dart's flashback is a sacrifice and
    // nothing else): every downstream reader spells that `alt.mana ?? {}`, and
    // an inherited printed cost left standing here would be charged twice.
    const rest: AlternativeCost = { ...resolved };
    delete rest.mana;
    return mana ? { ...rest, mana } : rest;
}

/** The mana cost a cast pays: the Escape cost or Flashback cost when cast from
 *  the graveyard (CR 702.138a / 702.34a — "rather than paying its mana cost"),
 *  the card's normal printed mana cost under the BROAD graveyard-cast
 *  permission (CR 305.1-analog / 601, issue #1149 — Yawgmoth's Will pays no
 *  alternative cost, just the printed one), else the card's printed mana cost
 *  for a hand/exile cast. Exported for the flashback/escape integration tests
 *  (issue #944 pattern).
 *
 *  CR 709.3 (issue #3344) — WHICH object's printed cost that is, once a SPLIT
 *  half has been announced, is the one reading this function has to take, and
 *  it is not the same answer for every branch:
 *
 *   * a permission that has the cast pay "its mana cost" (Yawgmoth's Will,
 *     Hogaak's intrinsic grant, Lurrus, retrace — CR 702.81a adds a discard
 *     ALONGSIDE the mana cost rather than replacing it — and an unreplaced
 *     library-top cast) is talking about the SPELL. CR 709.3a: "only the
 *     chosen half is … put onto the stack"; CR 709.3b: "while on the stack,
 *     only the characteristics of the half being cast exist". CR 709.4b's own
 *     example settles it — "If you cast Assault, the resulting spell is a red
 *     spell with a mana value of 1." So those branches price the announced
 *     HALF, through `castSubjectView`.
 *   * a cost an ability STATES about the card — escape (CR 702.138a),
 *     flashback (CR 702.34a), madness (CR 702.35a) — is stated by an ability
 *     that functions in the zone the card is IN, and CR 709.4 makes the
 *     characteristics there "those of its two halves combined". A granted
 *     escape "equal to that card's mana cost" (Underworld Breach) therefore
 *     reads the COMBINED cost, so those branches stay blind to the
 *     announcement. */
export function castRawManaCost(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone,
    /** CR 709.3 (issue #3344) — the cast option being announced, so a SPLIT
     *  half is priced as the half rather than as the CR 709.4b summed card.
     *  Only the branches that pay "the card's mana cost" read it (see
     *  {@link castCostSubject}); the branches that pay a cost some ability
     *  STATES about the card in its zone — escape, flashback, madness — are
     *  deliberately blind to it.
     *
     *  Absent (the overwhelming default) means "the printed card", and every
     *  existing caller is unchanged by construction. */
    alternativeCostId?: string,
    /** CR 601.2b / 118.9 (issue #7525) — the announced permission choice
     *  off the top of the library: `true` casts under a grant that KEEPS the
     *  mana cost (Mystic Forge beside Bolas's Citadel). Absent picks the
     *  replacing grant when one covers the cast. */
    declineManaCostReplacement?: boolean
): ManaCost | undefined {
    if (zone === "exile") {
        // CR 601.3 / 601.2b — the permission this cast is made under decides
        // what it pays. The caster is the priority holder: a cast begins with
        // priority (CR 117.1a), and this signature names no caster.
        const route = exileCastRoute(
            state,
            card,
            state.priorityPlayerId,
            declineManaCostReplacement
        );
        // CR 702.170d / 118.9 — "without paying its mana cost", an alternative
        // cost: additional costs and cost increases still apply.
        if (route === "plot") return {};
        // CR 702.143a — "by paying any foretell cost it has rather than paying
        // that spell's mana cost" (an alternative cost, CR 601.2b / 601.2f–h).
        if (route === "foretell") return getForetellCost(card);
        // CR 702.185a — a warped card's recast is an ordinary cast for its
        // printed mana cost: no waiver or madness cost on a grant applies.
        if (route !== "warp") {
            // CR 601.3 / 118.9 (issue #1156) — Dauthi Voidwalker's "play it
            // without paying its mana cost" free-cast waiver: this specific
            // exile-sourced card was granted a cost-free cast
            // (`SpellContext.grantCastFromExile`'s `withoutPayingManaCost`
            // option).
            if (card.castFromExileWithoutPayingManaCost) return {};
            // CR 118.9 — a grant that states its price ("by paying {2} rather
            // than paying its mana cost", CR 701.65a).
            if (card.castFromExileAlternativeCost) {
                return card.castFromExileAlternativeCost;
            }
            // CR 702.35a — a card discarded via Madness is cast from exile for
            // its madness cost, not its printed mana cost. `Madness {0}` is
            // the empty cost.
            if (card.madnessExiled) return getMadnessCost(card) ?? {};
            // No open permission: what the designation would charge, for a
            // price asked outside any window.
            if (route === undefined && isForetellCast(card)) {
                return getForetellCost(card);
            }
        }
    }
    // CR 118.9-analog / 119.4 (issue #2398, Bolas's Citadel) — a cast made
    // under a cast-from-top-of-library permission whose `manaCostReplacement`
    // is `"life-equal-to-mana-value"` pays NO mana at all: the whole mana cost
    // is replaced by a life payment charged at commit
    // (`castLifeInsteadOfMana`, deducted alongside every other life leg).
    // Returning `{}` here — not `undefined` — is what makes the mana half free
    // at every cost site (`normalizeManaCost`, the pool-coverage gate, the
    // auto-tap solver) without any of them learning about the permission.
    //
    // Per ANNOUNCEMENT (issue #7205): a filtered grant may cover a split half
    // the whole card does not, so the half names the grant (CR 601.3e).
    if (
        libraryTopCastPayment(
            state,
            card,
            zone,
            alternativeCostId,
            declineManaCostReplacement
        )
    ) {
        return {};
    }
    if (zone !== "graveyard") {
        return getInstanceManaCost(castSubjectView(card, alternativeCostId));
    }
    // CR 601.3 / 118.9 (issue #1344) — Malcolm, Alluring Scoundrel's
    // "cast the discarded card without paying its mana cost" free-cast
    // waiver: this specific graveyard-sourced card was granted a cost-free
    // cast (`SpellContext.grantCastFromGraveyard`'s `withoutPayingManaCost`
    // option). Checked BEFORE Escape/Flashback/the broad permission below —
    // the free-cast waiver wins if a card somehow carried more than one
    // marker, since "no cost is required" is stronger than any specific
    // alternative cost (mirrors the exile branch's own precedence above).
    if (card.castFromGraveyardWithoutPayingManaCost) {
        return {};
    }
    // CR 702.138a — an escape cast pays the escape mana cost; a card never has
    // both escape and flashback, so this preference is unambiguous.
    if (hasEscape(state, card)) return getEscapeManaCost(state, card);
    // CR 702.34a — a Flashback cast pays the flashback mana cost, which may be
    // ABSENT for a purely non-mana flashback (Lava Dart: "Sacrifice a
    // Mountain", no mana portion) — `undefined` here correctly means "no mana
    // to pay", NOT "fall back to the printed cost".
    if (hasFlashback(card)) return getFlashbackCost(card);
    // CR 305.1-analog / 601 (issue #1149) — neither Escape nor Flashback: a
    // plain cast under the BROAD graveyard-cast permission (Yawgmoth's Will),
    // the intrinsic "you may cast this from your graveyard" (Hogaak), Lurrus's
    // once-per-turn permission or a RETRACE cast (CR 702.81a adds a discard
    // ALONGSIDE the mana cost, it does not replace it) pays the card's normal
    // printed mana cost — which, for an announced split half, is the HALF's
    // (CR 709.3a).
    return getInstanceManaCost(castSubjectView(card, alternativeCostId));
}

/** The permission a card's own exile designation derives. */
export type DesignationExileCastRoute = "plot" | "foretell" | "warp";
/** The permission a cast from exile is made under: a designation, or the
 *  `castableFromExile*` grant record. */
export type ExileCastRoute = DesignationExileCastRoute | "grant";
/** What a route pays: nothing, a cost it states, or the printed mana cost. */
export type ExileCastRoutePrice = "free" | "alternative" | "printed";

// ---------------------------------------------------------------------------
// Which mechanism licenses a cast from a NON-hand zone, and whether the Bot's
// search sandboxes can model it (issue #2971)
// ---------------------------------------------------------------------------

/** The graveyard-cast mechanisms this engine ships. Named as a closed union so
 *  a new one cannot be added without every consumer here going red — the same
 *  discipline `PARK_VARIANT_K` (`gre/parkKinds.ts`) imposes on cast parks. */
export type GraveyardCastMechanism =
    | "escape"
    | "flashback"
    | "retrace"
    | "jump-start"
    | "grant"
    | "intrinsic"
    | "permission";

/** CR 601.3 — which mechanism, if any, lets `caster` cast `card` out of
 *  `player`'s graveyard right now, or `undefined` when none does.
 *
 *  This is the CANDIDATE-SET question, deliberately separate from the legality
 *  question `getLegalActions` answers: that function's final "cast is for all
 *  non-land cards" fallback is zone-BLIND, so handing it an arbitrary graveyard
 *  card reports "cast" for a spell `locateCastSource` would then refuse to
 *  locate. Every caller gates on THIS first and on `getLegalActions` second —
 *  the same fail-closed order the retrace and library-top loops already use.
 *
 *  Precedence mirrors `castRawManaCost` and `graveyardCastStackFlags` above,
 *  because a mechanism decides both what the cast PAYS and what it STAMPS: a
 *  disagreement between the three would be exactly the class of bug that keeps
 *  the cost and the flags in one file. */
export function graveyardCastMechanism(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    casterId: string
): GraveyardCastMechanism | undefined {
    if (!player.graveyard.some((c) => c.id === card.id)) return undefined;
    return graveyardCastMechanismForMember(state, player, card, casterId);
}

/** `graveyardCastMechanism` for a card the caller has ALREADY established is in
 *  `player.graveyard` — the whole body, minus the membership scan.
 *
 *  Split out for a caller that is itself iterating the graveyard, where that
 *  scan makes the loop O(n²): the leaf evaluator's graveyard-reach term
 *  (`gre/ai/graveyardReach.ts`) runs per ISMCTS leaf, once per graveyard card,
 *  per player. It is a SPLIT, never a second copy — the checked entry point
 *  above delegates here, so there is exactly one implementation of the
 *  precedence and no way for the two to drift. Do NOT call this with a card
 *  whose zone you have not established; that is what the public one is for. */
export function graveyardCastMechanismForMember(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    casterId: string
): GraveyardCastMechanism | undefined {
    // CR 702.138 — escape wins over everything: a card never has both escape
    // and flashback, and `castRawManaCost` checks it first.
    if (hasEscape(state, card)) return "escape";
    // CR 702.34 — flashback.
    if (hasFlashback(card)) return "flashback";
    // CR 702.81 — retrace (its own enumeration loop; listed for completeness).
    if (hasRetrace(state, card)) return "retrace";
    if (card.types.includes("Land")) return undefined;
    // CR 601.3 (issue #1344) — the per-card grant (Malcolm, Emry), which may
    // also waive the mana cost.
    if (card.castableFromGraveyardBy === casterId) return "grant";
    const intrinsic = tryGetDefinition(
        (card.card as { id?: string }).id ?? ""
    )?.castableFromOwnGraveyard;
    // CR 702.51 (issue #1338, Hogaak) — the card's own intrinsic permission.
    if (intrinsic === true) return "intrinsic";
    // CR 601.3 (ADR 0093, issue #2244) — a graveyard play permission, whatever
    // its source (Yawgmoth's Will's turn-scoped grant, Lurrus's once-per-turn
    // static): the single resolver has already applied every gate it carries.
    if (canCastFromGraveyardByPermission(state, player, card)) {
        return "permission";
    }
    // CR 118.9b — the intrinsic permission SCOPED to one alternative
    // cost (Detective's Phoenix: "using its bestow ability"). Asked AFTER the
    // broad permission on purpose: a cast Yawgmoth's Will also licenses may pay
    // the printed cost, so it is that permission's cast, not this one's — and
    // `requiredGraveyardAlternativeCostId` only binds a cast this branch names.
    if (intrinsic) return "intrinsic";
    // CR 702.133a — jump-start, last: it adds a discard, so every permission
    // above is cheaper, the order `locateCastSource` claims them in.
    if (hasJumpStart(card)) return "jump-start";
    return undefined;
}

/** CR 712.11c — whether each graveyard-cast mechanism reaches a modal
 *  double-faced card's BACK face: "only the face that will be face up on the
 *  stack is evaluated to determine if it can be cast." A `Record`, so a new
 *  mechanism cannot ship without deciding.
 *
 *  A GENERIC permission names the card and no characteristic of it — the
 *  per-card grant (Malcolm), a graveyard play permission (Yawgmoth's Will) —
 *  so the back face, evaluated alone, is still covered. Escape, flashback,
 *  retrace and the intrinsic "you may cast this card from your graveyard" are
 *  abilities of the FRONT face: the back face does not have them (CR 712.8a
 *  — in the graveyard the card has only its front face's characteristics), so
 *  they license the front face only. */
const GRAVEYARD_LICENCE_REACHES_BACK_FACE: Record<
    GraveyardCastMechanism,
    boolean
> = {
    escape: false,
    flashback: false,
    retrace: false,
    "jump-start": false,
    intrinsic: false,
    grant: true,
    permission: true,
};

/** CR 712.11b / 712.11c — whether the licence for casting `card` out of
 *  `zone` reaches its BACK face, the one authority the legality gate
 *  (`gre/rules.ts`), the Bot's enumerator (`gre/moves.ts`), the client picker
 *  (`affordableAlternativeCosts`) and `announceCast` ask, so no surface offers
 *  a back-face cast the mutation refuses. `false` for a card with no castable
 *  back face.
 *
 *  Off the graveyard the mechanism decides
 *  ({@link GRAVEYARD_LICENCE_REACHES_BACK_FACE}, in `graveyardCastMechanism`'s
 *  precedence). A graveyard play permission must also cover the back face
 *  ITSELF: its card-type and mana-value axes are asked of the face being cast
 *  (CR 712.11c), and of the permission the commit will spend — the one
 *  `selectGraveyardPlayPermission` picks for the card — so a once-per-turn
 *  "mana value 2 or less" permission covering a two-mana front face never
 *  lends itself to a four-mana back. Every other zone is read off the card
 *  ({@link modalBackCastLicensedInZone}). */
export function modalBackCastLicensed(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    /** The zone the cast comes from; any other zone licenses nothing. */
    zone: Zone,
    casterId: string
): boolean {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    if (!castableModalBackTwin(def ?? undefined)) return false;
    if (zone !== "graveyard") {
        return modalBackCastLicensedInZone({ ...card, zone });
    }
    const mechanism = graveyardCastMechanism(state, player, card, casterId);
    if (mechanism === undefined) return false;
    if (!GRAVEYARD_LICENCE_REACHES_BACK_FACE[mechanism]) return false;
    if (mechanism !== "permission") return true;
    const permission = selectGraveyardPlayPermission(
        state,
        player,
        "cast",
        card
    );
    return (
        permission !== undefined &&
        graveyardPlayPermissionCovers(
            permission,
            "cast",
            castSubjectView(card, modalBackCastAltCostId(def!))
        )
    );
}

/** The fields {@link exileCastPermission} reads. */
type ExileCastWindowFields = Pick<
    CardInstanceState,
    | "castableFromExileBy"
    | "castableFromExileFromTurn"
    | "ownerId"
    | "plottedOnTurn"
    | "foretoldOnTurn"
    | "warpExiledOnTurn"
>;

/** The fields {@link exileCastPermitted} reads: the window, plus the grant's
 *  board condition. */
type ExileCastFields = ExileCastWindowFields &
    Pick<CardInstanceState, "castableFromExileCondition">;

/** The permissions a card's own designation derives, each on the turn after the
 *  designation: CR 702.170d (plotted, "any turn after the turn in which it
 *  became plotted"), CR 702.143a (foretold, "after the current turn has ended")
 *  and CR 702.185a (warped, likewise). Each names the card's OWNER and none is
 *  written into the `castableFromExile*` record, so a grant on that record
 *  stands beside them untouched. */
function designationPermissions(
    card: Pick<
        CardInstanceState,
        "ownerId" | "plottedOnTurn" | "foretoldOnTurn" | "warpExiledOnTurn"
    >,
    casterId: string
): { route: DesignationExileCastRoute; opensOn: number }[] {
    if (card.ownerId !== casterId) return [];
    const out: { route: DesignationExileCastRoute; opensOn: number }[] = [];
    if (card.plottedOnTurn !== undefined) {
        out.push({ route: "plot", opensOn: card.plottedOnTurn + 1 });
    }
    if (card.foretoldOnTurn !== undefined) {
        out.push({ route: "foretell", opensOn: card.foretoldOnTurn + 1 });
    }
    if (card.warpExiledOnTurn !== undefined) {
        out.push({ route: "warp", opensOn: card.warpExiledOnTurn + 1 });
    }
    return out;
}

/** The grant half of {@link exileCastPermission}: the `castableFromExile*`
 *  record alone, read against its lower bound. */
function exileGrantOpen(
    card: Pick<
        CardInstanceState,
        "castableFromExileBy" | "castableFromExileFromTurn"
    >,
    casterId: string,
    turn: number
): boolean {
    if (card.castableFromExileBy !== casterId) return false;
    return (
        card.castableFromExileFromTurn === undefined ||
        turn >= card.castableFromExileFromTurn
    );
}

/** Whether `casterId` holds ANY cast-from-exile permission on `card`, open or
 *  not: the grant, or a designated card's owner. What decides that the viewer
 *  gets a Cast button at all, enabled or not. */
export function holdsExileCastPermission(
    card: Pick<
        Partial<CardInstanceState>,
        | "castableFromExileBy"
        | "ownerId"
        | "plottedOnTurn"
        | "foretoldOnTurn"
        | "warpExiledOnTurn"
    >,
    casterId: string
): boolean {
    return (
        card.castableFromExileBy === casterId ||
        (card.ownerId === casterId &&
            (card.plottedOnTurn !== undefined ||
                card.foretoldOnTurn !== undefined ||
                card.warpExiledOnTurn !== undefined))
    );
}

/** CR 118.9b — "An effect that allows you to cast a spell may
 *  require a certain alternative cost to be paid." The alternative-cost id a
 *  cast of `card` out of `player`'s graveyard MUST announce, or `undefined`
 *  when it may announce any (or none).
 *
 *  Non-`undefined` only when the mechanism licensing the cast is the card's
 *  own SCOPED intrinsic permission (`castableFromOwnGraveyard:
 *  { requiredAlternativeCost }` — Detective's Phoenix's "You may cast this
 *  card from your graveyard using its bestow ability"): every other mechanism
 *  ({@link graveyardCastMechanismForMember} asks them first) lets the printed
 *  cost be paid. The ONE predicate the legality gate, `announceCast`, the Bot's
 *  enumeration and the client picker read, so none of them offers a cast the
 *  mutation refuses. */
export function requiredGraveyardAlternativeCostId(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    casterId: string = player.id
): string | undefined {
    if (graveyardCastMechanism(state, player, card, casterId) !== "intrinsic") {
        return undefined;
    }
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    const scope = def?.castableFromOwnGraveyard;
    if (typeof scope !== "object") return undefined;
    switch (scope.requiredAlternativeCost) {
        // CR 702.103a — the card's own Bestow cost. A card declaring the
        // scope without a `bestow` field is unannounceable (fail CLOSED): the
        // sentinel names no cost `getAlternativeCost` resolves.
        case "bestow":
            return def?.bestow?.id ?? REQUIRED_ALT_COST_MISSING;
    }
}

/** CR 118.9b — refuse a cast out of the graveyard that does not
 *  announce the alternative cost its licensing permission requires
 *  ({@link requiredGraveyardAlternativeCostId}). A no-op for every other zone
 *  and every unscoped mechanism. Called by `announceCast` and again by
 *  `finalizeTargetSelection`, the targeted commit. */
export function assertGraveyardCastAnnouncementLicensed(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    zone: CastFromZone,
    alternativeCostId: string | undefined
): void {
    if (zone !== "graveyard") return;
    const required = requiredGraveyardAlternativeCostId(state, player, card);
    if (required === undefined || alternativeCostId === required) return;
    const name =
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.name ??
        "This card";
    throw new Error(
        `${name} can be cast from your graveyard only for its ${required} cost`
    );
}

/** The id {@link requiredGraveyardAlternativeCostId} answers for a scope
 *  naming a cost the card does not have — matches no announcement. */
const REQUIRED_ALT_COST_MISSING = "required-alternative-cost-missing";

/** CR 601.3 — whether `casterId` currently holds a permission to cast `card`
 *  out of `zoneOwner`'s EXILE. Two shapes, both riding the card object:
 *  the open-ended / turn-scoped grant (`castableFromExileBy` — Ice Cauldron,
 *  the impulse windows, Robber of the Rich, Dauthi Voidwalker's free cast,
 *  Elite Spellbinder's taxed grant) and a madness cast (CR 702.35a), which is
 *  the same field plus the `madnessExiled` marker.
 *
 *  A grant can also be stamped but not yet OPEN: that is the LOWER bound
 *  `castableFromExileFromTurn`, and this is the ONE authority that reads it.
 *  Route every consumer through here — `getLegalActions`' land leg
 *  (`gre/rules.ts`), the real payment path (`findCastableExileCard`,
 *  `convex/game.ts`), the exile projection the client's Cast button gates on
 *  (`gameProjections.ts`), the land play (`gre/playLand.ts`) and the Bot's
 *  non-hand cast enumeration (`gre/moves.ts`) — so a window that is closed for
 *  the affordance can never be open for the payment.
 *
 *  The grant may be CROSS-PLAYER (CR 400.7): the card sits in its OWNER's exile
 *  while a different player holds the permission, which is why `zoneOwner` and
 *  `casterId` are separate parameters — the same split `getLegalActions`'
 *  `casterId` and `castZoneOwner` (`convex/gre/activation.ts`) already carry.
 *
 *  A LAND in exile under such a grant is deliberately included in neither
 *  answer here nor excluded: a land is PLAYED, never cast (CR 305.9), and the
 *  caller filters on type — the land half has its own enumeration
 *  (`resolvePlayLandSourceZone`).
 *
 *  CR 702.170d / 702.143a / 702.185a — the permission a card's designation
 *  carries is a THIRD shape, derived from that designation
 *  ({@link designationPermissions}) rather than stamped on the grant record, so
 *  it and a grant coexist: either one licenses the cast. */
export function exileCastPermission(
    /** Narrowed to the fields this authority reads so the CLIENT can ask it
     *  directly about a projected `SlimExileCard` (ADR 0074 — the frontend
     *  imports pure engine modules, it just never has authority): the Cast
     *  button's disabled REASON has to come from the same comparison the
     *  projection gated on, or the two drift and the button lies again. */
    card: ExileCastWindowFields,
    casterId: string,
    /** CR 702.185a (issue #1268) — the CURRENT turn number, against which the
     *  grant's LOWER bound (`castableFromExileFromTurn`) is read. A grant made
     *  with that rider exists but has not OPENED yet: Warp's "its owner may
     *  cast this card AFTER THE CURRENT TURN HAS ENDED" leaves the card exiled
     *  and permission-stamped during the turn it was warped out, and castable
     *  only from the next one. Required rather than optional on purpose — every
     *  consumer already has `state` in hand, and a defaulted parameter is how
     *  one of them would silently keep the old, fail-OPEN answer. */
    turn: number
): boolean {
    return (
        designationPermissions(card, casterId).some(
            (permission) => turn >= permission.opensOn
        ) || exileGrantOpen(card, casterId, turn)
    );
}

/** The grant half of {@link exileCastPermitted}, designations excluded: the
 *  record's window and its board condition. Asked directly by the land play
 *  (CR 116.2a — a plotted card's permission is to CAST, and a land is played,
 *  so only a grant can license it) and by the route decision below. */
export function exileGrantPermitted(
    state: GameState,
    card: Pick<
        CardInstanceState,
        | "castableFromExileBy"
        | "castableFromExileFromTurn"
        | "castableFromExileCondition"
    >,
    casterId: string
): boolean {
    if (!exileGrantOpen(card, casterId, state.turn)) return false;
    return alternativeCostConditionMet(
        state,
        casterId,
        card.castableFromExileCondition
    );
}

/** The designations whose permission `casterId` holds open on `card` now. */
function openDesignationRoutes(
    state: GameState,
    card: ExileCastWindowFields,
    casterId: string
): DesignationExileCastRoute[] {
    return designationPermissions(card, casterId)
        .filter((permission) => state.turn >= permission.opensOn)
        .map((permission) => permission.route);
}

/** CR 702.170d — true iff the plotted permission is the ONLY one licensing
 *  `casterId`'s cast of `card`, whose timing then binds: "during their main
 *  phase while the stack is empty", before any instant speed or flash the card
 *  itself has. Beside another open permission the cast may use that one's
 *  timing. */
export function exileCastOnlyUnderPlotPermission(
    state: GameState,
    card: ExileCastFields,
    casterId: string
): boolean {
    const open = openDesignationRoutes(state, card, casterId);
    return (
        open.length === 1 &&
        open[0] === "plot" &&
        !exileGrantPermitted(state, card, casterId)
    );
}

/** What a cast under `route` pays, rather than its mana cost. Ranks the routes
 *  and labels the picker row: `free` is CR 118.9's "without paying its mana
 *  cost", and the madness cost is the grant's only when `madnessExiled` says
 *  so. */
export function exileRoutePrice(
    card: Pick<
        CardInstanceState,
        | "castFromExileWithoutPayingManaCost"
        | "castFromExileAlternativeCost"
        | "madnessExiled"
    >,
    route: ExileCastRoute
): ExileCastRoutePrice {
    if (route === "plot") return "free";
    if (route === "foretell") return "alternative";
    if (route === "warp") return "printed";
    if (card.castFromExileWithoutPayingManaCost === true) return "free";
    if (card.castFromExileAlternativeCost !== undefined) return "alternative";
    return card.madnessExiled === true ? "alternative" : "printed";
}

const EXILE_ROUTE_PRICE_RANK: Record<ExileCastRoutePrice, number> = {
    free: 0,
    alternative: 1,
    printed: 2,
};

/** CR 601.3 / 601.2b — the permissions `casterId` may announce a cast of `card`
 *  under right now, as the routes a caster can tell apart: any one effect that
 *  allows the cast suffices (CR 601.3), and which alternative cost the spell
 *  pays is announced (CR 601.2b).
 *
 *  `[]` = none open. Otherwise the first entry is what an announcement with no
 *  `declineManaCostReplacement` takes: the cheaper route, the designation on a
 *  tie. A second entry exists only where the two prices differ, and
 *  `declineManaCostReplacement` names it: an {X} spell under a free permission
 *  must announce X = 0 (CR 107.3b), so the dearer route is a real choice. Two
 *  routes at one price are no choice; a grant carrying fixing and no tax wins
 *  that tie, since the designation offers nothing it does not.
 *
 *  A plotted card's route exists beside another permission only inside its own
 *  window ("during their main phase while the stack is empty"). A cast already
 *  announced under the second route (`castDeclinedExileRoute`) keeps it, so the
 *  tax, the fixing and the price read one answer from announcement to commit.
 *
 *  The route decision the price, the legality gate, the Bot's enumerator, the
 *  wire and the grant's riders all read. */
export function exileCastRoutes(
    state: GameState,
    card: ExileCastFields &
        Pick<
            CardInstanceState,
            | "castFromExileWithoutPayingManaCost"
            | "castFromExileAlternativeCost"
            | "madnessExiled"
            | "castFromExileManaSubstitution"
            | "castFromExileCostIncrease"
            | "castDeclinedExileRoute"
        >,
    casterId: string
): ExileCastRoute[] {
    const open = openDesignationRoutes(state, card, casterId);
    const grantOpen = exileGrantPermitted(state, card, casterId);
    const others = open.filter((route) => route !== "plot");
    const plotBinds =
        open.includes("plot") &&
        ((others.length === 0 && !grantOpen) ||
            isSorceryTimingFor(state, casterId));
    const designation = plotBinds ? "plot" : others[0];
    const routes = ((): ExileCastRoute[] => {
        if (designation === undefined) return grantOpen ? ["grant"] : [];
        if (!grantOpen) return [designation];
        const designationRank =
            EXILE_ROUTE_PRICE_RANK[exileRoutePrice(card, designation)];
        const grantRank =
            EXILE_ROUTE_PRICE_RANK[exileRoutePrice(card, "grant")];
        if (designationRank === grantRank) {
            return card.castFromExileManaSubstitution !== undefined &&
                card.castFromExileCostIncrease === undefined
                ? ["grant"]
                : [designation];
        }
        return designationRank < grantRank
            ? [designation, "grant"]
            : ["grant", designation];
    })();
    if (card.castDeclinedExileRoute === true && routes.length === 2) {
        return [routes[1]];
    }
    return routes;
}

/** The route `casterId`'s cast of `card` takes: the default, or the second one
 *  when the caster declined it ({@link exileCastRoutes}). `undefined` when no
 *  permission is open or the declined route does not exist. */
export function exileCastRoute(
    state: GameState,
    card: Parameters<typeof exileCastRoutes>[1],
    casterId: string,
    declineManaCostReplacement?: boolean
): ExileCastRoute | undefined {
    // A cast already announced under the second route has only that route left.
    const declined =
        declineManaCostReplacement === true &&
        card.castDeclinedExileRoute !== true;
    return exileCastRoutes(state, card, casterId)[declined ? 1 : 0];
}

/** CR 601.2f / 609.4b — whether the riders on the grant record (its tax, its
 *  mana fixing) apply to `casterId`'s cast of `card`: they ride the grant, so
 *  a cast under the card's own designation owes and gets neither. */
export function exileCastRidesGrant(
    state: GameState,
    card: Parameters<typeof exileCastRoutes>[1],
    casterId: string
): boolean {
    const route = exileCastRoute(state, card, casterId);
    return route === undefined || route === "grant";
}

/** One route as the wire shows it: its price, and whether it locks an announced
 *  {X} to 0 (CR 107.3b), nothing a cast pays under it including X. */
export type ExileCastRouteView = {
    price: ExileCastRoutePrice;
    xLocked: boolean;
};

/** What the client's picker reads: the default announcement's route, and the
 *  declined one where the caster has that choice. */
export type ExileCastRouteChoice = ExileCastRouteView & {
    declined?: ExileCastRouteView;
};

function exileRouteView(
    card: CardInstanceState,
    route: ExileCastRoute
): ExileCastRouteView {
    const price = exileRoutePrice(card, route);
    const cost: ManaCost | undefined =
        price === "free"
            ? {}
            : route === "foretell"
              ? getForetellCost(card)
              : price === "alternative"
                ? (card.castFromExileAlternativeCost ?? getMadnessCost(card))
                : getInstanceManaCost(card);
    return { price, xLocked: typeof cost?.X !== "string" };
}

/** The wire's view of {@link exileCastRoutes} for `casterId`: what the default
 *  announcement pays, and what the declined one would. `undefined` when the
 *  picker owes nothing: no route, or one plain printed cast. */
export function exileCastRouteChoice(
    state: GameState,
    card: CardInstanceState,
    casterId: string
): ExileCastRouteChoice | undefined {
    const [route, declined] = exileCastRoutes(state, card, casterId);
    if (route === undefined) return undefined;
    const view = exileRouteView(card, route);
    if (declined !== undefined) {
        return { ...view, declined: exileRouteView(card, declined) };
    }
    return view.price === "printed" ? undefined : view;
}

/** A view of `state` in which `card`'s cast is announced under its second route
 *  (`castDeclinedExileRoute`), so every reader of the route prices that cast.
 *  What `announceCast` writes onto the real card, for the Bot's enumerator to
 *  probe without writing to the state it is enumerating. */
export function stateWithDeclinedExileRoute(
    state: GameState,
    cardInstanceId: string
): GameState {
    return {
        ...state,
        players: state.players.map((p) =>
            p.exile.some((c) => c.id === cardInstanceId)
                ? {
                      ...p,
                      exile: p.exile.map((c) =>
                          c.id === cardInstanceId
                              ? { ...c, castDeclinedExileRoute: true }
                              : c
                      ),
                  }
                : p
        ),
    };
}

/** Undoes `announceCast`'s `castDeclinedExileRoute` when the announced cast is
 *  abandoned: the choice was the cast's, and the card stays in exile. */
export function clearDeclinedExileRoute(
    state: GameState,
    cardInstanceId: string | undefined
): void {
    for (const player of state.players) {
        const card = player.exile.find((c) => c.id === cardInstanceId);
        if (card) delete card.castDeclinedExileRoute;
    }
}

/** CR 611.2b (issue #7295) — {@link exileCastPermission} PLUS the grant's board
 *  condition ("you may play them if you control a Wizard"). The condition is an
 *  ongoing effect, so it is re-read on EVERY ask against the live board: the
 *  permission is lost when the Wizard leaves and regained when one returns,
 *  with nothing stamped or cleared in between.
 *
 *  This is the server-side authority — every consumer with a `GameState`
 *  (the enumerators, `getLegalActions`, the payment path, the exile projection,
 *  the land play) asks here. {@link exileCastPermission} stays the window-only
 *  half for the CLIENT, which holds a projected card and no board: the
 *  projection withholds `legalActions` while the condition fails, which is what
 *  the Cast button gates on. A card with no condition answers exactly as
 *  `exileCastPermission` does. The condition belongs to the grant, so it never
 *  closes a plotted card's own permission (CR 702.170d). */
export function exileCastPermitted(
    state: GameState,
    card: ExileCastFields,
    casterId: string
): boolean {
    return (
        openDesignationRoutes(state, card, casterId).length > 0 ||
        exileGrantPermitted(state, card, casterId)
    );
}

/** The turn on which `casterId`'s next cast-from-exile window on `card` opens,
 *  when they hold one that is closed on `turn`: the earliest of the card's
 *  designations and the grant. `undefined` when one is open, or they hold none.
 *  Shared with the Cast button's disabled reason. */
export function exileCastOpensOnTurn(
    card: ExileCastWindowFields,
    casterId: string,
    turn: number
): number | undefined {
    if (exileCastPermission(card, casterId, turn)) return undefined;
    const opening = [
        ...designationPermissions(card, casterId).map(
            (permission) => permission.opensOn
        ),
        card.castableFromExileBy === casterId
            ? card.castableFromExileFromTurn
            : undefined,
    ].filter((t): t is number => t !== undefined);
    return opening.length > 0 ? Math.min(...opening) : undefined;
}

/** CR 702.143a / 702.170d / 702.185a (issue #7587) — whether `casterId` holds
 *  a grant to cast `card` from exile that is stamped but opens only on a LATER
 *  turn: a foretold card ("after the current turn has ended"), a plotted card
 *  ("on a later turn"), a warped card's recast window. Read through
 *  {@link exileCastOpensOnTurn}, so the comparison stays the one authority's.
 *
 *  A board condition on that future window is NOT re-read: the future board is
 *  unknown, and the card is banked either way. */
export function exileCastOpensLater(
    state: GameState,
    card: ExileCastWindowFields,
    casterId: string
): boolean {
    return exileCastOpensOnTurn(card, casterId, state.turn) !== undefined;
}

/** Issue #7587 — whether an exiled `card` is LATENT material for `casterId`:
 *  castable now ({@link exileCastPermitted}) or once a later-turn window opens
 *  ({@link exileCastOpensLater}). The evaluator's hand term and the search's
 *  banking tie-break both ask here, so "what counts as a card still in hand"
 *  has one answer. */
export function exileCastLatent(
    state: GameState,
    card: ExileCastFields,
    casterId: string
): boolean {
    return (
        exileCastPermitted(state, card, casterId) ||
        exileCastOpensLater(state, card, casterId)
    );
}

/** CR 601.3 / 400.7 (issue #2971) — the zone a `cast-spell` Move actually
 *  leaves, and the player whose zone that is, for the Bot's search cast
 *  commit sequence (`commitCastInSearch`, issue #4444). `null` when no
 *  permitted source still holds the card — a stale Move, which the caller skips
 *  rather than throwing, exactly as `resolvePlayLandSourceZone` does for the
 *  land half.
 *
 *  The sandboxes have no `locateCastSource` (that lives in `convex/gre/activation.ts`,
 *  which imports the enumerator), so before this they GUESSED: hand, unless the
 *  id happened to be the library top. The guess is wrong for every zone this
 *  issue enumerates, and wrong in the worst way — `removeFromZone` throws
 *  `Card <id> not found in hand`, surfacing as a search error rather than an
 *  illegal cast. `declaredZone` is the Move's own `castFromZone`, stamped by
 *  the enumerator from the permission it gated on; the legacy derivation stays
 *  as the fail-closed backstop for hand-built Moves that carry no zone.
 *
 *  `retraceZone` is threaded separately because `applyRetraceCastForSearch`
 *  both PROBES and CHARGES: it must run before this, and its answer wins. */
export function castSourceForSearch(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    declaredZone: CastFromZone | undefined,
    retraceZone: "graveyard" | undefined
): { owner: PlayerState; zone: CastFromZone } | null {
    const zone: CastFromZone =
        retraceZone ??
        declaredZone ??
        (player.hand.some((c) => c.id === cardInstanceId) ||
        player.library[0]?.id !== cardInstanceId
            ? "hand"
            : "library");
    // CR 702.81a (issue #2971 review finding 7) — a graveyard Move whose card
    // still HAS retrace, reached with `retraceZone === undefined`, means
    // `applyRetraceCastForSearch` declined to charge the land discard (the
    // grant lapsed between enumeration and application). Applying it anyway
    // would put the spell on the stack for free and with no `exileOnResolve`,
    // so it returns to the graveyard and is recastable — the unbounded-recast
    // shape the discard exists to bound. Refuse instead; the caller skips.
    if (zone === "graveyard" && retraceZone === undefined) {
        const inGraveyard = player.graveyard.find(
            (c) => c.id === cardInstanceId
        );
        if (inGraveyard && hasRetrace(state, inGraveyard)) return null;
    }
    // CR 400.7 — exile is the ONE origin whose owner may not be the caster (a
    // cross-player grant). Every other zone a cast can come from is the
    // caster's own, mirroring `castZoneOwner` (`convex/gre/activation.ts`).
    const owner =
        zone === "exile"
            ? state.players.find((p) =>
                  p.exile.some((c) => c.id === cardInstanceId)
              )
            : player;
    if (!owner) return null;
    const held =
        zone === "hand"
            ? owner.hand
            : zone === "exile"
              ? owner.exile
              : zone === "graveyard"
                ? owner.graveyard
                : owner.library;
    if (!held.some((c) => c.id === cardInstanceId)) return null;
    return { owner, zone };
}

// ---------------------------------------------------------------------------
// The NON-MANA leg of a graveyard cast (issue #2980)
// ---------------------------------------------------------------------------

/** The exile-cost picker a graveyard cast owes, or the reason no legal payment
 *  exists. `undefined` = this cast owes no exile cost at all.
 *
 *  Two shapes rather than a throw, because the two callers need opposite
 *  things from the same computation: the cast-announcement mutation throws the
 *  `unpayable` message at the player, while the Bot's move enumerator drops the
 *  candidate. A builder that threw could only serve the first, which is exactly
 *  how the cost ended up living inside `announceCast` in the first place. */
export type CastExileCostBuild =
    | { choice: NonNullable<PendingCast["exileFromGraveyardChoice"]> }
    | { unpayable: string };

/** CR 702.34a / 702.138a escape / 118.8 (issue #2980) — the "exile N cards" additional
 *  cost a cast from the GRAVEYARD owes, as the `PendingCast` picker every
 *  commit path parks on, or `undefined` when this cast owes none.
 *
 *  A spell's OWN `additionalCosts.exileFromGraveyard` rides the
 *  same slot and is owed from ANY zone; it is checked first. Behind it, three
 *  independent graveyard-cast legs share the slot (no shipped card carries
 *  more than one), checked in the precedence `announceCast` has always used:
 *
 *   1. `additionalCosts.flashbackExileFromGraveyard` (CR 702.34a / 118.8 —
 *      Flash of Insight's "Exile X blue cards from your graveyard"). Lives on
 *      the DEFINITION, not on the flashback object, and is X-DEPENDENT: a
 *      zero-X flashback cast owes nothing.
 *   2. `FlashbackCost.exileFromHand` (Lava Dart's sibling shape) — one card
 *      from the caster's own HAND, so the picker carries `zone: "hand"`.
 *   3. The ESCAPE exile (CR 702.138a — "exile N OTHER cards from your
 *      graveyard"), either the fixed `count` (Uro, Phlage, and every card
 *      Underworld Breach grants escape to) or Nethergoyf's variable
 *      `minCardTypes` shape.
 *
 *  This used to be written out TWICE inside `convex/game.ts` — once in the
 *  targeted commit (`finalizeTargetSelection`) and once in the untargeted
 *  announce (`announceCast`) — which is why the Bot's enumerator could not
 *  price an escape cast at all: `game.ts` imports the enumerator, so the
 *  enumerator can never import back. Moved down here beside `castRawManaCost`
 *  for the same reason and by the same route issue #2971 moved the mana leg;
 *  both mutation sites now call this one copy, so the cost the search charges
 *  and the cost the server parks on cannot drift.
 *
 *  Delve (CR 702.66) and Convoke (CR 702.51) also ride this picker slot and are
 *  deliberately NOT here: they are `payWith` MANA offsets, not additional
 *  costs, they apply to a HAND cast as much as a graveyard one, and they are
 *  built (and ordered against each other) by `announceCast` around this call. */
export function buildCastExileCostChoice(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    zone: CastFromZone,
    opts?: { additionalCosts?: AdditionalCostSpec; chosenX?: number }
): CastExileCostBuild | undefined {
    // CR 601.2f / 118.8 (issue #2072) — the spell's OWN "exile N cards from
    // your graveyard" additional cost (Abhorrent Oculus), owed by every cast
    // whatever its zone, so it is checked ahead of the graveyard-only legs
    // below. On an escape cast (CR 702.138a — Underworld Breach grants
    // escape to every nonland card) both costs are owed (CR 601.2f — the
    // total cost), so a fixed escape count is SUMMED into the one picker. A
    // variable escape cost (`minCardTypes`) has no single-count shape to join,
    // so that combination fails closed as unpayable.
    const ownExile = opts?.additionalCosts?.exileFromGraveyard;
    if (ownExile) {
        const escSpec =
            zone === "graveyard" && hasEscape(state, card)
                ? getEscapeExileSpec(state, card)
                : undefined;
        if (escSpec && "minCardTypes" in escSpec) {
            return {
                unpayable:
                    "This spell's graveyard exile can't be combined with a variable escape cost",
            };
        }
        const count = ownExile.count + (escSpec?.count ?? 0);
        const others = player.graveyard.filter((c) => c.id !== card.id);
        if (others.length < count) {
            return {
                unpayable:
                    "Not enough other cards in your graveyard to pay the additional cost",
            };
        }
        return {
            choice: { count, excludeInstanceId: card.id },
        };
    }
    if (zone !== "graveyard") return undefined;
    // CR 702.138 / 702.34 — WHICH mechanism this cast uses decides which cost
    // it owes, and escape beats flashback, exactly as `castRawManaCost`,
    // `graveyardCastStackFlags` and `graveyardCastMechanism` all order them. A
    // card can carry both: Underworld Breach grants escape to EVERY nonland
    // card in its controller's graveyard, flashback cards included. Reading the
    // zone alone made a Breach-granted escape cast of Flash of Insight pay the
    // FLASHBACK exile ("X blue cards") instead of the escape one — and at
    // `chosenX: 0` pay nothing at all, while escape stamps no `exileOnResolve`
    // so the card returns to the graveyard: the unbounded-recast shape this
    // whole cost exists to bound (issue #2980 review, F2).
    const escaping = hasEscape(state, card);
    // CR 702.34a / 118.8 — Flash of Insight. X = the announced `chosenX`; a
    // zero-X flashback cast looks at 0 cards and owes no exile cost.
    const fbExileSpec = escaping
        ? undefined
        : opts?.additionalCosts?.flashbackExileFromGraveyard;
    const chosenX = opts?.chosenX;
    if (fbExileSpec && chosenX !== undefined && chosenX > 0) {
        if (
            flashbackExileEligibleCount(player, fbExileSpec.color, card.id) <
            chosenX
        ) {
            return {
                unpayable:
                    "Not enough matching cards in your graveyard to pay the flashback cost",
            };
        }
        return {
            choice: {
                count: chosenX,
                ...(fbExileSpec.color !== undefined
                    ? { color: fbExileSpec.color }
                    : {}),
                excludeInstanceId: card.id,
            },
        };
    }
    // CR 702.34a / 118.8 — the flashback-only "Exile a <colour> card from your
    // HAND" cost. Exactly one card, from the caster's own hand. Suppressed on an
    // escape cast for the same reason as the leg above.
    const fbHandSpec = escaping
        ? undefined
        : getFlashbackAdditionalCost(card)?.exileFromHand;
    if (fbHandSpec) {
        const eligible = player.hand.filter((c) =>
            isExileCostEligible(c, "", fbHandSpec.color)
        );
        if (eligible.length < 1) {
            return {
                unpayable:
                    "No matching card in your hand to pay the flashback cost",
            };
        }
        return {
            choice: {
                count: 1,
                ...(fbHandSpec.color !== undefined
                    ? { color: fbHandSpec.color }
                    : {}),
                excludeInstanceId: card.id,
                zone: "hand",
            },
        };
    }
    // CR 702.138a — the ESCAPE exile. "OTHER cards", so the escaping card is
    // never eligible for its own cost (CR 601.2a).
    const escExileSpec = getEscapeExileSpec(state, card);
    if (!escExileSpec) return undefined;
    const others = player.graveyard.filter((c) => c.id !== card.id);
    if ("minCardTypes" in escExileSpec) {
        if (countDistinctCardTypes(others) < escExileSpec.minCardTypes) {
            return {
                unpayable:
                    "Not enough card types in your graveyard to pay the escape cost",
            };
        }
        return {
            choice: {
                count: 1,
                minCardTypes: escExileSpec.minCardTypes,
                excludeInstanceId: card.id,
            },
        };
    }
    if (others.length < escExileSpec.count) {
        return {
            unpayable:
                "Not enough other cards in your graveyard to pay the escape cost",
        };
    }
    return {
        choice: {
            count: escExileSpec.count,
            excludeInstanceId: card.id,
        },
    };
}

/** CR 702.34a / 119.4 — the LIFE a cast from `zone` owes for the card's
 *  flashback cost ("Flashback—{1}{U}, Pay 3 life."), 0 when none. Owed only on a
 *  graveyard cast that actually uses flashback: escape beats flashback (CR 702.138
 *  — Underworld Breach), so an escape cast of the same card owes none. The ONE
 *  seam the targeted and untargeted commits, the legal-action gate and the Bot's
 *  enumerator share, so the life the server charges and the life the search
 *  prices cannot drift. */
export function flashbackLifeCost(
    state: GameState,
    card: CardInstanceState,
    zone: CastFromZone
): number {
    if (zone !== "graveyard" || hasEscape(state, card)) return 0;
    return getFlashbackAdditionalCost(card)?.life ?? 0;
}

/** CR 601.3 (issue #2980) — the card a `cast-spell` Move is about to
 *  cast, looked up in the zone the Move DECLARES, for the two search sandboxes'
 *  pre-removal cost block.
 *
 *  Both sandboxes used to look it up in the caster's HAND and nowhere else, so
 *  every graveyard and exile cast the enumerator offers silently skipped its
 *  whole pre-cast cost block: the escape / flashback exile went uncharged (the
 *  unbounded-recast shape), the flashback sacrifice leg went uncharged, and the
 *  spell went onto the stack for free. A hand cast resolves exactly as before —
 *  the declared zone is `"hand"` for every one of them.
 *
 *  Exile is the ONE zone whose owner may not be the caster — a cross-player
 *  cast permission (CR 601.3, Dauthi Voidwalker's opponent-exile free cast)
 *  leaves the card in its OWNER's exile while another player holds the grant.
 *  Mirrors {@link castSourceForSearch}; every other zone is the caster's own. `undefined` when no such zone holds the card — a stale
 *  Move, which each caller already handles. */
export function findCastSourceCard(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    declaredZone: CastFromZone | undefined
): CardInstanceState | undefined {
    const zone = declaredZone ?? "hand";
    if (zone === "exile") {
        for (const p of state.players) {
            const found = p.exile.find((c) => c.id === cardInstanceId);
            if (found) return found;
        }
        return undefined;
    }
    const held =
        zone === "hand"
            ? player.hand
            : zone === "graveyard"
              ? player.graveyard
              : player.library;
    return held.find((c) => c.id === cardInstanceId);
}

/** CR 702.66 / 702.138a escape / 702.34a (issue #2980) — does this cast's own exile
 *  ADDITIONAL cost already occupy the one `PendingCast.exileFromGraveyardChoice`
 *  slot, leaving no room for Delve's `payWith` offset to ride it?
 *
 *  `announceCast` decides exactly this, with `if (!castExileChoice &&
 *  !castConvokeChoice)` — the delve picker is built only when the slot is free.
 *  Its comment claimed "no delve card in the pool also carries one of those
 *  exile costs", which Underworld Breach falsifies for every nonland card in
 *  the graveyard: a Treasure Cruise given escape owes "exile three other cards"
 *  AND wants to delve, and only one of them fits.
 *
 *  The enumerator must agree, or it discounts the generic cost by a delve the
 *  server will never charge: the tap plan then covers less than the real cost,
 *  the announcement parks unpayable, and the cast can never commit — the
 *  announce-then-abort freeze (issue #2980 review, F1). Answering `true` makes
 *  the enumerator price the FULL cost, which simply drops the Move when the
 *  mana is short: fail closed, same as the server. */
export function castExileCostOccupiesPayWithSlot(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    zone: CastFromZone,
    opts?: { additionalCosts?: AdditionalCostSpec; chosenX?: number }
): boolean {
    return (
        buildCastExileCostChoice(state, player, card, zone, opts) !== undefined
    );
}
