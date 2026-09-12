/**
 * The PURE activation path (CR 602 — activating an activated ability), and
 * the cost-payment machinery it drives (issue #3479).
 *
 * WHY IT LIVES HERE AND NOT IN `convex/game.ts`. `game.ts` imports `./auth`
 * at its line 4, so every module that reaches it is server-only: the
 * client-bundle purity guard (ADR 0074,
 * `scripts/__tests__/client-bundle-purity.test.ts`) refuses that import from
 * `src/`, and one VALUE import is enough to crash the app on cold load with
 * "process is not defined". That single import is what kept the blade suite's
 * engine-real `setup` steps (`gre/ai/blade/setup.ts`) out of the browser —
 * and with them the verdict quiz's ability to rebuild ANY position whose
 * pending decision comes from a real activation. Measured over five matchups
 * (PR #3474): 23.0% of the 1300 decisions with a non-empty stack hold an
 * activated ability, which is the share that gated on.
 *
 * THE MUTATION STILL CALLS THIS MODULE — `convex/game.ts` re-exports every
 * name below rather than keeping a copy, so there is ONE activation path and
 * it cannot fork. Everything the mutation owns is I/O: fetch the row, clone
 * the state, persist. Every legality check, every cost payment, every stack
 * push lives here.
 *
 * Nothing in this module is async and nothing takes a Convex `ctx`; every
 * function mutates the `GameState` it is handed, in place.
 */

import { getDefinition, tryGetDefinition } from "../cards";
import { classLevelActivationViolation } from "../cards/abilities/classLevels";
import type {
    AbilityMode,
    ActivatedAbility,
    CardDefinition,
    CardType,
    ManaCost,
    PermanentFilter,
    TargetRequirement,
} from "../cards/types";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import type { GrantedAbilityOrigin } from "./activatedAbilities";
import {
    buildActivatedAbilityStackItem,
    recordActivation,
} from "./activationCommit";
import { buildActivationSacrificeSelection } from "./activationCostPicks";
import { castAsAdventure } from "./adventure";
import { handCardMatchesFilter } from "./alternativeCost";
import { applyBestowCharacteristics } from "./bestow";
import {
    exileCastPermission,
    graveyardCastStackFlags,
    reboundCastStackFlags,
} from "./castCost";
import type { CastFromZone } from "./castCost";
import { isTapLockedBySummoningSickness, manaValue } from "./constants";
import { findEscapeCastable } from "./escape";
import { payExertActivationCost } from "./exert";
import { assertExpectedInput } from "./expectedInput";
import { turnFaceDown } from "./faceDown";
import { findFlashbackCastable } from "./flashback";
import { additionalCostPaymentSnapshot } from "./kicker";
import { STATIC_EFFECT_CTX, getEffectivePower } from "./layers";
import {
    LOYALTY_VIOLATION_MESSAGE,
    loyaltyActivationViolation,
    payLoyaltyCost,
} from "./loyalty";
import {
    captureNinjutsuAttackTarget,
    ninjutsuReturnCandidateIds,
} from "./ninjutsu";
import { nextOwedPayment, tapOtherContribution } from "./owedPayment";
import { resolveDivideTotal } from "./pendingTargetOrigin";
import { effectivePermanentView } from "./permanentView";
import { drainAutoPasses, isSorceryTiming } from "./phases";
import { findRetraceCastable } from "./retrace";
import {
    canCastFromGraveyardByPermission,
    canCastPermanentFromGraveyardByPermission,
    effectiveRequirementForSource,
    getLegalTargets,
    isCastableLibraryTopSpell,
    markGraveyardPermanentCastUsed,
    pendingTargetFiltersFromRequirement,
    targetingSourceFromCard,
} from "./rules";
import {
    applySacrificeSelection,
    canAffordSacrifice,
    isSacrificeSelectionComplete,
    type SacrificeSelection,
} from "./sacrificeChoice";
import { liveSupertypesOf } from "./snow";
import { castAsSplitHalf } from "./splitCast";
import {
    NO_SPELL_MANA_RIDERS,
    addRestrictedManaToPool,
    applyCostModifiers,
    canPayDiscardLastDrawn,
    commitLandsForCost,
    discardToGraveyard,
    emitBecameTargetEvents,
    emitPermanentTapped,
    emitSpellCastEvent,
    genericSpendAmbiguityForPayment,
    getAbilityManaSubstitutions,
    getCastManaSubstitutions,
    getCostModifiers,
    getOpponentId,
    getPlayer,
    getStaticAdditionalSacrifices,
    grantKnowledgeToAll,
    hasAnyManaRider,
    isManaCostCovered,
    manaRiderStackStamps,
    manaRidersForAbility,
    manaSpentDelta,
    matchesPermanentFilter,
    moveCard,
    normalizeManaCost,
    payDiscardAtRandomCost,
    payDiscardLastDrawn,
    payExileThisCost,
    payManaCostForAbility,
    payManaCostForSpell,
    payRemoveCounterCost,
    payReturnThisToHandCost,
    processPendingActionTriggers,
    removeFromZone,
    removePermanentTo,
    resolveTargetRequirementCount,
    resolveTopOfStack,
    settleSpellManaSubstitutionGrant,
    spendablePoolForAbility,
    spendablePoolForSpell,
    tapPermanent,
    type CardInstanceState,
    type GameState,
    type ManaSubstitution,
    type PendingActivation,
    type PendingCast,
    type PlayerState,
    type StackItem,
} from "./state";
import type { ManaRiders, SpellManaRiders } from "./state";
import { canPayTapOtherCost } from "./tapOtherCost";
import type { ManaRestriction } from "./types";
import { ConvexError } from "convex/values";

/** Guard: reject actions on a finished game. */
export function assertGameNotOver(state: GameState) {
    if (state.gameOver) throw new Error("Game is over");
}

/** Guard: reject actions while the engine is suspended awaiting
 *  mid-resolution player choices (CR 608.2). Priority is frozen in this
 *  window — only `submitResolutionChoice` is legal.
 *
 *  CR 608.2g exception: while a player is being asked an optional may-pay
 *  question, they may activate mana abilities to make the mana required.
 *  Pass `allowManaForMayPay: true` from the tap/untap mana mutations so
 *  they can run during the pending may-pay's payment window for that
 *  player. Other mid-resolution choice kinds keep the strict guard. */
export function assertNoPendingChoices(
    state: GameState,
    opts: { allowManaForMayPay?: { playerId: string } } = {}
) {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) return;
    const head = queue[0];
    const allow = opts.allowManaForMayPay;
    if (allow && head.kind === "may-pay" && head.playerId === allow.playerId) {
        return;
    }
    throw new Error(
        "Waiting for resolution choices — complete them before acting"
    );
}

/** CR 106.6 (issue #1559 review) — deposits mana produced by tapping a source
 *  into the correct pool: the fungible `manaPool` when `restriction` is
 *  undefined, or the parallel `restrictedMana` pool (carrying `rider`, CR
 *  106.6 "can't be countered") when the producing ability declares one
 *  (Mishra's Workshop, Adarkar Unicorn, Delighted Halfling's legendary-spell
 *  ability). Shared by every tap-for-mana path — `tapUntap`'s priority tap and
 *  `tapSourceIntoPayment`'s payment tap — so a restricted ability's output
 *  never reaches the fungible pool no matter which mutation taps it. Fixes
 *  the bug found in the #1559 PR review: `tapSourceIntoPayment` added
 *  restricted mana straight to `manaPool`, so the restriction was entirely
 *  unenforced (CR 106.6 — the mana paid for anything) and the "can't be
 *  countered" rider was silently dropped, on the payment-tap path — the
 *  auto-tap / click-to-pay UX that is the DEFAULT way to cast a spell. */
export function depositTappedMana(
    player: PlayerState,
    chosen: ManaCost,
    restriction: ManaRestriction | undefined,
    riders: ManaRiders | undefined
): void {
    // CR 106.6 (issue #3354) — a RIDER forces the deposit into the parallel
    // pool even with no restriction at all (Arena of Glory's {R}{R} may pay
    // for anything, but carries "if spent on a creature spell…"): the fungible
    // `manaPool` is a bare per-colour count with nowhere to record the tag.
    const tagged = restriction !== undefined || hasAnyManaRider(riders);
    for (const [color, amount] of Object.entries(chosen)) {
        if (color !== "X" && typeof amount === "number" && amount > 0) {
            if (tagged) {
                addRestrictedManaToPool(
                    player,
                    color,
                    amount,
                    restriction,
                    undefined,
                    riders
                );
            } else {
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        }
    }
}

/** True iff a card sitting in a graveyard satisfies the exile-from-graveyard
 *  cost's optional card-type filter (CR 118.5 / 406 — Night Soil: "creature
 *  cards"). The card's printed types are read from its instance (graveyard
 *  cards retain `types`); when `cardType` is omitted any card qualifies. */
export function graveyardCardMatchesExileCost(
    card: CardInstanceState,
    cardType?: CardType
): boolean {
    if (cardType === undefined) return true;
    return card.types.includes(cardType);
}

/** True iff at least ONE eligible graveyard holds `count` cards matching
 *  `cardType` (CR 118.5 — the whole cost must be paid from a SINGLE graveyard;
 *  it cannot be split across two). Gates activation legality for an
 *  `exileFromGraveyard` cost (Night Soil). When `restrictOwnerId` is set, only
 *  that player's graveyard is eligible (CR 118.5 — Grim Lavamancer's "your
 *  graveyard", `owner: "you"`); otherwise any player's graveyard qualifies. */
export function canPayExileFromGraveyard(
    state: GameState,
    count: number,
    cardType?: CardType,
    restrictOwnerId?: string
): boolean {
    const sources =
        restrictOwnerId !== undefined
            ? state.players.filter((p) => p.id === restrictOwnerId)
            : state.players;
    return sources.some(
        (p) =>
            p.graveyard.filter((c) =>
                graveyardCardMatchesExileCost(c, cardType)
            ).length >= count
    );
}

/** Untapped permanents on `player`'s battlefield that match `filter` and are
 *  eligible to pay a `tapOtherFilter` cost (CR 602.1 / 118.8). The source
 *  permanent (`sourceId`) is excluded — the cost taps OTHER permanents — as is
 *  anything already tapped. Effective colours are derived per-candidate via the
 *  layer system so a `colors` filter ("white creatures") reads the same colour
 *  the rest of the engine sees. The activating player is the controller-relation
 *  reference, so `controllerRelation: "you"` resolves to `player`. */
export function tapOtherCandidates(
    player: PlayerState,
    sourceId: string,
    filter: PermanentFilter
): CardInstanceState[] {
    return player.battlefield.filter((c) => {
        if (c.id === sourceId) return false;
        if (c.isTapped) return false;
        const view = {
            ...c,
            colors: STATIC_EFFECT_CTX.getColors(c),
        };
        return matchesPermanentFilter(view, filter, {
            selfControllerId: player.id,
            supertypesOf: liveSupertypesOf,
        });
    });
}

/** Cast-from-exile lookup (CR 601.3 — Ice Cauldron: "You may cast that card
 *  for as long as it remains exiled"). Returns the card carrying
 *  `castableFromExileBy === casterId` and matching `instanceId`, or undefined.
 *  Searches EVERY player's exile, not just the caster's own (issue #1156):
 *  a grant is usually same-player (Ice Cauldron), but `grantCastFromExile`'s
 *  `zoneOwnerId` already supports a CROSS-PLAYER grant (Robber of the Rich,
 *  Dauthi Voidwalker — the redirected/exiled card stays in ITS OWNER's exile,
 *  CR 400.7, while a different player is granted the cast permission), so the
 *  lookup can't assume the caster's own zone. The cast pipeline checks the
 *  hand first, then this. */
export function findCastableExileCard(
    state: GameState,
    casterId: string,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        // CR 702.185a (issue #1268) — through the shared authority: a grant can
        // be stamped and not yet OPEN (a warped card is castable only "after
        // the current turn has ended"), and this is the REAL payment path.
        const found = p.exile.find(
            (c) =>
                c.id === instanceId &&
                exileCastPermission(c, casterId, state.turn)
        );
        if (found) return found;
    }
    return undefined;
}

/** CR 601.3 / 400.7 (issue #1156) — the player whose zone actually holds a
 *  card being cast/played, which may differ from the CASTER (`player`) for a
 *  cross-player exile grant (Robber of the Rich, Dauthi Voidwalker). Every
 *  other cast zone (hand, graveyard) is always the caster's own — Flashback /
 *  Escape / the broad graveyard-cast permission all read from the caster's
 *  OWN graveyard, no cross-player graveyard-cast primitive exists — so this
 *  only ever redirects for `zone === "exile"`. Falls back to `player` when
 *  the card isn't found in any exile (defensive; callers have already located
 *  the card via `locateCastSource` / `findCastableExileCard`, so this should
 *  always resolve for a real cast). Exported so the cross-player cast-commit
 *  integration test can drive the exact removal the mutation performs (no
 *  convex-test harness in this repo — mirrors `locateCastSource` /
 *  `castRawManaCost`, issue #944 pattern). */
export function castZoneOwner(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    zone: CastFromZone
): PlayerState {
    if (zone !== "exile") return player;
    return (
        state.players.find((p) =>
            p.exile.some((c) => c.id === cardInstanceId)
        ) ?? player
    );
}

/** CR 305.1-analog / 601 (issue #1149) — the SPELL half of the BROAD,
 *  turn-scoped graveyard-cast permission (Yawgmoth's Will). Returns the
 *  NON-LAND card in `player`'s graveyard matching `instanceId` while the
 *  permission covers it, or undefined. Never returns a card that already has
 *  Flashback/Escape — `locateCastSource` checks those first, so this is only
 *  ever reached for a card with neither (the permission then covers it for
 *  its normal printed mana cost). */
export function findGraveyardPermissionCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return canCastFromGraveyardByPermission(state, player, card)
        ? card
        : undefined;
}

/** Per-card cast-from-graveyard grant lookup (CR 601.3 / 118.9,
 *  issue #1344 — Malcolm, Alluring Scoundrel: "you may cast the discarded
 *  card without paying its mana cost"). Returns the NON-LAND card in
 *  `player`'s graveyard matching `instanceId` while it carries
 *  `castableFromGraveyardBy === player.id`, or undefined. Distinct from
 *  `findGraveyardPermissionCastable` above (the BROAD, turn-scoped
 *  permission) — this is a SPECIFIC-CARD grant, always same-player (no
 *  cross-player graveyard-cast primitive exists, `castZoneOwner`'s doc
 *  below). Never returns a card that already has Flashback/Escape/the
 *  broad permission — `locateCastSource` checks those first, so this is
 *  only ever reached for a card with none of them. */
export function findGraveyardGrantCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card || card.types.includes("Land")) return undefined;
    return card.castableFromGraveyardBy === player.id ? card : undefined;
}

/** CR 702.51 / 601.3 (issue #1338, Hogaak, Arisen Necropolis) — the INTRINSIC
 *  self-permission lookup: a non-land card in `player`'s graveyard whose own
 *  definition declares `castableFromOwnGraveyard` ("You may cast this card from
 *  your graveyard"). Always same-player. Never returns a card that has
 *  Flashback/Escape/a broad-or-specific external permission — `locateCastSource`
 *  checks those first, so this is only reached for a card with none of them. */
export function findIntrinsicGraveyardCastable(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card || card.types.includes("Land")) return undefined;
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return def?.castableFromOwnGraveyard ? card : undefined;
}

/** CR 702.139 (issue #1392, Lurrus of the Dream-Den) — the STATIC,
 *  battlefield-derived graveyard-permanent-cast permission lookup. Returns
 *  the card in `player`'s graveyard matching `instanceId` while
 *  `canCastPermanentFromGraveyardByPermission` covers it, or undefined.
 *  Never returns a card that already has Flashback/Escape/the broad
 *  permission/a specific grant — `locateCastSource` checks those first, so
 *  this is only ever reached for a card with none of them. */
export function findGraveyardPermanentPermissionCastable(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = player.graveyard.find((c) => c.id === instanceId);
    if (!card) return undefined;
    return canCastPermanentFromGraveyardByPermission(state, player, card)
        ? card
        : undefined;
}

/** CR 601.3 (issue #2398, Bolas's Citadel) — the cast-from-top-of-
 *  library lookup. Returns the NONLAND card on top of `player`'s own library
 *  when it matches `instanceId` and `player` holds the cast-from-top
 *  permission, or undefined. Position-strict (index 0 only): the permission
 *  names the TOP card and the rest of the library is a hidden zone (CR 400.2),
 *  so a stale client id naming a card the library has since moved must never
 *  become a cast from the middle of the deck. Like the graveyard/library land
 *  permissions this is derived live from the battlefield every call — nothing
 *  on the card itself to check or clear. */
export function findCastableLibraryTopSpell(
    state: GameState,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    if (!isCastableLibraryTopSpell(state, player, instanceId)) return undefined;
    return player.library[0];
}

/** Locate the card being cast and the zone it comes from — hand, exile
 *  (Ice Cauldron, CR 601.3), or graveyard (Flashback, CR 702.34, Escape,
 *  CR 702.138, or the BROAD graveyard-cast permission, CR 305.1-analog / 601,
 *  issue #1149). A single choke point so every cast-commit site derives the
 *  origin identically. The `card` is undefined when the id isn't castable
 *  from any zone (callers throw "Card not in hand"). `viaGraveyardPermanentPermission`
 *  is set true ONLY when the STATIC graveyard-permanent-cast permission
 *  (Lurrus, issue #1392) is what supplied this cast — the ordered chain
 *  below reaches that branch only when no higher-precedence mechanism
 *  (Flashback/Escape/the broad permission/a specific grant) already claimed
 *  the card, so the flag unambiguously identifies which permission to debit
 *  its once-per-turn use against at commit (`markGraveyardPermanentCastUsed`).
 *  `viaRetrace` is the same idea for Retrace (CR 702.81, issue #2358): the
 *  LAST branch of the chain, so the flag unambiguously says "this cast owes
 *  the discard-a-land additional cost" and no other mechanism's cast ever
 *  pays it.
 *  Exported so the flashback integration test can drive the REAL cast-source
 *  resolution (no convex-test harness — issue #944). */
export function locateCastSource(
    state: GameState,
    player: PlayerState,
    instanceId: string
): {
    card?: CardInstanceState;
    zone: CastFromZone;
    viaGraveyardPermanentPermission?: true;
    viaRetrace?: true;
} {
    const inHand = player.hand.find((c) => c.id === instanceId);
    if (inHand) return { card: inHand, zone: "hand" };
    const exile = findCastableExileCard(state, player.id, instanceId);
    if (exile) return { card: exile, zone: "exile" };
    const flashback = findFlashbackCastable(player, instanceId);
    if (flashback) return { card: flashback, zone: "graveyard" };
    // CR 702.138b — a card with escape may be cast from its owner's graveyard.
    const escape = findEscapeCastable(state, player, instanceId);
    if (escape) return { card: escape, zone: "graveyard" };
    // CR 305.1-analog / 601 (issue #1149) — a card castable purely under the
    // BROAD graveyard-cast permission (neither Flashback nor Escape).
    const permissionCast = findGraveyardPermissionCastable(
        state,
        player,
        instanceId
    );
    if (permissionCast) return { card: permissionCast, zone: "graveyard" };
    // CR 601.3 / 118.9 (issue #1344) — a card castable purely under a
    // SPECIFIC-CARD graveyard-cast grant (Malcolm, Alluring Scoundrel),
    // reached only when the card has none of Flashback/Escape/the broad
    // permission (those branches above already returned).
    const grantCast = findGraveyardGrantCastable(player, instanceId);
    if (grantCast) return { card: grantCast, zone: "graveyard" };
    // CR 702.51 / 601.3 (issue #1338) — a card castable purely under its OWN
    // intrinsic "you may cast this from your graveyard" permission (Hogaak),
    // reached only when the card has no Flashback/Escape/external permission/
    // specific grant. Resolves normally (no exile-on-resolve).
    const intrinsicGraveyardCast = findIntrinsicGraveyardCastable(
        player,
        instanceId
    );
    if (intrinsicGraveyardCast) {
        return { card: intrinsicGraveyardCast, zone: "graveyard" };
    }
    // CR 702.139 (issue #1392) — a card castable purely under Lurrus's
    // STATIC, once-per-turn, permanent-cards-only permission, reached only
    // when the card has none of Flashback/Escape/the broad permission/a
    // specific grant (those branches above already returned).
    const permanentPermissionCast = findGraveyardPermanentPermissionCastable(
        state,
        player,
        instanceId
    );
    if (permanentPermissionCast) {
        return {
            card: permanentPermissionCast,
            zone: "graveyard",
            viaGraveyardPermanentPermission: true,
        };
    }
    // CR 601.3 (issue #2398, Bolas's Citadel) — the NONLAND card on
    // top of the caster's OWN library, under the player-wide cast-from-top
    // permission. Last in the chain because every other mechanism above is
    // scoped to hand/exile/graveyard and can never name a library card, so
    // the ordering is informational rather than a precedence rule.
    const libraryTopCast = findCastableLibraryTopSpell(
        state,
        player,
        instanceId
    );
    if (libraryTopCast) return { card: libraryTopCast, zone: "library" };
    // CR 702.81 (issue #2358) — a card castable under RETRACE, printed or
    // granted (Wrenn and Six's emblem). Deliberately last among the GRAVEYARD
    // branches: retrace
    // pays the card's normal mana cost PLUS an extra land discard, so every
    // graveyard mechanism above is cheaper for the caster and a card
    // qualifying for two of them takes the other.
    const retraceCast = findRetraceCastable(state, player, instanceId);
    if (retraceCast) {
        return { card: retraceCast, zone: "graveyard", viaRetrace: true };
    }
    return { zone: "hand" };
}

/** Resolves an activated ability's mana cost, folding in the FEM Merseine
 *  "pay enchanted creature's mana cost" dynamic cost (CR 601.2f / 202.3). When
 *  `manaEqualToEnchantedCreatureCost` is set, the source's `attachedTo`
 *  permanent's PRINTED mana cost is added on top of any declared `cost.mana`
 *  (normally none). Returns `undefined` when there is no mana cost at all, and
 *  throws when the dynamic cost is declared but the source isn't attached to a
 *  permanent on the battlefield (illegal activation). */
export function resolveAbilityManaCost(
    state: GameState,
    card: CardInstanceState,
    ability: { cost: ActivatedAbility["cost"] },
    opts: { chosenX?: number } = {}
): Record<string, number> | undefined {
    const base = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana, { chosenX: opts.chosenX })
        : undefined;
    // CR 601.2f — Chromatic Armor's "{X}: … X is the number of sleight counters
    // on this Aura": fold `card.counters[type]` generic pips onto the base. X is
    // fixed by board state (no player choice), read at activation.
    if (ability.cost.manaEqualToCounterCount) {
        const have =
            card.counters?.[ability.cost.manaEqualToCounterCount.type] ?? 0;
        const merged: Record<string, number> = { ...(base ?? {}) };
        if (have > 0) merged.X = (merged.X ?? 0) + have;
        return Object.keys(merged).length > 0 ? merged : undefined;
    }
    if (!ability.cost.manaEqualToEnchantedCreatureCost) return base;

    const hostId = card.attachedTo;
    const host = hostId
        ? state.players
              .flatMap((p) => p.battlefield)
              .find((c) => c.id === hostId)
        : undefined;
    if (!host) {
        throw new Error("Enchanted creature is no longer on the battlefield");
    }
    const hostCardId = (host.card as { id?: string }).id;
    const hostCost = (hostCardId ? tryGetDefinition(hostCardId) : undefined)
        ?.manaCost;
    // Merge the host's printed cost (normalized so X folds to 0, CR 202.3b)
    // onto the base.
    const merged: Record<string, number> = { ...(base ?? {}) };
    const hostNormalized = hostCost ? normalizeManaCost(hostCost) : {};
    for (const [sym, amt] of Object.entries(hostNormalized)) {
        merged[sym] = (merged[sym] ?? 0) + amt;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/** CR 602.1 / 118.3 — "discard a card matching <filter>" is unpayable unless
 *  the activator holds at least `count` matching cards. Lifted out of
 *  `activateAbilityOnState` (issue #3455) so the NON-STACK mana path gates on
 *  the identical predicate rather than a second copy: a mutation that admits
 *  what the other refuses is exactly how "the ability fired and nothing
 *  happened" ships. Throws; no-op when the ability has no such leg. */
export function assertDiscardFilterCostAffordable(
    player: PlayerState,
    ability: ActivatedAbility
): void {
    const leg = ability.cost.discardFilter;
    if (!leg) return;
    const candidates = player.hand.filter((c) =>
        handCardMatchesFilter(c, leg.filter)
    );
    if (candidates.length < leg.count) {
        throw new Error(
            "Not enough matching cards in hand to pay the discard cost"
        );
    }
}

/** CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>" is unpayable
 *  unless the activator controls enough matching permanents. The twin of
 *  {@link assertDiscardFilterCostAffordable}, extracted for the same reason
 *  (issue #3455). Throws; no-op when the ability has no such leg. */
export function assertSacrificeFilterCostAffordable(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    ability: ActivatedAbility
): void {
    const leg = ability.cost.sacrificeFilter;
    if (!leg) return;
    const candidates = player.battlefield.filter((c) =>
        // Layered view, matching `sacrificeCandidates` (issue #1209).
        matchesPermanentFilter(effectivePermanentView(state, c), leg, {
            selfControllerId: player.id,
            // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact": the
            // source is not a legal payment for its own cost.
            selfInstanceId: card.id,
            supertypesOf: liveSupertypesOf,
        })
    );
    // CR 602.1 / 118.5 (issue #2398) — "Sacrifice TEN nonland permanents"
    // (Bolas's Citadel): the gate is a COUNT, not mere existence.
    if (candidates.length < (ability.cost.sacrificeFilterCount ?? 1)) {
        throw new Error("No legal permanent to pay the sacrifice cost");
    }
}

/** Builds the `pendingActivation` payment descriptor for a non-targeted
 *  activated ability whose costs are deferred (mana not yet covered, or a
 *  choice cost still pending). Single source of truth for the `activateAbility`
 *  mutation so every deferred cost — crucially the CR 106.10 noted-mana capture
 *  flag (Jeweled Amulet / Ice Cauldron) — is carried onto the payment and
 *  honoured at `tryAutoCommitPendingActivation`. Pure: returns the descriptor,
 *  mutates nothing. */
export function buildPendingActivation(opts: {
    playerId: string;
    cardInstanceId: string;
    abilityId: string;
    ability: ActivatedAbility;
    manaCost: Record<string, number> | undefined;
    chosenX?: number;
    /** CR 700.2c (issue #1341) — mode locked in at announcement for a modal
     *  activated ability; rides to the stack item at commit. */
    chosenModeId?: string;
    keepPriority?: boolean;
    grantedSourceCardId?: string;
    /** CR 113.1 — which list on the granting def holds the template (issue
     *  #2943). Travels with `grantedSourceCardId` at every hand-off. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
    fromGraveyard?: boolean;
    fromHand?: boolean;
    /** Unified filtered-sacrifice choice (own cost + static Drought), built by
     *  the caller which has `state` (CR 701.21a). */
    sacrificeSelection?: SacrificeSelection;
}): PendingActivation {
    const { ability } = opts;
    return {
        playerId: opts.playerId,
        cardInstanceId: opts.cardInstanceId,
        ...(opts.fromGraveyard ? { fromGraveyard: true } : {}),
        ...(opts.fromHand ? { fromHand: true } : {}),
        abilityId: opts.abilityId,
        ...(opts.chosenModeId ? { chosenModeId: opts.chosenModeId } : {}),
        manaCost: opts.manaCost ?? {},
        tappedLandIds: [],
        tapSource: !!ability.cost.tap,
        sacrificeSource: !!ability.cost.sacrifice,
        ...(ability.cost.discardThis ? { discardThisSource: true } : {}),
        // CR 702.29c / 702.29f — carry the "this discard pays a cycling cost"
        // marker to commit, where the ability object is no longer in scope.
        // Declared once on `cyclingActivationShell`, so cycling AND typecycling
        // both get it without either factory restating it.
        ...(ability.cost.cyclingCost ? { cyclingCost: true } : {}),
        // CR 702.129a / 118.3 — Eternalize's "Exile this card from your
        // graveyard" leg. Deferred to commit like `discardThisSource` so a
        // cancelled mana payment leaves the graveyard untouched.
        ...(ability.cost.exileThis ? { exileThisSource: true } : {}),
        // CR 602.1a / 118.1 — Attunement's "Return this enchantment to its
        // owner's hand" leg. Deferred to commit like `exileThisSource` so a
        // cancelled mana payment leaves the permanent on the battlefield.
        ...(ability.cost.returnThisToHand
            ? { returnThisToHandSource: true }
            : {}),
        // CR 701.43a / 602.1a — Arena of Glory's "Exert this land" leg.
        // Deferred to commit like every other non-mana leg so a cancelled mana
        // payment leaves the source un-exerted.
        ...(ability.cost.exertThis ? { exertSource: true } : {}),
        ...(ability.cost.removeCounter
            ? { removeCounterCost: { ...ability.cost.removeCounter } }
            : {}),
        ...(ability.cost.life !== undefined
            ? { lifeCost: ability.cost.life }
            : {}),
        ...(ability.cost.discardLastDrawn
            ? { discardLastDrawnSource: true }
            : {}),
        ...(ability.cost.discardAtRandom
            ? { discardAtRandomCount: ability.cost.discardAtRandom }
            : {}),
        // CR 702.49a — mark the selection above as a ninjutsu RETURN leg, so
        // the commit path knows to capture CR 702.49c's defender before the
        // bounce takes the returned creature out of combat.
        ...(ability.cost.returnUnblockedAttacker
            ? { returnUnblockedAttacker: true }
            : {}),
        ...(opts.sacrificeSelection
            ? { sacrificeSelection: opts.sacrificeSelection }
            : {}),
        ...(ability.cost.exileFromGraveyard
            ? {
                  exileFromGraveyardChoice: {
                      count: ability.cost.exileFromGraveyard.count,
                      ...(ability.cost.exileFromGraveyard.cardType !== undefined
                          ? {
                                cardType:
                                    ability.cost.exileFromGraveyard.cardType,
                            }
                          : {}),
                      ...(ability.cost.exileFromGraveyard.owner !== undefined
                          ? { owner: ability.cost.exileFromGraveyard.owner }
                          : {}),
                  },
              }
            : {}),
        ...(ability.cost.tapOtherFilter
            ? {
                  tapOtherChoice: {
                      filter: ability.cost.tapOtherFilter.filter,
                      ...(ability.cost.tapOtherFilter.count !== undefined
                          ? { count: ability.cost.tapOtherFilter.count }
                          : {}),
                      ...(ability.cost.tapOtherFilter.totalPower !== undefined
                          ? {
                                totalPower:
                                    ability.cost.tapOtherFilter.totalPower,
                                pickedPower: 0,
                            }
                          : {}),
                      pickedIds: [],
                  },
              }
            : {}),
        ...(ability.cost.discardFilter
            ? {
                  discardFilterChoice: {
                      filter: ability.cost.discardFilter.filter,
                      count: ability.cost.discardFilter.count,
                  },
              }
            : {}),
        ...(opts.chosenX !== undefined ? { chosenX: opts.chosenX } : {}),
        // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron). Carry
        // the capture flag onto the deferred payment so the per-colour
        // mana-spent delta is snapshotted at commit (auto-tap / manual-tap
        // path). Without this the noted mana is silently lost when the pool
        // doesn't already cover the cost.
        ...(ability.noteManaSpent ? { noteManaSpent: true } : {}),
        keepPriority: opts.keepPriority,
        ...(opts.grantedSourceCardId
            ? { grantedSourceCardId: opts.grantedSourceCardId }
            : {}),
        ...(opts.grantedAbilityOrigin
            ? { grantedAbilityOrigin: opts.grantedAbilityOrigin }
            : {}),
    };
}

/** Effective card types of an activated ability's SOURCE object, used to key
 *  restricted-mana eligibility at the ACTIVATION payment path (CR 106.6, issue
 *  #728 — Soldevi Machinist's "spend this mana only to activate abilities of
 *  artifacts"). Searches every battlefield first (CR 113.3c — the source may
 *  sit on an opponent's board for an "any player may activate" ability), then
 *  graveyards (CR 113.6 — Ashen Ghoul-style graveyard activations). Returns an
 *  empty list when the source can't be found, which makes EVERY restriction
 *  ineligible — the conservative direction (the payment falls back to the
 *  fungible pool exactly as it did before the seam existed). */
export function activationSourceTypes(
    state: GameState,
    cardInstanceId: string | undefined
): readonly string[] {
    if (!cardInstanceId) return [];
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === cardInstanceId);
        if (found) return found.types;
    }
    for (const p of state.players) {
        const found = p.graveyard.find((c) => c.id === cardInstanceId);
        if (found) return found.types;
    }
    return [];
}

/** The permanent (or graveyard / hand card) a parked `pendingActivation` names
 *  as its ability's SOURCE, or `undefined` when it has since left that zone.
 *
 *  Zone search order, unchanged from where this used to be inlined in
 *  {@link tryAutoCommitPendingActivation}:
 *   - CR 113.3c — every player's battlefield, not just the activator's: an
 *     "any player may activate" ability's source sits on someone else's board
 *     while the activator pays from their own pool;
 *   - CR 113.6 — graveyards, but ONLY when the payment was flagged
 *     `fromGraveyard` (Ashen Ghoul), so a battlefield source that died
 *     mid-payment still reads as gone instead of resurrecting from its
 *     graveyard;
 *   - CR 113.6 / 702.29a — the activator's hand, only under `fromHand`
 *     (Cycling), for the same reason.
 *
 *  Extracted (issue #2944) because two callers now need it BEFORE they spend
 *  anything: the commit path's mana-coverage check and `autoTapForPayment`'s
 *  tap plan both read the activation-scoped substitutions off this source
 *  (CR 602.1 / 609.4b), and a probe that disagreed with the payment would be a
 *  bot freeze. Pure — it resolves a reference and drops nothing. */
export function findPendingActivationSource(
    state: GameState,
    player: PlayerState,
    pa: {
        cardInstanceId: string;
        fromGraveyard?: boolean;
        fromHand?: boolean;
    }
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === pa.cardInstanceId);
        if (found) return found;
    }
    if (pa.fromGraveyard) {
        for (const p of state.players) {
            const found = p.graveyard.find((c) => c.id === pa.cardInstanceId);
            if (found) return found;
        }
    }
    if (pa.fromHand) {
        const found = player.hand.find((c) => c.id === pa.cardInstanceId);
        if (found) return found;
    }
    return undefined;
}

/** If the activator's pool now covers pendingActivation, pay mana, apply the
 *  deferred tap/sacrifice costs on the source, push the ability on the stack,
 *  and swap priority. Mirrors tryAutoCommitPendingCast for abilities. Returns
 *  the source card name on commit, or null if nothing was committed. */
export function tryAutoCommitPendingActivation(
    state: GameState,
    playerId: string,
    genericSpendOrder?: readonly string[]
): { cardInstanceId: string; abilityId: string; cardName?: string } | null {
    const pa = state.pendingActivation;
    if (!pa || pa.playerId !== playerId) return null;

    // CR 602.2 — an activated ability may only be put on the stack while its
    // controller has priority. Same defense as tryAutoCommitPendingCast: a
    // payment left dangling after priority moves away must not auto-commit on
    // the opponent's turn.
    //
    // CR 605.3a (issue #3455) — a MANA ability is the documented exception: it
    // is legal with priority, while paying a spell's or ability's mana cost,
    // AND inside a may-pay window, where `priorityPlayerId` is not the payer at
    // all. Its announcement never reaches the stack, so CR 602.2 has nothing to
    // say about it; the window was already validated by the entry point that
    // built this park (`activateManaAbility` / `tapUntap` /
    // `tapSourceIntoPayment`), and gating it here would strand the park with no
    // way to clear — a freeze, not a rejection.
    if (!pa.resolveWithoutStack && state.priorityPlayerId !== playerId) {
        return null;
    }

    const player = getPlayer(state, playerId);
    // CR 602.1 / 609.4b (issue #2944) — the ability seam needs the source
    // permanent, so the lookup that used to sit below the coverage check is
    // hoisted here. It is a pure read: the "source vanished => drop the
    // payment" branch stays exactly where it was, BELOW the coverage and
    // owed-payment gates, so a partially-paid activation whose source is gone
    // is still dropped in the same order it always was.
    const card = findPendingActivationSource(state, player, pa);
    // CR 106.6 (issue #728) — restricted mana eligible for THIS ability's
    // source (Soldevi Machinist's artifact-ability mana) counts toward
    // coverage, exactly as `spendablePoolForSpell` does at the cast path.
    const paSourceTypes = activationSourceTypes(state, pa.cardInstanceId);
    if (
        !isManaCostCovered(
            spendablePoolForAbility(player, paSourceTypes),
            pa.manaCost,
            getAbilityManaSubstitutions(state, player.id, card)
        )
    )
        return null;
    // CR 602.1 / 118 — every DEFERRED cost pick (sacrifice, graveyard exile,
    // tap-other/crew, filtered discard) blocks commit until the activator has
    // named the cards, regardless of mana coverage. This gate does not CALL the
    // owed-payment seam, it IS it (ADR 0091 / issue #1209): `nextOwedPayment`
    // carries the exact chain of early returns that used to sit here, in the
    // same order, and the vs-AI bot reads the same function — so a park cannot
    // exist that the gate blocks on and the bot cannot see. `gateOwnsManaSpend`
    // holds back the CR 601.2g mana-spend park only: this gate re-derives that
    // one from the live pool a few lines below (a parked prompt whose ambiguity
    // has since vanished must be CLEARED, not honoured).
    if (nextOwedPayment(state, playerId, { gateOwnsManaSpend: true })) {
        return null;
    }

    if (!card) {
        // Source vanished (e.g. removed by an opposing effect). Drop the
        // payment silently — lands stay tapped (same policy as cancelCast for
        // sacrificed sources).
        state.pendingActivation = undefined;
        return null;
    }

    // CR 601.2g — an ambiguous generic-mana payment PARKS awaiting the
    // activator's choice of which mana pays the generic cost. Evaluated once
    // every other cost/choice gate above has cleared and mana is covered, so the
    // pool reflects only the generic portion still owed. When no order was
    // supplied (the caller is the plain resume path) and the choice is
    // meaningful, stash it on `pendingActivation` and return without committing;
    // `resolveManaSpendChoice` supplies a valid order and re-enters here.
    if (!genericSpendOrder) {
        const ambiguity = genericSpendAmbiguityForPayment(
            player.manaPool,
            pa.manaCost,
            getAbilityManaSubstitutions(state, player.id, card)
        );
        if (ambiguity) {
            pa.manaSpendChoice = ambiguity;
            return null;
        }
    }
    // The choice is settled (auto-pick or a supplied order) — clear any stale
    // parked prompt before the pool is spent.
    pa.manaSpendChoice = undefined;

    // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron). Snapshot
    // the pool before payment so the per-colour delta becomes the noted mana.
    const poolBeforePayment = pa.noteManaSpent
        ? { ...player.manaPool }
        : undefined;
    // CR 106.6 (issue #728) — restricted-first settlement, mirroring the cast
    // path's `payManaCostForSpell`.
    payManaCostForAbility(
        player,
        pa.manaCost,
        paSourceTypes,
        getAbilityManaSubstitutions(state, player.id, card),
        genericSpendOrder
    );
    const notedManaSpent = poolBeforePayment
        ? manaSpentDelta(poolBeforePayment, player.manaPool)
        : undefined;
    commitLandsForCost(player, pa.manaCost);

    // Deferred non-mana costs (CR 602.1) — applied now so cancellation leaves
    // the source untouched.
    if (pa.tapSource) {
        if (card.isTapped) {
            // Benign double-commit race: the source got tapped between the
            // payment opening and this commit (e.g. the player double-clicked
            // the land). A misclick must not surface a server error — drop the
            // payment silently, same policy as a vanished source above (lands
            // stay tapped).
            state.pendingActivation = undefined;
            return null;
        }
        card.isTapped = true;
    }
    // CR 701.43a — "Exert this permanent" (Arena of Glory). Applied with the
    // other deferred, always-payable legs: CR 701.43b makes it legal whether or
    // not the source is tapped and whether or not it was already exerted, so
    // unlike the zone-move legs below there is nothing to re-check at commit.
    if (pa.exertSource) {
        payExertActivationCost(state, card);
    }
    if (pa.removeCounterCost) {
        payRemoveCounterCost(state, card, pa.removeCounterCost);
    }
    if (pa.discardLastDrawnSource) {
        // CR 118.3 — re-check at commit: the recorded card may have left the
        // hand while mana was being tapped. If so, drop the payment silently
        // (lands stay tapped, same policy as a vanished source above).
        if (!canPayDiscardLastDrawn(player)) {
            state.pendingActivation = undefined;
            return null;
        }
        payDiscardLastDrawn(state, player);
    }
    if (pa.discardAtRandomCount) {
        // CR 118.3 — re-check at commit: the hand may have emptied while mana
        // was being tapped. If so, drop the payment silently (lands stay
        // tapped, mirroring the vanished-source / discardLastDrawn policy).
        if (player.hand.length === 0) {
            state.pendingActivation = undefined;
            return null;
        }
        payDiscardAtRandomCost(state, playerId, pa.discardAtRandomCount);
    }
    // CR 119.4 — pay the life cost at commit (deferred so a dropped/cancelled
    // payment leaves the total untouched). Validated up-front at announcement.
    if (pa.lifeCost !== undefined) {
        player.life -= pa.lifeCost;
    }
    if (pa.sacrificeSource) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    }
    // CR 702.29a / 118.3 — the Cycling "Discard this card" cost. The source is
    // discarded from hand as the ability goes on the stack, routed through the
    // shared choke point so CARD_DISCARDED fires (Marauding Mako). Re-check at
    // commit: the card may have left the hand while mana was tapped; if so,
    // drop the payment silently (lands stay tapped, mirroring the
    // vanished-source policy above). Runs BEFORE the stack-item clone below so
    // the ability's source is captured while still valid.
    if (pa.discardThisSource) {
        // CR 702.29c — a cycling/typecycling cost payment is marked on the one
        // CARD_DISCARDED event so a "when you cycle this card" trigger can tell
        // it apart from an ordinary discard, without a second event (702.29d).
        if (
            !discardToGraveyard(
                state,
                playerId,
                card.id,
                pa.cyclingCost ? "cycling" : undefined
            )
        ) {
            state.pendingActivation = undefined;
            return null;
        }
    }
    // CR 118.1 / 601.2h — the "Exile this card/permanent" cost, paid as the
    // ability goes on the stack: graveyard → exile for an Eternalize-shaped
    // ability, battlefield → exile for a permanent's own self-exile cost
    // (Feldon's Cane). Re-check at commit: the source may have left that zone
    // while mana was tapped; if so, drop the payment silently (lands stay
    // tapped, mirroring the vanished-source policy above). Runs BEFORE the
    // stack-item clone below so the ability's source is captured while valid.
    if (pa.exileThisSource) {
        if (!payExileThisCost(state, player, card.id, !!pa.fromGraveyard)) {
            state.pendingActivation = undefined;
            return null;
        }
    }
    // CR 602.1a / 601.2h — the "Return this permanent to its owner's hand"
    // cost, paid as the ability goes on the stack (Attunement). Re-check at
    // commit: the permanent may have left the battlefield while mana was
    // tapped; if so, drop the payment silently (lands stay tapped, mirroring
    // the vanished-source policy above). Runs BEFORE the stack-item clone
    // below so the ability's source is captured while still valid.
    if (pa.returnThisToHandSource) {
        if (!payReturnThisToHandCost(state, card.id)) {
            state.pendingActivation = undefined;
            return null;
        }
    }
    // CR 602.1 / 118.3 — pay the "discard a card matching <filter>" cost
    // (Survival of the Fittest): move each picked card from hand to graveyard
    // through the shared discard choke point so CR 614 replacements /
    // CARD_DISCARDED fire. Re-check presence at commit (vanished-card
    // policy): if any picked card left the hand while mana was tapped, drop
    // the activation silently (lands stay tapped, mirroring the
    // vanished-source policy above).
    if (pa.discardFilterChoice?.pickedCardIds) {
        const stillInHand = pa.discardFilterChoice.pickedCardIds.every((id) =>
            player.hand.some((c) => c.id === id)
        );
        if (!stillInHand) {
            state.pendingActivation = undefined;
            return null;
        }
        for (const id of pa.discardFilterChoice.pickedCardIds) {
            discardToGraveyard(state, playerId, id);
        }
    }
    // CR 602.1 / 118.5 / 701.21a — execute the player-chosen filtered
    // sacrifice(s) (own cost + Drought) through the unified layer. The own-cost
    // requirement is snapshot-flagged: its mv/subtypes/effective power ride on
    // the stack item (Priest of Yawgmoth, Freyalise Supplicant).
    // CR 702.49c — capture the returned creature's defender BEFORE the bounce
    // removes it from combat, stamping it on the ninjutsu source still in hand.
    if (pa.returnUnblockedAttacker) {
        captureNinjutsuAttackTarget(state, card, pa.sacrificeSelection);
        // CR 702.49a/b — "Reveal this card from your hand" is the cost's third
        // leg. Knowledge here is per-viewer and monotonic (ADR 0026), so the
        // reveal is a grant with nothing to undo when CR 702.49b's window
        // closes.
        grantKnowledgeToAll(state, playerId, [card.id]);
    }
    const activationSacrificeSnapshot = sacrificeSnapshotFromSelection(
        pa.sacrificeSelection,
        state
    );
    // CR 602.1 / 118.5 / 406 — pay the "exile N cards from a single graveyard"
    // cost: move each picked card from that owner's graveyard to their exile.
    // Re-check presence at commit (vanished-card policy): if any picked card
    // is no longer in the chosen graveyard, drop the activation silently.
    let activationExileSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (pa.exileFromGraveyardChoice?.pickedCardIds) {
        const ownerId = pa.exileFromGraveyardChoice.pickedGraveyardOwnerId;
        const owner = ownerId
            ? state.players.find((p) => p.id === ownerId)
            : undefined;
        const stillThere =
            owner !== undefined &&
            pa.exileFromGraveyardChoice.pickedCardIds.every((id) =>
                owner.graveyard.some((c) => c.id === id)
            );
        if (!stillThere) {
            state.pendingActivation = undefined;
            return null;
        }
        activationExileSnapshot = exileCostSnapshot(
            owner,
            pa.exileFromGraveyardChoice.pickedCardIds
        );
        for (const id of pa.exileFromGraveyardChoice.pickedCardIds) {
            moveCard(owner, id, "graveyard", "exile");
        }
    }
    // CR 602.1 / 118.8 — tap the chosen "other" permanents (Hand of Justice).
    // Re-validate each at commit: a pick may have left play or been tapped
    // while mana was being paid. If any pick is no longer a legal payment,
    // drop the activation silently (lands stay tapped, mirroring the
    // vanished-source policy above).
    if (pa.tapOtherChoice) {
        const picks: CardInstanceState[] = [];
        for (const id of pa.tapOtherChoice.pickedIds) {
            const perm = player.battlefield.find((c) => c.id === id);
            if (!perm || perm.isTapped || perm.id === card.id) {
                state.pendingActivation = undefined;
                return null;
            }
            picks.push(perm);
        }
        for (const perm of picks) {
            tapPermanent(state, perm);
        }
    }

    // CR 605.3b (issue #3455) — a MANA ability does not use the stack. Every
    // cost leg above has now been paid exactly as it is for a stack ability;
    // what differs is only the terminal action, so the two share this whole
    // function and part here rather than in two copies of the payment chain.
    if (pa.resolveWithoutStack) {
        return commitNonStackActivation(state, player, card, pa);
    }

    // CR 601.2f / 701.21a — the filtered sacrifice(s) were executed above via
    // the unified layer (pa.sacrificeSelection); nothing more to pay here.
    const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.chosenModeId ? { chosenModeId: pa.chosenModeId } : {}),
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
        // CR 601.2d — divide-as-you-choose split forwarded from the deferred
        // payment to the resolving stack item (Arc Mage).
        ...(pa.targetAmounts ? { targetAmounts: pa.targetAmounts } : {}),
        ...(pa.chosenX !== undefined ? { chosenX: pa.chosenX } : {}),
        ...(pa.grantedSourceCardId
            ? { grantedSourceCardId: pa.grantedSourceCardId }
            : {}),
        ...(pa.grantedAbilityOrigin
            ? { grantedAbilityOrigin: pa.grantedAbilityOrigin }
            : {}),
        // CR 118.1 / 608.2h — the additional-cost victim's snapshot, from
        // whichever leg this activation actually paid. No shipped ability
        // declares BOTH a snapshot-flagged sacrifice cost and a single-card
        // graveyard-exile cost; if one ever does, the SACRIFICE leg wins, so
        // adding an exile leg can never silently change what an existing card
        // (Priest of Yawgmoth, Freyalise Supplicant) reads back.
        ...((activationSacrificeSnapshot ?? activationExileSnapshot)
            ? {
                  additionalSacrificeSnapshot:
                      activationSacrificeSnapshot ?? activationExileSnapshot,
              }
            : {}),
        ...(notedManaSpent ? { notedManaSpent } : {}),
    });
    state.stack.push(stackItem);
    recordActivation(state, card, pa.abilityId, !!pa.tapSource);

    const keepPriority = pa.keepPriority;
    state.pendingActivation = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;

    // CR 603.2b (issue #1265) — a DEFERRED-payment targeted ability locks its
    // targets as it finally reaches the stack; fire "becomes the target of an
    // ability" triggers (Leovold) alongside the tap-trigger flush below.
    // `"activated-ability"` (issue #2360) — a deferred-payment ACTIVATED
    // ability (CR 602.2b), never a cast spell.
    emitBecameTargetEvents(
        state,
        pa.targets,
        playerId,
        stackItem.id,
        "activated-ability"
    );
    // CR 603.2 — flush PERMANENT_TAPPED events queued during payment so
    // mana-tap triggers (Manabarbs / Mana Flare / Wild Growth) land on top
    // of the freshly-pushed activated ability. BEFORE the auto-pass drain,
    // which may otherwise start resolving the ability first (see
    // `commitPendingCast`).
    processPendingActionTriggers(state);

    drainAutoPasses(state);

    return {
        cardInstanceId: pa.cardInstanceId,
        abilityId: pa.abilityId,
        cardName: (card.card as { name?: string }).name,
    };
}

/** CR 605.3b (issue #3455) — commit a MANA ability whose cost carried a
 *  FILTERED give-up leg, once the payer has answered it.
 *
 *  Every cost leg is already paid by {@link tryAutoCommitPendingActivation},
 *  which this is the tail of: the mana portion, the {T}, the source sacrifice,
 *  and — the whole reason the announcement parked at all — the chosen victim /
 *  discarded card, executed through the SAME `sacrificeSelection` /
 *  `discardFilterChoice` layer the stack path uses. What is left is the part CR
 *  605.3b makes different: the ability resolves IMMEDIATELY, is never observable
 *  on the stack, and grants nobody priority — so there is no `passCount` reset,
 *  no `priorityPlayerId` swap and no `drainAutoPasses`.
 *
 *  Two output shapes, matching the two the engine already has for a mana
 *  ability:
 *   - a fixed `manaProduced` (Ashnod's Altar's {C}{C}, Phyrexian Tower's
 *     {B}{B}) is deposited directly, restriction- and rider-aware, exactly as
 *     `activateFixedSacrificeManaAbility` does for the tap-less self-sacrifice
 *     shape (CR 106.6);
 *   - anything else (an Effect Script / `resolve()` body) runs through a
 *     TRANSIENT stack item resolved and popped inside this call, the same
 *     bypass `activateManaAbility`'s fixed-effect path uses so the ability gets
 *     a full `SpellContext` without ever persisting on the stack.
 *
 *  CR 106.4 / 603.3 — a {T} leg paid this way is a COMMITMENT: the victim is in
 *  the graveyard and cannot be un-sacrificed, so the source is marked
 *  `manaCommitted` and the untap-to-refund toggle (`tapUntap`) refuses it. The
 *  same reasoning `tapTriggerCommitted` carries for a tap that put a trigger on
 *  the stack. */
export function commitNonStackActivation(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    pa: PendingActivation
): { cardInstanceId: string; abilityId: string; cardName?: string } {
    const resolved = resolveActivatedAbility(card, pa.abilityId);
    const ability = resolved?.ability;
    // The park is cleared BEFORE the ability resolves: the resolution can queue
    // triggers and re-enter the commit seams below, and a phantom park would
    // read to every one of them as a payment still owed.
    state.pendingActivation = undefined;
    if (pa.tapSource) card.manaCommitted = true;
    // CR 602.5 — increment BEFORE the resolve so `getActivationCount` inside a
    // `resolve()` body counts this activation (the `activateManaAbility`
    // convention).
    recordActivation(state, card, pa.abilityId, !!pa.tapSource);
    const produced = pa.inlineManaOutput;
    if (produced) {
        // CR 106.6 — a restricted / rider-carrying output floats in the
        // parallel pool, never the fungible one.
        depositTappedMana(
            player,
            produced,
            ability?.manaRestriction,
            manaRidersForAbility(ability)
        );
        // Emitted from the card object we still hold, so its types/subtypes
        // snapshot is the source's own even when a `cost.sacrifice` leg has
        // already moved it (the `activateFixedSacrificeManaAbility`
        // convention).
        // CR 605.2 — only when the activation actually TAPPED or sacrificed
        // the source. Skirk Prospector / Krark-Clan Ironworks / Skirge Familiar
        // do neither and stay on the battlefield, so a "tapped for mana" event
        // there is a lie a becomes-tapped watcher would act on (review finding
        // 5). `activateFixedSacrificeManaAbility`'s own emit is the sacrifice
        // half of the same gate.
        if (pa.tapSource || pa.sacrificeSource) {
            emitPermanentTapped(state, card, true, produced);
        }
    } else {
        // CR 605.3c — synthesize a transient stack item so the resolve gets a
        // full SpellContext, then let `resolveTopOfStack` pop it. It is pushed
        // and resolved inside this call, so it is never observable on the stack.
        state.stack.push(
            buildActivatedAbilityStackItem(card, {
                castById: player.id,
                abilityId: pa.abilityId,
                ...(pa.chosenModeId ? { chosenModeId: pa.chosenModeId } : {}),
                ...(pa.chosenX !== undefined ? { chosenX: pa.chosenX } : {}),
                ...(pa.grantedSourceCardId
                    ? { grantedSourceCardId: pa.grantedSourceCardId }
                    : {}),
                ...(pa.grantedAbilityOrigin
                    ? { grantedAbilityOrigin: pa.grantedAbilityOrigin }
                    : {}),
            })
        );
        resolveTopOfStack(state);
    }
    // CR 603.2 / 603.3b / 605.3b — flush what the cost and the mana queued (the
    // victim's own dies trigger, a Mana Flare-style watcher, PERMANENT_TAPPED).
    // No SBA pass: a mana ability resolves without one (CR 605.3b).
    //
    // TWO guards, both of them things the stack path is allowed to do and this
    // one is not (review findings 1A/1B):
    //
    //  - **Never inside a payment window.** CR 603.3b puts a waiting trigger on
    //    the stack "the next time a player would receive priority", which
    //    during a cast's payment is AFTER the spell is announced — so the
    //    trigger belongs ABOVE the spell, not below it. `tapSourceIntoPayment`
    //    already leaves its events queued for exactly this reason (see its
    //    `lifeBeforeTap` note about City of Brass); the cast's own commit
    //    flushes them.
    //  - **Never move priority.** `processPendingActionTriggers` ends in
    //    "LANDED → grant priority to the active player", which is right for an
    //    ability that went on the stack and catastrophic for one that did not:
    //    a non-active player activating a sac outlet at priority would hand
    //    priority away (CR 605.3b says activating a mana ability changes
    //    nothing about who holds it), and mid-cast it strands the payment
    //    forever — `tryAutoCommitPendingCast` gates on
    //    `priorityPlayerId === playerId`, so the creature is eaten, the mana
    //    floats, and the cast can never commit.
    //
    // The restore is SKIPPED when the flush suspended (CR 603.3b/603.3d — an
    // APNAP ordering choice or a trigger's own target selection): that path
    // parks priority on the chooser deliberately, and putting it back would
    // strand the choice instead.
    const priorityBeforeFlush = state.priorityPlayerId;
    const choicesBeforeFlush = state.pendingChoices?.length ?? 0;
    const targetBeforeFlush = state.pendingTarget;
    if (!state.pendingCast) {
        processPendingActionTriggers(state);
    }
    const flushSuspended =
        (state.pendingChoices?.length ?? 0) > choicesBeforeFlush ||
        state.pendingTarget !== targetBeforeFlush;
    if (!flushSuspended) state.priorityPlayerId = priorityBeforeFlush;
    // NOT carried here, and deliberately (review finding 7): the painland
    // coloured-tap ping (`applyColoredTapSelfDamage`), Ancient Tomb's
    // unconditional one (`applyUnconditionalTapSelfDamage`), the depletion
    // counter (`applyDepletionCounterOnTap`), Chromatic Sphere's draw
    // (`applyDrawCardOnTap`) and Rainbow Vale's control-change arm
    // (`armDelayedTriggerOnTap`). No card on this shape declares any of them —
    // the other cost-side riders (exert, life, discard-at-random, counter
    // removal) are already paid by the shared chain ABOVE the split, and the
    // undo bookkeeping (`recordLifePaidOnTap`, `chosenMana`, the tap-bonus
    // stamp) is unreachable because `manaCommitted` refuses the untap. A card
    // that ever combines one of the five with a filtered give-up cost needs
    // them wired here; this comment is so that is not discovered silently.
    //
    // CR 605.3a (issue #2420) — this activation may itself have been FUNDING a
    // pending cast: the mana it just added can complete it, and every other
    // payment mutation re-checks after adding pool mana. Without the same check
    // here a fully-covered cast whose last leg was this ability would never
    // commit — a silent freeze. No-op when no such cast is parked.
    tryAutoCommitPendingCast(state, player.id);
    return {
        cardInstanceId: pa.cardInstanceId,
        abilityId: pa.abilityId,
        cardName: (card.card as { name?: string }).name,
    };
}

/** CR 118.9 / 601.2h — pay the HAND leg of a chosen alternative cost: move each
 *  picked card from the caster's hand to exile (CR 701.13) or discard it to the
 *  graveyard (CR 701.9, through the discard choke point so CARD_DISCARDED /
 *  Library of Leng apply). Re-checks presence at commit (vanished-card policy):
 *  returns `false` if any picked card is no longer in hand, so the caller can
 *  drop the cast silently. Runs BEFORE the cast card itself leaves the hand. */
export function payAlternativeCostHandChoice(
    state: GameState,
    playerId: string,
    choice: NonNullable<PendingCast["alternativeCostHandChoice"]>
): boolean {
    const picks = choice.pickedCardIds;
    if (!picks) return false;
    const player = getPlayer(state, playerId);
    if (!picks.every((id) => player.hand.some((c) => c.id === id))) {
        return false;
    }
    for (const id of picks) {
        if (choice.action === "exile") {
            moveCard(player, id, "hand", "exile");
        } else {
            discardToGraveyard(state, playerId, id);
        }
    }
    return true;
}

/** What a cast-time mana payment produced, beyond draining the pool: the
 *  CR 106.6 riders it drew on (issues #1559 / #3354) and the CR 106.4
 *  per-colour record of the mana actually spent. */
export interface CastManaPayment {
    /** CR 106.6 (issues #1559 / #3354) — which mana riders the payment drew
     *  on. A record, not a boolean: the riders are independent and a single
     *  payment can fire both. */
    riders: SpellManaRiders;
    /** Present only when the card declares `noteManaSpent` (and the cost had a
     *  mana part at all) — the per-colour delta over the payment. */
    notedManaSpent?: Record<string, number>;
}

/** CR 601.2h — pay a spell's mana cost at the cast-commit step, and capture
 *  what was spent.
 *
 *  This is the ONE payment site for every spell cast-commit path in this file:
 *  `tryAutoCommitPendingCast` (park-and-pay), `finalizeTargetSelection`'s
 *  immediate branch, and `announceCast`'s two immediate-commit branches
 *  (normal cost and alternative cost). It exists because the capture half used
 *  to be copy-pasted at each site and only TWO of the four had it (issue
 *  #2378): a caster who floated the mana at priority before casting reached
 *  `announceCast`'s immediate branch, whose stack item carried no
 *  `notedManaSpent` at all — so Soul Burn (CR 202.3) read an empty record and
 *  a Sunburst permanent (CR 702.44a, Pentad Prism) entered with zero counters.
 *  Every path now shares one implementation, so a fifth cannot forget.
 *
 *  `cardDef` is the single source of the spell's printed types/supertypes
 *  (CR 106.6 restricted-mana eligibility, CR 205.4a `legendary-spell`) as well
 *  as the `noteManaSpent` opt-in — the callers no longer derive them
 *  separately and cannot disagree. */
export function payCastManaCost(
    state: GameState,
    player: PlayerState,
    manaCost: Record<string, number>,
    cardDef: CardDefinition | null | undefined,
    substitutions: ManaSubstitution[],
    cardInstanceId: string,
    genericSpendOrder?: readonly string[],
    /** CR 107.3 — the {X} this cast announced, so the settle step below prices
     *  the printed cost the same way the caller did. */
    chosenX?: number
): CastManaPayment {
    if (Object.keys(manaCost).length === 0) {
        return { riders: { ...NO_SPELL_MANA_RIDERS } };
    }
    // CR 609.4b / 118.14 (issue #2890) — a one-shot "for one spell this turn,
    // you may spend mana as though it were mana of any type/color" grant (North
    // Star) is spent by the first cast the pool could not otherwise cover.
    // Settled HERE, at the one payment seam every cast-commit path shares, and
    // BEFORE the pool is drained (the counterfactual reads the pre-payment
    // pool). A cast that some other permission already made payable leaves the
    // grant untouched.
    settleSpellManaSubstitutionGrant(
        state,
        player,
        manaCost,
        cardDef,
        cardInstanceId,
        chosenX
    );
    // CR 106.4 / 202.3 / 702.44b — snapshot the pool before payment so the
    // per-colour delta (`manaSpentDelta`, CR 106.10) becomes `notedManaSpent`
    // on the stack item. Only for cards that asked for it: the snapshot is a
    // pool copy per cast otherwise.
    const poolBeforePayment = cardDef?.noteManaSpent
        ? { ...player.manaPool }
        : undefined;
    const riders = payManaCostForSpell(
        player,
        manaCost,
        cardDef?.types ?? [],
        substitutions,
        cardInstanceId,
        genericSpendOrder,
        cardDef?.supertypes ?? []
    );
    return {
        riders,
        ...(poolBeforePayment
            ? {
                  notedManaSpent: manaSpentDelta(
                      poolBeforePayment,
                      player.manaPool
                  ),
              }
            : {}),
    };
}

export function tryAutoCommitPendingCast(
    state: GameState,
    playerId: string,
    genericSpendOrder?: readonly string[]
): { cardInstanceId: string; cardName: string | undefined } | null {
    if (!state.pendingCast || state.pendingCast.playerId !== playerId) {
        return null;
    }
    // CR 601.2 / 601.2i — a spell may only be put on the stack while its caster
    // has priority. Payment is a multi-step server interaction (tap each land);
    // if priority moved away mid-payment (player passed / ended turn), the
    // lingering pendingCast must NOT auto-commit. Without this guard a stale
    // payment could be finalized on the opponent's turn, casting at an illegal
    // time. The stale pendingCast is rolled back separately when priority is
    // surrendered (see abandonPendingPayment).
    if (state.priorityPlayerId !== playerId) {
        return null;
    }
    const player = getPlayer(state, playerId);
    // CR 106.6: a creature spell may also be paid with restricted mana whose
    // restriction permits it (Metamorphosis). Fold it into the affordability
    // check and drain it first at payment.
    const castInstanceId = state.pendingCast!.cardInstanceId;
    // CR 601.3 — the card may be cast from the hand OR from exile (Ice
    // Cauldron's "you may cast that card for as long as it remains exiled").
    const castSource = locateCastSource(state, player, castInstanceId);
    const castCard = castSource.card;
    const castDef = castCard
        ? tryGetDefinition((castCard.card as { id: string }).id)
        : undefined;
    const castTypes = castDef?.types ?? [];
    // CR 106.6 / 205.4a (issue #1559) — the printed supertypes of the spell
    // being cast, for the `legendary-spell` restriction's eligibility check
    // (Delighted Halfling). Reads the DEFINITION's printed supertypes rather
    // than the live overlay (`liveSupertypesOf`, `cards/snowReads.ts` —
    // `CardInstanceState` DOES carry a mutable overlay via
    // `grantedSupertypes`/`removedSupertypes`, contrary to an earlier,
    // inaccurate version of this comment). Matches `sba.ts`'s legend rule
    // (also printed-only) — no card grants/removes "Legendary" on a card
    // sitting in hand, so the two coincide for every real spell today.
    const castSupertypes = castDef?.supertypes ?? [];
    if (
        !isManaCostCovered(
            spendablePoolForSpell(
                player,
                castTypes,
                castInstanceId,
                castSupertypes
            ),
            state.pendingCast.manaCost,
            getCastManaSubstitutions(
                state,
                player,
                castInstanceId,
                castDef,
                state.pendingCast.manaCost,
                state.pendingCast.chosenX
            )
        )
    ) {
        return null;
    }
    // CR 601.2f / 118.8 / 702.51 / 702.34a / 118.9 — every DEFERRED cost pick
    // (filtered sacrifice incl. Drought's static tax, the exile additional cost,
    // convoke's creature picker, the flashback/escape/delve graveyard exile, the
    // alternative-cost hand leg) blocks commit until the caster has named the
    // cards, regardless of mana coverage. This gate does not CALL the
    // owed-payment seam, it IS it (ADR 0091 / issue #1209): `nextOwedPayment`
    // carries the exact chain of early returns that used to sit here, in the
    // same ORDER — convoke BEFORE delve, because the convoke pick pays the
    // coloured/hybrid pips and reduces the generic, so the delve picker is only
    // built after convoke resolves (`recordConvokeCreaturePick`). The vs-AI bot
    // reads the same function, so a park cannot exist that the gate blocks on
    // and the bot cannot see. `gateOwnsManaSpend` holds back the CR 601.2g
    // mana-spend park only: this gate re-derives that one from the live pool
    // below (a parked prompt whose ambiguity has since vanished must be
    // CLEARED, not honoured).
    if (nextOwedPayment(state, playerId, { gateOwnsManaSpend: true })) {
        return null;
    }
    // Every park above is now ANSWERED — these are the answers, applied by the
    // commit body below (they are read, never re-gated on, here).
    const castSel = state.pendingCast.sacrificeSelection;
    const ac = state.pendingCast.additionalCost;
    const castConvoke = state.pendingCast.convokeCreatureChoice;
    const castExile = state.pendingCast.exileFromGraveyardChoice;
    const castAltHand = state.pendingCast.alternativeCostHandChoice;
    // CR 601.2g — an ambiguous generic-mana payment PARKS awaiting the caster's
    // choice of which mana pays the generic cost. Evaluated once every other
    // cost/choice gate above has cleared and mana is covered (manual floating
    // pool and auto-tap overproduction converge here). With no order supplied
    // (plain resume path) and a meaningful choice, stash it on `pendingCast`
    // and return without putting the spell on the stack; `resolveManaSpendChoice`
    // supplies a valid order and re-enters here. The ambiguity is checked on the
    // spell's spendable pool (folds any eligible restricted mana), matching the
    // coverage check above.
    if (!genericSpendOrder) {
        const ambiguity = genericSpendAmbiguityForPayment(
            spendablePoolForSpell(
                player,
                castTypes,
                castInstanceId,
                castSupertypes
            ),
            state.pendingCast.manaCost,
            getCastManaSubstitutions(
                state,
                player,
                castInstanceId,
                castDef,
                state.pendingCast.manaCost,
                state.pendingCast.chosenX
            )
        );
        if (ambiguity) {
            state.pendingCast.manaSpendChoice = ambiguity;
            return null;
        }
    }
    // The choice is settled (auto-pick or a supplied order) — clear any stale
    // parked prompt before the pool is spent.
    state.pendingCast.manaSpendChoice = undefined;

    // CR 106.4 / 202.3 — cast-path payment + mana-spent tracking (Soul Burn,
    // Sunburst), through the shared `payCastManaCost` seam.
    const { riders: castManaRiders, notedManaSpent: castNotedManaSpent } =
        payCastManaCost(
            state,
            player,
            state.pendingCast.manaCost,
            castDef,
            getCastManaSubstitutions(
                state,
                player,
                castInstanceId,
                castDef,
                state.pendingCast.manaCost,
                state.pendingCast.chosenX
            ),
            castInstanceId,
            genericSpendOrder
        );
    commitLandsForCost(player, state.pendingCast.manaCost);

    // CR 118.8 / 701.21a — execute the player-chosen filtered sacrifice(s)
    // (Drought / own additional cost) through the unified layer. The own-cost
    // requirement is snapshot-flagged: its mana value + subtypes ride on the
    // stack item, read at resolve via SpellContext.getAdditionalSacrificeMv /
    // getAdditionalCostSubtypes.
    let additionalSacrificeSnapshot: StackItem["additionalSacrificeSnapshot"];
    if (castSel) {
        additionalSacrificeSnapshot = sacrificeSnapshotFromSelection(
            castSel,
            state
        );
    }
    // CR 406 — the exile additional cost (Soul Exchange). Snapshot the exiled
    // permanent's mv/subtypes ("+2/+2 if the exiled creature was a Thrull"),
    // then exile it (no sacrifice cause to leave-the-battlefield triggers).
    if (ac?.pickedId) {
        const exiled = player.battlefield.find((c) => c.id === ac.pickedId);
        if (!exiled) {
            // Picked permanent vanished between selection and commit —
            // refuse to push the spell, drop pendingCast silently.
            state.pendingCast = undefined;
            return null;
        }
        const exCardId = (exiled.card as { id?: string }).id;
        const exDef = exCardId ? tryGetDefinition(exCardId) : undefined;
        const exMv = exDef?.manaCost
            ? Object.entries(exDef.manaCost).reduce<number>(
                  (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
                  0
              )
            : 0;
        additionalSacrificeSnapshot = {
            cardInstanceId: exiled.id,
            mv: exMv,
            ...(exiled.subtypes && exiled.subtypes.length > 0
                ? { subtypes: [...exiled.subtypes] }
                : {}),
        };
        removePermanentTo(state, exiled.id, "exile");
    }

    // CR 702.34a / 118.5 — pay the flashback "exile X blue cards from your
    // graveyard" cost (Flash of Insight): move each picked card from the
    // caster's own graveyard to their exile. Re-check presence at commit
    // (vanished-card policy): if any picked card is no longer in the graveyard,
    // drop the pendingCast silently. Runs BEFORE the flashback card itself
    // leaves the graveyard below (the picks never include it — CR 601.2a).
    if (castExile?.pickedCardIds) {
        // CR 702.34a / 118.5 — the picked cost cards leave the caster's own
        // graveyard (default) or hand (`zone: "hand"`, the exile-from-hand
        // flashback cost) for exile.
        const exileSourceZone = castExile.zone ?? "graveyard";
        const exileSource =
            exileSourceZone === "hand" ? player.hand : player.graveyard;
        const stillThere = castExile.pickedCardIds.every((id) =>
            exileSource.some((c) => c.id === id)
        );
        if (!stillThere) {
            state.pendingCast = undefined;
            return null;
        }
        for (const id of castExile.pickedCardIds) {
            moveCard(player, id, exileSourceZone, "exile");
        }
    }
    // CR 702.51a (issue #1338) — pay Convoke: TAP each chosen creature as the
    // spell moves to the stack. Deferred to commit (like the delve exile above)
    // so a cancelled cast leaves the creatures untapped. Re-check presence
    // (vanished-card policy); drop the pendingCast silently on a mismatch.
    if (castConvoke?.pickedCreatureIds) {
        const stillThere = castConvoke.pickedCreatureIds.every((id) =>
            player.battlefield.some((c) => c.id === id && !c.isTapped)
        );
        if (!stillThere) {
            state.pendingCast = undefined;
            return null;
        }
        for (const id of castConvoke.pickedCreatureIds) {
            const creature = player.battlefield.find((c) => c.id === id);
            if (creature) creature.isTapped = true;
        }
    }
    // CR 118.9 — pay the alternative-cost HAND leg (Force of Will's "exile a
    // blue card", Foil's "discard an Island card and another card"): move each
    // picked card from hand to exile / graveyard. Runs BEFORE the cast card
    // itself leaves the hand below. Re-check presence (vanished-card policy);
    // drop the pendingCast silently on a mismatch.
    if (castAltHand?.pickedCardIds) {
        if (!payAlternativeCostHandChoice(state, playerId, castAltHand)) {
            state.pendingCast = undefined;
            return null;
        }
    }

    // CR 702.139 (issue #1392) — this cast is enabled EXCLUSIVELY by Lurrus's
    // STATIC graveyard-permanent-cast permission (no higher-precedence
    // mechanism claimed the card, `locateCastSource`'s ordered chain): debit
    // its once-per-turn use now, at commit.
    if (castSource.viaGraveyardPermanentPermission) {
        markGraveyardPermanentCastUsed(state, playerId);
    }
    // CR 601.3 / 702.34 — remove from the zone the card was actually cast from
    // (hand, exile for Ice Cauldron's noted card, or graveyard for Flashback).
    const castFromZone = castSource.zone;
    // issue #1156 — a cross-player exile grant (Dauthi Voidwalker, Robber of
    // the Rich) removes from the ACTUAL exile owner, not the caster.
    const spellCard = removeFromZone(
        state,
        castZoneOwner(
            state,
            player,
            state.pendingCast.cardInstanceId,
            castFromZone
        ),
        state.pendingCast.cardInstanceId,
        castFromZone,
        playerId
    );
    const pendingTargets = (state.pendingCast as Record<string, unknown>)
        .targets as StackItem["targets"] | undefined;
    const pendingChosenX = state.pendingCast.chosenX;
    const pendingKickerPayments = state.pendingCast.kickerPayments;
    const pendingBuybackPaid = state.pendingCast.buybackPaid;
    const pendingChosenModeId = state.pendingCast.chosenModeId;
    const pendingTargetAmounts = state.pendingCast.targetAmounts;
    // CR 601.2b / 118.4 — pay the "pay X life" additional cost the instant the
    // spell moves hand → stack (Fire Covenant). Affordability was validated at
    // announcement; SBA handles a fatal payment.
    const pendingPayLife = state.pendingCast.payLife;
    if (pendingPayLife && pendingPayLife > 0) {
        player.life -= pendingPayLife;
    }
    // CR 601.2f / 701.21a — the filtered sacrifice(s) were executed above via
    // the unified layer (castSel); nothing more to pay here.
    const stackItem: StackItem = {
        ...spellCard,
        castById: playerId,
        ...(pendingTargets ? { targets: pendingTargets } : {}),
        ...(pendingChosenX !== undefined ? { chosenX: pendingChosenX } : {}),
        // CR 702.33d / 702.175a (ADR 0085) — ONE partition at the write: the
        // kicked-counting entries land on `kickerPayments`, the rest on
        // `unkickedCostPayments`, so every "was this kicked" reader (including
        // the CLIENT's, which sees a slim item with no definition) stays
        // correct with no edit of its own.
        ...additionalCostPaymentSnapshot(castDef, pendingKickerPayments),
        ...(pendingBuybackPaid ? { buybackPaid: true } : {}),
        ...(pendingTargetAmounts
            ? { targetAmounts: pendingTargetAmounts }
            : {}),
        ...(pendingChosenModeId ? { chosenModeId: pendingChosenModeId } : {}),
        ...(additionalSacrificeSnapshot ? { additionalSacrificeSnapshot } : {}),
        ...(castNotedManaSpent ? { notedManaSpent: castNotedManaSpent } : {}),
        // CR 106.6 riders (issues #1559 / #3354) — mana spent on this cast
        // carried `cantBeCounteredRider` (Delighted Halfling, read by
        // `counter()` alongside the static `CardDefinition.cantBeCountered`)
        // and/or `hasteRider` (Arena of Glory, handed off to the permanent at
        // resolution). One helper stamps both, so the five cast-commit paths
        // cannot disagree.
        ...manaRiderStackStamps(castManaRiders, {
            bestowed: state.pendingCast.bestowed,
        }),
        // CR 702.74a — a parked Evoke cast (real hand-cost choice) carries the
        // marker through `PendingCast.evoked` (set at announcement) so it
        // still lands on the stack item once the picker completes.
        ...(state.pendingCast.evoked ? { evoked: true } : {}),
        // CR 702.109a — a parked Dash cast (mana payment via `tapForPayment`,
        // or a real non-mana pick composing with Dash) carries the marker
        // through `PendingCast.dashed` (set at announcement) so it still
        // lands on the stack item once mana is covered / the picker completes.
        ...(state.pendingCast.dashed ? { dashed: true } : {}),
        // CR 702.185a — a parked Warp cast (its cost is pure MANA, so it parks
        // on `tapForPayment` like any ordinary cast) carries the marker through
        // `PendingCast.warped`, set at announcement. Without it the deferred
        // commit builds a permanent bought at the warp price that never leaves.
        ...(state.pendingCast.warped ? { warped: true } : {}),
        // CR 702.96a (issue #3215) — a parked Overload cast (the ordinary case:
        // an overload cost is a MANA cost, so it parks on `tapForPayment`)
        // carries the marker through `PendingCast.overloaded`, set at
        // announcement. Without it the deferred commit builds a spell that was
        // paid for at the overload price and then resolves against the one
        // target it never announced.
        ...(state.pendingCast.overloaded ? { overloaded: true } : {}),
        // CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — the timing
        // memory Necromancy-shaped clauses key on, read back off the
        // ANNOUNCEMENT-time snapshot (`announceCast`) rather than re-derived
        // here, exactly like `evoked`/`dashed` immediately above. Re-deriving
        // at commit is NOT equivalent: activating mana abilities is part of
        // casting (CR 601.2g), and `tapForPayment` →
        // `resolveManaAbilityTriggerImmediately` can leave a SUSPENDED
        // triggered mana ability (CR 605.4a — Fertile Ground parks on its
        // colour pick) on the stack while this function runs in that very
        // same mutation, which made a textbook sorcery-speed main-phase cast
        // read as cast off sorcery timing.
        ...(state.pendingCast.castOffSorceryTiming
            ? { castOffSorceryTiming: true }
            : {}),
        ...graveyardCastStackFlags(state, spellCard, castFromZone),
        ...reboundCastStackFlags(spellCard, castFromZone),
    };
    // CR 702.103b (issue #2388) — see the matching call in
    // `finalizeTargetSelection`. This is the DEFERRED half of the same commit:
    // a bestow cast whose mana was paid across a separate `tapForPayment`
    // mutation lands here instead, and must become an Aura at exactly the same
    // seam. The choice rode here on `PendingCast.bestowed` (set at
    // announcement, the `evoked`/`dashed` shape); the flag on the stack item
    // itself is written by `applyBestowCharacteristics`, alongside the type
    // line it rewrites, so the two can never be set apart from each other.
    if (state.pendingCast.bestowed) applyBestowCharacteristics(stackItem);
    // CR 702.37c (issue #2705) — a MORPH cast puts a FACE-DOWN 2/2 on the
    // stack, not the printed card. The choice rode here on
    // `PendingCast.morphed` (set at announcement, the `evoked`/`dashed`/
    // `bestowed` shape); this is the branch a real morph cast reaches, since
    // the {3} is almost never already floating. Turned down BEFORE the push and
    // before `emitSpellCastEvent` below, so no viewer and no cast trigger ever
    // observes the face-up card on the stack.
    if (state.pendingCast.morphed) turnFaceDown(state, stackItem, "morph");
    // CR 715.3b (ADR 0120) — the DEFERRED half of the Adventure commit: a cast
    // whose mana was paid across a separate `tapForPayment` mutation lands
    // here, and must become the inset half at exactly the same seam. The choice
    // rode here on `PendingCast.castAsAdventure` (set at announcement, the
    // `bestowed`/`morphed` shape).
    if (state.pendingCast.castAsAdventure) castAsAdventure(stackItem);
    // CR 709.3b (ADR 0121) — the same deferred half, for a SPLIT card: the
    // announced side rode here on `PendingCast.castAsSplitHalf`, and the item
    // must become that half at exactly this seam.
    if (state.pendingCast.castAsSplitHalf) {
        castAsSplitHalf(stackItem, state.pendingCast.castAsSplitHalf);
    }
    state.stack.push(stackItem);

    const cardName = (spellCard.card as { name?: string }).name;
    const keepPriority = state.pendingCast.keepPriority;
    state.pendingCast = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    state.singleShotAutoPass = keepPriority ? undefined : playerId;

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

    return { cardInstanceId: spellCard.id, cardName };
}

// --- Queries ---

/** Resolves an activated ability id on a battlefield card against its
 *  post-layer effective set ({@link getEffectiveActivatedAbilities}). Returns
 *  the template and, when the ability was granted to this permanent by
 *  another card (CR 113.1), the granting card def id. Returns null if no
 *  matching ability exists. */
export function resolveActivatedAbility(
    card: CardInstanceState,
    abilityId: string
): {
    ability: NonNullable<
        ReturnType<typeof getDefinition>["activatedAbilities"]
    >[number];
    grantedSourceCardId?: string;
    grantedAbilityOrigin?: GrantedAbilityOrigin;
} | null {
    return (
        getEffectiveActivatedAbilities(card).find(
            (r) => r.ability.id === abilityId
        ) ?? null
    );
}

/** Throws a descriptive Error if the activated ability's CR 602.5 timing
 *  restrictions (controller-turn-only, once-per-turn cap, sorcery speed, and
 *  Boast's CR 702.142a attacked-this-turn precondition) are violated
 *  against the current state. Called by every activation entry point before
 *  cost lock so the rejection is surfaced before any mutation. Exported so an
 *  integration test can drive the real check (no convex-test harness in this
 *  repo — see `untapRefundsLife.test.ts`). */
export function assertActivationTimingLegal(
    state: GameState,
    card: CardInstanceState,
    ability: {
        id: string;
        controllerTurnOnly?: boolean;
        oncePerTurn?: boolean;
        sorcerySpeedOnly?: boolean;
        requiresAttackedThisTurn?: boolean;
        classLevelBar?: number;
        functionsAtClassLevel?: number;
    }
): void {
    if (
        ability.controllerTurnOnly &&
        state.activePlayerId !== card.controllerId
    ) {
        throw new Error("Activate only during your turn");
    }
    // CR 702.142a (Boast) — "Activate only if this creature attacked this
    // turn". `hasAttackedThisTurn` is stamped at declare-attackers
    // (`gre/combat.ts`, CR 508.1), deliberately SURVIVES END_OF_COMBAT (CR
    // 506.4 keeps a creature that attacked flagged for the rest of the turn)
    // and is cleared at CLEANUP (`gre/phases.ts`, CR 514.2) — so a Boast
    // ability stays activatable in the postcombat main phase and the end step,
    // exactly as the rule reads. Absence of the flag IS "did not attack": the
    // engine only ever writes it `true` and `serialize.ts` round-trips it, so
    // there is no unknown state here to fail open on.
    if (ability.requiresAttackedThisTurn && card.hasAttackedThisTurn !== true) {
        throw new Error("Activate only if this creature attacked this turn");
    }
    // CR 716.2a (issue #3234) — the class level gates: a level bar activates
    // only at level N-1, and an ability printed in the level-N section only
    // exists at level N or greater. Shared predicate with the Bot enumerator
    // and the UI affordance (`classLevelActivationViolation`), so none of the
    // three can disagree about whether a level-up is legal.
    const classLevelViolation = classLevelActivationViolation(card, ability);
    if (classLevelViolation !== null) {
        throw new Error(classLevelViolation);
    }
    if (ability.oncePerTurn) {
        const used = card.activationsThisTurn?.[ability.id] ?? 0;
        if (used >= 1) {
            throw new Error("Activate only once each turn");
        }
    }
    // CR 602.3b / 307.5 template — "activate only as a sorcery" follows the
    // same timing window a sorcery's own casting does (main phase, empty
    // stack, activator holds priority). Reuses the engine's canonical
    // `isSorceryTiming` helper — the same one `assertLoyaltyActivationLegal`
    // layers an active-player requirement on top of for loyalty abilities.
    if (ability.sorcerySpeedOnly && !isSorceryTiming(state)) {
        throw new Error("Activate only as a sorcery");
    }
}

/** CR 606 — validates a LOYALTY ABILITY (an ability whose cost carries a signed
 *  `cost.loyalty`) up-front, before any cost is paid. No-op for a non-loyalty
 *  ability.
 *
 *  THE THROWING WRAPPER, nothing more. The rule itself lives in
 *  `convex/gre/loyalty.ts` (`loyaltyActivationViolation`), because the bot's
 *  move enumerator and the search's cost payer need the SAME rule in boolean
 *  form and cannot import this module (`convex/gre/**` must not depend on
 *  `convex/game.ts`). Issue #2491: before the extraction the enumerator simply
 *  refused every loyalty ability, so the bot cast planeswalkers it never
 *  activated; re-deriving the rule there instead would have produced an
 *  enumerator-says-legal / server-rejects divergence that half-applies the
 *  bot's `activateAbility → selectTarget` sequence.
 *
 *  The three clauses (unchanged, and the messages are byte-identical):
 *   - CR 606.3 — at most one loyalty ability of a given permanent per turn
 *     (the per-instance `loyaltyActivatedThisTurn` lock);
 *   - CR 606.3 — the controller's own main phase, empty stack, holding
 *     priority (`isSorceryTimingFor`, the engine's one authority on that
 *     window — the old inline form paired the player-agnostic
 *     `isSorceryTiming` with an explicit active-player check, which is the
 *     same condition);
 *   - CR 606.6 — a `-N` cost is illegal unless the permanent has at least that
 *     many loyalty counters. (This clause cited CR 606.5 before #2491; 606.5
 *     is the cost-COMBINATION rule and 606.6 is the floor — `bun run cr 606.6`
 *     prints it.) */
export function assertLoyaltyActivationLegal(
    state: GameState,
    card: CardInstanceState,
    ability: { cost: { loyalty?: number } }
): void {
    const violation = loyaltyActivationViolation(state, card, ability);
    if (violation) throw new Error(LOYALTY_VIOLATION_MESSAGE[violation]);
}

/** Minimum number of targets required for a TargetRequirement.count value.
 *  Fixed N → N; range → min. Used to validate confirmTargets (CR 601.2c). */
export function minTargetCount(
    count: number | { min: number; max?: number }
): number {
    return typeof count === "number" ? count : count.min;
}

/** Resolves a target-count's `"X"` bound(s) (a literal `"X"` count, or a
 *  `{ min, max: "X" }` "up to X" range) to fixed numbers using the cast's
 *  `chosenX` (CR 107.3 / 601.2c). Returns the input unchanged for a plain
 *  numeric / already-fixed range. Thin wrapper over the single shared
 *  resolver (`gre/state.ts` `resolveTargetRequirementCount`, issue #2365)
 *  with `requireX: true` — the cast/activated-ability path is the one
 *  consumer that must reject an X-bearing count with no announced X
 *  (activated abilities without X in their cost never carry one). */
export function resolveTargetCount(
    count: number | "X" | { min: number; max?: number | "X" },
    chosenX: number | undefined
): number | { min: number; max?: number } {
    return resolveTargetRequirementCount(count, chosenX, { requireX: true });
}

/** True when the selected targets have reached the maximum allowed for this
 *  requirement. Fixed N → selected >= N; range → selected >= max (undefined
 *  max means no upper limit, so this never triggers auto-advance). */
// `pendingTargetFiltersFromRequirement` moved to `./gre/rules` (issue #1193) so
// the gre trigger-target path (`raiseTriggerTargetSelection`) can build a
// `PendingTarget` without importing `game.ts`. Imported above; same behavior.

/** CR 601.2f / 118.5 — affordability gate for board-wide static NON-mana
 *  additional costs (Drought). Throws (the cast/activation is illegal) when the
 *  announcing `player` controls too few permanents to pay the per-pip
 *  "sacrifice a <filter>" cost imposed on this spell/ability. Called at each
 *  announcement site, before entering the payment phase.
 *
 *  Exported (issue #1985) so a focused GRE-level test can drive the
 *  no-target alt-cost commit branch's REAL composition (this call,
 *  `buildCastSacrificeSelection`, `assertKickerPermanentSlotFree`,
 *  `buildCastPermanentCostChoice`, in the same order `announceCast` runs
 *  them) without going through the full mutation — the same reason
 *  `buildCastSacrificeSelection` and `assertKickerAnnouncementLegal` are
 *  already exported. The mutation ITSELF is also covered end to end, through
 *  `gameMutationHarness` (`alternative-cost.test.ts`, issue #1985 round 2). */
export function assertStaticAdditionalCostAffordable(
    state: GameState,
    rawManaCost: ManaCost | undefined,
    announced: CardInstanceState,
    player: PlayerState,
    kind: "spell" | "ability"
): void {
    const reqs = getStaticAdditionalSacrifices(
        state,
        rawManaCost,
        announced,
        kind
    );
    if (
        reqs.length > 0 &&
        !canAffordSacrifice(
            state,
            player.id,
            reqs.map((r) => ({ filter: r.filter, count: r.count }))
        )
    ) {
        throw new Error(
            "Can't pay the additional cost (not enough permanents to sacrifice)"
        );
    }
}

/** Apply a selection and extract the snapshot-flagged victim's mv/subtypes/power
 *  for the resulting stack item (CR 118.8 / 602.1 — Priest of Yawgmoth,
 *  Freyalise Supplicant). Shared by the cast and activation commit paths. */
export function sacrificeSnapshotFromSelection(
    selection: SacrificeSelection | undefined,
    state: GameState
): StackItem["additionalSacrificeSnapshot"] | undefined {
    if (!selection) return undefined;
    const results = applySacrificeSelection(state, selection);
    const snap = results.find((r) => r.snapshot);
    if (!snap) return undefined;
    return {
        cardInstanceId: snap.id,
        mv: snap.mv,
        ...(snap.subtypes ? { subtypes: snap.subtypes } : {}),
        ...(snap.power !== undefined ? { power: snap.power } : {}),
    };
}

/** Snapshot the card a `cost.exileFromGraveyard` activation cost is about to
 *  exile, for the resulting stack item (CR 118.1 — the cost is paid at
 *  activation; CR 608.2h — the object is gone by the time the ability
 *  resolves, so an effect reading "the exiled card's mana value" must read a
 *  snapshot, never the live zone). Necropolis ("Exile a creature card from
 *  your graveyard: Put X +0/+1 counters on this creature, where X is the
 *  exiled card's mana value").
 *
 *  The exile twin of `sacrificeSnapshotFromSelection`, writing the SAME
 *  `StackItem.additionalSacrificeSnapshot` field — which is already the
 *  additional-cost-victim snapshot for both departures, sacrifice AND exile
 *  (Soul Exchange's `additionalCosts.exileFilter` fills it on the cast path),
 *  and is read back through the same `SpellContext.getAdditionalSacrificeMv` /
 *  `getAdditionalCostSubtypes`.
 *
 *  Taken ONLY for a single-card cost, matching `sacrificeFilterCount`'s own
 *  documented policy: "the exiled card" has no referent once the cost exiles
 *  two (Night Soil, Grim Lavamancer — neither reads one back). MUST be called
 *  BEFORE the cards leave the graveyard. */
export function exileCostSnapshot(
    owner: PlayerState,
    pickedCardIds: string[]
): StackItem["additionalSacrificeSnapshot"] | undefined {
    if (pickedCardIds.length !== 1) return undefined;
    const exiled = owner.graveyard.find((c) => c.id === pickedCardIds[0]);
    if (!exiled) return undefined;
    const defId = (exiled.card as { id?: string }).id;
    const def = defId ? tryGetDefinition(defId) : undefined;
    return {
        cardInstanceId: exiled.id,
        mv: manaValue(def?.manaCost),
        ...(exiled.subtypes && exiled.subtypes.length > 0
            ? { subtypes: [...exiled.subtypes] }
            : {}),
    };
}

/** CR 602.1 / 118.5 / 701.21a — assemble every filtered sacrifice an activation
 *  owes into one player-chosen selection: the ability's own "sacrifice a
 *  <filter>" cost (snapshot-flagged) plus any board-wide static additional
 *  sacrifice (Drought — activated-ability form). Auto-resolves fungible boards
 *  inline. Returns undefined when the ability owes no filtered sacrifice. The
 *  ability's fixed self-sacrifice (`cost.sacrifice`) is NOT folded — it has no
 *  choice and stays on `sacrificeSource`. */
// `buildActivationSacrificeSelection` now lives in the pure engine
// (`gre/activationCostPicks.ts`) and is imported above: the bot's move
// enumerator needs the IDENTICAL selection to know which victims it must
// submit, and a second copy here is exactly how the two would drift.

/**
 * The PURE activation path (CR 602 — activating an activated ability), lifted
 * verbatim out of the `activateAbility` mutation below so it can be driven
 * WITHOUT a Convex `ctx`: the blade suite's engine-real `setup` steps need to
 * reach a position whose pending decision is produced by a real activation
 * (ADR 0070 §4 — a fetchland's live search-library choice), and a hand-built
 * approximation of that path is exactly the silent-divergence class the ADR
 * rejects.
 *
 * THE MUTATION CALLS THIS FUNCTION — there is no second copy. Everything the
 * mutation still owns is I/O: fetch the row, clone the state, persist. Every
 * legality check, every cost payment, every stack push lives here.
 *
 * Mutates `state` in place. The three former early-return points (targeted
 * ability → `pendingTarget`; deferred payment → `pendingActivation`; committed
 * → stack) all persisted the SAME `seq + 1` snapshot, so collapsing them into
 * a plain `return` costs nothing: the caller saves once, whichever way it
 * returned. Throws on any illegal activation, exactly as before.
 */
/** CR 700.2 / 602.2b (issue #1341) — validates the mode an activation
 *  announced. A modal ability MUST name one of its declared modes; a
 *  non-modal ability must name none. Returns the chosen `AbilityMode`, or
 *  undefined when the ability is not modal. Mirrors `announceCast`'s modal
 *  prelude so the two announcement paths can't drift. */
export function resolveActivationMode(
    ability: ActivatedAbility,
    chosenModeId: string | undefined
): AbilityMode | undefined {
    if (!ability.modes || ability.modes.length === 0) {
        if (chosenModeId) {
            throw new Error(
                "Ability is not modal — chosenModeId must not be supplied"
            );
        }
        return undefined;
    }
    if (!chosenModeId) {
        throw new Error("Modal ability — must choose a mode at announcement");
    }
    const mode = ability.modes.find((m) => m.id === chosenModeId);
    if (!mode) {
        throw new Error(
            `Unknown mode id "${chosenModeId}" for ability "${ability.id}"`
        );
    }
    return mode;
}

export function activateAbilityOnState(
    state: GameState,
    args: {
        playerId: string;
        cardInstanceId: string;
        abilityId: string;
        /** If true, the activator keeps priority after the ability hits the stack. */
        keepPriority?: boolean;
        /** Value chosen for X at activation time (CR 107.3 / 601.2b). */
        chosenX?: number;
        /** CR 700.2 / 602.2b (issue #1341) — the mode chosen at announcement
         *  for a MODAL activated ability (Umezawa's Jitte). Required when the
         *  ability declares `modes`, rejected when it does not. */
        chosenModeId?: string;
    }
): void {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId: args.playerId,
        expect: "priority",
    });
    assertNoPendingChoices(state);

    if (state.priorityPlayerId !== args.playerId) {
        throw new Error("You don't have priority");
    }
    if (state.pendingCast) {
        throw new ConvexError("Another spell is already being cast");
    }
    if (state.pendingActivation) {
        throw new ConvexError("Another ability is already being activated");
    }

    const player = getPlayer(state, args.playerId);
    // CR 602.1 — by default only the source's controller activates an
    // activated ability, so look on the activator's own battlefield first.
    // For "any player may activate" abilities (CR 113.3c, Ifh-Bíff Efreet)
    // the source can live on another player's battlefield; fall back to a
    // global search and gate it on the resolved ability's flag below.
    let card = player.battlefield.find((c) => c.id === args.cardInstanceId);
    if (!card) {
        for (const p of state.players) {
            const found = p.battlefield.find(
                (c) => c.id === args.cardInstanceId
            );
            if (found) {
                card = found;
                break;
            }
        }
    }
    // CR 113.6 / 602.5b — a graveyard-source activated ability (Ashen
    // Ghoul's `activateFromGraveyard`). When the source is on no
    // battlefield, look for it in a graveyard; the `activateFromGraveyard`
    // flag on the resolved ability gates whether it may be activated there.
    let fromGraveyard = false;
    if (!card) {
        for (const p of state.players) {
            const found = p.graveyard.find((c) => c.id === args.cardInstanceId);
            if (found) {
                card = found;
                fromGraveyard = true;
                break;
            }
        }
    }
    // CR 113.6 / 702.29a — a hand-source activated ability (Cycling's
    // `activateFromHand`). When the source is on no battlefield and in no
    // graveyard, look for it in a hand; the `activateFromHand` flag on the
    // resolved ability gates whether it may be activated there. Only the
    // owner's OWN hand is searched (a card is never in an opponent's hand
    // from this player's perspective, and CR 702.29a scopes it to "your
    // hand").
    let fromHand = false;
    if (!card) {
        const found = player.hand.find((c) => c.id === args.cardInstanceId);
        if (found) {
            card = found;
            fromHand = true;
        }
    }
    if (!card) throw new Error("Card not on battlefield");

    const cardId = (card.card as { id?: string }).id;
    if (!cardId) throw new Error("Card has no definition");

    const resolved = resolveActivatedAbility(card, args.abilityId);
    if (!resolved) throw new Error("Ability not found");
    const ability = resolved.ability;
    // CR 113.6 — the source is in a graveyard: legal only for an ability
    // that opts in via `activateFromGraveyard`, and only its owner may
    // activate it (CR 602.1 — "from YOUR graveyard"). The battlefield
    // controller-only checks below are skipped for this branch.
    if (fromGraveyard) {
        if (!ability.activateFromGraveyard) {
            throw new Error(
                "This ability can't be activated from the graveyard"
            );
        }
        if (card.ownerId !== args.playerId) {
            throw new Error("You do not own this card");
        }
    } else if (fromHand) {
        // CR 113.6 / 702.29a — the source is in a hand: legal only for an
        // ability that opts in via `activateFromHand` (Cycling), and only
        // its owner may activate it (CR 702.29a — "from your hand"). The
        // battlefield controller-only checks below are skipped.
        if (!ability.activateFromHand) {
            throw new Error("This ability can't be activated from your hand");
        }
        if (card.ownerId !== args.playerId) {
            throw new Error("You do not own this card");
        }
    } else if (ability.activateFromHand || ability.activateFromGraveyard) {
        // CR 113.6 / 702.29a — the source was located on the battlefield
        // (neither `fromHand` nor `fromGraveyard`), but this ability
        // functions ONLY from the hand (Cycling) or graveyard (Ashen
        // Ghoul). A permanent can never pay its discard-this / graveyard
        // cost, so activating it here is illegal — reject before any cost
        // is locked. The client already omits it from the battlefield menu
        // (`getStackAbilities`); this is the authoritative backstop.
        throw new Error("This ability can't be activated from the battlefield");
    } else if (ability.activatableByEnchantedController) {
        // CR 602.1 — "Only the controller of the enchanted creature may
        // activate this ability" (FEM Merseine). The Aura's host decides
        // who may activate, regardless of who controls the Aura.
        const hostId = card.attachedTo;
        const host = hostId
            ? state.players
                  .flatMap((p) => p.battlefield)
                  .find((c) => c.id === hostId)
            : undefined;
        if (!host || host.controllerId !== args.playerId) {
            throw new Error(
                "Only the controller of the enchanted creature may activate this ability"
            );
        }
    } else if (ability.activatableByOpponentsOnly) {
        if (card.controllerId === args.playerId) {
            throw new Error("Only your opponents may activate this ability");
        }
    } else if (
        // CR 602.1 — enforce the controller-only default unless the ability
        // is explicitly "any player may activate". `card.controllerId` is
        // the source's controller; only that player may activate otherwise.
        !ability.activatableByAnyPlayer &&
        card.controllerId !== args.playerId
    ) {
        throw new Error("You do not control this permanent");
    }
    const grantedSourceCardId = resolved.grantedSourceCardId;
    const grantedAbilityOrigin = resolved.grantedAbilityOrigin;
    if (!ability.useStack) {
        throw new Error("Use tapUntap for mana abilities");
    }
    // CR 602.1 / 605.1a (issue #1124) — a turn-scoped "can't activate
    // abilities that aren't mana abilities" lock (Abeyance). Every ability
    // reaching this point is non-mana (the check above already rejected
    // `useStack: false`), so no separate mana-ability exemption is needed.
    if (state.cannotActivateAbilitiesThisTurn?.includes(args.playerId)) {
        throw new Error(
            "You can't activate abilities that aren't mana abilities this turn"
        );
    }
    // CR 602.5 — phase-restricted activated abilities ("activate only
    // during combat" etc.) are illegal outside their declared phase
    // allow-list. Mirrors spell-level `castPhaseRestriction`.
    if (
        ability.activationPhaseRestriction &&
        !ability.activationPhaseRestriction.includes(state.phase)
    ) {
        throw new Error("Ability cannot be activated during this phase");
    }
    // CR 602.5 / 606.3 — timing legality (controller-turn-only,
    // once-per-turn, "activate only as a sorcery") and loyalty legality are
    // gated HERE, in the shared prelude, so BOTH the targeted and the
    // non-targeted path enforce them identically. They used to live only in
    // the non-targeted branch (loyalty was duplicated into the targeted one),
    // which let a targeted `sorcerySpeedOnly` ability — Equip is the canonical
    // shape — open a `pendingTarget` at instant speed. The timing check then
    // fired far downstream in `finalizeTargetSelection`, throwing AFTER the
    // prompt was already persisted: the game sat forever on
    // `expectedInput.kind === "target"` and every subsequent `passPriority`
    // bounced off `assertExpectedInput` (ADR 0047). Any new activation gate
    // belongs in this prelude, not in one of the two branches.
    assertActivationTimingLegal(state, card, ability);
    assertLoyaltyActivationLegal(state, card, ability);

    // CR 602.2b: if the ability has targets, choose them before paying
    // costs. Mana availability is deferred to finalizeTargetSelection
    // (which enters pendingActivation when the pool doesn't cover the
    // cost — mirrors the spell announceCast flow).
    // CR 700.2 / 602.2b (issue #1341) — a MODAL activated ability locks its
    // mode in FIRST (CR 601.2b, before targets), and only the chosen mode's
    // requirement is declared (CR 700.2d). Mirrors `announceCast`'s modal
    // prelude for spells.
    const chosenMode = resolveActivationMode(ability, args.chosenModeId);
    const baseTargetReq = chosenMode
        ? chosenMode.targetRequirement
        : ability.getTargetRequirement
          ? ability.getTargetRequirement(card, state)
          : ability.targetRequirement;
    // CR 612.6 — a color-targeted ability follows its source's active
    // color-word changes (Sleight of Mind on a Circle of Protection
    // retargets its "<color> source of your choice"). The substituted
    // filter flows into both getLegalTargets and the stored pendingTarget.
    // Both merges the primary requirement gets (CR 612.6 colour substitution
    // and the CR 601.2c reflexive self-exclude below) are folded into ONE
    // shared helper (`effectiveRequirementForSource`, `gre/rules.ts`) so the
    // ADDITIONAL target groups (issue #2361) cannot silently skip a merge
    // the primary receives — an extra group declaring `targetIsAnother` or a
    // `colorFilter` must behave identically to a primary that declares it —
    // AND so the CR 608.2b resolution-time re-check
    // (`resolvingTargetRequirement`, `gre/state.ts`, issue #1853 round 3) can
    // reconstruct the IDENTICAL effective requirement instead of drifting
    // from this announcement-time computation.
    const effectiveRequirement = (req: TargetRequirement): TargetRequirement =>
        effectiveRequirementForSource(req, card, card.id);
    // Reflexive self-EXCLUDE (issue #2399) — "ANOTHER target nonlegendary
    // creature you control" (Reflection of Kiki-Jiki). An activated ability's
    // source is always the on-battlefield `card` itself (unlike a triggered
    // ability's separately-tracked `triggerSourceId`), so the same merge
    // `triggerTargetLegality` does for triggers applies here, through the SAME
    // shared helper. The merge lands on `effectiveTargetReq`, which flows into
    // BOTH `getLegalTargets` below and the stored `pendingTarget` filters that
    // `applyOneTargetSelection` re-validates every pick against.
    const effectiveTargetReq = baseTargetReq
        ? effectiveRequirement(baseTargetReq)
        : baseTargetReq;
    if (effectiveTargetReq) {
        if (state.pendingTarget) {
            throw new Error("Target selection is in progress");
        }
        if (ability.cost.tap && card.isTapped) {
            throw new Error("Card is already tapped");
        }
        // CR 302.1 — creatures with summoning sickness cannot pay a {T}
        // cost on an activated ability (mana or otherwise).
        if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
            throw new Error("Creature has summoning sickness");
        }
        if (ability.cost.removeCounter) {
            const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
            if (have < ability.cost.removeCounter.count) {
                throw new Error("Not enough counters to pay activation cost");
            }
        }
        // CR 119.4 — a life-payment cost is illegal unless the player has
        // at least that much life. Validated up-front on the targeted path
        // too, before entering pendingTarget.
        if (
            ability.cost.life !== undefined &&
            player.life < ability.cost.life
        ) {
            throw new Error("Not enough life");
        }
        if (
            ability.canActivate !== undefined &&
            !ability.canActivate(card, state)
        ) {
            throw new Error("Ability cannot be activated right now");
        }
        // CR 107.3 / 601.2b — chosenX must accompany abilities with X in
        // their mana cost. Stashed on pendingTarget; finalizeTargetSelection
        // forwards it to pendingActivation / the stack item.
        const targetHasXInCost =
            ability.cost.mana?.X !== undefined &&
            typeof ability.cost.mana.X === "string";
        // CR 107.3 — Reflecting Mirror derives X from the targeted spell's
        // mana value rather than letting the player choose it. The value
        // can only be computed once the spell target is known, so it is
        // resolved in finalizeTargetSelection, not here.
        const xIsDerived = ability.cost.xFromTargetSpellMv !== undefined;
        if (
            targetHasXInCost &&
            !xIsDerived &&
            (args.chosenX === undefined || args.chosenX < 0)
        ) {
            throw new Error("This ability requires a chosen X value");
        }
        const targetChosenX =
            targetHasXInCost && !xIsDerived ? args.chosenX : undefined;
        // CR 202.2 / 702.16b: the source's colors come from the
        // permanent owning the activated ability.
        // Issue #1378 — the activating permanent's LIVE effective power (CR
        // 613 layer 7c), for a `mvFilter` bound of `"sourcePower"`. Read the
        // same way the ability's own `dealDamage`-style effects would
        // (`getEffectivePower`); an activated ability's source is always the
        // on-battlefield `card` itself (unlike a triggered ability's
        // separately-tracked `triggerSourceId`).
        const abilitySourcePower = getEffectivePower(state, card);
        const legal = getLegalTargets(
            state,
            effectiveTargetReq,
            // CR 113.3 — the source is an activated ability, not a spell. All
            // five characteristics come from the ONE factory, so no dimension
            // (notably CR 205.4a supertypes, for a protection quality) can be
            // dropped here.
            targetingSourceFromCard(card, false),
            args.playerId,
            targetChosenX,
            [],
            abilitySourcePower
        );
        let abilityCount = resolveTargetCount(
            effectiveTargetReq.count,
            targetChosenX
        );
        // CR 602.2b / 601.2c — mirrors the cast path's identical check
        // (`legalTargets.length < required` above): activating with a
        // `count >= 2` requirement and fewer legal candidates than that
        // (e.g. Sorrow's Path / General Jarkeld's `count: 2` with only ONE
        // legal blocking creature on the board) must be rejected up front,
        // not accepted on `legal.length !== 0` and then dead-end mid-
        // selection with a second target slot nothing can fill (the CR
        // 601.2c distinct-targets fix, issue #1951 review round 2, is what
        // makes the dead-end reachable: a repeat pick used to silently
        // paper over the shortfall).
        //
        // CR 601.2c — a min-0 requirement ("up to one" / "up to N", Teferi,
        // Time Raveler's -3 "Return up to one target artifact, creature, or
        // enchantment... Draw a card", Sorin, Lord of Innistrad's -6, Minsc
        // & Boo's +1) is legal to activate with ZERO legal targets on the
        // board — same rule the cast path's `required` reorder above
        // enforces. `abilityRequired` must therefore be resolved BEFORE
        // deciding whether an empty legal-target set is fatal, not after an
        // unconditional throw on `legal.length === 0`: that ordering used to
        // reject Teferi's -3 outright on an empty board, losing its
        // unconditional "Draw a card" rider (issue #2369 review round 2).
        const abilityRequired = minTargetCount(abilityCount);
        if (legal.length < abilityRequired) {
            throw new Error(
                legal.length === 0
                    ? "No legal targets available"
                    : "Not enough legal targets"
            );
        }
        // CR 601.2c via CR 602.2b (issue #2361) — additional INDEPENDENT
        // target groups, the ability-level twin of the cast path's
        // `additionalRequirements` block above. Each group's legality is
        // checked HERE, at activation, which is where Oko, Thief of Crowns'
        // "target creature an opponent controls with power 3 or less"
        // restriction bites (the −5's power filter is an announce-time target
        // restriction, not a resolution-time re-check). `AbilityMode` has no
        // per-mode twin of this field, so unlike the cast path there is no
        // `chosenMode ??` leg to prefer.
        const abilityAdditionalRequirements = (
            ability.additionalTargetRequirements ?? []
        ).map(effectiveRequirement);
        for (const extra of abilityAdditionalRequirements) {
            const extraLegal = getLegalTargets(
                state,
                extra,
                targetingSourceFromCard(card, false),
                args.playerId,
                targetChosenX,
                [],
                abilitySourcePower
            );
            if (
                extraLegal.length <
                minTargetCount(resolveTargetCount(extra.count, targetChosenX))
            ) {
                throw new Error("Not enough legal targets");
            }
        }
        // CR 601.2d / 120.4 — divide-as-you-choose budget for an activated
        // ability (Arc Mage). Mirrors the spell-cast path: resolve the total
        // against the chosen X, cap an open-ended `{ min }` count at the
        // total (each target needs ≥ 1 point), and carry the total on
        // pendingTarget so the client drives the per-target stepper UI.
        const abilityDivideTotal = effectiveTargetReq.divideAsChosen
            ? resolveDivideTotal(
                  effectiveTargetReq.divideAsChosen.total,
                  targetChosenX
              )
            : undefined;
        if (
            abilityDivideTotal !== undefined &&
            typeof abilityCount === "object" &&
            abilityCount.max === undefined
        ) {
            abilityCount = {
                min: abilityCount.min,
                max: abilityDivideTotal,
            };
        }
        state.pendingTarget = {
            playerId: args.playerId,
            cardInstanceId: card.id,
            targetType: effectiveTargetReq.type,
            count: abilityCount,
            selected: [],
            keepPriority: args.keepPriority,
            kind: "ability",
            abilityId: args.abilityId,
            // CR 700.2c (issue #1341) — the mode is locked BEFORE targets, so
            // it rides the pendingTarget and is forwarded to the stack item /
            // pendingActivation at finalization.
            ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
            ...(abilityDivideTotal !== undefined
                ? { divideTotal: abilityDivideTotal }
                : {}),
            ...(effectiveTargetReq.divideAsChosen?.kind
                ? { divideKind: effectiveTargetReq.divideAsChosen.kind }
                : {}),
            ...(targetChosenX !== undefined ? { chosenX: targetChosenX } : {}),
            ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
            ...(grantedAbilityOrigin ? { grantedAbilityOrigin } : {}),
            // Same shared filter builder as the spell-cast path
            // (`pendingTargetFiltersFromRequirement`), so the three
            // pending-target builders can never drift (CR 601.2c) — this
            // includes `spellStackKind` for a "counter target ability"
            // activated ability (CR 113 / 701.5a).
            ...pendingTargetFiltersFromRequirement(
                effectiveTargetReq,
                targetChosenX,
                abilitySourcePower
            ),
            // CR 601.2c (issue #2361) — queue the additional independent
            // target groups. `selectTarget` / `confirmTargets` reach the SAME
            // generic `advanceTargetGroupOrFinalize` the cast path uses (it
            // reads `pendingTarget` without caring about `kind`), which swaps
            // in the next group's filters via
            // `applyRequirementToPendingTarget` and only finalizes once the
            // queue is empty — so nothing downstream needed an ability-side
            // twin.
            ...(abilityAdditionalRequirements.length > 0
                ? { remainingRequirements: abilityAdditionalRequirements }
                : {}),
        };

        return;
    }

    // Pay costs (CR 602.1). Up-front checks before we mutate anything:
    if (ability.cost.tap && card.isTapped) {
        throw new Error("Card is already tapped");
    }
    // CR 302.1 — creatures with summoning sickness cannot pay a {T} cost.
    if (ability.cost.tap && isTapLockedBySummoningSickness(card)) {
        throw new Error("Creature has summoning sickness");
    }
    // CR 122.6 — counter-removal cost: source must have enough counters
    // of the declared type. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    if (ability.cost.removeCounter) {
        const have = card.counters?.[ability.cost.removeCounter.type] ?? 0;
        if (have < ability.cost.removeCounter.count) {
            throw new Error("Not enough counters to pay activation cost");
        }
    }
    // CR 118.3 — "discard the last card you drew this turn" additional
    // cost (Jandor's Ring): the player must have drawn a card this turn
    // that is still in hand. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    if (ability.cost.discardLastDrawn && !canPayDiscardLastDrawn(player)) {
        throw new Error("No card drawn this turn left to discard");
    }
    // CR 118.3 — "discard a card at random" cost (Coral Helm): illegal with
    // an empty hand. Validated up-front.
    if (ability.cost.discardAtRandom && player.hand.length === 0) {
        throw new Error("No card in hand to discard");
    }
    // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
    // (Survival of the Fittest): illegal unless at least `count` matching
    // cards are in the activating player's hand. Validated up-front so we
    // never enter a pendingActivation that can't be paid.
    assertDiscardFilterCostAffordable(player, ability);
    // CR 119.4 — a life-payment cost is illegal unless the player has at
    // least that much life. Validated up-front so we never enter a
    // pendingActivation that can't be paid (fetch lands: {T}, Pay 1 life,
    // Sacrifice — the life leg was previously unpaid on the stack path).
    if (ability.cost.life !== undefined && player.life < ability.cost.life) {
        throw new Error("Not enough life");
    }
    // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>": the
    // activation is illegal if no matching permanent is on the activating
    // player's battlefield. Validated up-front so we never enter a
    // pendingActivation that can't be paid.
    assertSacrificeFilterCostAffordable(state, player, card, ability);
    // CR 702.49a — Ninjutsu's "Return an unblocked attacking creature you
    // control to its owner's hand" leg: illegal unless such a creature exists.
    // This gate is ALSO the keyword's timing rule — a creature is neither
    // blocked nor unblocked until blockers are declared (CR 509.1h), so the
    // candidate set is empty before then and the ability is simply
    // unaffordable, rather than carrying a second window rule that could drift
    // from the cost.
    if (
        ability.cost.returnUnblockedAttacker &&
        ninjutsuReturnCandidateIds(state, player.id).length === 0
    ) {
        throw new Error("No unblocked attacker to return");
    }
    // CR 602.1 / 118.5 — "exile N cards from a single graveyard" (Night
    // Soil): illegal unless one graveyard holds enough matching cards.
    // Validated up-front so we never enter an unpayable pendingActivation.
    if (ability.cost.exileFromGraveyard) {
        const { count, cardType, owner } = ability.cost.exileFromGraveyard;
        if (
            !canPayExileFromGraveyard(
                state,
                count,
                cardType,
                owner === "you" ? player.id : undefined
            )
        ) {
            throw new Error(
                "No single graveyard has enough cards to pay the exile cost"
            );
        }
    }
    // CR 602.1 / 118.8 — "tap N untapped permanents matching <filter> you
    // control": illegal unless at least N matching untapped permanents
    // (other than the source) are available.
    if (ability.cost.tapOtherFilter) {
        const candidates = tapOtherCandidates(
            player,
            card.id,
            ability.cost.tapOtherFilter.filter
        );
        if (
            !canPayTapOtherCost(
                ability.cost.tapOtherFilter,
                candidates.map((c) => tapOtherContribution(state, c))
            )
        ) {
            throw new Error(
                "Not enough untapped permanents to pay the tap cost"
            );
        }
    }
    // CR 602.5 — activated abilities may declare a custom precondition
    // (e.g. Clockwork Beast: "Activate only if it has fewer than seven
    // +1/+0 counters on it.") read against current source state.
    if (
        ability.canActivate !== undefined &&
        !ability.canActivate(card, state)
    ) {
        throw new Error("Ability cannot be activated right now");
    }
    // CR 107.3 / 601.2b — chosenX is required for abilities whose mana
    // cost has X. Validate up-front; pass to normalizeManaCost so the
    // generic portion includes X * (the chosen value).
    const hasXInCost =
        ability.cost.mana?.X !== undefined &&
        typeof ability.cost.mana.X === "string";
    if (hasXInCost && (args.chosenX === undefined || args.chosenX < 0)) {
        throw new Error("This ability requires a chosen X value");
    }
    const chosenX = hasXInCost ? args.chosenX : undefined;
    const manaCost = resolveAbilityManaCost(state, card, ability, {
        chosenX,
    });
    if (manaCost) {
        // ADR 0096 — same collector, same ability argument as the
        // `finalizeTargetSelection` commit path: the two must charge the same
        // reduced total for the same activation.
        applyCostModifiers(
            manaCost,
            getCostModifiers(state, card, "ability", ability, player.id)
        );
    }
    // CR 601.2f / 118.5 — board-wide static NON-mana additional cost
    // (Drought). Gate on affordability at announcement; pip count comes from
    // the ability's PRINTED activation cost.
    assertStaticAdditionalCostAffordable(
        state,
        ability.cost.mana,
        card,
        player,
        "ability"
    );

    // Enter a pendingActivation payment phase that mirrors pendingCast
    // when (a) mana isn't yet covered, OR (b) the ability has a
    // sacrifice-a-filtered-permanent cost that still needs a choice
    // (CR 602.1 / 118.5). In the payment phase the player taps lands and
    // picks the sacrifice (selectActivationCost); auto-commit applies the
    // deferred tap/sacrifice and pushes the ability on the stack.
    // Tap/sacrifice are DEFERRED so cancel leaves the source untouched.
    // CR 106.6 (issue #728) — restricted mana eligible for an ability of THIS
    // source (Soldevi Machinist's artifact-ability mana) counts toward
    // coverage, exactly as `spendablePoolForSpell` does at the cast path.
    const abilitySourceTypes = card.types;
    const manaUncovered =
        !!manaCost &&
        !isManaCostCovered(
            spendablePoolForAbility(player, abilitySourceTypes),
            manaCost,
            getAbilityManaSubstitutions(state, player.id, card)
        );
    // CR 602.1 / 118.5 / 701.21a — unified filtered sacrifice (own cost +
    // Drought). A non-fungible board defers so the player chooses; a
    // fungible board auto-resolves and commits inline.
    const activationSac = buildActivationSacrificeSelection(
        state,
        ability,
        card,
        player,
        tryGetDefinition((card.card as { id?: string }).id ?? "")?.name ??
            "Sacrifice"
    );
    const needsSacrificeChoice =
        !!activationSac && !isSacrificeSelectionComplete(activationSac);
    const needsExileChoice = !!ability.cost.exileFromGraveyard;
    const needsTapOtherChoice = !!ability.cost.tapOtherFilter;
    const needsDiscardChoice = !!ability.cost.discardFilter;
    if (
        manaUncovered ||
        needsSacrificeChoice ||
        needsExileChoice ||
        needsTapOtherChoice ||
        needsDiscardChoice
    ) {
        const pending = buildPendingActivation({
            playerId: args.playerId,
            cardInstanceId: card.id,
            abilityId: args.abilityId,
            ability,
            manaCost,
            chosenX,
            ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
            keepPriority: args.keepPriority,
            grantedSourceCardId,
            grantedAbilityOrigin,
            fromGraveyard,
            fromHand,
            ...(activationSac ? { sacrificeSelection: activationSac } : {}),
        });
        state.pendingActivation = pending;
        // CR 302.1 — a {T}-cost ability still needs the source untapped at
        // commit; deferral keeps it untapped now, so re-check at commit.
        // When mana is already covered and the source has a {T} cost but no
        // sacrifice choice, this branch isn't reached (mana covered path).
        // tryAutoCommitPendingActivation handles the eventual commit (after
        // the sacrifice pick) including when mana is already covered.
        tryAutoCommitPendingActivation(state, args.playerId);

        return;
    }

    // Mana already covered (or no mana cost) — commit immediately.
    if (ability.cost.tap) {
        card.isTapped = true;
    }
    // CR 701.43a / 602.1a — the "Exert this permanent" leg (Arena of Glory).
    if (ability.cost.exertThis) payExertActivationCost(state, card);
    // CR 106.10 — noted-mana battery (Jeweled Amulet / Ice Cauldron):
    // snapshot the pool before payment so the per-colour delta becomes the
    // mana noted on the source at resolve (mirrors the deferred-commit and
    // targeted-ability paths).
    const poolBeforePayment =
        ability.noteManaSpent && manaCost ? { ...player.manaPool } : undefined;
    if (manaCost) {
        payManaCostForAbility(
            player,
            manaCost,
            abilitySourceTypes,
            getAbilityManaSubstitutions(state, player.id, card)
        );
        commitLandsForCost(player, manaCost);
    }
    const notedManaSpent = poolBeforePayment
        ? manaSpentDelta(poolBeforePayment, player.manaPool)
        : undefined;
    if (ability.cost.removeCounter) {
        payRemoveCounterCost(state, card, ability.cost.removeCounter);
    }
    if (ability.cost.discardLastDrawn) {
        payDiscardLastDrawn(state, player);
    }
    if (ability.cost.discardAtRandom) {
        payDiscardAtRandomCost(state, player.id, ability.cost.discardAtRandom);
    }
    // CR 119.4 — pay the life cost (fetch lands: "Pay 1 life"). Validated
    // up-front; deducted here as the ability goes on the stack.
    if (ability.cost.life !== undefined) {
        player.life -= ability.cost.life;
    }
    // CR 606.4 — pay a non-targeted loyalty ability's signed loyalty cost as
    // it goes on the stack (Liliana's "+1", Garruk's "-4"). No-op otherwise.
    payLoyaltyCost(card, ability);
    if (ability.cost.sacrifice) {
        removePermanentTo(state, card.id, "graveyard", "sacrifice");
    }
    // CR 702.29a / 118.3 — the Cycling "Discard this card" cost: discard the
    // source from hand as the ability commits, routed through the shared
    // choke point so CARD_DISCARDED fires (Marauding Mako). Runs BEFORE the
    // stack-item clone below (the card object persists after the move).
    // CR 702.29c — `cyclingCost` marks a cycling/typecycling cost payment on the
    // one CARD_DISCARDED event; an ordinary discard-this cost stays unmarked.
    if (ability.cost.discardThis) {
        discardToGraveyard(
            state,
            player.id,
            card.id,
            ability.cost.cyclingCost ? "cycling" : undefined
        );
    }
    // CR 118.1 / 601.2h — the "Exile this card/permanent" activation cost, paid
    // as the ability commits: graveyard → exile for an Eternalize-shaped
    // ability, battlefield → exile for a permanent's own self-exile cost
    // (Feldon's Cane). Runs BEFORE the stack-item clone below (the card object
    // persists after the move, so the item keeps CR 608.2h last-known
    // information).
    if (ability.cost.exileThis) {
        payExileThisCost(
            state,
            player,
            card.id,
            !!ability.activateFromGraveyard
        );
    }
    // CR 602.1a / 601.2h — the "Return this permanent to its owner's hand"
    // activation cost, paid as the ability commits (Attunement). Runs BEFORE
    // the stack-item clone below (the card object persists after the move, so
    // the item keeps CR 608.2h last-known information). FAIL CLOSED on an
    // unpayable cost — see the twin site in `finalizeTargetSelection` for why
    // this leg, unlike `exileThis`, has no structural guarantee that `card`
    // was located on a battlefield.
    if (
        ability.cost.returnThisToHand &&
        !payReturnThisToHandCost(state, card.id)
    ) {
        throw new Error(
            "Cannot pay the return-to-hand cost: the source is not on the battlefield"
        );
    }
    // CR 601.2f / 118.5 / 701.21a — apply the auto-resolved filtered
    // sacrifice (Drought / fungible own cost) as the ability commits.
    // CR 702.49c — same capture on the immediate-commit path (a single
    // unblocked attacker auto-resolves the pick, so no park is ever created).
    if (ability.cost.returnUnblockedAttacker) {
        captureNinjutsuAttackTarget(state, card, activationSac);
        // CR 702.49a/b — the reveal leg; see the deferred-commit twin above.
        grantKnowledgeToAll(state, args.playerId, [card.id]);
    }
    const immediateSacSnapshot = sacrificeSnapshotFromSelection(
        activationSac,
        state
    );

    // Put ability on stack (clone card state as a virtual stack item)
    const stackItem: StackItem = buildActivatedAbilityStackItem(card, {
        castById: args.playerId,
        abilityId: args.abilityId,
        ...(chosenMode ? { chosenModeId: chosenMode.id } : {}),
        ...(chosenX !== undefined ? { chosenX } : {}),
        ...(grantedSourceCardId ? { grantedSourceCardId } : {}),
        ...(grantedAbilityOrigin ? { grantedAbilityOrigin } : {}),
        ...(immediateSacSnapshot
            ? { additionalSacrificeSnapshot: immediateSacSnapshot }
            : {}),
        ...(notedManaSpent ? { notedManaSpent } : {}),
    });
    state.stack.push(stackItem);
    recordActivation(state, card, args.abilityId, !!ability.cost.tap);
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, args.playerId);
    state.singleShotAutoPass = args.keepPriority ? undefined : args.playerId;
    // CR 603.3 — flush ABILITY_ACTIVATED queued by recordActivation so the
    // "non-tap ability activated" punisher lands on top of the freshly
    // pushed ability (resolves first). No-op for {T} abilities. Runs BEFORE
    // the auto-pass drain, which may otherwise reach two consecutive passes
    // and start resolving the ability before its own trigger is placed (see
    // `commitPendingCast`).
    processPendingActionTriggers(state);
    drainAutoPasses(state);
}
