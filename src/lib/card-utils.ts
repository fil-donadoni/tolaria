import type {
    CardInstance,
    GenericSpendAmbiguity,
    ManaPool,
    PendingActivation,
    PendingCast,
    PendingTarget,
    Player,
} from "~/types/game";
import type { CardType, Color, ManaCost } from "~/types/cards";
import type { Phase } from "@convex/gre/types";
import {
    matchesPermanentFilter as matchesEnginePermanentFilter,
    type FilterMatchContext,
    type MatchablePermanent,
    type PermanentFilter,
} from "@convex/cards/filters";
import {
    canPayTapOtherCost,
    crewPowerContribution,
    type TapOtherCandidate,
    type TapOtherCostSpec,
} from "@convex/gre/tapOtherCost";
import {
    hasControlledSinceTurnStart,
    type ControlContinuityView,
} from "@convex/gre/controlContinuity";
import type {
    ActivatedAbility,
    AdditionalCostLeg,
    AlternativeCost,
    CardDefinition,
    EffectCardFilter,
    EmblemInstance,
    KickerCost,
    MayPayCost,
    PermanentView,
    TargetRequirement,
    TriggerStateView,
} from "@convex/cards/types";
import {
    abilityLossTimestamp,
    getEffectiveActivatedAbilities,
    grantOutrankedByAbilityLoss,
} from "@convex/gre/activatedAbilities";
import { findTriggeredAbility } from "@convex/gre/copy";
// CR 606 (issue #2491) — the shared loyalty authority. The client reads the two
// STATE-ONLY clauses from it; the timing clause stays a documented narrowing
// (this view has no stack length / priority holder), with the server the gate.
import {
    isLoyaltyAbility,
    loyaltyCostPayable,
    loyaltyLockedThisTurn,
} from "@convex/gre/loyalty";
import {
    DAMAGEABLE_PERMANENT_TYPES,
    LAND_SUBTYPE_MANA,
    LANDWALK_KEYWORDS,
    LANDWALK_SUPERTYPE_KEYWORDS,
    assignHybridPips,
    getActivatedManaAbility,
    getEffectiveManaChoices,
    getFixedSacrificeManaAbility,
    getManaTapOptions,
    hybridCostKey,
    isSpellStackItem,
    normalizedHybridPips,
} from "@convex/gre/constants";
import type {
    CardInstanceState,
    GameState,
    MayPayHandCard,
    PlayerState,
} from "@convex/gre/state";
import {
    assignMayPayHandCards,
    manaBalanceForRestriction,
} from "@convex/gre/state";
import {
    affordableAlternativeCosts,
    handCardMatchesFilter,
} from "@convex/gre/alternativeCost";
// CR 601.2b / 118.8 — the server's own additional-cost leg affordability, reused
// verbatim so the cast-time leg picker and `announceCast` can never disagree.
import { payableAdditionalCostLegs } from "@convex/gre/additionalCost";
// CR 702.33a (ADR 0079) — the server's own kicker-leg affordability check,
// reused verbatim so the cast-cost dialog and `announceCast` can never disagree.
import { canPayKickerLegs } from "@convex/gre/kicker";
import {
    checkPermanentTargetFilters,
    checkPlayerTargetFilters,
    checkSpellTargetFilters,
    isAlreadySelectedTarget,
    permanentFilterValuesFromCarrier,
    playerFilterValuesFromCarrier,
    spellFilterValuesFromCarrier,
    type PermanentFilterValues,
    type TargetFilterCtx,
} from "@convex/gre/targetFilters";
import type { StackItem } from "@convex/gre/state";
import { getDefinition, tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import { getEffectiveColors } from "@convex/cards/effectiveColors";
import { liveSupertypesOf } from "@convex/cards/snowReads";
import {
    controlsLandWithSupertype,
    negatedLandwalkSubtypes,
} from "@convex/cards/landwalkNegation";
import { effectivePower, effectiveToughness } from "./effective-stats";

export function isLand(card: CardInstance): boolean {
    return card.types?.includes("Land") ?? false;
}

export function isCreature(card: CardInstance): boolean {
    return card.types?.includes("Creature") ?? false;
}

/** CR 306 — true iff this permanent is a planeswalker. Drives the on-card
 *  loyalty badge and mirrors the engine-side `isPlaneswalker`. */
export function isPlaneswalker(card: CardInstance): boolean {
    return card.types?.includes("Planeswalker") ?? false;
}

/** CR 702.126 — true iff `card` declares the Improvise keyword. Used both to
 *  identify the spell currently being cast (`pendingCastHasImprovise` below)
 *  and, symmetrically, to exclude an Improvise-eligible artifact's OWN cast
 *  from tapping itself (it isn't on the battlefield yet, so this never
 *  actually fires — kept general rather than cast-source-specific). */
export function hasImprovise(card: CardInstance): boolean {
    return (
        getDefinition(card.card.id).staticAbilities?.includes("improvise") ??
        false
    );
}

/** The `CardInstance` a `PendingCast` is paying for, searched across every
 *  zone a cast can originate from (CR 601.3 / 702.34 — hand, an exile
 *  permission like Ice Cauldron, or a graveyard cast like Flashback/Escape).
 *  Mirrors the server's `locateCastSource` zone order; `me` is the viewer's
 *  OWN player object, whose hand is never nulled on the wire. */
export function pendingCastSourceCard(
    pendingCast: PendingCast,
    me: Player | undefined
): CardInstance | undefined {
    if (!me) return undefined;
    const inHand = me.hand.find(
        (c): c is CardInstance =>
            c !== null && c.id === pendingCast.cardInstanceId
    );
    if (inHand) return inHand;
    const inExile = me.exile.find((c) => c.id === pendingCast.cardInstanceId);
    if (inExile) return inExile;
    return me.graveyard.find((c) => c.id === pendingCast.cardInstanceId);
}

/** CR 702.126 — true iff the spell `pendingCast` is currently paying for
 *  declares Improvise. Drives both the artifact-tap affordance
 *  (`useBattlefieldVisualState`/`useBattlefieldInteraction`) and the
 *  PaymentBanner subtitle. */
export function pendingCastHasImprovise(
    pendingCast: PendingCast,
    me: Player | undefined
): boolean {
    const source = pendingCastSourceCard(pendingCast, me);
    return !!source && hasImprovise(source);
}

/** CR 702.126a — generic mana still owed by `pendingCast` (0 once the whole
 *  generic portion has been paid off, by mana or by Improvise taps). An
 *  Improvise artifact tap is only ever legal while this is positive — mirrors
 *  the server's `tapArtifactForImprovise` guard so the client's affordance
 *  never offers a tap the mutation would reject. */
export function pendingCastRemainingGeneric(pendingCast: PendingCast): number {
    return pendingCast.manaCost.X ?? 0;
}

/** CR 601.2g — the generic-mana spend choice (if any) parked on THIS viewer's
 *  `pendingCast`/`pendingActivation`, and which container holds it. Mirrors
 *  the server's `findActiveManaSpendChoice` (convex/game.ts) over the
 *  wire-projected state, so the board can decide whether to render
 *  `ManaSpendChoiceDialog` without a round trip. `manaSpendChoice` is only
 *  ever set once every OTHER payment gate (sacrifice/exile/alt-cost pickers)
 *  has cleared — it is the LAST finalize-point check
 *  (`tryAutoCommitPendingCast`/`tryAutoCommitPendingActivation`) — so at most
 *  one container is realistically active at a time; the cast-before-activation
 *  check order below is just a stable pick, not a real race. */
export function activeManaSpendChoice(
    pendingCast: PendingCast | undefined,
    pendingActivation: PendingActivation | undefined,
    viewerId: string
):
    | { container: "cast"; choice: GenericSpendAmbiguity }
    | { container: "activation"; choice: GenericSpendAmbiguity }
    | null {
    if (pendingCast?.playerId === viewerId && pendingCast.manaSpendChoice) {
        return { container: "cast", choice: pendingCast.manaSpendChoice };
    }
    if (
        pendingActivation?.playerId === viewerId &&
        pendingActivation.manaSpendChoice
    ) {
        return {
            container: "activation",
            choice: pendingActivation.manaSpendChoice,
        };
    }
    return null;
}

/** CR 302.1 — a creature with summoning sickness cannot pay the {T} or {Q}
 *  cost of an activated ability; CR 702.10b — haste lifts the restriction.
 *  Mirrors `isTapLockedBySummoningSickness` in convex/gre/constants.ts. */
export function isTapLockedBySummoningSickness(card: CardInstance): boolean {
    if (!card.isSummoningSick || !isCreature(card)) return false;
    return !(card.staticAbilities?.includes("haste") ?? false);
}

/**
 * Returns true if `attacker` has a landwalk keyword (CR 702.14b) for a land
 * subtype present anywhere in `defenderBattlefield`. Such an attacker can't
 * be blocked at all and should be filtered out of blocker-eligibility checks.
 */
export function isLandwalkUnblockable(
    attacker: CardInstance,
    defenderBattlefield: CardInstance[]
): boolean {
    const abilities = attacker.staticAbilities ?? [];
    // CR 509.1b / 702.14 — a landwalk-negation static (Great Wall, Undertow)
    // on the defender's battlefield suppresses the matching landwalk so the
    // creature can be blocked normally. Mirrors the server rule in
    // `combatRegistry.ts` so the client's block view agrees with the engine.
    const negated = negatedLandwalkSubtypes(defenderBattlefield);
    for (const [keyword, subtype] of Object.entries(LANDWALK_KEYWORDS)) {
        if (!abilities.includes(keyword)) continue;
        if (negated.has(subtype)) continue;
        const hasLand = defenderBattlefield.some(
            (c) => isLand(c) && (c.subtypes?.includes(subtype) ?? false)
        );
        if (hasLand) return true;
    }
    // CR 702.14 — supertype-keyed landwalk ("legendary landwalk", Livonya
    // Silone): unblockable while the defender controls a land with the named
    // supertype. Mirrors the server's `LANDWALK_SUPERTYPE_RULES`.
    for (const [keyword, supertype] of Object.entries(
        LANDWALK_SUPERTYPE_KEYWORDS
    )) {
        if (!abilities.includes(keyword)) continue;
        if (controlsLandWithSupertype(defenderBattlefield, supertype)) {
            return true;
        }
    }
    return false;
}

export function getLandManaColor(card: CardInstance): Color | null {
    const subtypes = card.subtypes ?? [];
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

/** The id to resolve a card's NAME / ART / ORACLE TEXT by for a DISPLAY-ONLY
 *  read (issue #1735): `knownCardId` when present — set ONLY on the viewer's
 *  own projection of their own face-down permanent or spell
 *  (`projectBattlefieldCard` / `projectStackItem`, `convex/gameProjections.ts`)
 *  — else `card.card.id` itself (every non-face-down card, and every OTHER
 *  viewer's face-down one). This is the controller's/caster's "I may look at
 *  my own face-down card" affordance ONLY.
 *
 *  NEVER use this for a rules computation — targeting filters, activation
 *  costs, color/mana-value reads, ability enumeration. Those MUST resolve off
 *  `card.card.id` directly so a face-down permanent's game-object
 *  characteristics stay the CR 708.2 sentinel's for EVERY viewer, controller
 *  included; that is the entire fix #1735 ships (a restored real id feeding a
 *  rules read is exactly the bug). */
export function displayCardId(card: CardInstance): string {
    return card.knownCardId ?? card.card.id;
}

/** Every activated ability actually available on this permanent POST-LAYER —
 *  native AND GRANTED (CR 113.1 / 611.2a, issue #1880) — as the CLIENT sees it
 *  (a projected `CardInstance` is structurally a `CardInstanceState` here;
 *  `grantedActivatedAbilities` survives the wire because `slimCard` spreads the
 *  instance). The ONE place the board's tap / mana / ability-menu path may
 *  resolve an ability id or scan a permanent's abilities.
 *
 *  Reading `getDefinition(card.card.id).activatedAbilities` there instead makes
 *  a GRANTED ability invisible to the click handler, with two shipped-bug
 *  shapes: the menu entry dispatches `activateAbility` (which throws "Use
 *  tapUntap for mana abilities"), or — worse — a cost-bearing granted mana
 *  ability gets no explicit menu entry at all and the permanent falls through
 *  to the silent left-click tap that charges its mana cost with no prompt
 *  (CR 601.2f / 605.3c, issue #1179). */
export function getEffectiveClientAbilities(
    card: CardInstance
): ActivatedAbility[] {
    return getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).map(({ ability }) => ability);
}

/** The mana ability this permanent exposes, native OR granted (CR 113.1 /
 *  611.2a, issue #1880). Reads the SAME post-layer effective set the server's
 *  mana probes use (`getEffectiveActivatedAbilities`, `gre/activatedAbilities`)
 *  rather than `cardDef.activatedAbilities` alone — a permanent granted a
 *  "{T}: Add …" (Urza's Saga chapter I) is a real mana source, and reading
 *  only the printed list left the board with no tap-for-mana affordance for
 *  one the server's auto-tap solver would happily use. Client hint only —
 *  server validation stays authoritative (#436). */
function findClientManaAbility(card: CardInstance) {
    return (
        getEffectiveActivatedAbilities(
            card as unknown as CardInstanceState
        ).find(
            ({ ability: a }) =>
                !a.useStack &&
                (a.manaProduced ||
                    a.manaChoices ||
                    a.getManaChoices ||
                    a.manaColorSource)
        )?.ability ?? null
    );
}

/** Returns true if a card has a tap mana ability (basic land subtype or
 *  activated), consulting the activated ability's own `canActivate`
 *  precondition when present (CR 602.5b, issue #947) — an un-imprinted
 *  Chrome Mox has NO usable mana ability at all, not merely one with an empty
 *  choice list, so it must not read as tappable. `stateView` is the same
 *  viewer-visible board projection `getStackAbilities` uses; an omitted
 *  caller falls back to an empty view, matching the existing UI-hint
 *  convention (#436) — server validation stays authoritative.
 *
 *  CR 106.1 / 605.1a (issue #1889) — `players`, when supplied, resolves the
 *  source's CURRENT unified TAP option list through the very helper the server
 *  reads (`getManaTapOptions` → `getManaTapOptionsDetailed`), and an EMPTY list
 *  means the source cannot pay for anything right now: an Everflowing Chalice
 *  with no charge counters, an empty Gaea's Cradle, the Urza trio one piece
 *  short. Those stop reading as tappable payment sources in the UI, matching the
 *  server exactly instead of re-deriving the answer from a private copy of the
 *  rule — which is how the two drifted in the first place. Board-conditional
 *  choosers (Fellwar Stone) read EVERY player's battlefield, which is why the
 *  argument is the whole player list, not just the controller's.
 *
 *  Two deliberate narrowings keep the delta at EXACTLY ZERO everywhere else:
 *  omitting `players` leaves the predicate byte-identical to its pre-#1889
 *  behaviour, and the gate applies only to a {T} ability — a NON-tap mana
 *  ability (Vivi Ornitier's {U}/{R} split, Farrelite Priest's "{1}: Add {W}") is
 *  deliberately absent from the tap option list (CR 605.1a — it is reached
 *  through the ability menu, not a tap), so gating on that list would wrongly
 *  erase it. */
export function hasManaAbility(
    card: CardInstance,
    stateView?: TriggerStateView,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): boolean {
    if (getLandManaColor(card) !== null) return true;
    const ability = findClientManaAbility(card);
    if (!ability) return false;
    if (ability.canActivate) {
        const view: TriggerStateView = stateView ?? { players: [] };
        if (!ability.canActivate(card as unknown as PermanentView, view)) {
            return false;
        }
    }
    if (players && ability.cost.tap === true) {
        if (
            getManaTapOptions(
                card as unknown as CardInstanceState,
                card.controllerId,
                players.map((p) => ({
                    playerId: p.id,
                    battlefield:
                        p.battlefield as unknown as CardInstanceState[],
                }))
            ).length === 0
        ) {
            return false;
        }
    }
    return true;
}

/** Returns the native mana ability of a card as a menu entry (id + oracleText),
 *  or null if the card has no native activated mana ability. Used to surface
 *  the mana ability inside the ability context menu when a card has both a
 *  mana ability and a stack ability (e.g. Basalt Monolith, Mana Vault), so a
 *  left click doesn't silently choose tap-for-mana over the {3}: Untap.
 *  Gated on `canActivate` like {@link hasManaAbility} (issue #947) — an
 *  un-imprinted Chrome Mox has no menu entry to offer. */
export function getActivatedManaMenuEntry(
    card: CardInstance,
    stateView?: TriggerStateView
): { id: string; oracleText: string } | null {
    const ability = findClientManaAbility(card);
    if (!ability) return null;
    if (ability.canActivate) {
        const view: TriggerStateView = stateView ?? { players: [] };
        if (!ability.canActivate(card as unknown as PermanentView, view)) {
            return null;
        }
    }
    // CR 602.1 / 118.8 (issue #2371) — the SAME unpayable-`tapOtherFilter`
    // gate {@link getManaCostMenuAbility} applies, because the two can offer
    // the SAME ability: Urza, Lord High Artificer's "Tap an untapped artifact
    // you control: Add {U}." has neither a mana leg nor a {T} leg, so it is a
    // `getManaCostMenuAbility` entry, and this helper's toggle is suppressed
    // only when that entry is actually present. With every artifact tapped the
    // entry is (correctly) withheld — and the toggle then leaked the identical
    // ability id back into the menu as a doomed dispatch. Withheld here too,
    // and for the affordability reason: until issue #2021 this case was masked
    // by an unconditional summoning-sickness gate in `getActivatable`, which
    // CR 302.6 does not license for a cost containing no tap symbol.
    if (ability.cost.tapOtherFilter && stateView) {
        const candidates = tapOtherCostCandidates(
            ability.cost.tapOtherFilter,
            card.id,
            card.controllerId,
            stateView
        );
        if (!canPayTapOtherCost(ability.cost.tapOtherFilter, candidates)) {
            return null;
        }
    }
    return { id: ability.id, oracleText: ability.oracleText };
}

/** True if the card was tapped for mana and the produced mana is still in the
 *  player's pool — so an "Untap and refund" action is legal. Server's tapUntap
 *  blocks refund when `manaCommitted` is set (mana already spent on a cost),
 *  but mana can also drain at phase boundaries (CR 106.4) leaving the source
 *  tapped while the pool is empty. In that case the refund would silently
 *  un-tap for free with no mana to give back — hide the option. Only supports
 *  fixed `manaProduced` sources (Basalt Monolith / Mana Vault style). Choice
 *  sources need `chosenMana` projected to the client to be precise here.
 *
 *  CR 106.6 (issue #1713) — mana this source produced can be sitting in a
 *  RESTRICTED bucket (Mishra's Workshop / Soldevi Machinist-style mana)
 *  rather than the fungible `manaPool`. Reading `manaPool` alone hid the
 *  refund affordance for exactly those sources even though the mana is still
 *  there, unspent, and `tapUntap`'s server-side reversal would happily give
 *  it back. So the question asked here is the SERVER refund's own question —
 *  "is the bucket THIS ability deposited into still holding the mana" — keyed
 *  on the producing ability's `manaRestriction` via
 *  `manaBalanceForRestriction`, exactly as `refundFixedManaOutput` /
 *  `refundChosenManaOutput` (`convex/game.ts`) reverse it.
 *
 *  It is NOT a spend-eligibility question, so `spendablePoolForAbility` is
 *  the wrong helper: keyed on the source's own card types it excludes every
 *  restricted source from its own bucket (Soldevi Machinist is a Creature,
 *  Mishra's Workshop a Land), and it would conversely offer a refund to an
 *  UNRESTRICTED source whose mana is long spent merely because some unrelated
 *  restricted bucket happens to be eligible for it. */
export function canRefundManaTap(
    card: CardInstance,
    player: Pick<PlayerState, "manaPool" | "restrictedMana">
): boolean {
    if (!card.isTapped || card.manaCommitted) return false;
    // POST-LAYER set (CR 113.1 / 611.2a, issue #1880) — a source tapped for
    // mana via a GRANTED fixed ability offers the same refund affordance.
    const ability = getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).find(({ ability: a }) => !a.useStack && a.manaProduced)?.ability;
    if (!ability?.manaProduced) return false;
    // The rider is deliberately left off the bucket key: the FIXED-output
    // deposit sites (`tapUntap`, `tapSourceIntoPayment`) both bank without one
    // and `refundFixedManaOutput` reverses without one, so a rider-keyed
    // lookup here would miss the unit the server actually credited. Only
    // `chosenMana` (choice) abilities carry a rider, and this helper does not
    // support those (see above).
    const restriction = ability.manaRestriction;
    for (const [color, amount] of Object.entries(ability.manaProduced)) {
        if (color === "X" || typeof amount !== "number" || amount <= 0)
            continue;
        if (manaBalanceForRestriction(player, color, restriction) < amount)
            return false;
    }
    return true;
}

/** Returns the mana-tap options to prompt the player with, or null when the
 *  source taps for mana with no choice (a single fixed/basic option).
 *
 *  Reads the SAME unified `getManaTapOptions` list the server resolves the
 *  submitted index against (CR 605.1a / 305.6 — activated abilities + one
 *  intrinsic option per basic land subtype), so a land under Urborg shows its
 *  own colour AND {B}, and City of Traitors shows {C}{C} AND {B}. Board-
 *  conditional choosers (Fellwar Stone) need every player's battlefield, so the
 *  caller passes the current players (CR 106.1). Mirrors the server's
 *  `manaTapNeedsChoice` gate: prompt when 2+ options exist, or the source
 *  carries a choice-based ability. The slim `CardInstance` is a structurally
 *  valid `CardInstanceState` here. */
export function getManaChoices(
    card: CardInstance,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): ManaCost[] | null {
    const options = getManaTapOptions(
        card as unknown as CardInstanceState,
        card.controllerId,
        players?.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }))
    );
    // POST-LAYER set (issue #1880) — a GRANTED choice-based mana ability
    // prompts exactly like a printed one, keeping this in lockstep with the
    // server's `manaTapNeedsChoice`.
    const hasChoiceAbility = getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).some(
        ({ ability: a }) =>
            !a.useStack &&
            (a.manaChoices || a.getManaChoices || a.manaColorSource)
    );
    if (options.length >= 2 || hasChoiceAbility) {
        return options.length > 0 ? options : null;
    }
    return null;
}

/** Returns the mana CHOICES for a NON-tap mana ability (Vivi Ornitier's
 *  {U}/{R} split), or null when the card has no non-tap, non-sacrifice
 *  choice-based mana ability. Issue #1179's client analog of
 *  {@link getManaChoices}: that helper reads the unified TAP options list
 *  (`getManaTapOptions`), which deliberately EXCLUDES a mana ability with no
 *  {T}/sacrifice component (CR 605.1a — it's reached through the
 *  activated-ability menu, not a direct tap), so a non-tap chooser needs its
 *  own resolver. Reads the SAME `getEffectiveManaChoices` helper the server
 *  (`activateManaAbility`) validates the submitted `manaChoiceIndex`
 *  against, so the picker's index always matches what the server expects.
 *  Board-conditional choosers need every player's battlefield (CR 106.1 /
 *  613.4 — Vivi's list is derived from her CURRENT effective power). */
export function getNonTapManaChoices(
    card: CardInstance,
    players?: ReadonlyArray<{ id: string; battlefield: CardInstance[] }>
): ManaCost[] | null {
    // POST-LAYER set (CR 113.1 / 611.2a, issue #1880) — the gate matches the
    // effective list `getEffectiveManaChoices` below resolves against, so a
    // GRANTED non-tap chooser is not silently gated out of the picker.
    const ability = getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).find(
        ({ ability: a }) =>
            !a.useStack &&
            !a.cost.tap &&
            !a.cost.sacrifice &&
            (a.manaChoices || a.getManaChoices || a.manaColorSource)
    )?.ability;
    if (!ability) return null;
    return getEffectiveManaChoices(
        card as unknown as CardInstanceState,
        card.controllerId,
        (players ?? []).map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield as unknown as CardInstanceState[],
        }))
    );
}

/** Every permanent that can legally be tapped to pay a `cost.tapOtherFilter`
 *  cost leg (CR 602.1 / 118.8), weighed exactly as the SERVER weighs them
 *  (`crewPowerContribution`, `gre/tapOtherCost.ts`) off the viewer-visible
 *  board projection. The ability's own source never counts (CR 602.1's
 *  "another") and an already-tapped permanent never counts.
 *
 *  ONE authority for the three client surfaces that must not disagree: the
 *  menu affordability gates ({@link getStackAbilities} for a stack ability,
 *  {@link getManaCostMenuAbility} for a `useStack: false` mana ability), the
 *  picker's own candidate set, and — through the shared
 *  `matchesPermanentFilter` / `canPayTapOtherCost` predicates — the server's
 *  `selectActivationCost` / `payTapOtherAbilityCost` validation. A private
 *  copy in any one of them is how a "clickable but rejected" permanent ships.
 *
 *  Without a `stateView` there is no board to weigh, so the caller gets an
 *  empty list — callers gate on `canPayTapOtherCost` and must treat the
 *  no-view case as "stay offered, let the server decide" (the existing
 *  UI-hint convention, #436). */
export function tapOtherCostCandidates(
    spec: TapOtherCostSpec,
    sourceId: string,
    controllerId: string,
    stateView: TriggerStateView
): TapOtherCandidate[] {
    const mine = stateView.players.find((p) => p.id === controllerId);
    return (mine?.battlefield ?? [])
        .filter(
            (c) =>
                c.id !== sourceId &&
                !c.isTapped &&
                matchesEnginePermanentFilter(c, spec.filter, {
                    selfControllerId: controllerId,
                })
        )
        .map((c) => ({
            id: c.id,
            power: crewPowerContribution(c.power ?? 0, c.crewPowerBonus ?? 0),
        }));
}

/** The NON-stack mana ability that gets its OWN entry in the ability context
 *  menu, or null (CR 605.1a / 601.2f / 605.3c, issue #1179). A mana ability
 *  must not be a silent left-click tap-for-mana when EITHER (a) its cost
 *  includes MANA, tap or not (Chromatic Star, Farrelite Priest "{1}: Add
 *  {W}") — the player has to choose to pay it; OR (b) it has no
 *  {T}/sacrifice component at all (Vivi Ornitier's free "{0}:", Urza, Lord
 *  High Artificer's "Tap an untapped artifact you control: Add {U}") — there
 *  is no tap toggle to reach it through in the first place.
 *
 *  POST-LAYER set (CR 113.1 / 611.2a, issue #1880) — read through
 *  {@link getEffectiveClientAbilities}, never `getDefinition(...).
 *  activatedAbilities`: a GRANTED "{1}, {T}: Add {W}" is invisible to the
 *  printed list, so it got no explicit entry and fell through to the plain
 *  left-click `tapUntap`, silently charging its {1}.
 *
 *  AFFORDABILITY (CR 602.1 / 118.8, issue #2371) — a `tapOtherFilter` cost
 *  leg is unpayable when the controller has no matching untapped permanent to
 *  tap, so the entry is withheld rather than offered as a doomed dispatch.
 *  This is the same gate {@link getStackAbilities} applies to a `useStack:
 *  true` ability's tap-other cost; it lives HERE, not inline in
 *  `useBattlefieldInteraction`, so the catalogue affordability sweep
 *  (`activation-affordability.catalogue.test.ts`) can reach the mana-ability
 *  menu surface at all — its `if (!a.useStack) continue` used to make every
 *  gate on this path structurally unguarded. */
export function getManaCostMenuAbility(
    card: CardInstance,
    stateView?: TriggerStateView
): ActivatedAbility | null {
    return (
        getEffectiveClientAbilities(card).find(
            (a) =>
                !a.useStack &&
                a.oracleText &&
                (!!a.cost.mana || (!a.cost.tap && !a.cost.sacrifice)) &&
                (!a.cost.tapOtherFilter ||
                    !stateView ||
                    canPayTapOtherCost(
                        a.cost.tapOtherFilter,
                        tapOtherCostCandidates(
                            a.cost.tapOtherFilter,
                            card.id,
                            card.controllerId,
                            stateView
                        )
                    ))
        ) ?? null
    );
}

/** Returns the mana color produced by an activated tap ability, or null.
 *  POST-LAYER set (CR 113.1 / 611.2a, issue #1880) — mirrors the engine's
 *  `getActivatedManaColor`, so the battlefield's "taps for mana" visual cue
 *  (`useBattlefieldVisualState`) lights up for a GRANTED `{T}: Add …` too. */
export function getActivatedManaColor(card: CardInstance): Color | null {
    const ability = getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).find(
        ({ ability: a }) => a.cost.tap && !a.useStack && a.manaProduced
    )?.ability;
    if (!ability?.manaProduced) return null;
    const colors = Object.entries(ability.manaProduced)
        .filter(([k, v]) => k !== "X" && typeof v === "number" && v > 0)
        .map(([k]) => k as Color);
    return colors.length === 1 ? colors[0] : null;
}

/** True when this source's mana ability has a FIXED output paid by sacrificing
 *  it, with no {T} leg (CR 605.1a, issue #2021) — Tinder Wall, Gaea's Touch,
 *  the Invasion Attendants, the Eldrazi Spawn token. Client mirror of the
 *  engine's `getFixedSacrificeManaAbility`, read by the same board gates that
 *  ask `getActivatedManaColor` about a tap source: that probe answers null here
 *  (no `cost.tap`, and a multi-colour output has no single `Color` anyway), so
 *  without this the source is not clickable as a payment source. */
export function hasFixedSacrificeManaAbility(card: CardInstance): boolean {
    return (
        getFixedSacrificeManaAbility(card as unknown as CardInstanceState) !==
        null
    );
}

/** True when activating this source for mana would pay a {T} cost (CR 302.6) —
 *  an intrinsic basic-land tap or an activated mana ability with `cost.tap`.
 *
 *  The summoning-sickness gates on the board read THIS rather than
 *  `isTapLockedBySummoningSickness` alone (issue #2021): CR 302.6 restricts an
 *  ability whose cost contains the tap or untap symbol, and nothing else, so a
 *  sacrifice-only mana creature (an Eldrazi Spawn token, which is summoning
 *  sick the turn it is created — the only turn it usually matters) must stay
 *  activatable. Mirrors the `requiresTap` gate in `tapUntap` /
 *  `tapSourceIntoPayment` server-side. */
export function manaActivationRequiresTap(card: CardInstance): boolean {
    if (getLandManaColor(card) !== null) return true;
    return getEffectiveActivatedAbilities(
        card as unknown as CardInstanceState
    ).some(({ ability: a }) => !a.useStack && a.cost.tap === true);
}

/** Returns true if the target requirement includes permanents (not player-only). */
export function wantsPermanentTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.some((t) => t !== "player");
}

/** True if the target requirement can target a player (CR 115.1a). Mirrors
 *  {@link wantsPermanentTarget}: handles both the scalar `"player"` and the
 *  array form (e.g. Lava Spike's `["player", "Planeswalker"]`), plus `"any"`
 *  (CR 115.4 "any target"). Used to mark a player face as clickable during
 *  targeting — a raw `targetType === "player"` misses the array form. */
export function wantsPlayerTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.includes("player") || types.includes("any");
}

/** Client-side mirror of the backend's matchesPermanentFilter. Returns true
 *  if the permanent matches every constraint in the filter (AND semantics).
 *  Used by the mid-resolution choice UI to highlight legal picks.
 *
 *  Must stay in sync with `matchesPermanentFilter` in `convex/cards/filters.ts`
 *  (the source of truth, `PermanentFilter`) — a field present there but
 *  missing here fails OPEN (matches every permanent) rather than closed, the
 *  exact shape of the `excludeSubtypes` gap fixed in issue #1938's fixup (the
 *  Planeshift Lair cycle's "non-Lair land" return-leg filter silently matched
 *  every land, Lairs included, because this mirror had no `excludeSubtypes`
 *  branch). See the `matchesPermanentFilter (client mirror parity guard —
 *  issue #1938 fixup)` describe block in `card-utils.test.ts`: it diffs this
 *  mirror against the real engine matcher one field at a time, and is the
 *  place to add a case when a new field lands on either side. */
export interface ClientPermanentFilter {
    types?: string | string[];
    /** Exclude permanents whose `types` include any of these (CR 205) — the
     *  negative of `types`. Mirrors `PermanentFilter.excludeTypes`. */
    excludeTypes?: string | string[];
    subtypes?: string | string[];
    /** Exclude permanents whose `subtypes` include any of these (CR 205.3i /
     *  205.3i) — the negative of `subtypes`. Mirrors
     *  `PermanentFilter.excludeSubtypes`, e.g. the Planeshift Lair cycle's
     *  "non-Lair land" return-leg cost filter (issue #1938). */
    excludeSubtypes?: string | string[];
    /** Exclude permanents that have ANY of these supertypes (CR 205.4a) — the
     *  negative of `supertypes` (this mirror has no POSITIVE `supertypes`
     *  field — no shipped choice picker needs it yet). Read against the
     *  card's PRINTED supertypes (`tryGetDefinition(...).supertypes`), since
     *  `CardInstance` carries no live supertype field client-side — the same
     *  best-effort static fallback the `colors` field below already uses (a
     *  snow-status mutation like Cold Snap isn't reflected here). Mirrors
     *  `PermanentFilter.excludeSupertypes`. */
    excludeSupertypes?: string | string[];
    requireAbility?: string;
    excludeAbility?: string;
    colors?: string | string[];
    tapped?: boolean;
    /** OR ACROSS filter dimensions (issue #897) — mirrors
     *  `PermanentFilter.any` (`convex/cards/filters.ts`). A non-empty array
     *  of full clauses of this same shape; the permanent matches if it
     *  matches AT LEAST ONE clause, ANDed with every other top-level field
     *  present alongside `any`. Without this branch a filter carrying ONLY
     *  `any` collapses to all-fields-undefined and fails OPEN (highlights
     *  every permanent as a legal pick). */
    any?: ClientPermanentFilter[];
    /** Exclude these instance ids from the match set (CR 109.2 "another") —
     *  mirrors `PermanentFilter.excludeInstanceIds`. This is how an effect
     *  says "another creature you control" / "a permanent other than ~":
     *  the interpreter's `toPermanentFilter` turns an `EffectCardFilter`'s
     *  `excludeSource` into this field, carrying the SOURCE's own instance id
     *  (Gut, True Soul Zealot's "sacrifice another creature or an artifact",
     *  issue #2373). Without this branch the mirror fails OPEN and rings the
     *  source itself as a legal pick; clicking it throws "Card does not match
     *  the required filter" server-side. Typed `ReadonlyArray` to match the
     *  engine field exactly — the wire `PendingChoice.filter` IS a
     *  `PermanentFilter` and is passed here unchanged. */
    excludeInstanceIds?: ReadonlyArray<string>;
    /** Restrict the match set to exactly these instance ids — mirrors
     *  `PermanentFilter.instanceIds`, the positive twin of the field above.
     *  Same fail-OPEN shape when unmirrored, and it was ALSO already
     *  reachable: the per-permanent optional-untap prompt
     *  (`convex/gre/phases.ts`, `kind: "untap-pick"`, ATQ cluster E "you may
     *  choose not to untap this") emits a battlefield choice scoped by
     *  `filter: { instanceIds: [card.id] }` with no `candidateIds`
     *  allow-list — so before this branch existed the mirror ringed EVERY
     *  tapped permanent instead of the one the prompt is about. */
    instanceIds?: ReadonlyArray<string>;
    /** "another <filter>" with the source id deferred to match time (CR 109.2,
     *  issue #2367) — mirrors `PermanentFilter.excludeSource`, the flag a
     *  static card-definition filter uses when it has no instance id to write
     *  into `excludeInstanceIds`.
     *
     *  This mirror ALWAYS fails closed on it, because it has no
     *  `FilterMatchContext` and therefore no source id to compare against. That
     *  is not a gap: every filter that reaches a client picker has already been
     *  LOWERED to a concrete `excludeInstanceIds` entry by
     *  `resolveExcludeSource` at the point the requirement was built
     *  (`buildActivationSacrificeSelection`, `convex/gre/activationCostPicks.ts`),
     *  which is the branch above. A raw `excludeSource` arriving here therefore
     *  means the server forgot to lower it — and refusing to highlight anything
     *  is the safe answer, exactly as `controlledSinceTurnStart` does without a
     *  `turnState`. Declaring the field is what makes that TRUE: without a
     *  branch the mirror would fail OPEN and ring the source itself as a legal
     *  sacrifice (the `excludeSubtypes` shape of issue #1938). */
    excludeSource?: boolean;
    /** "…that they controlled since the beginning of the turn" (Keldon
     *  Twilight, PLS). Mirrors `PermanentFilter.controlledSinceTurnStart`.
     *  Answering it needs the two turn-scoped `GameState` fields, so callers
     *  must pass `turnState` — without it this branch fails CLOSED (the filter
     *  is a restriction, so refusing to highlight is the safe direction: the
     *  server would reject the pick anyway). */
    controlledSinceTurnStart?: boolean;
}

export function matchesPermanentFilter(
    card: CardInstance,
    filter: ClientPermanentFilter,
    /** Projected `{ turn, controlChangedThisTurn }` — required only by the
     *  `controlledSinceTurnStart` clause. Both fields cross the wire verbatim.
     *  `turn` here is the ENGINE turn (`GameState.turn`, forwarded as
     *  `useGameContext().engineTurn`), the same scale `enteredOnTurn` is
     *  stamped from — NOT the board's display counter
     *  (`activePlayer.turnsTaken`), which is roughly half of it and would
     *  exclude candidates the server accepts (issue #1944 review fixup). */
    turnState?: ControlContinuityView
): boolean {
    if (filter.types !== undefined) {
        const types = Array.isArray(filter.types)
            ? filter.types
            : [filter.types];
        const cardTypes = card.types ?? [];
        if (!types.some((t) => cardTypes.includes(t))) return false;
    }
    if (filter.excludeTypes !== undefined) {
        const excluded = Array.isArray(filter.excludeTypes)
            ? filter.excludeTypes
            : [filter.excludeTypes];
        const cardTypes = card.types ?? [];
        if (excluded.some((t) => cardTypes.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subs = Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes];
        const cardSubs = card.subtypes ?? [];
        if (!subs.some((s) => cardSubs.includes(s))) return false;
    }
    if (filter.excludeSubtypes !== undefined) {
        const excluded = Array.isArray(filter.excludeSubtypes)
            ? filter.excludeSubtypes
            : [filter.excludeSubtypes];
        const cardSubs = card.subtypes ?? [];
        if (excluded.some((s) => cardSubs.includes(s))) return false;
    }
    if (filter.excludeSupertypes !== undefined) {
        const excluded = Array.isArray(filter.excludeSupertypes)
            ? filter.excludeSupertypes
            : [filter.excludeSupertypes];
        const cardSupertypes: string[] =
            tryGetDefinition(card.card.id)?.supertypes ?? [];
        if (excluded.some((s) => cardSupertypes.includes(s))) return false;
    }
    const abilities = card.staticAbilities ?? [];
    if (
        filter.requireAbility !== undefined &&
        !abilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.excludeAbility !== undefined &&
        abilities.includes(filter.excludeAbility)
    ) {
        return false;
    }
    if (
        filter.tapped !== undefined &&
        (card.isTapped === true) !== filter.tapped
    ) {
        return false;
    }
    if (filter.colors !== undefined) {
        // CR 202.2 / 613.1d — the server's own effective-colour derivation,
        // imported rather than re-implemented (`cards/effectiveColors.ts`):
        // layer-5 `colorOverride` SETS, `grantedColors` UNION. `grantedColors`
        // DOES cross the wire (`slimCard` only strips `card`/`knownTo`), so a
        // Goblin turned black by Dralnu's Crusade matches a "black creature"
        // filter here exactly as it does server-side.
        const cardColors = getEffectiveColors(card as unknown as PermanentView);
        const wanted = Array.isArray(filter.colors)
            ? filter.colors
            : [filter.colors];
        if (!wanted.some((c) => cardColors.includes(c as Color))) {
            return false;
        }
    }
    // CR 109.2 — instance-id scoping, the same two checks the engine matcher
    // runs (`convex/cards/filters.ts`). `excludeInstanceIds` is what carries
    // an effect's "another" clause to the client (`excludeSource` →
    // `toPermanentFilter` → the wire `PendingChoice.filter`, issue #2373);
    // without it the mirror rings the effect's own source as a legal pick.
    if (
        filter.excludeInstanceIds !== undefined &&
        filter.excludeInstanceIds.includes(card.id)
    ) {
        return false;
    }
    if (
        filter.instanceIds !== undefined &&
        !filter.instanceIds.includes(card.id)
    ) {
        return false;
    }
    // CR 109.2 — "another <filter>" (issue #2367). This mirror carries no
    // source id, so the only honest answer is CLOSED; see the field's own doc
    // comment on `ClientPermanentFilter` for why an unlowered `excludeSource`
    // reaching here is a server bug and not a case to fail open on.
    if (filter.excludeSource === true) return false;
    // "…that they controlled since the beginning of the turn" — delegated to
    // the ONE engine authority (`hasControlledSinceTurnStart`) rather than
    // re-derived here, so the board highlight and the server's pending-choice
    // submit validation can never disagree. No `turnState` → fail closed.
    if (filter.controlledSinceTurnStart !== undefined) {
        const held = turnState
            ? hasControlledSinceTurnStart(turnState, card)
            : false;
        if (filter.controlledSinceTurnStart !== held) return false;
    }
    // issue #897 — OR ACROSS filter dimensions. Every other field above is
    // ANDed; `any` is the one disjunctive clause list this filter supports.
    // Recurses through this same matcher (each clause is a full AND-of-fields
    // filter). A filter carrying ONLY `any` must NOT fail open (match
    // everything) — this check is what enforces that.
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) =>
            matchesPermanentFilter(card, clause, turnState)
        )
    ) {
        return false;
    }
    return true;
}

/** Returns true if a card on the battlefield matches the pending target requirement. */
export function matchesTargetRequirement(
    card: CardInstance,
    targetType: string | string[]
): boolean {
    const types = Array.isArray(targetType) ? targetType : [targetType];
    const cardTypes = card.types ?? [];
    // "spell-or-permanent" matches ANY permanent on the battlefield
    if (types.includes("spell-or-permanent")) return true;
    // CR 115.4 / 120.3: "any target" only matches damageable permanents
    // (creatures, planeswalkers, battles) — never lands, artifacts, enchantments.
    if (types.includes("any")) {
        return DAMAGEABLE_PERMANENT_TYPES.some((t) => cardTypes.includes(t));
    }
    return types.some((t) => cardTypes.includes(t as never));
}

/** Target-requirement `type` values that do NOT name a battlefield permanent,
 *  so {@link hasBattlefieldTargetCandidate} cannot judge them and fails open. */
const NON_PERMANENT_TARGET_TYPES = new Set([
    "player",
    "spell",
    "spell-or-permanent",
    "card",
]);

/**
 * CR 602.2b / 601.2c — is there at least ONE permanent on the board that could
 * be this requirement's target?
 *
 * An activated ability that targets and has NO legal target can't be activated
 * at all (CR 602.2b), so offering it in the tap/context menu is offering a move
 * the server will reject — the Equipment whose Equip is listed with no creature
 * anywhere on the battlefield. This is the client hint that hides it.
 *
 * Deliberately CONSERVATIVE — it only judges what the wire view can see
 * cheaply, and every branch it can't judge FAILS OPEN (returns true) so the
 * gate never hides a legal ability:
 *  - a requirement in a non-battlefield zone (graveyard), or whose type names a
 *    player / spell / any card, is not judged;
 *  - only `type`, `subtypeFilter`, `controller`, `controlledSinceTurnStart` and
 *    the self-exclusion are applied — the finer filters (power/toughness,
 *    colour, protection, shroud, intrinsic per-card filters) are the server's,
 *    whose `getLegalTargets` / `selectTarget` remain the single authority.
 * So a "no candidates" answer is reliable; a "has candidates" answer only means
 * the ability is worth offering.
 */
/** The minimum number of targets `requirement.count` demands (CR 601.2c) —
 *  the client-side mirror of `game.ts`'s own `minTargetCount`, widened to
 *  also accept the literal `"X"` count form (a `TargetRequirement.count` this
 *  function's caller may see before `chosenX` is known, unlike the cast-commit
 *  path `game.ts`'s helper serves). No chosen-X value is threaded into this
 *  UI-hint gate, so `"X"` resolves to `1` — a conservative floor (an
 *  affordability HINT undercounting a genuinely larger X only risks a false
 *  "unaffordable" READ if X ends up 0, which the server's own `hasEnoughLegalTargets`
 *  gate has final say over regardless). */
function minTargetCountHint(
    count: number | "X" | { min: number; max?: number | "X" }
): number {
    if (count === "X") return 1;
    return typeof count === "number" ? count : count.min;
}

export function hasBattlefieldTargetCandidate(
    requirement: TargetRequirement,
    source: CardInstance,
    stateView: TriggerStateView | undefined
): boolean {
    // No view to judge against — fail open (the caller may be a test or a
    // surface without player state).
    if (!stateView || stateView.players.length === 0) return true;
    if (requirement.zone !== undefined && requirement.zone !== "battlefield") {
        return true;
    }
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    if (types.some((t) => NON_PERMANENT_TARGET_TYPES.has(t))) return true;
    const activePlayerId = stateView.activePlayerId ?? source.controllerId;
    // The two judged filter dimensions run through the SAME registry
    // (`checkPermanentTargetFilters`, ADR 0068) `getLegalTargets` and
    // `selectTarget` already share — no bespoke client mirror (issue #1697).
    const ctx: TargetFilterCtx = {
        state: {
            activePlayerId,
            players: stateView.players,
        } as unknown as GameState,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: source.controllerId,
        activePlayerId,
    };
    const values: PermanentFilterValues = {
        controller: requirement.controller,
        subtypeFilter: requirement.subtypeFilter
            ? Array.isArray(requirement.subtypeFilter)
                ? requirement.subtypeFilter
                : [requirement.subtypeFilter]
            : undefined,
    };
    // CR 602.2b (issue #1951 review round 3, MINOR 8) — a `count >= 2`
    // ability (Sorrow's Path / General Jarkeld's swap-blockers, Garruk
    // Wildspeaker's "+1: Untap two target lands") needs at LEAST that many
    // legal candidates, not merely one: the old "return true on the first
    // hit" check let the tap menu offer the ability with a single legal
    // blocking creature, and `activateAbilityOnState`'s own matching
    // `minTargetCount` rejection (`convex/game.ts`) then threw "Not enough
    // legal targets" the moment the player tried it — a dead menu entry, the
    // exact symptom this gate exists to prevent for every other cost shape.
    const required = minTargetCountHint(requirement.count);
    // A zero-minimum requirement (an open "up to N" divide-as-you-choose
    // range, e.g. Fire Covenant/Meteor Shower with X = 0) needs no candidate
    // at all — CR 601.2d, there is nothing to divide.
    if (required <= 0) return true;
    let matchCount = 0;
    for (const player of stateView.players) {
        for (const permanent of player.battlefield) {
            if (
                requirement.excludeSource === true &&
                permanent.id === source.id
            ) {
                continue;
            }
            if (
                !matchesTargetRequirement(
                    permanent as unknown as CardInstance,
                    types
                )
            ) {
                continue;
            }
            if (
                checkPermanentTargetFilters(
                    ctx,
                    permanent as unknown as CardInstanceState,
                    values
                ) !== null
            ) {
                continue;
            }
            // CR 302.6 / 400.7 (issue #1824) — "target ... the active player
            // has controlled continuously since the beginning of the turn"
            // (Norritt, Arcum's Whistle). Judged HERE rather than through the
            // registry above, unlike every other dimension: the registry's
            // descriptor derives continuity from `enteredOnTurn` +
            // `GameState.turn` + the `controlChangedThisTurn` ledger, and this
            // gate's synthetic state is built from a `TriggerStateView`, which
            // carries none of the three. Routing through the descriptor
            // therefore fails CLOSED, not open: with no `state.turn` the
            // descriptor's `typeof ctx.state.turn !== "number"` branch returns
            // a violation for EVERY permanent, so the ability would never be
            // offered at all (verified empirically in review — the "is
            // OFFERED" test goes red while both "is HIDDEN" tests stay green).
            // `buildTriggerStateView` already pre-derives the answer per
            // permanent through the SAME authority
            // (`hasControlledSinceTurnStart`, `gre/controlContinuity.ts`), so
            // the boolean read here IS the registry's verdict, computed one
            // layer up. Left undefined when that reducer was called without
            // `turnState`, in which case this gate declines to judge —
            // fail-open, like every other dimension it cannot see, so a
            // legal-but-unjudgeable ability stays offered and the server
            // re-validates.
            // Third option, considered and NOT taken: thread `turn` /
            // `controlChangedThisTurn` onto the synthetic state so the
            // descriptor itself could judge, keeping ONE authority at this
            // site too. It is the structurally cleaner shape, but it widens
            // `TriggerStateView` (a wire-adjacent reducer shared by every
            // affordance) for a single filter; the pre-derived boolean already
            // comes from the same authority, so the two agree by construction.
            // Revisit if a second turn-scoped filter needs the same fields.
            if (
                requirement.controlledSinceTurnStart === true &&
                permanent.controlledSinceTurnStart === false
            ) {
                continue;
            }
            matchCount++;
            if (matchCount >= required) return true;
        }
    }
    return false;
}

/** CR 109.1 / 109.3 / 102.1 / 202 / 205 / 601.2c / 613 / 701.26 / 702 — THE
 *  single client-side authority for every PERMANENT-kind target-filter
 *  dimension, delegating to the SAME registry (`checkPermanentTargetFilters`,
 *  `convex/gre/targetFilters.ts`, ADR 0068) `getLegalTargets` (the offered
 *  set) and the `selectTarget` mutation (the accepted set, `convex/game.ts`)
 *  already share. Closes issue #1697 (Karakas: "target legendary creature"):
 *  the client previously only had bespoke per-dimension mirrors (controller,
 *  sameController, excludeTypes/excludeInstanceIds — since deleted, this
 *  registry-backed predicate is their sole replacement) — every OTHER
 *  dimension the registry knows about (`supertypeFilter`, `subtypeFilter`,
 *  `excludeSupertypes`, `excludeSubtypes`, `colorFilter`, `colorFilterAny`,
 *  `excludeColors`, `tappedFilter`, `combatRoleFilter`, `requireAbility`,
 *  `requireAbilityAny`, `excludeAbility`, `powerFilter`, `toughnessFilter`,
 *  `mvFilter`) was silently treated as unfiltered, so the highlight ring
 *  offered every permanent matching the structural `type` alone and
 *  selecting one the server actually rejected (e.g. a non-legendary
 *  creature) threw. A future filter added to the registry is honored here
 *  automatically — no hand-maintained per-dimension mirror to keep in sync.
 *
 *  `pendingTarget` already carries every filter field PRE-LOWERED
 *  (`PendingTarget`, `convex/gre/state.ts`) — the identical
 *  `PermanentFilterValues` shape `selectTarget` builds server-side from the
 *  very same object — so this only FORWARDS those fields, it never
 *  re-derives them from a `TargetRequirement`. `allPlayers`/`activePlayerId`
 *  build a minimal `GameState`-shaped view (the same established pattern as
 *  {@link affordableAltCostsForCard} above): the registry's power/toughness
 *  checks only read `state.players[].battlefield` through the layer system,
 *  which the wire-projected `Player[]` already carries in full. `emblems`
 *  (CR 114, issue #1221) is threaded the same way `effective-stats.ts`
 *  already does for `effectivePower`/`effectiveToughness` — the layer
 *  system's `getEffectivePower`/`getEffectiveToughness` read
 *  `state.emblems ?? []` for owner-scoped `pt-buff` statics (Sorin, Lord of
 *  Innistrad's "Creatures you control get +1/+0" emblem, `convex/gre/layers.ts`);
 *  omitting it from the synthetic state under-computes P/T here and
 *  OVER-filters a `powerFilter`/`toughnessFilter` requirement relative to the
 *  server (a legal target silently reads as unclickable — the inverse of
 *  #1697's symptom). Does NOT check the structural `targetType` (CardType
 *  membership) — {@link matchesTargetRequirement} remains the gate for that,
 *  since `type` is a `StructuralKey` in the registry, not a per-candidate
 *  filter. */
export function matchesPermanentTargetFilters(
    card: CardInstance,
    pendingTarget: PendingTarget,
    allPlayers: ReadonlyArray<Player>,
    activePlayerId: string,
    /** Projected `{ turn, controlChangedThisTurn }` (CR 302.6 / 400.7, issue
     *  #1824) — the two wire fields `PendingTarget.controlledSinceTurnStart`
     *  is evaluated against (Norritt, Arcum's Whistle). REQUIRED, unlike
     *  `toMatchablePermanent`/`buildTriggerStateView`'s optional twin: those
     *  build a VIEW whose unpopulated dimension fails closed by itself,
     *  whereas this function's synthetic `GameState` reaches the registry
     *  directly, so a caller omitting the fields must be a COMPILE error
     *  rather than a silently-narrowed board. Pass `undefined` only when the
     *  engine turn is genuinely unknown (a hand-built test context) — the
     *  filter then fails CLOSED, never open.
     *
     *  `turn` must be the ENGINE turn (`useGameContext().engineTurn` /
     *  `GameState.turn`), never the board's display counter: `enteredOnTurn`
     *  is stamped from the global turn number. */
    turnState: ControlContinuityView | undefined,
    emblems?: ReadonlyArray<EmblemInstance>
): boolean {
    // CR 601.2c — a permanent already chosen under THIS SAME requirement is
    // never a legal SECOND pick (Magma Burst's kicked "another target", Dust
    // to Dust's "two target artifacts"). Mirrors the server's own exclusion
    // (`isAlreadySelectedTarget`, `getLegalTargets`/`selectTarget`) so an
    // already-picked permanent can't still read as clickable — the inverse
    // of the #1697 symptom this function otherwise guards against.
    if (
        isAlreadySelectedTarget(
            { type: "permanent", id: card.id },
            pendingTarget.selected
        )
    ) {
        return false;
    }
    const siblingControllerId = ((): string | undefined => {
        if (
            !pendingTarget.sameController ||
            pendingTarget.selected.length === 0
        ) {
            return undefined;
        }
        const sibling = pendingTarget.selected.find(
            (t) => t.type === "permanent"
        );
        if (!sibling) return undefined;
        for (const p of allPlayers) {
            const found = p.battlefield.find((c) => c.id === sibling.id);
            if (found) return found.controllerId;
        }
        return undefined;
    })();

    const state = {
        activePlayerId,
        players: allPlayers,
        // CR 114 (issue #1221) — command-zone emblems (Sorin, Lord of
        // Innistrad's anthem). See the doc comment above: without this, a
        // `powerFilter`/`toughnessFilter` check over-filters relative to the
        // server.
        emblems,
        // CR 302.6 / 400.7 (issue #1824) — the two facts
        // `controlledSinceTurnStart` is evaluated against (Norritt, Arcum's
        // Whistle). Spread rather than assigned so an absent `turnState`
        // leaves `state.turn` UNDEFINED, which the descriptor detects and
        // fails CLOSED on — assigning `turn: undefined` explicitly would read
        // identically, but the spread keeps the "these fields simply aren't
        // here" intent legible.
        ...(turnState ?? {}),
    } as unknown as GameState;
    const ctx: TargetFilterCtx = {
        state,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: pendingTarget.playerId,
        activePlayerId,
        siblingControllerId,
    };
    // Derived by iterating `PERMANENT_FILTER_KEYS`, never spelled out field by
    // field: `PermanentFilterValues` is a `Partial<>`, so a hand-written map
    // can drop a carried filter with `tsc` green — the client then highlights a
    // permanent the server rejects, the #1697 symptom re-opened one dimension
    // at a time (issue #1824 review). Same single derivation the server's own
    // accepted-set site uses.
    const values = permanentFilterValuesFromCarrier(pendingTarget);
    // Sound: the wire-projected `CardInstance` is a structural superset of the
    // fields `checkPermanentTargetFilters`/the layer system read off
    // `CardInstanceState` (the same cast pattern `effective-stats.ts`'s
    // `toPermanentView` uses for `PermanentView`).
    return (
        checkPermanentTargetFilters(
            ctx,
            card as unknown as CardInstanceState,
            values
        ) === null
    );
}

/** True if the target requirement can target a spell on the stack (CR 114.1):
 *  the `"spell"` or `"spell-or-permanent"` types. */
export function wantsSpellTarget(
    targetType: string | string[] | undefined
): boolean {
    if (!targetType) return false;
    const types = Array.isArray(targetType) ? targetType : [targetType];
    return types.includes("spell") || types.includes("spell-or-permanent");
}

/** The ONE client-side predicate for "is this stack item clickable as a spell
 *  target" (CR 114.1) — the spell-kind twin of
 *  {@link matchesPermanentTargetFilters}, and built the same way (issue #1734,
 *  the sibling of #1697/#1732).
 *
 *  Every filter dimension delegates to `checkSpellTargetFilters` — the SAME
 *  registry (`convex/gre/targetFilters.ts`, ADR 0068) that `getLegalTargets`
 *  (the offered set) and the `selectTarget` mutation (the accepted set,
 *  `convex/game.ts`) already share — with the forward set produced by
 *  `spellFilterValuesFromCarrier`, which iterates `SPELL_FILTER_KEYS`, the very
 *  list the check loops. A spell filter added to the registry is therefore
 *  honored here automatically: there is no per-dimension client mirror left to
 *  keep in sync, and no `"server-only"` bucket.
 *
 *  This REPLACES nine hand-written mirrors (`matchesSpellTypeFilter`,
 *  `matchesSpellExcludeTypeFilter`, `matchesSpellCreaturePtFilter`,
 *  `matchesSpellSingleTargetingController`, `matchesSpellController`,
 *  `matchesSpellWouldDestroyLand`, `matchesStackObjectFilter`,
 *  `matchesSpellTargetsTypeFilter`, `matchesSpellWasKicked`) plus the
 *  `CLIENT_SPELL_FILTER_COVERAGE` classification map that existed only to make
 *  their incompleteness a compile error. Four divergences the mirrors had
 *  actually accumulated, all closed by construction here:
 *
 *  1. `colorFilter` / `colorFilterAny` / `mvFilter` were classified
 *     `"server-only"` — never checked client-side at all, so Spell Blast's
 *     "counter target spell with mana value X" offered every spell on the
 *     stack and the server refused the click (the #1697 symptom, spell-kind).
 *  2. Four mirrors tested `abilityId || triggeredAbilityId` but NOT
 *     `delayedTriggerId` (CR 603.7a), so a delayed trigger on the stack read as
 *     a legal "spell" target — fail-OPEN.
 *  3. `matchesSpellController`'s `"opponent"` branch required `castById !==
 *     undefined`, where `matchesBattlefieldController` (the shared authority)
 *     only requires a defined CHOOSER — fail-CLOSED for a caster-less item.
 *  4. `matchesSpellWouldDestroyLand` recognised only `def.effect ===
 *     "destroy-target"` and missed the Effect Script branch
 *     (`def.effects?.some((op) => op.op === "destroy")`, ADR 0045) the registry
 *     has, so a DSL land-destruction spell was silently unclickable under
 *     Equinox — fail-CLOSED.
 *
 *  **Wire safety (issue #1732's lesson).** The client sees a PROJECTED state,
 *  so routing a kind through the shared checker over-filters if the checker
 *  reads a field the projection drops. Audited dimension by dimension: the ONLY
 *  thing `slimCard` (`convex/gameProjections.ts`) strips from a stack item is
 *  the fat `card` definition (→ `{ id }`), plus `knownTo`/`stormSnapshot` which
 *  no filter reads. Every other field the fourteen spell dimensions touch
 *  (`types`, `power`, `toughness`, `castById`, `targets`, `chosenX`,
 *  `kickerPayments`, `abilityId`, `triggeredAbilityId`, `delayedTriggerId`,
 *  `colorOverride`, `grantedColors`) passes through untouched, and the two
 *  dimensions that need definition data (`mvFilter` via `mvOfStackItem`,
 *  `colorFilter`/`colorFilterAny` via `getEffectiveColors`) read `card.id` and
 *  fall back to the bundled card registry — the same registry the server uses. */
export function matchesSpellPendingTarget(
    item: {
        id: string;
        card: { id: string };
        types?: string[];
        abilityId?: string;
        triggeredAbilityId?: string;
        delayedTriggerId?: string;
        power?: number;
        toughness?: number;
        castById?: string;
        chosenX?: number;
        targets?: { type: string; id: string }[];
        kickerPayments?: Record<string, number>;
    },
    pendingTarget: PendingTarget | undefined,
    ctx: {
        playerId: string;
        activePlayerId: string;
        players: { id: string; battlefield: CardInstance[] }[];
    }
): boolean {
    if (!pendingTarget) return true;
    // CR 601.2c — a stack object already chosen under THIS SAME requirement is
    // never a legal SECOND pick. Mirrors the server's own exclusion
    // (`isAlreadySelectedTarget`, applied by `getLegalTargets` to every kind)
    // and `matchesPermanentTargetFilters`' identical guard.
    if (
        isAlreadySelectedTarget(
            { type: "spell", id: item.id },
            pendingTarget.selected
        )
    ) {
        return false;
    }
    // Two spell dimensions scan the board (`spellWouldDestroyLandYouControl`
    // resolves the candidate's chosen land targets, `spellTargetsTypeFilter`
    // resolves its chosen permanent targets), so the synthetic `GameState`
    // carries the projected players — an empty board would fail both CLOSED.
    const state = {
        activePlayerId: ctx.activePlayerId,
        players: ctx.players,
    } as unknown as GameState;
    const filterCtx: TargetFilterCtx = {
        state,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: ctx.playerId,
        activePlayerId: ctx.activePlayerId,
    };
    // `types`/`targets` are non-optional on the engine's `StackItem` (the
    // checks index them directly) but optional on the wire shape callers hand
    // us, so they are normalized rather than cast away.
    const candidate = {
        ...item,
        types: item.types ?? [],
        targets: item.targets ?? [],
    } as unknown as StackItem;
    return (
        checkSpellTargetFilters(
            filterCtx,
            candidate,
            spellFilterValuesFromCarrier(pendingTarget)
        ) === null
    );
}

/** The ONE client-side predicate for "is this player clickable as a target"
 *  (CR 115.4) — the player-kind twin of {@link matchesPermanentTargetFilters}
 *  and {@link matchesSpellPendingTarget} (issue #1734).
 *
 *  Every filter dimension delegates to `checkPlayerTargetFilters` — the SAME
 *  registry (ADR 0068) `getLegalTargets` and `selectTarget` share — with the
 *  forward set produced by `playerFilterValuesFromCarrier`, which iterates
 *  `PLAYER_FILTER_KEYS`, the very list the check loops. It replaces an inline
 *  `playerAttackedThisTurn` clause in `usePlayerInteraction` that reproduced
 *  ONE of the kind's dimensions and simply did not have the other:
 *
 *  - `controller` (CR 109.3 / 115 — Word of Command's "target opponent") was
 *    NEVER checked client-side, so a `controller: "you"` / `"opponent"` /
 *    `"active"` player requirement lit up BOTH nameplates and the server
 *    rejected whichever one the player clicked — the #1697 symptom, player-kind.
 *
 *  The colour gate is not a registry filter but a kind-level exclusion the
 *  server applies at both sites (`getLegalTargets` skips the whole player loop
 *  when a colour filter is set; `selectTarget` throws "Players have no color"),
 *  so it is reproduced here rather than routed — CR 105.2: a player has no
 *  colour, so a colour-filtered requirement can never admit one.
 *
 *  **Wire safety.** Both dimensions read only fields the projection preserves
 *  verbatim: `controller` reads `player.id` (untouched by the `PublicPlayer` /
 *  `FullPlayer` reshape) and `playerAttackedThisTurn` reads
 *  `player.battlefield[].hasAttackedThisTurn`, which `slimCard` passes through
 *  (it only rewrites `card` → `{ id }`). Neither reads `ctx.state`. */
export function matchesPlayerTargetFilters(
    player: { id: string; battlefield: ReadonlyArray<CardInstance> },
    pendingTarget: PendingTarget,
    activePlayerId: string
): boolean {
    // CR 601.2c — a player already chosen under THIS SAME requirement is never
    // a legal second pick (Magma Burst's kicked "another target").
    if (
        isAlreadySelectedTarget(
            { type: "player", id: player.id },
            pendingTarget.selected
        )
    ) {
        return false;
    }
    // CR 105.2 — players have no colour. Mirrors `getLegalTargets`' own gate
    // (`!colorFilter && !colorFilterAny` around the whole player loop) and
    // `selectTarget`'s "Players have no color" throw.
    if (
        pendingTarget.colorFilter !== undefined ||
        pendingTarget.colorFilterAny !== undefined
    ) {
        return false;
    }
    const filterCtx: TargetFilterCtx = {
        // No player-kind check reads `ctx.state`; the two dimensions read the
        // CANDIDATE (`player.id`, `player.battlefield`) and the chooser/active
        // ids threaded below.
        state: { activePlayerId } as unknown as GameState,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: pendingTarget.playerId,
        activePlayerId,
    };
    return (
        checkPlayerTargetFilters(
            filterCtx,
            player as unknown as PlayerState,
            playerFilterValuesFromCarrier(pendingTarget)
        ) === null
    );
}

/** Builds a `TriggerStateView` (the shape `canActivate` predicates read,
 *  CR 602.5b) from the viewer-visible players and turn state. Predicates
 *  legitimately inspect `state.players` (a controller's hand size — Library of
 *  Alexandria; any creature on the battlefield — Pestilence) and
 *  `state.activePlayerId` (Nettling Imp's "only during an opponent's turn"),
 *  so feeding them an empty player list made every such ability misjudged as a
 *  UI hint (#436). This re-projects the client `Player[]` into the minimal view
 *  the contract requires; the server's full `GameState` evaluation stays
 *  authoritative. Only fields cards may rely on are surfaced — `hand.length`,
 *  battlefield `types`/`subtypes`/`staticAbilities`, life, ids. */
export function buildTriggerStateView(
    players: ReadonlyArray<{
        id: string;
        life: number;
        hand: ReadonlyArray<unknown>;
        battlefield: ReadonlyArray<CardInstance>;
        graveyard?: ReadonlyArray<CardInstance>;
    }>,
    activePlayerId?: string,
    /** Player ids under Abeyance's "can't activate abilities that aren't mana
     *  abilities" lock (CR 602.1, issue #1124) — forwarded from the wire
     *  `GameState.cannotActivateAbilitiesThisTurn` so `getStackAbilities` can
     *  hide the affected controller's non-mana abilities as a UI hint. */
    cannotActivateAbilitiesThisTurn?: ReadonlyArray<string>,
    /** Life gained by each player this turn (CR 119.3 tally, issue #1457) —
     *  forwarded from the wire `GameState.lifeGainedThisTurn` (it survives
     *  `projectPublicState`'s `...state` spread untouched) so a client-side
     *  `canActivate` / condition predicate can answer "if you gained life this
     *  turn" with the SAME number the server's intervening-if reads. Dropping
     *  it here would make any such affordance permanently invisible. */
    lifeGainedThisTurn?: Readonly<Record<string, number>>,
    /** Projected `{ turn, controlChangedThisTurn }` — mirrors
     *  `toMatchablePermanent`'s identical optional param exactly (issue
     *  #1951 review round 3, MAJOR 5). Required only by the two turn-scoped
     *  `PermanentFilter` dimensions (`enteredThisTurn`/
     *  `controlledSinceTurnStart`); omitted, both stay undefined and any
     *  filter using them fails closed (see `TRIGGER_STATE_VIEW_CENSUS`
     *  below). No shipped `sacrificeFilter`/`tapOtherFilter` cost uses
     *  either dimension yet, so no existing caller is required to pass
     *  this — it exists so a FUTURE one can, without another silent gap. */
    turnState?: ControlContinuityView
): TriggerStateView {
    return {
        players: players.map((p) => ({
            id: p.id,
            life: p.life,
            hand: { length: p.hand.length },
            // CR 118.5 — graveyard contents feed the exile-from-graveyard
            // activation-cost affordability hint (Grim Lavamancer, Night Soil)
            // in `getStackAbilities`; without it the ability is wrongly hidden.
            graveyard: (p.graveyard ?? []).map((c) => ({
                id: c.id,
                ownerId: c.ownerId,
                types: c.types ?? [],
            })),
            battlefield: p.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types ?? [],
                subtypes: c.subtypes ?? [],
                staticAbilities: c.staticAbilities ?? [],
                // CR 613.4 — EFFECTIVE P/T, not the instance's base values.
                // Counters (layer 7c) and anthems/pump (7d) are applied at
                // READ time by the layer system and are never baked into
                // `c.power`, so weighing the base value here made the crew
                // affordability hint disagree with the server's own
                // `getEffectivePower` (a creature pumped over the Crew N
                // threshold had the ability hidden; a shrunk one was offered
                // and then rejected). Same computation as the server's, via
                // the shared client-side layer projection.
                power: effectivePower(players, c),
                toughness: effectiveToughness(players, c),
                isTapped: c.isTapped === true,
                // CR 202.2 / 613.1d — effective colours for a tapOtherFilter
                // colour clause (Hand of Justice), via the single colour
                // authority: layer-5 override SETS, `grantedColors` UNION.
                colors: getEffectiveColors(c as unknown as PermanentView),
                // CR 702.122b — "crews Vehicles as though its power were N
                // greater" (Shorikai's Pilot token) feeds the Crew N
                // affordability hint below; without it a board that CAN crew
                // only thanks to the bonus would never be offered the ability.
                crewPowerBonus: tryGetDefinition(c.card.id)?.crewPowerBonus,
                // CR 205.4a — LIVE supertypes, for a `sacrificeFilter`
                // activation cost narrowed by supertype (Sunstone / Glacial
                // Crevasses / Whiteout's "sacrifice a snow land"). Printed
                // supertypes ALONE (`tryGetDefinition(...).supertypes`) missed
                // a snow status granted by a `supertype-set` static effect or
                // indefinite mutation (Melting / Arcum's Weathervane) — the
                // server resolves the cost via `liveSupertypesOf`
                // (`activateAbilityOnState`, game.ts), so a Weathervane'd land
                // was a dead affordance: the server would activate the
                // ability, the client gate would hide it (issue #2235
                // review). `liveSupertypesOf` reads `grantedSupertypes`/
                // `removedSupertypes`, which cross the wire unchanged
                // (`slimCard` only strips `card`/`knownTo`).
                supertypes: liveSupertypesOf(c),
                // CR 111.5 / 701.21 — token-ness, for a `sacrificeFilter`
                // activation cost narrowed by `isToken` (Thopter Foundry's
                // "sacrifice a NONTOKEN artifact", Caribou Range's "sacrifice
                // a Caribou TOKEN"). `CardInstanceState.isToken` IS a real
                // persisted/wire field (unlike `supertypes`/`colors` above,
                // which need a registry lookup) — read it straight off the
                // instance rather than the definition. Omitting this left
                // every view entry reading `isToken: undefined`, which
                // `matchesPermanentFilter` treats as `false` — silently
                // hiding a token-sacrifice ability with tokens on board and
                // silently OFFERING a nontoken-only sacrifice ability whose
                // only candidates were tokens (issue #1951 review, round 2).
                isToken: c.isToken === true,
                // CR 508/509 — combat-role filters (a `sacrificeFilter`/
                // `tapOtherFilter` scoped to attackers/blockers). Same
                // fail-closed-vs-fail-open class as `isToken` above: an
                // unpopulated `isAttacking`/`isBlocking` reads as `false`
                // regardless of reality (issue #1951 review round 3, MAJOR 5
                // — "fix the class, not the field").
                isAttacking: c.isAttacking === true,
                isBlocking: c.isBlocking === true,
                // CR 111 / 707.1 — token provenance, for a `sacrificeFilter`
                // scoped to "tokens created with <this>" (Tetravus-style).
                // Direct wire field, same as `isToken`, no registry lookup.
                createdBy: c.createdBy,
                // CR 307.1 / 117.1a — the cast-time snapshot a CR 603.4
                // check-time condition reads off the permanent itself
                // (Necromancy's "if you cast it any time a sorcery couldn't
                // have been cast", issue #2392). Same fail-silent class as
                // `isToken`/`isAttacking` above: an unpopulated flag reads
                // `undefined`, which every `=== true` condition treats as
                // "cast at sorcery speed" — the wrong answer for EVERY
                // off-window cast, with nothing to distinguish it from a
                // genuine one. `CardInstanceState.castOffSorceryTiming` is a
                // real persisted/wire field (`slimCard` only strips
                // `card`/`knownTo`), so it is read straight off the instance.
                castOffSorceryTiming: c.castOffSorceryTiming === true,
                // CR 400.7 / Keldon Twilight-style continuity filters. Only
                // meaningful with `turnState` (mirrors `toMatchablePermanent`
                // exactly); omitted, both stay undefined — fail-closed, same
                // as every other unsupplied filter dimension here.
                ...(turnState
                    ? {
                          enteredThisTurn: c.enteredOnTurn === turnState.turn,
                          controlledSinceTurnStart: hasControlledSinceTurnStart(
                              turnState,
                              c
                          ),
                      }
                    : {}),
            })),
        })),
        activePlayerId,
        cannotActivateAbilitiesThisTurn,
        lifeGainedThisTurn,
    };
}

/** The alternative casting costs (CR 118.9) the caster can currently AFFORD for
 *  a hand card — the cast-availability CONDITION holds ("not your turn", "you
 *  control a Swamp") AND the cost is payable from the viewer-visible
 *  board/hand/life. The cast-option picker offers ONLY these: an unaffordable or
 *  condition-failing alternative (Force of Negation / Force of Vigor pitched on
 *  your own turn, Mine Collapse pitched on the opponent's turn, Snuff Out's "Pay
 *  4 life" without a Swamp) is filtered out so clicking it never throws a hard
 *  `announceCast` rejection ("Can't pay the alternative cost"). Delegates to the
 *  server predicate `affordableAlternativeCosts` — the same authority the
 *  mutation enforces — so the UI and the GRE can never disagree (no duplicated
 *  condition logic client-side). The projected `Player`/`CardInstance` shapes
 *  carry every field the predicate reads (`activePlayerId`, battlefield
 *  `types`/`subtypes`/`colorOverride`, own-hand `card.id`, `life`), so it
 *  evaluates correctly against the wire projection. */
export function affordableAltCostsForCard(
    card: CardInstance,
    casterId: string,
    players: ReadonlyArray<Player>,
    activePlayerId: string
): AlternativeCost[] {
    const caster = players.find((p) => p.id === casterId);
    if (!caster) return [];
    const state = {
        activePlayerId,
        players,
    } as unknown as GameState;
    return affordableAlternativeCosts(
        state,
        caster as unknown as PlayerState,
        card as unknown as CardInstanceState
    );
}

/** CR 702.33a — the card's Kickers whose NON-MANA legs the caster can actually
 *  pay right now (enough matching permanents to sacrifice/return, enough life,
 *  enough matching cards in hand). Mirrors `affordableAltCostsForCard` exactly:
 *  the wire-projected client view is handed to the SERVER's own
 *  `canPayKickerLegs` (`convex/gre/kicker.ts`), so the cast-cost dialog offers
 *  precisely the Kickers `announceCast` would accept and the two can never
 *  disagree (ADR 0074 — shared module, server authority; ADR 0079).
 *
 *  MANA legs are deliberately NOT priced here: a Kicker's mana folds into the
 *  spell's total and is paid by the ordinary deferred-payment path, so a caster
 *  with an empty pool may still legally announce a kicked cast and then tap for
 *  it. Gating on mana would hide the toggle for every kicked cast made from
 *  untapped lands. */
export function affordableKickersForCard(
    card: CardInstance,
    casterId: string,
    players: ReadonlyArray<Player>,
    activePlayerId: string
): KickerCost[] {
    const def = tryGetDefinition(card.card.id);
    const kickers = def?.kickers;
    if (!kickers || kickers.length === 0) return [];
    const caster = players.find((p) => p.id === casterId);
    if (!caster) return [];
    const state = {
        activePlayerId,
        players,
    } as unknown as GameState;
    return kickers.filter((k) =>
        canPayKickerLegs(
            state,
            caster as unknown as PlayerState,
            { ...def, kickers: [k] } as CardDefinition,
            { [k.id]: 1 },
            card.id
        )
    );
}

/** Does a HAND card (wire-projected `CardInstance`) match an
 *  `EffectCardFilter`? Thin wrapper around the server's
 *  `handCardMatchesFilter` (`convex/gre/alternativeCost.ts`) — delegates to
 *  the SAME predicate the mutation enforces (mirrors `affordableAltCostsForCard`
 *  above) so the UI and the GRE can never disagree on hand-card eligibility.
 *  Shared (issue #901) by every client-side hand-card-matching picker/gate:
 *  the alternative-cost hand leg (`CastAlternativeHandCostDialog`) and the
 *  `discardFilter` activation-cost leg (`DiscardCostDialog`, and the
 *  `getStackAbilities` affordability gate below). */
export function matchesHandCardFilter(
    card: CardInstance,
    filter: EffectCardFilter
): boolean {
    return handCardMatchesFilter(card as unknown as CardInstanceState, filter);
}

/** CR 602.5b — shared activation-TIMING predicate consulted by every
 *  zone-listing helper below (`getStackAbilities`, `getGraveyardStackAbilities`,
 *  `getHandStackAbilities`, and the `opponentOnly` branch of
 *  `getAnyPlayerStackAbilities`) so a printed activation-timing restriction
 *  hides an ability IDENTICALLY regardless of which zone/branch lists it
 *  (issue #1694 — the battlefield helper diverged from its graveyard/hand
 *  siblings and never checked `controllerTurnOnly` at all, so a permanent like
 *  Disrupting Scepter offered its ability during the opponent's turn and the
 *  server rejected the click). Mirrors the server's authoritative chokepoint
 *  `assertActivationTimingLegal` (`convex/game.ts`) for all FOUR restrictions
 *  it enforces:
 *   - `activationPhaseRestriction` (CR 602.5, phase/step-scoped — "only during
 *     your upkeep", "only during combat") — the current `phase` must be a
 *     member of the allow-list;
 *   - `sorcerySpeedOnly` (CR 602.3b / 307.5 — "Activate only as a sorcery") —
 *     narrowed client-side to the main-phase half of the server's
 *     `isSorceryTiming`; this view has no stack-length/priority-holder field
 *     to check the rest, so the mutation stays authoritative for that part;
 *   - `controllerTurnOnly` (CR 602.5b — "Activate only during your turn") —
 *     `turnOwnerId` (the permanent's controller while it's on the battlefield,
 *     its owner while it sits in hand/graveyard, since CR 602.5's "your"
 *     tracks whoever would control it) must be the active player;
 *   - `oncePerTurn` (CR 602.5 — "Activate only once each turn", Gate to
 *     Phyrexia) — IS evaluable client-side: the per-ability tally lives on
 *     `CardInstanceState.activationsThisTurn` (`convex/gre/state.ts`) and
 *     survives the wire (`slimCard` spreads the instance, `convex/
 *     gameProjections.ts`), so a prior fix that skipped this restriction as
 *     "not evaluable as a client hint" was factually wrong.
 *   - `requiresAttackedThisTurn` (CR 702.142a — Boast's "Activate only if this
 *     creature attacked this turn", Broadside Bombardiers) — IS evaluable
 *     client-side off the source instance's `hasAttackedThisTurn`.
 *  Every check fails OPEN when its driving field is unknown (`phase`,
 *  `activePlayerId`, or `activationsThisTurn` undefined) — the discipline
 *  every call site already followed individually before this predicate was
 *  extracted: a gate that cannot be evaluated must never hide an
 *  otherwise-legal ability; only the server's hard throw is authoritative.
 *  `requiresAttackedThisTurn` is the ONE deliberate exception, because its
 *  driving field has no unknown state to fail open on — see that parameter's
 *  own doc comment. */
export function isActivationTimingAllowed(
    ability: {
        id: string;
        activationPhaseRestriction?: ReadonlyArray<Phase>;
        sorcerySpeedOnly?: boolean;
        controllerTurnOnly?: boolean;
        oncePerTurn?: boolean;
        requiresAttackedThisTurn?: boolean;
    },
    turnOwnerId: string,
    phase: Phase | undefined,
    activePlayerId: string | undefined,
    /** Per-ability-id activation tally for this turn
     *  (`CardInstanceState.activationsThisTurn`). Omit (or an id absent from
     *  the map) fails OPEN — an unknown counter must never hide a legal
     *  activation. */
    activationsThisTurn?: Readonly<Record<string, number>>,
    /** The SOURCE permanent's `hasAttackedThisTurn` flag (CR 508.1), driving
     *  Boast's "Activate only if this creature attacked this turn"
     *  (CR 702.142a). Unlike every other gate here this one does NOT fail
     *  open on an absent value, because absence is not ambiguity: the engine
     *  only ever writes the flag `true` (`gre/combat.ts`), `serialize.ts`
     *  round-trips it, and `slimCard` (`convex/gameProjections.ts`) spreads
     *  the instance so it reaches the client intact — `undefined` therefore
     *  MEANS "has not attacked". Failing open here would make the hint
     *  useless: the ability would be offered on every untapped creature all
     *  game and only the server's throw would say no. */
    hasAttackedThisTurn?: boolean
): boolean {
    if (
        ability.activationPhaseRestriction &&
        phase !== undefined &&
        !ability.activationPhaseRestriction.includes(phase)
    ) {
        return false;
    }
    if (
        ability.sorcerySpeedOnly &&
        phase !== undefined &&
        phase !== "PRECOMBAT_MAIN" &&
        phase !== "POSTCOMBAT_MAIN"
    ) {
        return false;
    }
    if (
        ability.controllerTurnOnly &&
        activePlayerId !== undefined &&
        activePlayerId !== turnOwnerId
    ) {
        return false;
    }
    if (ability.oncePerTurn) {
        const used = activationsThisTurn?.[ability.id] ?? 0;
        if (used >= 1) {
            return false;
        }
    }
    // CR 702.142a (Boast) — "Activate only if this creature attacked this
    // turn". Mirrors the server's `assertActivationTimingLegal` clause exactly;
    // see the parameter's own doc comment for why this gate is fail-CLOSED
    // while its siblings above are fail-open.
    if (ability.requiresAttackedThisTurn && hasAttackedThisTurn !== true) {
        return false;
    }
    return true;
}

/** Returns stack-using activated abilities the player can currently announce.
 *  Only the non-mana availability is checked (source not already tapped when
 *  the ability has {T}); mana is deferred to a `pendingActivation` payment
 *  phase on the server, mirroring the spell cast flow. `phase` narrows to
 *  abilities whose `activationPhaseRestriction` (CR 602.5) allows the
 *  current phase — pass the current game phase to hide abilities like
 *  Jade Statue's animate outside of combat. */
export function getStackAbilities(
    card: CardInstance,
    phase?: Phase,
    /** True iff the controller has a "last card drawn this turn" still in
     *  hand. Gates the Jandor's Ring discard cost as a UI hint; the server
     *  validation is authoritative. Defaults to true so callers that don't
     *  pass it (and abilities without the cost) are unaffected. */
    canDiscardLastDrawn: boolean = true,
    /** Viewer-visible game state for `canActivate` predicates (CR 602.5b).
     *  When omitted, an empty player list is used — sufficient for predicates
     *  that only inspect the source permanent (e.g. Clockwork Beast's counter
     *  cap), but a predicate that scans players/battlefields will see nothing.
     *  Callers with access to player/turn state MUST pass a real view (built
     *  via `buildTriggerStateView`) so player-state-reading abilities — Library
     *  of Alexandria, Pestilence, Nettling Imp — are surfaced correctly (#436). */
    stateView?: TriggerStateView,
    /** Life available to the player who would pay the ability's cost. Gates the
     *  CR 119.4 life-payment cost as a UI hint: an ability whose `cost.life`
     *  exceeds it is unpayable and hidden, mirroring the server throw ("Not
     *  enough life"). Omit to skip the gate (callers/tests without life data). */
    payerLife?: number,
    /** The activating player's OWN real hand cards (never the opponent's —
     *  those are stripped to `null` on the wire and never reach this gate).
     *  Gates the CR 602.1 / 118.3 `discardFilter` activation cost (Survival
     *  of the Fittest "Discard a creature card") as a UI hint: an ability
     *  whose `cost.discardFilter` has fewer than `count` matching cards in
     *  this hand is unpayable and hidden, mirroring the server throw ("Not
     *  enough matching cards in hand to pay the discard cost"). Omit to skip
     *  the gate (callers without hand data, or the non-controller
     *  `getAnyPlayerStackAbilities` path — a `discardFilter` cost is always
     *  paid from the CONTROLLER's own hand, never the activator's). */
    discardFilterHand?: ReadonlyArray<CardInstance>,
    /** The player who would ACTIVATE — normally the source's controller, which
     *  is why every other gate here reads `card.controllerId`. Only
     *  `activatableByEnchantedController` (CR 602.1, FEM Merseine: "Only the
     *  controller of the enchanted creature may activate this ability") divorces
     *  the two: the Aura's controller and the activator can be different
     *  players. Omit for the ordinary controller-activates listing. */
    activatorId?: string
): { id: string; oracleText: string }[] {
    const tapLocked = isTapLockedBySummoningSickness(card);
    const filterAbility = (a: {
        id: string;
        useStack: boolean;
        oracleText: string;
        oncePerTurn?: boolean;
        cost: {
            tap?: boolean;
            life?: number;
            loyalty?: number;
            removeCounter?: { type: string; count: number };
            discardLastDrawn?: boolean;
            discardFilter?: { filter: EffectCardFilter; count: number };
            exileFromGraveyard?: {
                count: number;
                cardType?: CardType;
                owner?: "you";
            };
            /** CR 602.1 / 118.8 + CR 702.122a — "tap untapped permanents you
             *  control" (fixed `count`) / Crew N (`totalPower`). */
            tapOtherFilter?: {
                filter: PermanentFilter;
                count?: number;
                totalPower?: number;
            };
            /** CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>"
             *  as an activation cost (Deadapult's "Sacrifice a Zombie",
             *  Priest of Yawgmoth's "Sacrifice an artifact"). Distinct from
             *  `tapOtherFilter`: no self-exclusion — the source itself is a
             *  legal candidate when it matches (the server's own
             *  `matchesPermanentFilter` check, `game.ts`, doesn't exclude it
             *  either — Thopter Foundry's "sacrifice a nontoken artifact" can
             *  legally sacrifice itself). */
            sacrificeFilter?: PermanentFilter;
            /** CR 602.1 / 118.5 (issue #2398) — how many matching permanents
             *  the cost gives up ("Sacrifice ten nonland permanents", Bolas's
             *  Citadel). Omitted = 1. */
            sacrificeFilterCount?: number;
        };
        activationPhaseRestriction?: ReadonlyArray<Phase>;
        sorcerySpeedOnly?: boolean;
        /** CR 601.2c — the ability's declared target requirement, when it
         *  targets. Read by the CR 602.2b no-legal-target gate below. */
        targetRequirement?: TargetRequirement;
        controllerTurnOnly?: boolean;
        /** CR 702.142a — Boast's "Activate only if this creature attacked this
         *  turn", weighed by the shared `isActivationTimingAllowed` predicate
         *  against the source instance's `hasAttackedThisTurn`. */
        requiresAttackedThisTurn?: boolean;
        activatableByOpponentsOnly?: boolean;
        activatableByEnchantedController?: boolean;
        activateFromHand?: boolean;
        activateFromGraveyard?: boolean;
        canActivate?: (
            source: PermanentView,
            state: TriggerStateView
        ) => boolean;
    }): boolean => {
        if (!a.useStack || !a.oracleText) return false;
        // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate abilities
        // that aren't mana abilities" lock hides every non-mana ability on the
        // controller's permanents as a UI hint; the `activateAbility` mutation
        // is the authoritative gate. SCOPE: gates on the card's CONTROLLER,
        // which is correct for every normal (`isMe`-only) call site, but
        // `getAnyPlayerStackAbilities` re-filters this same list for a
        // non-controller ACTIVATOR (an "any player may activate" / "opponents
        // only" ability) — that narrower activator-vs-controller distinction
        // isn't threaded through here, so a locked non-controller activator on
        // an unlocked controller's permanent is not hidden client-side. The
        // server gate is unaffected and remains correct either way.
        if (
            stateView?.cannotActivateAbilitiesThisTurn?.includes(
                card.controllerId
            )
        ) {
            return false;
        }
        // CR 113.6 / 702.29a — a zone-restricted ability functions ONLY from the
        // zone it opts into: Cycling (`activateFromHand`) from the hand, Ashen
        // Ghoul (`activateFromGraveyard`) from the graveyard. Neither is a
        // battlefield ability, so a permanent whose definition carries one (a
        // Marauding Mako that resolved onto the battlefield) must NOT surface it
        // in its battlefield menu — the server rejects it there regardless.
        if (a.activateFromHand || a.activateFromGraveyard) return false;
        // CR 602.1 — "only your opponents may activate" abilities are never
        // surfaced on the controller's OWN permanent (this function is called
        // only for `isMe` cards); the opponent's view uses
        // `getAnyPlayerStackAbilities`.
        if (a.activatableByOpponentsOnly) return false;
        // CR 602.1 (FEM Merseine) — "Only the controller of the enchanted
        // creature may activate this ability". The activator is the HOST's
        // controller, which need not be the Aura's controller, so this listing
        // can't assume its usual "controller activates" identity: it is offered
        // only when `activatorId` is the controller of the permanent the source
        // is attached to. Deliberately fails CLOSED when the host or the
        // activator can't be resolved — unlike the affordability hints above,
        // showing this one to a player who may not activate it produces exactly
        // the dead menu entry (server rejects, or the click no-ops) this gate
        // exists to remove. `getAnyPlayerStackAbilities` is the path that
        // surfaces it to a non-controller activator.
        if (a.activatableByEnchantedController) {
            const host = stateView?.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === card.attachedTo);
            if (
                activatorId === undefined ||
                !host ||
                host.controllerId !== activatorId
            ) {
                return false;
            }
        }
        if (a.cost.tap && card.isTapped) return false;
        // CR 302.1 — creature with summoning sickness can't pay {T}.
        if (a.cost.tap && tapLocked) return false;
        // CR 119.4 — a "pay N life" cost is illegal unless the payer has at
        // least N life. Hidden as a UI hint so the ability is never offered
        // when unpayable; the server throw ("Not enough life") is
        // authoritative. Skipped when `payerLife` is unknown (undefined).
        if (
            a.cost.life !== undefined &&
            payerLife !== undefined &&
            payerLife < a.cost.life
        ) {
            return false;
        }
        // CR 602.5b (issue #1694) — `activationPhaseRestriction`,
        // `sorcerySpeedOnly`, `controllerTurnOnly` ("Activate only during
        // your turn") and `oncePerTurn` ("Activate only once each turn") are
        // all evaluated by the ONE shared predicate every zone-listing helper
        // consults, so they hide an ability identically regardless of zone.
        // The `activateAbility` mutation (`assertActivationTimingLegal`) is
        // authoritative regardless.
        if (
            !isActivationTimingAllowed(
                a,
                card.controllerId,
                phase,
                stateView?.activePlayerId,
                card.activationsThisTurn,
                // CR 702.142a — Boast's attacked-this-turn precondition, read
                // off the source instance (it survives `slimCard`).
                card.hasAttackedThisTurn
            )
        ) {
            return false;
        }
        // CR 122.6 — counter-removal cost is only legal if the source has
        // enough counters of the declared type.
        if (a.cost.removeCounter) {
            const have = card.counters?.[a.cost.removeCounter.type] ?? 0;
            if (have < a.cost.removeCounter.count) return false;
        }
        // CR 602.1 / 118.8 — "tap untapped permanents matching <filter> you
        // control" (Hand of Justice) and CR 702.122a Crew N ("total power N or
        // greater"): both are unactivatable when the controller's own untapped,
        // filter-matching permanents (the source itself never counts) can't
        // cover the cost. Weighed through the SAME shared predicate the server
        // uses (`gre/tapOtherCost.ts`), off the view's `power` +
        // `crewPowerBonus`. Without the `stateView` there is no board to weigh,
        // so the ability stays offered and the server rejects it.
        if (a.cost.tapOtherFilter && stateView) {
            const candidates = tapOtherCostCandidates(
                a.cost.tapOtherFilter,
                card.id,
                card.controllerId,
                stateView
            );
            if (!canPayTapOtherCost(a.cost.tapOtherFilter, candidates)) {
                return false;
            }
        }
        // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>" as an
        // activation cost (Deadapult's "Sacrifice a Zombie") is unpayable
        // when the controller has no matching permanent to give up — the
        // exact shape `getStackAbilities`'s sibling gates (`tapOtherFilter`,
        // `exileFromGraveyard`) already cover for other cost kinds; this one
        // was previously missing, so a `sacrificeFilter` ability was always
        // offered even with zero legal candidates, hitting the server's own
        // "No legal permanent to pay the sacrifice cost" throw (`game.ts`).
        // Weighed against the SAME `matchesPermanentFilter` authority the
        // server uses, off the viewer-visible `stateView` board; without it
        // the ability stays offered and the server rejects it (fail-open,
        // same discipline as every other board-dependent gate here).
        if (a.cost.sacrificeFilter && stateView) {
            // CR 602.1 / 118.5 — the sacrifice is paid by the ACTIVATOR, not
            // necessarily the source's controller ("any player may
            // activate"/enchanted-controller abilities, `activatorId` above):
            // `activateAbilityOnState` (`convex/game.ts`) scans
            // `getPlayer(state, args.playerId).battlefield` — the activator's
            // own board — for the sacrifice candidate. Latent today (no
            // shipped card combines `sacrificeFilter` with either shape), but
            // mirroring the server exactly here is what keeps it that way.
            const payerId = activatorId ?? card.controllerId;
            const mine = stateView.players.find((p) => p.id === payerId);
            const candidateCount = (mine?.battlefield ?? []).filter((c) =>
                matchesEnginePermanentFilter(c, a.cost.sacrificeFilter!, {
                    selfControllerId: payerId,
                    // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact"
                    // (Legion Extruder) / "another Orc or Goblin" (Orc
                    // General): the source is never a legal payment for its own
                    // cost, so it must not count toward this gate. Without the
                    // id an `excludeSource` filter matches nothing here
                    // (fail-closed) and the ability is simply never offered —
                    // wrong, but never an illegal click.
                    selfInstanceId: card.id,
                })
            ).length;
            // CR 602.1 / 118.5 (issue #2398) — a multi-permanent sacrifice cost
            // ("Sacrifice ten nonland permanents", Bolas's Citadel) needs the
            // COUNT, not mere existence; otherwise the ability is offered with
            // three permanents out and the server throws on click.
            if (candidateCount < (a.cost.sacrificeFilterCount ?? 1)) {
                return false;
            }
        }
        // CR 606 — a LOYALTY ABILITY (signed `cost.loyalty`) is offered only as
        // a UI hint when its three restrictions can be met; the `activateAbility`
        // mutation is the authoritative gate.
        //
        // The two STATE-ONLY clauses come from the shared engine authority
        // (`@convex/gre/loyalty`, issue #2491) — the same predicates the server
        // wrapper and the bot's enumerator read, so a change to either rule
        // reaches this gate too. Only the TIMING clause stays local: this view
        // carries no stack length and no priority holder, so
        // `loyaltyActivationViolation`'s `isSorceryTimingFor` is unavailable
        // here and the narrowing below is the closest safe approximation.
        if (isLoyaltyAbility(a)) {
            // CR 606.3 — at most one loyalty ability of this permanent per turn.
            if (loyaltyLockedThisTurn(card)) return false;
            // CR 606.3 — sorcery-speed: the controller's own MAIN PHASE. Both
            // halves matter, and only checking the turn left the abilities
            // offered all through combat and the end step on your own turn,
            // where `assertLoyaltyActivationLegal` rejects every one of them.
            // Narrowed the same way `sorcerySpeedOnly` above is — to the
            // main-phase half of `isSorceryTiming`, since this view carries no
            // stack length or priority holder; the server stays authoritative.
            // (An effect that grants instant-speed loyalty activation — Teferi,
            // Temporal Archmage — is not modelled yet; when it lands it belongs
            // here as an escape from this narrowing, mirroring the server gate.)
            if (
                stateView?.activePlayerId !== undefined &&
                stateView.activePlayerId !== card.controllerId
            ) {
                return false;
            }
            if (
                phase !== undefined &&
                phase !== "PRECOMBAT_MAIN" &&
                phase !== "POSTCOMBAT_MAIN"
            ) {
                return false;
            }
            // CR 606.6 — a `-N` cost may not take loyalty below 0.
            if (!loyaltyCostPayable(card, a)) return false;
        }
        // CR 118.3 — "discard the last card you drew this turn" cost
        // (Jandor's Ring) is unpayable when no such card is in hand.
        if (a.cost.discardLastDrawn && !canDiscardLastDrawn) return false;
        // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
        // (Survival of the Fittest) is unpayable unless at least `count`
        // cards in the controller's OWN hand match the filter. UI hint
        // against the viewer-visible hand; server validation is
        // authoritative. Skipped when `discardFilterHand` is unknown
        // (undefined) — same fail-open discipline as `payerLife`.
        if (a.cost.discardFilter && discardFilterHand !== undefined) {
            const { filter, count } = a.cost.discardFilter;
            const matching = discardFilterHand.filter((c) =>
                matchesHandCardFilter(c, filter)
            ).length;
            if (matching < count) return false;
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" cost
        // (Night Soil) is unpayable unless one graveyard holds enough matching
        // cards (the whole cost must come from ONE graveyard). UI hint against
        // the viewer-visible graveyards; server validation is authoritative.
        if (a.cost.exileFromGraveyard) {
            const { count, cardType, owner } = a.cost.exileFromGraveyard;
            // CR 118.5 — `owner: "you"` restricts the source to the activating
            // (viewer's own) graveyard; default = any player's (Night Soil).
            const sources =
                owner === "you"
                    ? (stateView?.players ?? []).filter(
                          (p) => p.id === card.controllerId
                      )
                    : (stateView?.players ?? []);
            const payable = sources.some(
                (p) =>
                    (p.graveyard ?? []).filter(
                        (c) =>
                            cardType === undefined || c.types.includes(cardType)
                    ).length >= count
            );
            if (!payable) return false;
        }
        // CR 602.5b — ability-specific activation precondition. Evaluated as a
        // UI hint against the viewer-visible `stateView` (real player/turn data
        // when the caller supplies it; an empty player list otherwise). A
        // predicate that reads the controller's hand or scans battlefields
        // (Library of Alexandria, Pestilence) needs the populated view to judge
        // correctly (#436); server-side validation against the full GameState
        // is authoritative regardless.
        if (a.canActivate !== undefined) {
            const view: TriggerStateView = stateView ?? { players: [] };
            if (!a.canActivate(card as PermanentView, view)) return false;
        }
        // CR 602.2b — a targeting ability with NO legal target can't be
        // activated, so offering it is offering a move the server will reject
        // (an Equipment's Equip with no creature anywhere on the battlefield).
        // Conservative and fail-open — see `hasBattlefieldTargetCandidate`.
        if (
            a.targetRequirement !== undefined &&
            !hasBattlefieldTargetCandidate(a.targetRequirement, card, stateView)
        ) {
            return false;
        }
        return true;
    };
    // CR 611.2a / 613.1f (layer 6) — read the POST-LAYER effective set, not
    // the card definition's raw list: a "loses all abilities" effect
    // (Titania's Song) strips native abilities here too, so a client that
    // read `cardDef.activatedAbilities` directly kept offering a stripped
    // ability as clickable — the server then rejected the activation.
    // `getEffectiveActivatedAbilities` already merges native (when not
    // suppressed) and granted (CR 113.1) abilities in one post-layer pass.
    return getEffectiveActivatedAbilities(card as unknown as CardInstanceState)
        .map(({ ability }) => ability)
        .filter(filterAbility)
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** CR 113.6 / 602.5b — activated abilities the viewer may announce on a card in
 *  their OWN graveyard (Ashen Ghoul's "{B}: Return this card from your graveyard
 *  to the battlefield. Activate only during your upkeep and only if three or
 *  more creature cards are above this card"). The board never sees the GRE, so
 *  this mirrors {@link getStackAbilities} for the graveyard zone: only abilities
 *  that opt in via `activateFromGraveyard` are eligible, gated as UI hints on
 *  the same predicates the server enforces (`activateAbility` in game.ts is
 *  authoritative regardless):
 *   - `activationPhaseRestriction` (CR 602.5) narrows to the current `phase`;
 *   - `controllerTurnOnly` ("only during your upkeep/turn") requires the
 *     graveyard owner to be the active player (CR 602.5 — "your" = the card's
 *     owner while it sits in the graveyard);
 *   - `canActivate` (CR 602.5b) evaluates the ability precondition against the
 *     viewer-visible `stateView` — for Ashen Ghoul, the
 *     `creatureCardsAboveInGraveyard` count, which reads the projected graveyard
 *     order carried by `buildTriggerStateView`.
 *  Mana is deferred to the `pendingActivation` payment phase (the server opens
 *  it), exactly like the battlefield activated-ability flow. */
export function getGraveyardStackAbilities(
    card: CardInstance,
    phase: Phase | undefined,
    stateView: TriggerStateView
): { id: string; oracleText: string }[] {
    // A card whose id resolves to no definition (synthetic tokens, test
    // fixtures) has no graveyard-activatable ability — never throw here, since
    // this runs while merely rendering the graveyard reveal for every card.
    const cardDef = tryGetDefinition(card.card.id);
    return (cardDef?.activatedAbilities ?? [])
        .filter((a) => {
            if (!a.activateFromGraveyard || !a.useStack || !a.oracleText) {
                return false;
            }
            // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate
            // abilities that aren't mana abilities" lock also hides a
            // graveyard-activated ability (Ashen Ghoul); the `activateAbility`
            // mutation is the authoritative gate regardless of source zone.
            if (
                stateView.cannotActivateAbilitiesThisTurn?.includes(
                    card.ownerId
                )
            ) {
                return false;
            }
            // CR 602.5b (issue #1694) — the same shared timing predicate
            // `getStackAbilities` consults: `activationPhaseRestriction`,
            // `controllerTurnOnly` ("Activate only during your upkeep/turn")
            // and `oncePerTurn` must hide the ability identically here. While
            // the card is in the graveyard its controller is its owner, so
            // `card.ownerId` is the "your turn" identity CR 602.5 tracks.
            if (
                !isActivationTimingAllowed(
                    a,
                    card.ownerId,
                    phase,
                    stateView.activePlayerId,
                    card.activationsThisTurn,
                    card.hasAttackedThisTurn
                )
            ) {
                return false;
            }
            // CR 602.1 / 118.5 (issue #2235) — "sacrifice a permanent
            // matching <filter>" (Whiteout's "Sacrifice a snow land") is
            // unpayable when the card's OWNER (the activator — CR 602.1
            // "from YOUR graveyard", enforced identically server-side by
            // `activateAbilityOnState` in `game.ts`) has no matching
            // permanent to give up. Mirrors `getStackAbilities`'s own
            // `sacrificeFilter` gate for the battlefield zone; this one was
            // previously missing entirely for the graveyard zone (no shipped
            // graveyard-activated card combined `sacrificeFilter` with
            // `activateFromGraveyard` until Whiteout), so the ability would
            // have been offered unconditionally regardless of board state,
            // hitting the server's "No legal permanent to pay the sacrifice
            // cost" throw on click.
            if (a.cost.sacrificeFilter) {
                const mine = stateView.players.find(
                    (p) => p.id === card.ownerId
                );
                const candidateCount = (mine?.battlefield ?? []).filter((c) =>
                    matchesEnginePermanentFilter(c, a.cost.sacrificeFilter!, {
                        selfControllerId: card.ownerId,
                        // CR 109.2 (issue #2367) — "Sacrifice ANOTHER <filter>".
                        // A graveyard-source ability's own card isn't on the
                        // battlefield at all, so this can never exclude a real
                        // candidate; threaded anyway because an `excludeSource`
                        // filter fails CLOSED without it (the ability would be
                        // permanently hidden rather than wrongly offered).
                        selfInstanceId: card.id,
                    })
                ).length;
                // CR 602.1 / 118.5 (issue #2398) — counted, not merely
                // existence-checked (see the battlefield gate above).
                if (candidateCount < (a.cost.sacrificeFilterCount ?? 1)) {
                    return false;
                }
            }
            if (a.canActivate) {
                if (!a.canActivate(card as unknown as PermanentView, stateView))
                    return false;
            }
            return true;
        })
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** CR 113.6 / 702.29a — activated abilities the viewer may announce on a card in
 *  their OWN hand (Cycling's "{cost}, Discard this card: Draw a card"). The board
 *  never sees the GRE, so this mirrors {@link getGraveyardStackAbilities} for the
 *  hand zone: only abilities that opt in via `activateFromHand` are eligible,
 *  gated as UI hints on the same predicates the server enforces (`activateAbility`
 *  in game.ts is authoritative regardless). Cycling's discard-this cost is always
 *  payable (the source is in hand) and its mana is deferred to the
 *  `pendingActivation` payment phase, so the only client-side gates are the
 *  standard phase / turn / precondition ones:
 *   - `activationPhaseRestriction` (CR 602.5) narrows to the current `phase`
 *     (Cycling is instant-speed and declares none, so this never hides it);
 *   - `controllerTurnOnly` — none of the Cycling cards use it, but honored for
 *     any future hand-activated ability that does;
 *   - `canActivate` (CR 602.5b) evaluates the ability precondition against the
 *     viewer-visible `stateView`. */
export function getHandStackAbilities(
    card: CardInstance,
    phase: Phase | undefined,
    stateView: TriggerStateView
): { id: string; oracleText: string }[] {
    // A card whose id resolves to no definition (synthetic tokens, test
    // fixtures) has no hand-activatable ability — never throw here, since this
    // runs while merely rendering the hand for every card.
    const cardDef = tryGetDefinition(card.card.id);
    return (cardDef?.activatedAbilities ?? [])
        .filter((a) => {
            if (!a.activateFromHand || !a.useStack || !a.oracleText) {
                return false;
            }
            // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate
            // abilities that aren't mana abilities" lock also hides a
            // hand-activated ability (Cycling); the `activateAbility` mutation
            // is the authoritative gate regardless of source zone.
            if (
                stateView.cannotActivateAbilitiesThisTurn?.includes(
                    card.ownerId
                )
            ) {
                return false;
            }
            // CR 602.5b (issue #1694) — the same shared timing predicate
            // `getStackAbilities` consults: `activationPhaseRestriction`,
            // `controllerTurnOnly` ("Activate only during your turn") and
            // `oncePerTurn` must hide the ability identically here. While the
            // card is in hand its controller is its owner, so `card.ownerId`
            // is the "your turn" identity CR 602.5 tracks.
            if (
                !isActivationTimingAllowed(
                    a,
                    card.ownerId,
                    phase,
                    stateView.activePlayerId,
                    card.activationsThisTurn,
                    card.hasAttackedThisTurn
                )
            ) {
                return false;
            }
            if (a.canActivate) {
                if (!a.canActivate(card as unknown as PermanentView, stateView))
                    return false;
            }
            return true;
        })
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
}

/** Filters `getStackAbilities` to those a NON-controller may activate on an
 *  OPPONENT's permanent while holding priority — the only case where a
 *  non-controller may activate. Three flags qualify: "any player may activate"
 *  (CR 113.3c, Ifh-Bíff Efreet), "only your opponents may activate"
 *  (CR 602.1, Clergy of the Holy Nimbus) and "only the controller of the
 *  enchanted creature may activate" (CR 602.1, FEM Merseine — the Aura is the
 *  opponent's, the activator is whoever controls its host). Granted abilities
 *  carry none of them, so only the card's native definition is consulted. */
export function getAnyPlayerStackAbilities(
    card: CardInstance,
    phase?: Phase,
    /** Viewer-visible game state for `canActivate` predicates (#436). Forwarded
     *  to `getStackAbilities` so an any-player ability gated on player/board
     *  state is judged against real data. */
    stateView?: TriggerStateView,
    /** Life of the activating (non-controller) player — the viewer paying the
     *  cost, NOT the permanent's controller. Forwarded to `getStackAbilities`
     *  to gate the CR 119.4 life cost (see there). */
    payerLife?: number,
    /** The non-controller ACTIVATOR (the viewer). Required for the
     *  `activatableByEnchantedController` branch, whose legality is "do you
     *  control the enchanted permanent?" rather than a flag on the source; the
     *  other two flags don't need it. */
    activatorId?: string
): { id: string; oracleText: string }[] {
    const cardDef = getDefinition(card.card.id);
    const nonControllerIds = new Set(
        (cardDef.activatedAbilities ?? [])
            .filter(
                (a) =>
                    a.activatableByAnyPlayer ||
                    a.activatableByOpponentsOnly ||
                    a.activatableByEnchantedController
            )
            .map((a) => a.id)
    );
    if (nonControllerIds.size === 0) return [];
    // Opponent-only abilities are filtered OUT by `getStackAbilities`, so query
    // the card definition directly for those, then merge with any "any player"
    // abilities surfaced through the normal filter (which applies tap/phase/
    // canActivate gating). An `activatableByEnchantedController` ability rides
    // that same filter — `activatorId` is what unlocks it there (the host's
    // controller must BE the activator), so it is forwarded rather than
    // re-gated here.
    const fromStack = getStackAbilities(
        card,
        phase,
        true,
        stateView,
        payerLife,
        undefined,
        activatorId
    ).filter((a) => nonControllerIds.has(a.id));
    const seen = new Set(fromStack.map((a) => a.id));
    // CR 602.5b (issue #1694) — `getStackAbilities` filters `activatableByOpponentsOnly`
    // OUT unconditionally (line ~1071 above), so this branch reads the card
    // definition directly instead of reusing `fromStack`'s gating. That means
    // it must run the SAME shared timing predicate itself — every other
    // zone-listing helper does — or an opponent-only ability with a printed
    // timing restriction (a future Clergy-of-the-Holy-Nimbus-shaped card) would
    // be offered outside its legal window while every other path hides it.
    const opponentOnly = (cardDef.activatedAbilities ?? [])
        .filter(
            (a) =>
                a.activatableByOpponentsOnly &&
                !seen.has(a.id) &&
                isActivationTimingAllowed(
                    a,
                    card.controllerId,
                    phase,
                    stateView?.activePlayerId,
                    card.activationsThisTurn,
                    card.hasAttackedThisTurn
                )
        )
        .map((a) => ({ id: a.id, oracleText: a.oracleText }));
    return [...fromStack, ...opponentOnly];
}

/** Returns the oracle text for an activated ability by id, or null. Checks
 *  the card's own definition first, then any granted-activated entries on the
 *  passed instance (resolved via the granting card's def). */
export function getAbilityOracleText(
    cardId: string,
    abilityId: string,
    grantedActivatedAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>
): string | null {
    const cardDef = getDefinition(cardId);
    const ability = cardDef.activatedAbilities?.find((a) => a.id === abilityId);
    if (ability?.oracleText) return ability.oracleText;
    for (const grant of grantedActivatedAbilities ?? []) {
        if (grant.abilityId !== abilityId) continue;
        const tmpl = getDefinition(grant.sourceCardId).grantTemplates?.find(
            (a) => a.id === abilityId
        );
        if (tmpl?.oracleText) return tmpl.oracleText;
    }
    return null;
}

/** Storm's cast trigger (CR 702.40, ADR 0052) is engine-synthesized — no card
 *  declares it in `triggeredAbilities` (it is not a per-card DSL/`resolve()`
 *  ability, see `collectCastTriggers` / `resolveStormTrigger` in
 *  `convex/gre/state.ts`) — so its label can't come from a card-def lookup.
 *  Matches the Mechanics Registry row id (`storm`, `mechanicsRegistry.ts`). */
const STORM_TRIGGER_ORACLE_TEXT =
    "Storm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)";

/** Returns the oracle text for a triggered ability by id, or null. Checks
 *  the card's own definition first, then any granted-triggered entries on the
 *  passed instance (resolved via the granting card's `triggeredGrantTemplates`)
 *  so an anthem-granted trigger (Energy Flux) shows its text on the stack. */
export function getTriggeredAbilityOracleText(
    cardId: string,
    triggeredAbilityId: string,
    grantedTriggeredAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>
): string | null {
    if (triggeredAbilityId === "storm") return STORM_TRIGGER_ORACLE_TEXT;
    // `tryGetDefinition` (not throwing): an emblem-sourced trigger's
    // `card.id` is an emblem KEY, absent from the card registry (CR 114 —
    // emblems live in `EMBLEM_REGISTRY`, resolved just below), so a hard
    // `getDefinition` here crashes the stack row (StackRow → this fn).
    const cardDef = tryGetDefinition(cardId);
    const ability = cardDef?.triggeredAbilities?.find(
        (a) => a.id === triggeredAbilityId
    );
    if (ability?.oracleText) return ability.oracleText;
    // CR 114 — an emblem's triggered ability is registered in the emblem
    // registry, not the card registry; resolve its text there so an emblem
    // trigger (Chandra, Torch of Defiance −7) shows its oracle text on the
    // stack instead of throwing.
    const emblemAbility = tryGetEmblemDefinition(
        cardId
    )?.triggeredAbilities?.find((a) => a.id === triggeredAbilityId);
    if (emblemAbility?.oracleText) return emblemAbility.oracleText;
    for (const grant of grantedTriggeredAbilities ?? []) {
        if (grant.abilityId !== triggeredAbilityId) continue;
        const tmpl = tryGetDefinition(
            grant.sourceCardId
        )?.triggeredGrantTemplates?.find((a) => a.id === triggeredAbilityId);
        if (tmpl?.oracleText) return tmpl.oracleText;
    }
    return null;
}

/** Returns the oracle text for a delayed triggered ability (CR 603.7a) by
 *  source card id + delayed trigger id, or null when unknown. Mirrors
 *  `getAbilityOracleText` / `getTriggeredAbilityOracleText` but looks up
 *  `cardDef.delayedTriggers` — a delayed trigger has no granted-ability path
 *  (it is always scheduled by its own source's resolve, never granted
 *  cross-card), so there is no grant-template fallback to check.
 *
 *  An INLINE delayed trigger (DSL `delayedTrigger` Op, ADR 0048) has NO
 *  `cardDef.delayedTriggers[]` row — its `delayedTriggerId` is the shared
 *  constant `INLINE_DELAYED_TRIGGER_ID` — so its text can only come from the
 *  stack item itself. `inlineOracleText` (the item's `delayedOracleText`,
 *  carried across the wire) takes priority, falling back to the card-def
 *  template lookup for the legacy `resolve()`-scheduled path. */
export function getDelayedTriggerOracleText(
    cardId: string,
    delayedTriggerId: string,
    inlineOracleText?: string
): string | null {
    if (inlineOracleText) return inlineOracleText;
    const cardDef = getDefinition(cardId);
    const trigger = cardDef.delayedTriggers?.find(
        (t) => t.id === delayedTriggerId
    );
    return trigger?.oracleText ?? null;
}

/** Which flavour of ability a stack item is (CR 602 / 603), or `null` for a
 *  spell. */
export type StackAbilityKind = "activated" | "triggered" | "delayed";

export function stackAbilityKindOf(item: {
    abilityId?: string;
    triggeredAbilityId?: string;
    delayedTriggerId?: string;
}): StackAbilityKind | null {
    if (item.abilityId) return "activated";
    if (item.triggeredAbilityId) return "triggered";
    if (item.delayedTriggerId) return "delayed";
    return null;
}

/**
 * The oracle text of an on-stack (or about-to-be-stacked) ABILITY, whatever
 * flavour it is — activated, triggered, delayed, or the inline body of a
 * reflexive trigger (CR 603.12, ADR 0048).
 *
 * The single resolver for every surface that prints an ability's text. The
 * stack row and the APNAP trigger-ORDER prompt used to each roll their own,
 * and the order prompt only handled `triggeredAbilityId` — so a reflexive
 * ability waiting in the same batch (Inti, Seneschal of the Sun's "When you do,
 * put a +1/+1 counter on target attacking creature", whose stack item is an
 * INLINE delayed trigger carrying its text in `delayedOracleText`) rendered as
 * a blank tile the player was asked to order.
 *
 * Returns null for a spell (no ability id at all) and for an ability whose
 * text can't be resolved.
 */
export function getStackAbilityOracleText(item: {
    card: { id: string };
    abilityId?: string;
    triggeredAbilityId?: string;
    delayedTriggerId?: string;
    delayedOracleText?: string;
    grantedActivatedAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>;
    grantedTriggeredAbilities?: ReadonlyArray<{
        sourceCardId: string;
        abilityId: string;
    }>;
}): string | null {
    const kind = stackAbilityKindOf(item);
    if (kind === null) return null;
    if (kind === "activated") {
        return getAbilityOracleText(
            item.card.id,
            item.abilityId!,
            item.grantedActivatedAbilities
        );
    }
    if (kind === "triggered") {
        return getTriggeredAbilityOracleText(
            item.card.id,
            item.triggeredAbilityId!,
            item.grantedTriggeredAbilities
        );
    }
    return getDelayedTriggerOracleText(
        item.card.id,
        item.delayedTriggerId!,
        item.delayedOracleText
    );
}

/** One line of a modal spell's or modal triggered ability's oracle text as shown
 *  on the stack (CR 601.2b for a spell, CR 603.3c for a trigger — the mode is
 *  ANNOUNCED, and CR 400.2 makes the stack a public zone). */
export type StackModeLine = {
    modeId: string;
    /** The bullet clause for this mode (`SpellMode`/`AbilityMode.oracleText`). */
    oracleText: string;
    /** Short mode label (`SpellMode`/`AbilityMode.label`) — a fallback if
     *  oracleText is thin. */
    label: string;
    /** True for the mode announced when the object went on the stack. */
    chosen: boolean;
};

/** CR 601.2b / CR 603.3c — for a modal object on the stack that has announced a
 *  mode, returns each declared mode's oracle line flagged with whether it is the
 *  chosen one, so the stack UI can highlight the chosen mode and de-emphasize
 *  the rest — visible to BOTH players: the mode is ANNOUNCED as the object goes
 *  on the stack, and CR 400.2 makes the stack a public zone. Reads
 *  `chosenModeId`, which survives the wire projection
 *  (`SlimStackItem` keeps every StackItem field but `card`).
 *
 *  Two mode lists feed it, one per announcing object:
 *   - a modal SPELL's `CardDefinition.modes`, locked at cast (issue #1274);
 *   - a modal TRIGGERED ability's `TriggeredAbility.modes`, announced as the
 *     ability was put on the stack (CR 603.3c, issue #2461) — the opponent is
 *     entitled to see which arm they are responding to.
 *
 *  Returns null for a stack item showing no mode: an activated or delayed
 *  ability (their announced mode is not rendered here yet), a non-modal spell
 *  or trigger, an object with no announced mode, or a `chosenModeId` that
 *  doesn't match any declared mode (defensive against a stale id). */
export function getStackModeLines(item: {
    card: Record<string, unknown>;
    chosenModeId?: string;
    abilityId?: string;
    triggeredAbilityId?: string;
    delayedTriggerId?: string;
}): StackModeLine[] | null {
    if (!item.chosenModeId) return null;
    // `card.id` is `unknown` on the fat engine `StackItem` (Record-typed card)
    // and `string` on the wire `SlimStackItem` — accept both.
    const cardId = item.card.id;
    if (typeof cardId !== "string") return null;
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    // CR 112.1 — a SPELL item carries the card-level mode list; a triggered
    // ability item carries its own ability's. The shared discriminator
    // (`gre/constants.ts`) is structurally typed precisely so the client's
    // `StackItem` satisfies it.
    //
    // The trigger lookup is `findTriggeredAbility`, the SAME
    // printed-plus-granted union the engine announces and resolves through
    // (`gre/copy.ts`, CR 707.9d) — not a bare `def.triggeredAbilities` scan. A
    // modal trigger granted by a copy effect or a `grantTriggeredAbility` Op is
    // announced server-side and must render its mode lines here too; two
    // different lookups for one question is how the client silently drops it.
    const modes:
        | { id: string; label: string; oracleText: string }[]
        | undefined = isSpellStackItem(item)
        ? def.modes
        : item.triggeredAbilityId
          ? findTriggeredAbility(
                item as unknown as CardInstanceState,
                item.triggeredAbilityId
            )?.modes
          : undefined;
    if (!modes || modes.length === 0) return null;
    if (!modes.some((m) => m.id === item.chosenModeId)) return null;
    return modes.map((m) => ({
        modeId: m.id,
        oracleText: m.oracleText,
        label: m.label,
        chosen: m.id === item.chosenModeId,
    }));
}

/** Display state for a card ability in the zoom panel.
 *  - "native": present on the CardDefinition and still effective.
 *  - "granted": added at runtime by an aura/effect (not on the def).
 *  - "lost": present on the card (printed OR granted earlier) but not
 *    effective right now. For a keyword that is a diff of native vs
 *    `instance.staticAbilities` (a Wall losing Defender — the backend has no
 *    explicit field). For an activated/triggered ability it is a "loses all
 *    abilities" static (CR 613.1f — Blood Moon, Humility, Titania's Song),
 *    read off `abilitiesSuppressedBy` with the CR 613.7 timestamp comparison,
 *    so a grant that landed BEFORE the stripper reads lost and one that landed
 *    after does not. */
export type AbilityDisplayState = "native" | "granted" | "lost";

export type DisplayKeyword = {
    name: string;
    state: AbilityDisplayState;
};

export type DisplayActivated = {
    id: string;
    oracleText: string;
    state: AbilityDisplayState;
    /** This ability's paragraph index within the card's printed `oracleText`
     *  (CR 100.6 — the printed line order), when it matches one exactly.
     *  Undefined for a runtime grant (its text comes from another card's
     *  `oracleText`, so no position on THIS card's printed text applies) —
     *  the renderer sorts those after every native row. Lets the preview
     *  interleave activated/triggered rows in printed order instead of a
     *  fixed activated-then-triggered block order (issue: Skyship
     *  Weatherlight's ETB trigger prints BEFORE its activated ability, but a
     *  fixed block order always renders activated first). */
    order?: number;
};

export type DisplayTriggered = {
    id: string;
    oracleText: string;
    state: AbilityDisplayState;
    /** See {@link DisplayActivated.order}. */
    order?: number;
};

export type DisplayAbilities = {
    keywords: DisplayKeyword[];
    activated: DisplayActivated[];
    triggered: DisplayTriggered[];
};

/** Decides whether the card preview should print the card's `oracleText`
 *  instead of (or alongside) the structured ability rows. The structured
 *  abilities view (`getDisplayAbilities`) only renders keywords, activated and
 *  triggered abilities — it has NO row for behavior whose rules text lives in
 *  any OTHER field, e.g.:
 *    - `staticEffects[]` (P/T CDA, anthems, keyword grants — CR 611/613)
 *    - `replacementEffects[]` (CR 614 — e.g. Sulfuric Vortex's lifegain lock)
 *    - enter-tapped mechanics (CR 614.12 shocklands, conditional-tapped lands,
 *      plain `entersTapped`)
 *    - `drawReplacement`, `revealsHand`, `extraLandDrops`,
 *      `playsLandsFromGraveyard`, … and any field added in the future.
 *  For those, and for spells/auras/cards with no structured abilities at all,
 *  the Oracle text is the only place the behavior is described, so it must be
 *  shown. When it is shown, the structured render is suppressed by the caller
 *  to avoid double-printing keywords already covered by the Oracle text.
 *
 *  Root detection is a COVERAGE check, not a field allowlist: comparing the
 *  count of oracle paragraphs to the count of renderable structured rows.
 *  Enumerating every oracle-bearing field (the old approach) silently dropped a
 *  clause the day a new field shipped — the Enduring Renewal (`drawReplacement`
 *  / `revealsHand`) and Icetill Explorer (`extraLandDrops` /
 *  `playsLandsFromGraveyard`) bug. When the printed Oracle text has MORE
 *  non-empty lines than the structured view can render, at least one clause is
 *  unrepresented, so the full Oracle text is printed. The named-field checks
 *  below remain as an explicit fast-path/safety-net for the CR-documented cases
 *  (they cover the rare shape where an oracle-only clause shares a printed line
 *  with a keyword, so paragraph count alone would undercount). */
export function shouldShowOracleText(
    def: CardDefinition | null | undefined,
    types: readonly string[],
    subtypes: readonly string[]
): boolean {
    if (!def?.oracleText) return false;
    const isSpellCard = types.includes("Instant") || types.includes("Sorcery");
    // CR 303.4 — an aura's granted clauses live on `staticEffects`, never on
    // its own `staticAbilities`, so the structured view would hide them.
    const isAura = subtypes.includes("Aura");
    if (isSpellCard || isAura) return true;

    // Rows the structured view (`getDisplayAbilities`) can actually render —
    // mirror its filters: one row per keyword, and only abilities that carry
    // their own `oracleText`.
    const structuredRows =
        (def.staticAbilities?.length ?? 0) +
        (def.activatedAbilities?.filter((a) => a.oracleText).length ?? 0) +
        (def.triggeredAbilities?.filter((a) => a.oracleText).length ?? 0);
    // No structured rows at all → Oracle text is the only description.
    if (structuredRows === 0) return true;

    // Explicit safety-net for the CR-documented oracle-only fields.
    const hasOracleOnlyText =
        (def.staticEffects?.length ?? 0) > 0 ||
        (def.replacementEffects?.length ?? 0) > 0 ||
        def.entersTappedUnlessPay !== undefined ||
        def.entersTappedUnless !== undefined ||
        def.entersTapped === true;
    if (hasOracleOnlyText) return true;

    // Coverage check (root fix): more printed lines than renderable rows means
    // a clause lives in a field the structured view can't show → print it all.
    const oracleParagraphs = def.oracleText
        .split("\n")
        .filter((p) => p.trim().length > 0).length;
    return oracleParagraphs > structuredRows;
}

/** Resolves the abilities to display in the zoom panel for a card. When
 *  `instance` is provided, runtime overrides are reflected:
 *  - keywords on the def but not on the instance are tagged "lost"
 *  - keywords on the instance but not on the def are tagged "granted"
 *  - granted activated abilities (CR 113.1) are appended via grantTemplates
 *  Without an instance, returns the static def view (used by deck builder, etc.). */
export function getDisplayAbilities(
    cardId: string,
    instance?: CardInstance
): DisplayAbilities {
    const def = tryGetDefinition(cardId);
    if (!def) return { keywords: [], activated: [], triggered: [] };
    const nativeKw = def.staticAbilities ?? [];
    const effectiveKw = instance?.staticAbilities ?? nativeKw;
    const nativeSet = new Set(nativeKw);
    const effectiveSet = new Set(effectiveKw);

    const keywords: DisplayKeyword[] = [];
    for (const k of nativeKw) {
        keywords.push({
            name: k,
            state: effectiveSet.has(k) ? "native" : "lost",
        });
    }
    for (const k of effectiveKw) {
        if (!nativeSet.has(k)) keywords.push({ name: k, state: "granted" });
    }

    // CR 613.1f — a live "loses all abilities" static (Blood Moon on a nonbasic
    // land, Humility, Titania's Song). Its layer timestamp decides which GRANTS
    // it reached (CR 613.7): the SAME comparison the engine's effective-ability
    // readers make, imported rather than re-derived so the preview can never
    // claim an ability the board won't offer.
    const strippedAt = instance
        ? abilityLossTimestamp(instance as unknown as CardInstanceState)
        : null;
    const grantState = (seq: number | undefined): AbilityDisplayState =>
        grantOutrankedByAbilityLoss(seq, strippedAt) ? "lost" : "granted";
    const nativeState: AbilityDisplayState =
        strippedAt === null ? "native" : "lost";

    // Printed-order lookup (CR 100.6): the position of an ability's own
    // `oracleText` within the card's full printed text, when it matches one
    // paragraph exactly. `-1` (not found) maps to `undefined` — same
    // "sorts last" bucket a runtime grant's cross-card text already falls
    // into, since neither has a position on THIS card's printed text.
    const paragraphs = (def.oracleText ?? "").split("\n").map((p) => p.trim());
    const paragraphOrder = (text: string): number | undefined => {
        const i = paragraphs.indexOf(text.trim());
        return i === -1 ? undefined : i;
    };

    const activated: DisplayActivated[] = (def.activatedAbilities ?? [])
        .filter((a) => a.oracleText)
        .map((a) => ({
            id: a.id,
            oracleText: a.oracleText,
            state: nativeState,
            order: paragraphOrder(a.oracleText),
        }));
    for (const grant of instance?.grantedActivatedAbilities ?? []) {
        const sourceDef = tryGetDefinition(grant.sourceCardId);
        const tmpl = sourceDef?.grantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl?.oracleText) continue;
        activated.push({
            id: tmpl.id,
            oracleText: tmpl.oracleText,
            state: grantState(grant.seq),
        });
    }

    const triggered: DisplayTriggered[] = (def.triggeredAbilities ?? [])
        .filter((a) => a.oracleText)
        .map((a) => ({
            id: a.id,
            oracleText: a.oracleText,
            state: nativeState,
            order: paragraphOrder(a.oracleText),
        }));
    // CR 113.1 — anthem-granted triggers (Energy Flux) live on the granting
    // card's `triggeredGrantTemplates`, not on this card's def.
    for (const grant of instance?.grantedTriggeredAbilities ?? []) {
        const sourceDef = tryGetDefinition(grant.sourceCardId);
        const tmpl = sourceDef?.triggeredGrantTemplates?.find(
            (a) => a.id === grant.abilityId
        );
        if (!tmpl?.oracleText) continue;
        triggered.push({
            id: tmpl.id,
            oracleText: tmpl.oracleText,
            state: grantState(grant.seq),
        });
    }

    // A granted KEYWORD is often implemented as a keyword row plus the
    // triggered/activated ability that gives it its rules text (granting ward
    // adds both `staticAbilities: ["ward {1}"]` and the "Whenever this
    // permanent becomes the target …" trigger). Printing both lists the same
    // ability twice — once bare, once with its reminder text. The keyword row
    // is the canonical, compact one, so drop any ability row that merely
    // restates a keyword already shown.
    // Scoped to GRANTED rows on both sides: a card's own printed text is its
    // author's business (a native ability is never a duplicate of a native
    // keyword row by accident), and narrowing keeps the filter from ever
    // swallowing a real printed ability that happens to open with a keyword
    // word.
    const grantedKeywords = keywords
        .filter((k) => k.state === "granted")
        .map((k) => capitalizeKeyword(k.name).toLowerCase());
    const restatesGrantedKeyword = (state: string, oracleText: string) =>
        state === "granted" &&
        grantedKeywords.some((kw) => oracleText.toLowerCase().startsWith(kw));

    return {
        keywords,
        activated: activated.filter(
            (a) => !restatesGrantedKeyword(a.state, a.oracleText)
        ),
        triggered: triggered.filter(
            (t) => !restatesGrantedKeyword(t.state, t.oracleText)
        ),
    };
}

/** The abilities the card preview should render below the type line.
 *
 *  When printed Oracle text is shown, it already covers the card's NATIVE
 *  abilities, so re-printing the structured view would duplicate them. But
 *  printed text is fixed — it can't reflect runtime grants that live on the
 *  instance: a granted keyword (e.g. landwalk), a granted activated ability,
 *  or a keyword LOST at runtime. Those deltas are surfaced even alongside
 *  Oracle text so they appear while the effect is active and disappear when it
 *  ends (#156). When Oracle text is not shown, the full structured set
 *  renders. */
export function resolvePreviewAbilities(
    abilities: DisplayAbilities,
    showOracleText: boolean
): DisplayAbilities {
    if (!showOracleText) return abilities;
    return {
        keywords: abilities.keywords.filter((k) => k.state !== "native"),
        // `!== "native"` on all three, not `=== "granted"`: a LOST row is a
        // runtime delta too (CR 613.1f), and the printed text above it says the
        // opposite of the truth while it applies.
        activated: abilities.activated.filter((a) => a.state !== "native"),
        triggered: abilities.triggered.filter((t) => t.state !== "native"),
    };
}

/** Display strings for internal `staticAbilities` markers — keywords whose
 *  identifier is a slug rather than the printed Oracle keyword. Real MTG
 *  evergreen keywords (flying, trample, first strike, …) are not listed
 *  here; they round-trip through `capitalizeKeyword` and render as
 *  "Flying" / "Trample" / "First strike" / etc. unchanged. */
const KEYWORD_DISPLAY: Record<string, string> = {
    "does-not-untap":
        "This permanent doesn't untap during its controller's untap step.",
    "skip-untap-step": "Players skip their untap steps.",
};

/** Renders a `staticAbilities` keyword for display. Internal slug keywords
 *  (the ones whose name reveals an implementation detail rather than the
 *  printed Oracle phrasing — e.g. `skip-untap-step`) are mapped to their
 *  Oracle line via `KEYWORD_DISPLAY`. Everything else falls back to a
 *  simple first-letter capitalization, matching the user preference of
 *  "name only, no reminder text" for real MTG keywords. */
export function capitalizeKeyword(k: string): string {
    if (!k) return k;
    const mapped = KEYWORD_DISPLAY[k];
    if (mapped) return mapped;
    return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Builds an MTG-style type line: "[Supertypes] [Types] — [Subtypes]".
 *  The em-dash separator is omitted when there are no subtypes. */
export function formatTypeLine(
    types: string[] | undefined,
    subtypes: string[] | undefined,
    supertypes: string[] | undefined
): string {
    const left = [...(supertypes ?? []), ...(types ?? [])].join(" ");
    const right = (subtypes ?? []).join(" ");
    return right ? `${left} — ${right}` : left;
}

const MANA_DISPLAY_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

/** Returns true if `pool` fully covers a numeric `cost` (CR 117.6). Mirrors
 *  the server-side `isManaCostCovered` for UI affordances such as enabling
 *  the "Pay" button on a may-pay prompt only when the player's mana pool
 *  can actually pay the cost. Treats `cost.X` as additional generic mana
 *  payable from any color. Does NOT handle `X: "X"` (variable cost) — by
 *  the time the cost reaches the UI it has been normalized to a number. */
export function isManaCostCovered(pool: ManaPool, cost: ManaCost): boolean {
    const remainingPool: Record<string, number> = {};
    let coloredRemaining = 0;
    for (const c of MANA_DISPLAY_COLORS) {
        const need = cost[c] ?? 0;
        if (need > 0 && (pool[c] ?? 0) < need) return false;
        remainingPool[c] = (pool[c] ?? 0) - need;
        coloredRemaining += remainingPool[c];
    }
    // CR 202.1a (issue #1738) — each guild-hybrid pip consumes one mana of
    // either of its colours. Delegates to the ENGINE's matching so the client
    // affordance and the server's `isManaCostCovered` can never disagree about
    // which pools pay which pips (a per-pip greedy here would gray out a
    // payable cast).
    //
    // Both cost SHAPES reach this helper and must be handled: a card's PRINTED
    // cost carries the `hybrid` colour-pair array, while a live
    // `PendingCast.manaCost` / `PendingActivation.manaCost` is already
    // NORMALIZED and carries the pips as composite `"R/W"` keys. They never
    // coexist on one object, so reading both is safe — and reading only one of
    // them leaves the other's pips invisible (the payment banner would call a
    // hybrid cast fully paid with an empty pool).
    const hybridPips = [
        ...(cost.hybrid ?? []),
        ...normalizedHybridPips(cost as Record<string, number>),
    ];
    if (hybridPips.length > 0) {
        const spent = assignHybridPips(remainingPool, hybridPips);
        if (!spent) return false;
        for (const amount of Object.values(spent)) coloredRemaining -= amount;
    }
    const generic = typeof cost.X === "number" ? cost.X : 0;
    return coloredRemaining >= generic;
}

/** CR 605.1a / 601.2f — can the controller afford the MANA leg of this
 *  source's own tap-for-mana activation cost, or REACH it by tapping something
 *  else? A filter/upgrader rock ("{1}, {T}: Add one mana of any color" — Mana
 *  Cylix, Celestial Prism, Chromatic Star/Sphere, Barbed Sextant, Implements of
 *  Sacrifice, Standing Stones; "{G}, {T}: Add {R}" — Fire Sprites) charges mana
 *  to activate, and the server pays it from the pool before adding the produced
 *  mana (`applyManaAbilityManaCost`, `convex/game.ts`).
 *
 *  Deliberately PERMISSIVE, mirroring `getStackAbilities` (which never hides an
 *  ability for want of mana): the server AUTO-TAPS the player's other sources to
 *  fund the cost (`autoTapForManaAbilityCost`), exactly as paying a spell does,
 *  so a floating pool is not a precondition — only the total absence of any way
 *  to produce mana is. A pool-exact mirror here greyed the rock out whenever the
 *  player hadn't manually pre-floated the mana, a cliff no other cost has.
 *
 *  True for the overwhelmingly common no-mana-cost mana ability, and true when
 *  the source exposes no activated mana ability at all (a basic land's
 *  intrinsic subtype tap) — this predicate only ever SUBTRACTS the hopeless
 *  case, it never grants tappability on its own. */
export function canAffordManaAbilityCost(
    card: CardInstance,
    pool: ManaPool,
    battlefield: ReadonlyArray<CardInstance> = [],
    manaGateView?: TriggerStateView
): boolean {
    const ability = getActivatedManaAbility(
        card as unknown as Parameters<typeof getActivatedManaAbility>[0],
        manaGateView
    );
    const cost = ability?.cost.mana;
    if (!cost) return true;
    // A live activation cost is already numeric — an `X: "X"` mana ability
    // doesn't exist in the catalogue, and `isManaCostCovered` can't read one.
    if (typeof cost.X === "string") return true;
    if (isManaCostCovered(pool, cost)) return true;
    // Any OTHER untapped mana source the engine's auto-tap could reach for.
    // Colour-blind on purpose: the server runs the real solver and rejects a
    // genuinely unpayable colour, the same way it rejects an unpayable spell
    // after auto-tap falls short.
    return battlefield.some(
        (c) =>
            c.id !== card.id &&
            c.isTapped !== true &&
            hasManaAbility(c, manaGateView)
    );
}

/** Serializes a ManaCost into the symbol-token form used by formatOracleText
 *  (e.g. `{ X: 2, R: 1 }` → "{2}{R}"). String X (variable cost) renders as
 *  "{X}". Returns "" when undefined or empty. */
export function manaCostToString(cost?: ManaCost): string {
    if (!cost) return "";
    const parts: string[] = [];
    const x = cost.X;
    if (typeof x === "string") {
        // `{X}{X}` costs (Recall) repeat the variable symbol `xFactor` times.
        const factor =
            typeof cost.xFactor === "number" && cost.xFactor > 0
                ? cost.xFactor
                : 1;
        for (let i = 0; i < factor; i++) parts.push(`{${x}}`);
    }
    // Fixed generic mana renders as ONE numeral symbol, ordered after {X} and
    // before the colored pips (CR 107.4 / 202.1). Two encodings feed it: numeric
    // `X` (the fixed-generic convention when there is no variable X — Grizzly
    // Bears `{ X: 1, G: 1 }`) and the explicit `generic` key (used when a
    // variable {X} coexists with fixed generic — Dominate
    // `{ X: "X", generic: 1, U: 2 }` → {X}{1}{U}{U}). Summing them collapses
    // both — and the rare both-at-once — into a single {N}; the `generic` key
    // was previously dropped entirely, so any card using it lost its generic
    // pip (Dominate showed {X}{U}{U}, Soul Burn `{ generic: 2, ... }` lost {2}).
    const genericFromX = typeof x === "number" && x > 0 ? x : 0;
    const generic = genericFromX + (cost.generic ?? 0);
    if (generic > 0) parts.push(`{${generic}}`);
    for (const c of MANA_DISPLAY_COLORS) {
        const n = cost[c] ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${c}}`);
    }
    // CR 107.4f — Phyrexian pips render as `{<color>/P}` tokens (Dismember
    // `{1}{B/P}{B/P}`), after the colored pips. The oracle-text tokenizer maps
    // `{B/P}` → the `B_P.svg` symbol asset (slash → underscore).
    if (cost.phyrexian) {
        for (const c of MANA_DISPLAY_COLORS) {
            const n = cost.phyrexian[c] ?? 0;
            for (let i = 0; i < n; i++) parts.push(`{${c}/P}`);
        }
    }
    // CR 202.1a (issue #1738) — guild-hybrid pips render as `{R/W}` tokens,
    // after the colored pips, in the same canonical colour order the payment
    // layer keys them by. The oracle-text tokenizer maps `{R/W}` → the
    // `R_W.svg` symbol asset (slash → underscore), exactly as for `{B/P}`.
    //
    // Print-order decision (issue #1740): this is CANONICAL order
    // (generic → single-colour → Phyrexian → hybrid), not literal printed
    // order — a hybrid pip declared BEFORE a colored pip in the printed cost
    // (e.g. a hypothetical `{R/W}{R}`) would still render as `{R}{R/W}`
    // here. `ManaCost` splits colored requirements and `hybrid`/`phyrexian`
    // into separate keys/fields specifically so the cost is a canonical bag,
    // not an ordered token list (CR 202.1's own printed order is a rendering
    // convention, not a rules requirement — CR 601.2f resolves the pips by
    // colour/kind, never by print position). No catalogue card currently
    // mixes a hybrid pip with a single-colour pip — the three shipped
    // hybrid-cost cards (Hogaak `{5}{B/G}{B/G}`, Figure of Destiny `{R/W}`,
    // Figure of Fable `{G/W}`) are all pure generic-plus-hybrid, zero
    // single-colour pips — so this canonical ordering is not yet
    // distinguishable from printed order by any shipped card; if one ever
    // does mix them, add an explicit `printOrder` field to `ManaCost` rather
    // than threading positional info through the generic/hybrid split.
    for (const pip of [
        ...(cost.hybrid ?? []),
        ...normalizedHybridPips(cost as Record<string, number>),
    ]) {
        parts.push(`{${hybridCostKey(pip[0], pip[1])}}`);
    }
    return parts.join("");
}

/** CR 107.4f — one mana-vs-life split option for a Phyrexian cast. `lifePips` is
 *  the number of `{C/P}` pips paid with 2 life each (the rest with the pip's
 *  colour of mana); `label` is the oracle-text-token string the picker renders
 *  (e.g. `"{B} + 2 life"`). */
export type PhyrexianSplitChoice = { lifePips: number; label: string };

/** CR 107.4f — the split options a caster chooses between for a Phyrexian-mana
 *  card in hand, derived from the server-authoritative `phyrexianOptions` the
 *  projection attaches (the affordable `lifePips` values) and the card's printed
 *  `{C/P}` pips. Life is assigned to the FIRST `lifePips` pips in WUBRG order
 *  (matching the engine's `phyrexianManaAdditions`), so each option's mana part
 *  is the remaining pips. Empty (no picker) unless there are ≥ 2 real options —
 *  the projection already gates that, this re-checks for safety. */
export function phyrexianSplitChoices(
    card: CardInstance
): PhyrexianSplitChoice[] {
    const options = card.phyrexianOptions;
    if (!options || options.length < 2) return [];
    const phy = getDefinition(card.card.id).manaCost?.phyrexian;
    if (!phy) return [];
    const pipColors: Color[] = [];
    for (const c of MANA_DISPLAY_COLORS) {
        const n = phy[c] ?? 0;
        for (let i = 0; i < n; i++) pipColors.push(c);
    }
    return options.map((lifePips) => {
        // Life pays the first `lifePips` pips; the rest are paid with mana.
        const manaPips = pipColors.slice(lifePips);
        const manaPart = manaPips.map((c) => `{${c}}`).join("");
        // CR 107.4f — 2 life per pip.
        const lifePart = lifePips > 0 ? `${lifePips * 2} life` : "";
        const label =
            manaPart && lifePart
                ? `${manaPart} + ${lifePart}`
                : manaPart || lifePart;
        return { lifePips, label };
    });
}

/** Normalized `may-pay` cost shape (CR 117.3a / 118.4 / 702.24). Mirrors the
 *  backend `normalizeMayPayCost` so the UI affordability gate and the cost
 *  label read the same shape whether the cost arrived as a bare `ManaCost`
 *  (mana-only) or the `{ mana?, life?, sacrifice? }` union (ADR 0042). */
export interface NormalizedMayPayCost {
    mana?: ManaCost;
    life?: number;
    /** PERMANENT leg (CR 701.21 sacrifice / 400.7 return, ADR 0079). `count`
     *  is either a fixed cardinal ("sacrifice N") or a summed-power threshold
     *  `{ minTotalPower }` (CR 118, Phyrexian Dreadnought — "sacrifice any
     *  number of matching permanents with total power ≥ N"). The `filter` is
     *  dropped here (the UI reads it off the raw cost via
     *  {@link mayPaySacrificeCount}); `action` is kept because it words the
     *  prompt. */
    permanent?: {
        action: "return" | "sacrifice";
        count: number | { minTotalPower: number };
    };
    /** HAND leg (CR 701.9 discard / 701.13 exile, issue #899 / ADR 0079).
     *  Fixed cardinals only — the payer picks exactly the summed requirement
     *  count of distinct cards from hand. */
    hand?: {
        action: "exile" | "discard";
        /** Per-requirement filter carried THROUGH (CR 118.9, PR #1963 review
         *  round 2): dropping it here made every UI consumer of the hand leg
         *  read as unconstrained — the fail-open shape that let Pay enable on a
         *  hand of non-matching cards. */
        requirements: { filter: EffectCardFilter; count: number }[];
    };
    /** Energy leg (CR 122.1, issue #1194). Fixed count only — "pay
     *  {E}{E}{E}" (Guide of Souls). Mirrors the backend `CostLegs.energy`
     *  leg 1:1. */
    energy?: number;
}

function isMayPayUnion(
    cost: MayPayCost
): cost is Exclude<MayPayCost, ManaCost> {
    return (
        "mana" in cost ||
        "life" in cost ||
        "permanent" in cost ||
        "hand" in cost ||
        "energy" in cost
    );
}

/** Widens either `may-pay` cost shape to `{ mana?, life?, sacrifice?,
 *  discard?, energy? }`. */
export function normalizeMayPayCost(cost: MayPayCost): NormalizedMayPayCost {
    if (isMayPayUnion(cost)) {
        return {
            ...(cost.mana ? { mana: cost.mana } : {}),
            ...(cost.life !== undefined ? { life: cost.life } : {}),
            ...(cost.permanent
                ? {
                      permanent: {
                          action: cost.permanent.action,
                          count: cost.permanent.count,
                      },
                  }
                : {}),
            ...(cost.hand
                ? {
                      hand: {
                          action: cost.hand.action,
                          requirements: cost.hand.requirements.map((r) => ({
                              filter: r.filter,
                              count: r.count,
                          })),
                      },
                  }
                : {}),
            ...(cost.energy !== undefined ? { energy: cost.energy } : {}),
        };
    }
    return { mana: cost as ManaCost };
}

/** UI affordability gate for a `may-pay` cost union (CR 117.6). The mana leg
 *  must be coverable by `pool`; `life` must be ≤ the chooser's life; the
 *  sacrifice leg needs at least `count` candidate permanents. Life / sacrifice
 *  candidate counts come from the caller (the UI knows the chooser's life and a
 *  precomputed candidate count). A cost with no constraining leg is affordable. */
export function mayPayCanAfford(
    cost: MayPayCost | undefined,
    pool: ManaPool,
    chooserLife: number,
    sacrificeCandidateCount: number,
    /** Extra mana the mana leg may draw on beyond `pool` (CR 106.6, ADR 0042) —
     *  restricted mana whose restriction the choice permits (e.g.
     *  cumulative-upkeep mana from Adarkar Unicorn / Snowfall). Already filtered
     *  to the eligible restriction by the caller and merged here so the Pay
     *  button enables when restricted + fungible mana together cover the cost. */
    extraMana?: ManaPool,
    /** Summed PRINTED power of the chooser's matching sacrifice candidates
     *  (CR 118). Required only for a threshold-mode sacrifice leg
     *  (`{ minTotalPower }`, Phyrexian Dreadnought); ignored for a fixed-count
     *  leg, which gates on `sacrificeCandidateCount` instead. */
    sacrificeCandidatePower?: number,
    /** The chooser's VISIBLE hand cards (CR 701.9 / 118.9, issue #899).
     *  Required for a discard leg — affordable iff every requirement can be
     *  covered by DISTINCT hand cards matching ITS filter. Ignored for a cost
     *  with no discard leg. Cards, not a COUNT: a summed-count gate enabled Pay
     *  on a hand full of non-matching cards and the server then threw (PR #1963
     *  review round 2). */
    hand?: readonly MayPayHandCard[],
    /** The chooser's current energy counters (CR 122.1, issue #1194). Required
     *  for an energy leg — affordable iff the chooser holds at least `energy`
     *  counters. Ignored for a cost with no energy leg. Survives the wire
     *  projection as `PlayerState.energyCounters`. */
    chooserEnergy?: number
): boolean {
    if (!cost) return true;
    const norm = normalizeMayPayCost(cost);
    const effectivePool: ManaPool = extraMana ? { ...pool } : pool;
    if (extraMana) {
        for (const [c, n] of Object.entries(extraMana)) {
            effectivePool[c] = (effectivePool[c] ?? 0) + (n ?? 0);
        }
    }
    if (norm.mana && !isManaCostCovered(effectivePool, norm.mana)) return false;
    if (norm.life !== undefined && chooserLife < norm.life) return false;
    if (norm.permanent) {
        if (typeof norm.permanent.count === "object") {
            // CR 118 threshold mode — affordable iff the matching candidates'
            // summed printed power reaches the required total.
            if (
                (sacrificeCandidatePower ?? 0) <
                norm.permanent.count.minTotalPower
            ) {
                return false;
            }
        } else if (sacrificeCandidateCount < norm.permanent.count) {
            return false;
        }
    }
    if (norm.hand && !assignMayPayHandCards(hand ?? [], norm.hand)) {
        return false;
    }
    if (norm.energy !== undefined && (chooserEnergy ?? 0) < norm.energy) {
        return false;
    }
    return true;
}

/** Adapts a client `CardInstance` to the engine's `MatchablePermanent` shape
 *  (`convex/cards/filters.ts`) so a `may-pay` PERMANENT leg's affordability
 *  gate (`mayPaySacrificeCount` / `mayPaySacrificePower`) can run the REAL
 *  `matchesPermanentFilter` instead of a hand-duplicated client mirror —
 *  duplicating the matcher is exactly how it drifted (issue #1938 fixup): the
 *  mirror had no `excludeSubtypes` branch, so the Planeshift Lair cycle's
 *  "non-Lair land" return-leg filter silently matched every land (Lairs
 *  included), and the Pay button enabled with zero legal return candidates.
 *  `types`/`subtypes` are optional on the wire (`CardInstance`) but required
 *  by `MatchablePermanent` — default to `[]`, the engine's own fail-closed
 *  default for a permanent with no printed types/subtypes.
 *
 *  Exported (not just for `mayPaySacrificeCount`/`mayPaySacrificePower`) so
 *  `card-utils.test.ts`'s `MIRROR_CENSUS` parity guard exercises this EXACT
 *  production derivation rather than a hand-duplicated test-only copy — a
 *  second copy is exactly how the `excludeSubtypes` gap above went unnoticed
 *  (issue #1938 fixup 2). See `MIRROR_CENSUS` below for which
 *  `PermanentFilter` fields this adapter populates. */
export function toMatchablePermanent(
    card: CardInstance,
    /** Projected `{ turn, controlChangedThisTurn }`. Required only by the two
     *  turn-scoped derived flags below; omitted, both stay undefined and their
     *  filters fail closed. `turn` must be the ENGINE turn
     *  (`useGameContext().engineTurn` / `GameState.turn`), never the board's
     *  display counter — see `matchesPermanentFilter`'s note. */
    turnState?: ControlContinuityView
): MatchablePermanent {
    return {
        id: card.id,
        types: card.types ?? [],
        subtypes: card.subtypes ?? [],
        staticAbilities: card.staticAbilities ?? [],
        controllerId: card.controllerId,
        // CR 202.2 / 613.1d — the single colour authority (layer-5 override
        // SETS, `grantedColors` UNION), same one `buildTriggerStateView` uses.
        colors: getEffectiveColors(card as unknown as PermanentView),
        // CR 205.4a — printed supertypes, for a permanent leg's `supertypes` /
        // `excludeSupertypes` clause ("sacrifice a nonbasic land"). No shipped
        // may-pay permanent leg uses it yet (latent-only); populated so one
        // that does doesn't silently fail open the way `excludeSubtypes` did.
        supertypes: tryGetDefinition(card.card.id)?.supertypes,
        power: card.power,
        toughness: card.toughness,
        isAttacking: card.isAttacking,
        isBlocking: card.isBlocking,
        isTapped: card.isTapped,
        // CR 111.5 / 701.21 — token-ness, for a permanent leg's `isToken`
        // clause ("sacrifice a nontoken permanent"). `card.isToken` crosses
        // the wire (`slimCard` forwards it unchanged) — populated so a filter
        // that uses it doesn't silently fail OPEN the way `excludeSubtypes`
        // did (issue #1938 fixup 2): `undefined` reads as "not a token" in
        // `matchesPermanentFilter`'s boolean-equality check, which would let
        // an ACTUAL token through an `isToken: false` filter.
        isToken: card.isToken,
        // CR 111 / 707.1 — token provenance, for a permanent leg's
        // `createdBy` clause (Tetravus-style "tokens created with this").
        // Same wire/fail-open reasoning as `isToken` above.
        createdBy: card.createdBy,
        // CR 400.7 — "entered the battlefield this turn": the same
        // `enteredOnTurn === turn` derivation the server does
        // (`convex/gre/state.ts`), now that the turn number is available.
        // Closes the gap the census recorded against this key.
        ...(turnState
            ? {
                  enteredThisTurn: card.enteredOnTurn === turnState.turn,
                  // "…that they controlled since the beginning of the turn" —
                  // the ONE engine authority, shared with the server
                  // (ADR 0074: the frontend may import pure engine modules).
                  controlledSinceTurnStart: hasControlledSinceTurnStart(
                      turnState,
                      card
                  ),
              }
            : {}),
    };
}

/** Compile-time census of every `PermanentFilter` field's client-side support,
 *  keyed by `keyof PermanentFilter` so adding a NEW field to `PermanentFilter`
 *  (`convex/cards/filters.ts`) breaks `tsc` here until this census is updated
 *  — the fix for the parity guard rotting silently (issue #1938 fixup 2): a
 *  hand-maintained test `cases` array has no such property, and
 *  `controllerRelation` / `isToken` / `name` / `enteredThisTurn` /
 *  `powerAtLeast` / `instanceIds` / `excludeInstanceIds` / `createdBy` all
 *  went unmirrored while that guard stayed green.
 *
 *  - `"mirrored"` — supported by BOTH the may-pay engine-matcher path
 *    (`toMatchablePermanent` + the real `matchesPermanentFilter`) AND the
 *    older `ClientPermanentFilter` mirror above (used for board highlighting).
 *    `card-utils.test.ts`'s parity guard asserts every `"mirrored"` key has at
 *    least one `MIRRORED_CASES` entry, run through BOTH paths.
 *  - `"adapter-only"` — supported by the engine-matcher path only
 *    (`toMatchablePermanent` populates the underlying `MatchablePermanent`
 *    field); NOT supported by the `ClientPermanentFilter` mirror, which has no
 *    field for it (no shipped board-highlight filter needs it yet). The
 *    parity guard asserts every `"adapter-only"` key has at least one
 *    `ADAPTER_ONLY_CASES` entry, run through the engine-matcher path only.
 *  - `"intentionally-absent"` — supported by NEITHER path today, with the
 *    reason recorded inline below rather than left as a scattered comment. */
export type MirrorStatus = "mirrored" | "adapter-only" | "intentionally-absent";

export const MIRROR_CENSUS: Record<keyof PermanentFilter, MirrorStatus> = {
    // — mirrored: ClientPermanentFilter has the field + a parity test case —
    types: "mirrored",
    excludeTypes: "mirrored",
    subtypes: "mirrored",
    excludeSubtypes: "mirrored",
    // Mirrored on BOTH paths, but the two reads diverge on liveness: the
    // `ClientPermanentFilter` mirror reads PRINTED supertypes only
    // (`tryGetDefinition(...).supertypes`, no snow-mutation awareness), the
    // same static fallback `toMatchablePermanent` uses above — stricter than
    // the server's own `matchesPermanentFilter`, which can resolve LIVE
    // supertypes via an injected `ctx.supertypesOf` (Melting / Arcum's
    // Weathervane). Neither client path threads that live resolver — a
    // latent gap (no shipped client-reachable filter needs the live value
    // yet), tracked here instead of as a prose note (issue #1938 fixup 2).
    excludeSupertypes: "mirrored",
    requireAbility: "mirrored",
    excludeAbility: "mirrored",
    colors: "mirrored",
    tapped: "mirrored",
    any: "mirrored",
    // Mirrored on BOTH paths (issue #2373 fixup). `id` is always populated on
    // `MatchablePermanent`, so the engine-matcher path has always worked; the
    // `ClientPermanentFilter` mirror gained the two branches only when a
    // SHIPPED choice filter started carrying them. `excludeInstanceIds` is the
    // wire form of an effect's "another" clause (CR 109.2) — an
    // `EffectCardFilter.excludeSource` becomes `PermanentFilter.
    // excludeInstanceIds` in `toPermanentFilter` and rides on
    // `PendingChoice.filter`, which the human battlefield picker evaluates
    // through THIS mirror. Unmirrored it failed OPEN: Gut, True Soul Zealot
    // was ringed as a legal sacrifice to her own trigger, and clicking her
    // threw "Card does not match the required filter" server-side.
    // `instanceIds` is the positive twin, mirrored alongside it so the
    // opposite scoping cannot fail open the same way.
    excludeInstanceIds: "mirrored",
    instanceIds: "mirrored",
    // CR 109.2 (issue #2367) — the id-less form of `excludeInstanceIds`, for a
    // STATIC card-definition filter ("Sacrifice another artifact"). Mirrored in
    // the fail-CLOSED direction on both paths: the engine matcher needs
    // `ctx.selfInstanceId` and matches nothing without it, and the
    // `ClientPermanentFilter` mirror — which has no context at all — always
    // matches nothing. The working client path is the LOWERED form: every
    // requirement that reaches a picker has had `resolveExcludeSource`
    // (`convex/cards/filters.ts`) turn this flag into a concrete
    // `excludeInstanceIds` entry at build time, which the branch above already
    // mirrors. Declaring the field is what stops an unlowered one failing OPEN.
    excludeSource: "mirrored",
    // — adapter-only: no ClientPermanentFilter field, but toMatchablePermanent
    // populates the underlying MatchablePermanent field so the engine-matcher
    // path (mayPaySacrificeCount / mayPaySacrificePower) matches correctly —
    // ClientPermanentFilter has no POSITIVE `supertypes` field (no shipped
    // board-highlight filter needs it), but the engine path already reads the
    // same printed-supertypes fallback as `excludeSupertypes` above.
    supertypes: "adapter-only",
    // `power`/`toughness` are always populated.
    powerAtLeast: "adapter-only",
    // The upper-bound twin (issue #2084, Enduring Innocence's "with power 2 or
    // less") rides the SAME populated `power` field, so it has exactly
    // `powerAtLeast`'s support: the engine-matcher path matches it,
    // `ClientPermanentFilter` has no P/T field to mirror it into.
    powerAtMost: "adapter-only",
    toughnessAtLeast: "adapter-only",
    // `isAttacking`/`isBlocking` are always populated.
    isAttacking: "adapter-only",
    isBlocking: "adapter-only",
    // Populated above (this fixup) from the `isToken`/`createdBy` fields added
    // to the client `CardInstance` type (`~/types/game.ts`) — `slimCard`
    // already forwarded them on the wire, they just weren't in the TS shape
    // or read by this adapter.
    isToken: "adapter-only",
    createdBy: "adapter-only",
    // Requires a `FilterMatchContext` with `selfControllerId` (`"you"` /
    // `"opponents"`) or `selfInstanceId` (`"self"`) — threaded by every
    // engine-matcher call site as of issue #1938 fixup 2
    // (`mayPaySacrificeCount`/`mayPaySacrificePower`'s new `ctx` parameter).
    controllerRelation: "adapter-only",
    // — intentionally-absent: neither path supports it, reason recorded here —
    // No battlefield permanent shape (`CardInstanceState` server-side,
    // `CardInstance` client-side) carries a live `name` field at all — the
    // server's OWN `sacrificeCandidates` (`convex/gre/state.ts`) doesn't
    // populate it either, so this is a pre-existing gap on both paths, not a
    // client-only drift. No shipped may-pay/board-highlight filter uses it.
    name: "intentionally-absent",
    // Was "intentionally-absent" until `toMatchablePermanent` gained its
    // optional `turnState` parameter (the `currentTurn` parameter that note
    // asked for, added alongside `controlledSinceTurnStart` below since both
    // read the same two wire fields). The adapter now derives it exactly as
    // the server does (`enteredOnTurn === turn`); the `ClientPermanentFilter`
    // mirror still has no field for it, because no shipped board-highlight
    // filter needs it.
    enteredThisTurn: "adapter-only",
    // Mirrored on BOTH paths: `ClientPermanentFilter.controlledSinceTurnStart`
    // (board highlighting for Keldon Twilight's sacrifice picker) and the
    // adapter above. Both delegate to the same engine helper
    // `hasControlledSinceTurnStart` (`convex/gre/controlContinuity.ts`) — one
    // authority, so the highlight and the server's submit validation cannot
    // disagree. Both fail CLOSED without a `turnState`, which the parity
    // cases assert explicitly.
    controlledSinceTurnStart: "mirrored",
};

/** `buildTriggerStateView`'s battlefield-entry support for a `PermanentFilter`
 *  field — a THIRD reducer, distinct from `MIRROR_CENSUS`'s two (the
 *  `toMatchablePermanent` engine-matcher adapter and the `ClientPermanentFilter`
 *  board-highlight mirror). This is the shape `getStackAbilities`'
 *  `sacrificeFilter`/`tapOtherFilter` activation-cost affordability gates read
 *  through (issue #1951 review round 3, MAJOR 5 — the `isToken` BLOCKER from
 *  round 2 is exactly what silently rotting THIS reducer's shape looks like: a
 *  filter field the reducer doesn't populate reads as `false`/`undefined` in
 *  `matchesPermanentFilter`'s boolean-equality checks, which is fail-CLOSED
 *  against a `true`-valued filter — an ability permanently hidden — and
 *  fail-OPEN against a `false`-valued one — an illegal ability offered).
 *  Keyed by `keyof PermanentFilter` so adding a NEW field to `PermanentFilter`
 *  (`convex/cards/filters.ts`) breaks `tsc` here until this census is updated,
 *  the same "fix the class, not the field" discipline `MIRROR_CENSUS` already
 *  established. */
export type TriggerStateViewFieldStatus =
    | "populated"
    | "structural"
    | "conditional-on-turnState"
    | "intentionally-absent";

export const TRIGGER_STATE_VIEW_CENSUS: Record<
    keyof PermanentFilter,
    TriggerStateViewFieldStatus
> = {
    types: "populated",
    excludeTypes: "populated",
    subtypes: "populated",
    excludeSubtypes: "populated",
    supertypes: "populated",
    excludeSupertypes: "populated",
    requireAbility: "populated",
    excludeAbility: "populated",
    colors: "populated",
    tapped: "populated",
    isToken: "populated",
    isAttacking: "populated",
    isBlocking: "populated",
    createdBy: "populated",
    powerAtLeast: "populated",
    powerAtMost: "populated",
    toughnessAtLeast: "populated",
    // `id` is always populated, so both instance-id filters already work.
    instanceIds: "populated",
    excludeInstanceIds: "populated",
    // CR 109.2 (issue #2367) — same `id`-only data dependency as the two keys
    // above; the SOURCE half comes from the gate's own `FilterMatchContext`
    // (`getStackAbilities`' `sacrificeFilter` branch passes `selfInstanceId`),
    // not from this reducer, exactly like `controllerRelation` below.
    excludeSource: "populated",
    // Needs a `FilterMatchContext` with `selfControllerId`/`selfInstanceId` —
    // threaded by the gate's own call (`getStackAbilities`'
    // `sacrificeFilter`/`tapOtherFilter` branches pass `selfControllerId`),
    // not by this reducer; `controllerId` is populated, which is all
    // `matchesPermanentFilter` needs from the CANDIDATE side.
    controllerRelation: "populated",
    // "structural": a recursive OR-across-fields combinator, not itself a
    // data dependency — it re-checks the SAME populated fields its clauses
    // reference, so it works automatically once those do.
    any: "structural",
    // Only populated when `buildTriggerStateView`'s optional `turnState`
    // param is supplied (mirrors `toMatchablePermanent`'s identical
    // turn-scoped derivation); no shipped `sacrificeFilter`/`tapOtherFilter`
    // cost uses either dimension yet, so no existing caller passes it today —
    // distinct from "populated" above (those are unconditional).
    enteredThisTurn: "conditional-on-turnState",
    controlledSinceTurnStart: "conditional-on-turnState",
    // No battlefield permanent shape carries a live `name` field anywhere —
    // server-side `CardInstanceState` doesn't have one either (the SAME
    // project-wide gap `MIRROR_CENSUS.name` records above), so this is not a
    // reducer-specific drift.
    name: "intentionally-absent",
};

/** Count of a chooser's battlefield permanents that satisfy a `may-pay` cost's
 *  sacrifice leg (CR 701.21). Returns 0 when the cost has no sacrifice leg.
 *  Used by the UI affordability gate to know whether the Pay button is legal.
 *
 *  `ctx` resolves `PermanentFilter.controllerRelation` ("sacrifice two Swamps
 *  YOU control", Infernal Denizen / Minion of Leshrac, CR 701.21) — without it
 *  `matchesControllerRelation` (`convex/cards/filters.ts`) fails CLOSED (the
 *  filter never matches), undercounting a legal sacrifice to 0 and permanently
 *  disabling the Pay button (issue #1938 fixup 2 regression). Callers pass the
 *  CHOOSER's own id as `selfControllerId` — the mayPay's payer, mirroring the
 *  server's own `sacrificeCandidates` (`convex/gre/state.ts`), which passes
 *  `{ selfControllerId: playerId }`. */
export function mayPaySacrificeCount(
    cost: MayPayCost | undefined,
    battlefield: CardInstance[],
    ctx?: FilterMatchContext
): number {
    if (!cost || !("permanent" in cost) || !cost.permanent) return 0;
    const filter: PermanentFilter = cost.permanent.filter;
    return battlefield.filter((c) =>
        matchesEnginePermanentFilter(toMatchablePermanent(c), filter, ctx)
    ).length;
}

/** Number of permanents a FIXED-count `may-pay` sacrifice leg makes the payer
 *  sacrifice (CR 701.21a). Returns 0 when the cost has no sacrifice leg OR uses
 *  a summed-power threshold (`{ minTotalPower }`, which has no fixed cardinal —
 *  gate that shape with {@link mayPaySacrificePickSatisfied} instead). */
export function mayPayRequiredSacrifices(cost: MayPayCost | undefined): number {
    if (!cost || !("permanent" in cost) || !cost.permanent) return 0;
    return typeof cost.permanent.count === "number" ? cost.permanent.count : 0;
}

/** The terminal action of a `may-pay` cost's permanent leg — `"sacrifice"` (CR
 *  701.21) or `"return"` to the owner's hand (CR 400.7 / 118.9, ADR 0079) —
 *  or `undefined` when the cost has no permanent leg. Client mirror of the
 *  backend `mayPayPermanentAction`; words the pick prompt. */
export function mayPayPermanentAction(
    cost: MayPayCost | undefined
): "return" | "sacrifice" | undefined {
    if (!cost || !("permanent" in cost) || !cost.permanent) return undefined;
    return cost.permanent.action;
}

/** The summed-power threshold of a `may-pay` sacrifice leg (`{ minTotalPower }`
 *  mode, CR 118, Phyrexian Dreadnought), or `undefined` for a fixed-count leg
 *  or a cost with no sacrifice leg. */
export function mayPaySacrificeThreshold(
    cost: MayPayCost | undefined
): number | undefined {
    if (!cost || !("permanent" in cost) || !cost.permanent) return undefined;
    const count = cost.permanent.count;
    return typeof count === "object" ? count.minTotalPower : undefined;
}

/** Summed PRINTED power (CR 208.2) of a `may-pay` cost's matching sacrifice
 *  candidates on `battlefield`. Feeds the threshold-mode affordability gate
 *  (CR 118). Returns 0 when the cost has no sacrifice leg.
 *
 *  `ctx` — see {@link mayPaySacrificeCount}; same `controllerRelation`
 *  fail-closed hazard applies here (issue #1938 fixup 2). */
export function mayPaySacrificePower(
    cost: MayPayCost | undefined,
    battlefield: CardInstance[],
    ctx?: FilterMatchContext
): number {
    if (!cost || !("permanent" in cost) || !cost.permanent) return 0;
    const filter: PermanentFilter = cost.permanent.filter;
    return battlefield
        .filter((c) =>
            matchesEnginePermanentFilter(toMatchablePermanent(c), filter, ctx)
        )
        .reduce((sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0), 0);
}

/** Summed PRINTED power (CR 208.2) of the chooser's currently-selected
 *  sacrifice victims. Drives the threshold-mode pick-progress display
 *  ("N / minTotalPower power selected"). */
export function mayPaySacrificeSelectionPower(
    selectedIds: string[],
    battlefield: CardInstance[]
): number {
    const selected = new Set(selectedIds);
    return battlefield
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0), 0);
}

/** Whether the chooser's current sacrifice pick satisfies a battlefield
 *  `may-pay` sacrifice leg (CR 701.21a / 118). Fixed-count legs require exactly
 *  `count` picks; threshold legs (`{ minTotalPower }`, Phyrexian Dreadnought)
 *  require the selected permanents' summed PRINTED power to reach the threshold
 *  (over-payment allowed). A cost with no sacrifice leg is trivially satisfied. */
export function mayPaySacrificePickSatisfied(
    cost: MayPayCost | undefined,
    selectedIds: string[],
    battlefield: CardInstance[]
): boolean {
    const threshold = mayPaySacrificeThreshold(cost);
    if (threshold !== undefined) {
        const selected = new Set(selectedIds);
        const power = battlefield
            .filter((c) => selected.has(c.id))
            .reduce(
                (sum, c) => sum + (tryGetDefinition(c.card.id)?.power ?? 0),
                0
            );
        return selectedIds.length > 0 && power >= threshold;
    }
    return selectedIds.length === mayPayRequiredSacrifices(cost);
}

/** Number of hand cards a `may-pay` discard leg makes the payer discard (CR
 *  701.9 / 118.3, issue #899). Returns 0 when the cost has no discard leg.
 *  Mirrors {@link mayPayRequiredSacrifices} — the discard leg has no
 *  summed-power threshold shape. */
export function mayPayRequiredDiscards(cost: MayPayCost | undefined): number {
    if (!cost || !("hand" in cost) || !cost.hand) return 0;
    return cost.hand.requirements.reduce((a, r) => a + r.count, 0);
}

/** Whether the chooser's current discard pick satisfies a hand `may-pay`
 *  discard leg (CR 701.9 / 118.9, issue #899): the selection must name exactly
 *  `count` distinct hand cards AND cover every requirement from DISTINCT
 *  matching cards. A cost with no discard leg is trivially satisfied. Mirrors
 *  {@link mayPaySacrificePickSatisfied}'s fixed-count branch.
 *
 *  Validated through {@link assignMayPayHandCards} with the buffer as the
 *  preference — the client-side twin of the server's `mayPayHandSelectionLegal`
 *  submit boundary, run over the SAME authority so the Pay button never enables
 *  on a pick the mutation would reject (PR #1963 review round 2). `selectedIds`
 *  is the click ORDER, which is exactly what the greedy consumes. */
export function mayPayDiscardPickSatisfied(
    cost: MayPayCost | undefined,
    selectedIds: string[],
    hand: readonly MayPayHandCard[] = []
): boolean {
    if (selectedIds.length !== mayPayRequiredDiscards(cost)) return false;
    if (!cost || !("hand" in cost) || !cost.hand) return true;
    if (new Set(selectedIds).size !== selectedIds.length) return false;
    const assigned = assignMayPayHandCards(hand, cost.hand, selectedIds);
    if (!assigned) return false;
    const chosen = new Set(selectedIds);
    return assigned.every((c) => chosen.has(c.id));
}

/** Human-readable label for a `may-pay` cost union, rendered after "Pay" on the
 *  prompt button. Mana renders as symbol tokens (formatOracleText-ready); life
 *  and sacrifice render as words, joined with " and " (Infernal Darkness:
 *  "{B} and 1 life"). Returns "" for a cost-less choice. */
export function mayPayCostLabel(cost?: MayPayCost): string {
    if (!cost) return "";
    const norm = normalizeMayPayCost(cost);
    const parts: string[] = [];
    if (norm.mana) {
        const s = manaCostToString(norm.mana);
        if (s) parts.push(s);
    }
    if (norm.life !== undefined && norm.life > 0) {
        parts.push(`${norm.life} life`);
    }
    if (norm.permanent) {
        const n = norm.permanent.count;
        if (typeof n === "object") {
            // CR 118 threshold mode (Phyrexian Dreadnought).
            parts.push(
                `sacrifice creatures with total power ${n.minTotalPower}`
            );
        } else if (norm.permanent.action === "return") {
            // CR 400.7 / 118.9 (ADR 0079) — the return-to-hand leg.
            parts.push(n === 1 ? "return a permanent" : `return ${n}`);
        } else {
            parts.push(n === 1 ? "sacrifice" : `sacrifice ${n}`);
        }
    }
    if (norm.hand) {
        const n = norm.hand.requirements.reduce((a, r) => a + r.count, 0);
        const verb = norm.hand.action === "exile" ? "exile" : "discard";
        parts.push(n === 1 ? `${verb} a card` : `${verb} ${n} cards`);
    }
    if (norm.energy !== undefined && norm.energy > 0) {
        // CR 122.1 / issue #1194 — energy costs print as repeated {E} symbol
        // tokens ("{E}{E}{E}"), the same convention `manaCostToString` uses
        // for mana above; `formatOracleText` (the label's only consumer)
        // already renders any `{X}` token generically, so no new glyph
        // plumbing is needed here.
        parts.push("{E}".repeat(norm.energy));
    }
    return parts.join(" and ");
}

export function groupByName(cards: CardInstance[]): CardInstance[][] {
    const groups: Map<string, CardInstance[]> = new Map();
    for (const card of cards) {
        // Display-only grouping key (issue #1735 review round 3 census):
        // `displayCardId`, not raw `card.card.id`, so a face-down permanent
        // groups by its OWN controller's known identity rather than
        // universally as "Face-down creature". Currently unreferenced
        // (no caller in the tree), hardened defensively so the census this
        // round ran against has no latent raw-id site left to find later.
        const name = getDefinition(displayCardId(card)).name;
        const group = groups.get(name);
        if (group) {
            group.push(card);
        } else {
            groups.set(name, [card]);
        }
    }
    return [...groups.values()];
}

/** CR 601.2b / 118.8 — the ADDITIONAL-cost legs (`additionalCosts.oneOf`) the
 *  caster can currently AFFORD for a hand card: "discard a card or pay 3 life"
 *  (Bitter Triumph) with an empty hand offers only the life leg, and at 3 or
 *  less life only the discard leg. `[]` for every card without a disjunction —
 *  callers read that as "no choice to make", never as "unpayable" (a card whose
 *  every leg is unpayable is not castable at all, and `getLegalActions` has
 *  already suppressed the Cast affordance by then).
 *
 *  Delegates to the server predicate `payableAdditionalCostLegs` — the SAME
 *  authority `announceCast` enforces and the Bot's enumerator reads — so the
 *  picker can never offer a leg the mutation rejects, and no leg-affordability
 *  logic is duplicated client-side. The projected `Player` carries every field
 *  the predicate reads (`life`, own-hand `card.id`, battlefield
 *  `types`/`subtypes`), so it evaluates correctly against the wire projection:
 *  the caster's OWN hand is projected in full, and this affordance is only ever
 *  computed for the viewer's own cast. */
export function payableAdditionalCostLegsForCard(
    card: CardInstance,
    casterId: string,
    players: ReadonlyArray<Player>
): AdditionalCostLeg[] {
    const caster = players.find((p) => p.id === casterId);
    if (!caster) return [];
    const def = tryGetDefinition(card.card.id);
    return payableAdditionalCostLegs(
        caster as unknown as PlayerState,
        def?.additionalCosts,
        card.id
    );
}
