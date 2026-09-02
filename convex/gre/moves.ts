// Macro-move enumeration for the vs-AI Bot (ADR 0001, issue #110).
//
// `enumerateMoves(state, playerId)` returns the complete set of legal ATOMIC
// macro-moves at the current decision point: a single `Move` bundles a player's
// full intent (which spell, which targets, which X, which attacker set, which
// blocker assignment) so the search/random layer can pick ONE and the executor
// (`src/lib/ai/executor.ts`) replays it through the EXISTING granular mutations.
// No new Convex move surface is introduced.
//
// PURE: no Math.random, no mutation, no ctx. Reuses the same legality helpers
// the human UI uses (`getLegalActions`, `getLegalTargets`, combat validators)
// so an enumerated move that the server then rejects is a bug, not a feature —
// the server stays the sole authority (CR 720), this is only a candidate list.
//
// Combinatorial windows (attacker subsets, blocker assignments, multi-target
// spells, X spells) are bounded by `MAX_COMBINATIONS`: for the small positions
// that matter to play and to tests the full set is enumerated; pathological
// boards are capped to a representative bounded sample (see comments at each
// site) rather than exploding. Caps are documented, never silent.

import type {
    ActivatedAbility,
    CardDefinition,
    Color,
    ManaCost,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import {
    normalizeManaCost,
    canPayDiscardLastDrawn,
    canPayRemoveCounterCost,
    canPayLifeCost,
    canPayDiscardAtRandom,
    applyCostModifiers,
    getCastManaSubstitutions,
    getCostModifiers,
    getManaSubstitutions,
    resolveTargetRequirementCount,
} from "./state";
import { handCardMatchesFilter } from "./alternativeCost";
import {
    castExileCostOccupiesPayWithSlot,
    castRawManaCost,
    exileCastPermission,
    graveyardCastMechanism,
    type CastFromZone,
} from "./castCost";
import { BESTOW_TARGET_REQUIREMENT, hasLegalBestowHost } from "./bestow";
import {
    payableAdditionalCostLegs,
    resolveAdditionalCosts,
} from "./additionalCost";
import {
    enumerateKickerVariants,
    foldBuybackCost,
    foldKickerCosts,
    kickedTargetRequirement,
    kickerLegPermanentSlotWouldCollide,
    kickerLifeCost,
    type KickerPayments,
} from "./kicker";
import {
    getLegalActions,
    canCastSpellsFromTopOfLibrary,
    isCastableLibraryTopSpell,
    libraryTopCastLifeCost,
    getLegalTargets,
    getProducibleManaSourceView,
    maxAffordableX,
    solvePhyrexianSplit,
    genericManaShortfall,
    targetingSourceFromCard,
    pendingTargetingSource,
    flashSurchargeOf,
    flashSurchargeRequired,
    foldFlashSurchargeCost,
    applySelfExclusion,
} from "./rules";
// issue #2283 — the origin classification that decides whether a live
// `pendingTarget` is the bot's own half-built announcement (hands off) or a
// selection the engine raised at it (must answer).
import {
    announcedTargetCount,
    pendingTargetCountMaxReached,
    pendingTargetOrigin,
    raisedPendingTargetOwedBy,
    requirementFromPendingTarget,
} from "./pendingTargetOrigin";
import {
    applyGenericOffset,
    delveEligibleCards,
    genericPortion,
    spellHasDelve,
} from "./payWith";
import { PHYREXIAN_LIFE_PER_PIP, phyrexianPipCount } from "./phyrexian";
import { getEffectivePower } from "./layers";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { canPayTapOtherCost, crewPowerContribution } from "./tapOtherCost";
import type { ActivationCostPicks } from "./activationCostPicks";
import { enumerateActivationCostPicks } from "./activationCostPicks";
import { planCastCostPicks, type CastCostPicks } from "./castCostPicks";
// Issue #2420 — the ONE model of a `tapOtherFilter` mana ability (Urza, Lord
// High Artificer), shared with the castability census (`coloredCostLeftover`,
// rules.ts) so the plan and the Cast affordance can never disagree.
import {
    NO_MANA_CONVERTER_LEGS,
    collectManaConverterLegs,
} from "./manaConverters";
import {
    MANA_COLORS,
    declaresAsEntersMode,
    isPlaneswalker,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
    mayHaveNonTapManaAbility,
    pureGenericManaSubCost,
} from "./constants";
import {
    getRequiredAttackerIds,
    getMaxBlockTargets,
    validateAttackerEligibility,
    validateBlockerEligibility,
    getAttackerCap,
    getBlockerCap,
    maxObeyableAttackRequirements,
    getMinimumBlockers,
} from "./combat";
import { isSorceryTiming } from "./phases";
import { loyaltyActivationViolation } from "./loyalty";
import { effectivePermanentView } from "./permanentView";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { matchesPermanentFilter } from "../cards/filters";
import { liveSupertypesOf, countSnowLands } from "./snow";
import { canSummonCompanion } from "./companion";
import {
    faceDownCastView,
    morphCastAlternativeCost,
    turnableFaceUpPermanents,
} from "./morph";
import { hasRetrace } from "./retrace";
import { flashbackExileEligibleCount } from "./flashback";
import { hasEscape } from "./escape";
import { substituteColorFilter } from "./textChanges";
// Choice-node candidate generation (PRD #1423, issue #1425) — a live
// `PendingChoice` becomes an in-tree decision node whose candidate answers this
// enumerator surfaces.
import { choiceCandidates } from "./ai/choiceCandidates";
// Dominance pruning (issue #1887) — the generic "this move is provably
// dominated by `pass`" seam. Opt-in per caller (see `EnumerateMovesOptions`).
import { isDominatedNoOpMove, isProbeEligibleMove } from "./ai/dominance";

/** One land tap the executor must perform to fund a cast/activation.
 *
 *  `abilityId` (issue #2420) is present ONLY when this entry ACTIVATES the
 *  source's own non-tap mana ability (CR 605.1a / 605.3c — `useStack: false`,
 *  cost has no `cost.tap`) rather than tapping the source for {T} mana; the
 *  executor and the search-side coarse applier both branch on it, routing
 *  through `activateManaAbility` instead of `tapForPayment`. Two shapes ride
 *  it:
 *   - `tapOtherIds` present — a `cost.tapOtherFilter` leg (Urza, Lord High
 *     Artificer): the permanent(s) the cost ACTUALLY taps. `cardInstanceId`
 *     itself (the ability's source) is never tapped by this payment
 *     (CR 602.1).
 *   - `tapOtherIds` absent — a pure `cost.mana` leg (Farrelite Priest /
 *     Initiate's Ebon Hand's "{1}: Add <color>."). Its generic sub-cost is
 *     funded by whichever plain (non-ability) `ManaTap` entries precede it in
 *     the SAME plan — `planManaPayment` always orders them first so the pool
 *     already covers this activation by the time it runs. */
export type ManaTap = {
    cardInstanceId: string;
    manaChoiceIndex?: number;
    abilityId?: string;
    tapOtherIds?: string[];
};

/** A single legal macro-move. Each kind is realised by the executor through a
 *  fixed sequence of EXISTING mutations (see `executeMove`). */
export type Move =
    | { kind: "pass" }
    | { kind: "mulligan"; decision: "keep" | "mull" }
    | {
          /** Post-mulligan bottoming submission (CR 103.5). Realised through the
           *  existing `submitResolutionChoice` mutation (kind "mulligan-bottom");
           *  the choice identity is read from the active pending choice. */
          kind: "mulligan-bottom";
          stackItemId: string;
          step: number;
          choiceId: string;
          cardInstanceIds: string[];
      }
    | {
          /** Generic mid-resolution choice submission (CR 608.2 / ADR 0016) —
           *  the bot's legal default for any zone-pick `PendingChoiceKind`
           *  (search-library, discard, scry, …). Realised through the same
           *  `submitResolutionChoice` mutation as `mulligan-bottom`; the choice
           *  identity is read from the active pending choice. */
          kind: "resolution-choice";
          stackItemId: string;
          step: number;
          choiceId: string;
          cardInstanceIds: string[];
      }
    | {
          /** Yes/no answer to a `may-pay` pending choice (CR 117.3a / 118.4),
           *  realised through the existing `submitMayPay` mutation — a separate
           *  executor entry point from `submitResolutionChoice` (ADR 0016). The
           *  choice identity is read from the active pending choice; only the
           *  boolean (and, for a sacrifice-leg pick, the chosen victim ids)
           *  travels on the Move. */
          kind: "may-pay";
          accept: boolean;
          /** CR 701.21a — chosen sacrifice victim id(s) when the accepted cost's
           *  sacrifice leg admits a real choice. Omitted otherwise. */
          sacrificeIds?: string[];
          /** CR 701.9 / 118.3 (issue #899) — chosen hand card id(s) when the
           *  accepted cost's discard leg admits a real choice. Omitted
           *  otherwise. Mirrors `sacrificeIds`; both travel to the same
           *  `submitMayPay` entry point. */
          discardIds?: string[];
      }
    | {
          /** Yes/no answer to a `land-entry-tapped` pending choice (shock lands,
           *  CR 614.12 / ADR 0051), realised through the dedicated
           *  `submitLandEntryChoice` mutation. Like `may-pay` only the boolean
           *  travels; the choice identity is read from the active pending
           *  choice. */
          kind: "land-entry";
          accept: boolean;
      }
    | {
          /** Yes/no answer to a `draw-replacement` pending choice (Zur's
           *  Weirding, CR 614 / ADR 0061), realised through the dedicated
           *  `submitDrawReplacementPay` mutation. Like `land-entry` only the
           *  boolean travels (accept = pay the life to bin the revealed card);
           *  the choice identity is read from the active pending choice. */
          kind: "draw-replacement";
          accept: boolean;
      }
    | {
          /** Decline a reflexive `madness-cast` pending choice (CR 702.35a),
           *  realised through the dedicated `submitMadnessDecline` mutation. No
           *  data travels; the choice identity is read from the active pending
           *  choice. The ACCEPT ("Cast") is a normal `cast-spell` move on the
           *  exiled card, never this — the bot's minimal policy always declines. */
          kind: "madness-decline";
      }
    | {
          /** Decline a reflexive `rebound-cast` pending choice (CR 702.88c),
           *  realised through the dedicated `submitReboundDecline` mutation. No
           *  data travels; the choice identity is read from the active pending
           *  choice. The ACCEPT ("Cast") is a normal `cast-spell` move on the
           *  exiled card, never this — the bot's minimal policy always
           *  declines, mirroring `madness-decline`. Unlike Madness, declining
           *  leaves the card exiled (no zone change, CR 702.88c). */
          kind: "rebound-decline";
      }
    | {
          /** Name a card for a `name-card` pending choice (CR 202.3 / ADR 0016)
           *  — the bot's legal default when it is targeted by a name-a-card
           *  effect (Petra Sphinx). Realised through the dedicated
           *  `submitNameCard` mutation; the choice identity is read from the
           *  active pending choice, only the name string travels on the Move. */
          kind: "name-card";
          cardName: string;
      }
    | {
          /** Acknowledge a suspended `random-reveal` flip (CR 705.2, ADR 0023).
           *  Carries no choice data — the engine drew and persisted the
           *  outcome; this only means "resume". Realised through the
           *  `submitRandomRevealAck` mutation; the choice identity is read from
           *  the active pending choice. A no-decision reveal: the bot acks just
           *  as the human client auto-acks when the animation ends. */
          kind: "random-reveal-ack";
          stackItemId: string;
          choiceId: string;
      }
    | { kind: "play-land"; cardInstanceId: string }
    | {
          /** CR 116.2 / 702.139a (ADR 0064) — the `summon-companion` special
           *  action. No card id (the source is `player.companion`, not a hand
           *  card) and no tap plan: the fixed generic {3} is solved and
           *  applied server-side in one shot by the shared auto-tap solver
           *  (`canSummonCompanion`/`summonCompanion`, gre/companion.ts /
           *  game.ts) — there's no colored-pip choice for the executor to
           *  replay. */
          kind: "summon-companion";
      }
    | {
          /** CR 116.2b / 702.37e (issue #2705) — the `turn-face-up` special
           *  action: turn a face-down permanent you control with a morph
           *  ability face up by paying its morph cost. The engine's SECOND
           *  special action, and deliberately not shaped like the first:
           *  where `summon-companion` is per-PLAYER, fixed-cost and once per
           *  game, this one is per-PERMANENT (hence `cardInstanceId`),
           *  VARIABLE-cost (the permanent's own printed morph cost, read
           *  through `faceDownOf`), repeatable, and available to EITHER
           *  player at ANY priority — CR 116.2b grants it with no timing
           *  restriction at all, which is the whole point of the mechanic.
           *
           *  No tap plan, for the same reason `summon-companion` carries
           *  none: the cost is solved and applied server-side in one shot by
           *  the shared auto-tap solver (`canTurnFaceUp` /
           *  `morphTurnUpPaymentPlan`, gre/morph.ts, and the
           *  `turnPermanentFaceUp` mutation in game.ts), so there is no
           *  coloured-pip choice for the executor to replay. */
          kind: "turn-face-up";
          cardInstanceId: string;
      }
    | {
          kind: "cast-spell";
          cardInstanceId: string;
          /** CR 601.3 (issue #2971) — the zone this cast comes FROM. Absent
           *  means the hand, which is every cast the enumerator emitted before
           *  the exile / graveyard loops landed.
           *
           *  Carried rather than re-derived: both search sandboxes used to
           *  GUESS the zone (hand, unless the id happened to be the library
           *  top), and a guess is exactly what breaks on the shapes this field
           *  exists for — a cross-player exile grant puts the card in the
           *  OPPONENT's exile, and a graveyard card is indistinguishable from
           *  a hand card by id alone. The real mutation derives the zone
           *  server-side (`locateCastSource`, game.ts) from the same
           *  permissions the enumerator gated on, so the executor forwards
           *  nothing extra to `announceCast` — this field is for the SANDBOXES,
           *  which have no `locateCastSource`. */
          castFromZone?: CastFromZone;
          chosenModeId?: string;
          /** CR 118.9 — id of the ALTERNATIVE casting cost this variant pays
           *  instead of the printed mana cost, forwarded verbatim to
           *  `announceCast.alternativeCostId`. Absent = the ordinary cast.
           *
           *  Today the enumerator emits it for exactly one cast mode, Bestow
           *  (CR 702.103a, issue #2388) — and Bestow is why the field exists
           *  at all: every other alternative cost this engine ships
           *  (evoke/dash/Gush/Fireblast) changes only what the caster PAYS, so
           *  a Bot that never picks one merely plays suboptimally, while a Bot
           *  that never picks Bestow cannot reach a whole class of board state
           *  (an Aura on a creature) no other move produces. Adding an
           *  evoke/dash/alt-cost variant later is the same field and needs no
           *  new plumbing — only its own enumeration and its own cost. */
          alternativeCostId?: string;
          /** CR 601.2b / 118.8 — which leg of a CASTER-CHOSEN additional cost
           *  ("discard a card or pay 3 life", Bitter Triumph) this variant
           *  pays, by `AdditionalCostLeg.id`. One Move per PAYABLE leg, the
           *  same shape `chosenModeId` uses for modes; absent for a card with
           *  no disjunction. `applyMove` charges the leg in the search tree and
           *  `executor.ts` names it to `announceCast`, so the Bot's valuation
           *  and the server's payment see the same cost. */
          additionalCostLegId?: string;
          /** CR 702.33 (issue #2081) — how many times EACH of this card's
           *  Kickers this variant pays, keyed by `KickerCost.id` (absent =
           *  not kicked at all). One Move per BOUNDED payment combination —
           *  see the bound rationale on `enumerateKickerVariants`
           *  (`gre/kicker.ts`). Forwarded verbatim to `announceCast
           *  .kickerPayments`; the MANA leg is already folded into `tapPlan`
           *  and the LIFE leg into `payLife` below, both at enumeration time,
           *  so the search values the payment it actually charges. */
          kickerPayments?: KickerPayments;
          /** CR 702.27a (issue #2081) — whether this variant pays the card's
           *  Buyback cost (absent/false = not paid). The extra mana is already
           *  folded into `tapPlan`. Forwarded verbatim to `announceCast
           *  .buyback`. */
          buybackPaid?: boolean;
          chosenX?: number;
          targets: TargetSelection[];
          /** CR 601.2c — whether the executor owes a trailing `confirmTargets`
           *  after its batched `selectTargets`. Computed by
           *  `announcedTargetsNeedConfirm` from the RESOLVED count reaching its
           *  max, NOT from the requirement being variable-count: a variable
           *  selection filled to its max auto-finalized on the last pick and
           *  needs none, while one answered with ZERO targets needs one and has
           *  no `selectTargets` call to ride on (issue #2870). */
          confirmTargets: boolean;
          /** Lands to tap, in order, to cover the cost (pool mana is auto-used
           *  by the server at commit and needs no tap). */
          tapPlan: ManaTap[];
          /** CR 107.4f / 702.33a — total life paid for this cast: Phyrexian
           *  pips ({C/P}) chosen to be paid with life (2 per pip) plus any paid
           *  Kicker's LIFE leg (CR 119.4). The mana-paid pips are already
           *  folded into `tapPlan`. Absent / 0 when neither applies. Deducted
           *  in `applyMove`. */
          payLife?: number;
          /** CR 601.2f / 701.21 / 701.13 (issue #2135) — the cards named to pay
           *  this cast's MANDATORY additional-cost parks (a filtered sacrifice
           *  — the card's own `additionalCosts.sacrificeFilter` plus Drought's
           *  board-wide static sacrifice — and the exile additional cost, Soul
           *  Exchange). The server parks a `pendingCast` for each and never
           *  commits until they are answered, so the pick travels ON the move:
           *  `applyMove`/`applyMoveInSearch` remove exactly these cards in the
           *  search, and `executor.ts` names exactly these cards to the server.
           *  K=1 for every cast-side park (`gre/parkKinds.ts`), so this is the
           *  single deterministic plan, never a variant axis. Absent for a cast
           *  with no such park. */
          castCostPicks?: CastCostPicks;
      }
    | {
          kind: "activate-ability";
          cardInstanceId: string;
          abilityId: string;
          /** CR 700.2 / 602.2b (issue #1341) — the mode of a MODAL activated
           *  ability (Umezawa's Jitte), locked in at announcement. One move
           *  variant per mode, each carrying that mode's own targets. */
          chosenModeId?: string;
          chosenX?: number;
          targets: TargetSelection[];
          /** CR 601.2c via CR 602.2b — as on `cast-spell` above:
           *  `announcedTargetsNeedConfirm` against the LAST target group's
           *  resolved count, never "is the requirement variable-count". */
          confirmTargets: boolean;
          tapPlan: ManaTap[];
          /** CR 602.1 / 118 — the cards named to pay the ability's DEFERRED
           *  cost legs (discard / exile-from-graveyard / tap-other). The
           *  server parks a `pendingActivation` for each of them and never
           *  commits until they are answered, so the pick travels ON the move:
           *  `applyMove` applies exactly these cards in the search, and
           *  `executor.ts` names exactly these cards to the server. Absent for
           *  an ability with no such leg. */
          costPicks?: ActivationCostPicks;
      }
    | {
          /** Activate an ability granted to the PLAYER by an effect (CR 113.1b,
           *  issue #2903) — Channel's "Pay 1 life: Add {C}." until end of turn.
           *  A player-level grant has no source permanent, so unlike
           *  `activate-ability` this move carries no `cardInstanceId`; it names
           *  the grant instance and the template by id, and the executor hands
           *  `activatePlayerAbility` (`convex/game.ts`) the instance id.
           *
           *  The template is a REFERENCE (`sourceCardId` + `abilityId`) resolved
           *  through the card-definition lookup at activation time — both the
           *  enumerator and the search applier do that lookup, since there is no
           *  instance to read the ability off. A mana ability (Channel's) is a
           *  legal move here in a way it is not for `enumerateAbilityMoves`:
           *  those are funded on demand by `planManaPayment` off a PERMANENT,
           *  while a player grant hangs off the player and cannot be reached by
           *  the tap planner, so it must be its own standalone move. */
          kind: "activate-granted-ability";
          /** The `GrantedAbilityInstance.id` (`grant-N`), the handle the
           *  `activatePlayerAbility` mutation names. */
          grantedAbilityInstanceId: string;
          /** The ability's id on the template's source card definition. */
          abilityId: string;
          /** The card definition id whose `activatedAbilities[]` holds the
           *  template. */
          sourceCardId: string;
      }
    | {
          /** Answer an ENGINE-RAISED pending target selection (issue #2283) —
           *  a targeted trigger's targets (CR 603.3d), a retarget (CR 115.7)
           *  or a spell copy’s retarget (CR 707.10c). Unlike the target
           *  tuple that rides ON a `cast-spell` / `activate-ability` move, this
           *  is a STANDALONE submission: nobody announced anything, the engine
           *  simply owes the controller a choice, and until it is answered the
           *  game cannot advance at all.
           *
           *  Realised through the SAME mutations a human's clicks make —
           *  `selectTargets` (batched) then `confirmTargets` when the count is
           *  a range. Divide-as-you-choose amounts are deliberately NOT carried:
           *  `applyOneTargetSelection` treats `amount` as optional and the
           *  engine auto-divides ≥1-each at finalize (CR 601.2d), which is
           *  always a legal split and one less thing that can be rejected. */
          kind: "submit-target";
          /** The additional targets to pick, in order. May be EMPTY for an "up
           *  to N" selection the bot declines (min 0) — then only
           *  `confirmTargets` fires (`selectTargets` rejects an empty array). */
          targets: TargetSelection[];
          /** CR 601.2c — a variable-count selection needs an explicit
           *  `confirmTargets`; a fixed-N one auto-finalizes on the last pick
           *  and MUST NOT be confirmed (the selection is already gone). */
          confirmTargets: boolean;
      }
    | {
          kind: "declare-attackers";
          attackerIds: string[];
          /** CR 508.1a (issue #1220) — optional per-attacker planeswalker attack
           *  target (attackerId → planeswalkerId). Absent attackers attack the
           *  defending player. Lets the bot direct an attack at a planeswalker. */
          attackTargets?: Record<string, string>;
      }
    | {
          kind: "declare-blockers";
          /** blocker → the single attacker it blocks (single-block this slice). */
          assignments: { blockerId: string; attackerId: string }[];
      };

/** CR 116.2 — the SPECIAL ACTIONS this engine models as `Move` kinds.
 *
 *  A special action is a game action that "doesn't use the stack and can't be
 *  responded to" (CR 116): nothing is put on the stack, the pass cycle resets,
 *  and priority stays with the player who took it. Those three consequences are
 *  identical for every member, which is why they are a SET rather than three
 *  copies of one `case` — the engine's first special action
 *  (`summon-companion`, ADR 0064) hardcoded them, and morph's `turn-face-up`
 *  (issue #2705) is what forced the shape out into the open.
 *
 *  What is deliberately NOT shared is legality or cost: `play-land` is once per
 *  turn at sorcery speed (CR 116.2a), `summon-companion` is once per game for a
 *  fixed {3} (CR 116.2g), and `turn-face-up` is unlimited, at any priority, for
 *  a cost that differs per permanent (CR 116.2b). Each keeps its own predicate;
 *  only the "no stack, no response, keeps priority" consequence is common.
 *
 *  The remaining CR 116.2 actions (suspend, foretell, plot, the planar die,
 *  unlock, the two effect-granted forms) are not modelled — none has a shipped
 *  card that reaches them. */
export const SPECIAL_ACTION_MOVE_KINDS: ReadonlySet<Move["kind"]> = new Set([
    // CR 116.2a — playing a land.
    "play-land",
    // CR 116.2g / 702.139a — putting a chosen companion into hand for {3}.
    "summon-companion",
    // CR 116.2b / 702.37e — turning a face-down permanent face up.
    "turn-face-up",
]);

/** Upper bound on combinations emitted per combinatorial window. Keeps a
 *  20-creature board from emitting 2^20 attacker subsets. Small real/test
 *  positions stay well under this and are enumerated exhaustively. */
export const MAX_COMBINATIONS = 64;

// ---------------------------------------------------------------------------
// Mana payment planning
// ---------------------------------------------------------------------------

/** HOW one ACTIVATION of mana gets produced from a `PlanSource` (issue #2420,
 *  yield-aware since issue #3027).
 *
 *  The planner's unit of account is a PHYSICAL PERMANENT, never an ability:
 *  every untapped permanent is at most one `PlanSource`, and consuming it
 *  removes it from the pool of sources, so the same permanent can never be
 *  spent twice however the mana is realised. That identity is what makes the
 *  double-tap impossible by construction rather than by bookkeeping (review
 *  round 3, finding 1: a `reserved`-set fix that missed the plain-tap leg let
 *  one Mox Sapphire be tapped once plainly and once as Urza's fodder, a plan
 *  the search valued as legal and the executor rejected outright).
 *
 *  Issue #3027 kept that identity verbatim and changed only what consuming a
 *  source YIELDS: `produces` carries the whole `ManaCost` of the one
 *  activation (Black Lotus's "Add three mana of any one color" is `{U:3}`,
 *  Sol Ring's is `{C:2}`), and the surplus lands in the plan-local floating
 *  pool rather than on the source. `undefined` means the ordinary case — one
 *  mana of whichever colour the option was selected for — so every option on
 *  a board of lands and `{T}` rocks stays the shared, allocation-free
 *  singleton it was. */
type PlanOption =
    /** The permanent taps itself — its own `{T}` ability, a basic land
     *  subtype's intrinsic `{T}: Add C` (CR 305.6), or pool mana. */
    | { via: "tap"; manaChoiceIndex?: number; produces?: ManaCost }
    /** The permanent's OWN `useStack: false` ability whose whole cost is N
     *  GENERIC mana (Farrelite Priest's "{1}: Add {W}"). It taps nothing —
     *  CR 602.1 — and is funded from OTHER plain sources, so the source is
     *  still spent (one activation per plan; see `fundGenericFromPlain`).
     *  `produces` is the GROSS yield; the `generic` sub-cost is funded
     *  separately, which nets to exactly what the castability census's own
     *  netting produces (`getProducibleManaUnits`, rules.ts). */
    | {
          via: "mana-cost";
          abilityId: string;
          manaChoiceIndex?: number;
          generic: number;
          produces?: ManaCost;
      }
    /** ANOTHER permanent's `tapOtherFilter` mana ability (Urza, Lord High
     *  Artificer) taps THIS one as its cost. The mana belongs to the
     *  permanent that gets tapped — see `manaConverters.ts` for why that is
     *  the exact model and not merely a convenient one. Always one mana:
     *  `isSingleTapOtherManaAbility` admits no other shape, and the census
     *  bounds converter capacity at one unit per physical permanent for the
     *  same reason. */
    | { via: "converter"; converterId: string; abilityId: string };

/** Total mana one activation of `opt` produces. `produces` absent is the
 *  ordinary one-mana case (issue #3027). */
function optionYieldTotal(opt: PlanOption): number {
    if (opt.via === "converter" || !opt.produces) return 1;
    let total = 0;
    for (const c of MANA_COLORS) total += opt.produces[c] ?? 0;
    return total;
}

/** Cached `{ via: "tap" }` realisations (issue #2420). Every permanent on an
 *  ordinary board contributes one per colour it makes; the values are
 *  immutable and never escape into a `ManaTap`, so one instance per choice
 *  index is enough and the planner allocates nothing per option.
 *
 *  Issue #3027 — a MULTI-mana option (Black Lotus, Sol Ring) needs its own
 *  `produces`, so it cannot share a singleton keyed on the choice index
 *  alone; those allocate. An ordinary board has none and keeps the cache. */
const PLAIN_TAP_OPTION: PlanOption = { via: "tap" };
const PLAIN_TAP_OPTION_BY_INDEX: PlanOption[] = [];
function plainTapOption(
    manaChoiceIndex: number | undefined,
    produces?: ManaCost
): PlanOption {
    if (produces) return { via: "tap", manaChoiceIndex, produces };
    if (manaChoiceIndex === undefined) return PLAIN_TAP_OPTION;
    return (PLAIN_TAP_OPTION_BY_INDEX[manaChoiceIndex] ??= {
        via: "tap",
        manaChoiceIndex,
    });
}

/** The `ManaCost` a `PlanOption` must carry explicitly, or `undefined` for the
 *  ordinary one-mana case the shared singletons cover (issue #3027). A
 *  multi-COLOUR single-mana option (one tap, one mana, several colours to
 *  choose from) is still one unit per colour entry in `detailed`, so only a
 *  genuine 2+ total earns a `produces`. Exits at 2 — the answer is a boolean
 *  in disguise, and this runs per option per permanent on the hot path. */
function explicitYield(mana: ManaCost): ManaCost | undefined {
    let total = 0;
    for (const c of MANA_COLORS) {
        total += mana[c] ?? 0;
        if (total >= 2) return mana;
    }
    return undefined;
}

/** Cost legs a `{T}` mana activation may carry and still have its FULL yield
 *  credited (issue #3027, review finding 1). `tapSourceIntoPayment`
 *  (`convex/game.ts`) executes exactly these as part of the same tap: the tap
 *  itself, and a SELF-sacrifice (`activateFixedSacrificeManaAbility` /
 *  the sacrifice branch — this is why Black Lotus commits end to end). */
const TAP_YIELD_CREDITABLE_COST_LEGS: ReadonlySet<string> = new Set([
    "tap",
    "sacrifice",
]);

/** True when the whole cost of a `{T}` mana activation is paid by the tap the
 *  plan already emits, so the activation's ENTIRE yield is really available.
 *
 *  `isAutoPayableManaAbilityCost` (`constants.ts`) short-circuits on
 *  `if (cost.tap) return true` — deliberately, "always payable regardless of
 *  what else rides along" — so an ability whose cost is `{T}` PLUS something
 *  else reaches the plain-tap realisation below. That was harmless while a
 *  source was worth one mana and `sources.length < totalRequired` capped it;
 *  crediting the GROSS yield of such an ability is not, because nothing ever
 *  plans the other leg. Measured on this branch before this guard:
 *  Apprentice Wizard ("{U}, {T}: Add {C}{C}{C}") alone returned a plan for a
 *  {3} cost with the {U} unfunded, and Orcish Lumberjack ("{T}, Sacrifice a
 *  Forest: Add {R}{R}{R}") returned one with no Forest chosen — plans the
 *  server rejects outright, and which the search would meanwhile value as
 *  legal (`applyTapPlan` only marks sources tapped).
 *
 *  DENY-BY-DEFAULT over the cost's own keys, so a leg added to
 *  `ActivatedAbility["cost"]` later is excluded until someone reviews it here
 *  rather than silently inheriting the gross credit. Denied means the source
 *  falls back to one mana — its exact pre-issue-#3027 behaviour, never a plan
 *  the server refuses. */
function tapActivationExecutesWholeCost(
    ability: ActivatedAbility | undefined
): boolean {
    // `undefined` = an intrinsic basic-land-subtype option (CR 305.6): a bare
    // {T} with no riders at all.
    if (!ability) return true;
    for (const [leg, value] of Object.entries(ability.cost)) {
        if (value === undefined || value === false) continue;
        if (!TAP_YIELD_CREDITABLE_COST_LEGS.has(leg)) return false;
    }
    return true;
}

type PlanSource = {
    /** undefined = mana already in the pool (no tap needed). */
    cardInstanceId?: string;
    options: Map<Color, PlanOption>;
};

/** True when `source`'s resolved option for `color` is a PLAIN tap (a {T}
 *  ability, a basic-land-subtype `{T}: Add C`, or pool mana). Used exclusively
 *  to fund a mana-cost ability's OWN sub-cost: letting Farrelite Priest fund a
 *  DIFFERENT mana-cost ability's activation (or itself) would recurse — one
 *  level of generic-for-colour conversion only (issue #2420). A `converter`
 *  realisation is excluded for the same fail-closed reason: it is a second
 *  ability activation whose ordering against the funded one this greedy
 *  planner does not model. */
function isPlainTapSource(
    source: Pick<PlanSource, "cardInstanceId" | "options">,
    color: Color
): boolean {
    if (!source.cardInstanceId) return true; // pool mana
    return source.options.get(color)?.via === "tap";
}

/** Selection tie-break rank (issue #2420): a realisation that costs nothing
 *  beyond the permanent itself (0) is always preferred over one that has to
 *  BURN ANOTHER SOURCE to fund it (1, the `mana-cost` shape). Without it the
 *  colour loop's "first index wins" tie-break spent both a Plains and a
 *  Farrelite Priest to produce the one {W} the Plains alone covers. Every
 *  option on a board with no such ability ranks 0, so ordinary boards keep
 *  byte-identical source selection. */
function planOptionRank(source: PlanSource, color: Color): number {
    return source.options.get(color)?.via === "mana-cost" ? 1 : 0;
}

/** Greedy tap plan covering a normalized mana cost (CR 601.2f). Returns the
 *  ordered land taps to perform, or `null` when the cost cannot be paid.
 *  Mirrors `canPotentiallyPayCost` (rules.ts) — same one-source-one-mana
 *  model — but emits the concrete sources; the mirror is now closer than it
 *  used to be (issue #1751 finding 4, closed fully by issue #1754):
 *  `getProducibleManaOptions` below is called with a real, BOTH-PLAYERS
 *  `battlefields` view built from `state` via the shared `manaGateBattlefields`
 *  helper (`constants.ts`, issue #1754 finding 6) — the SAME helper
 *  `coloredCostLeftover`/rules.ts calls from `opts.state` — so ANY
 *  board-dependent mana source's `canActivate` — self-referential
 *  (Mox Opal's Metalcraft, Fanatic of Rhonas's Ferocious) or
 *  opponent-scanning (Fellwar Stone, whose `getManaChoices` walks every
 *  OTHER player's battlefield) — is evaluated against a real board here
 *  exactly like it is by the human castability gate. Before issue #1751 this
 *  planner passed no board at all; before issue #1754 it passed a SELF-ONLY
 *  view (own controllerId + own battlefield alone), which covered the
 *  self-referential case but still starved Fellwar Stone of any opponent
 *  permanents to see. Pool mana is modelled as zero-tap sources and is
 *  consumed by the server at commit, so it never appears in the returned taps. */
export function planManaPayment(
    state: GameState,
    player: PlayerState,
    cost: Record<string, number>,
    /** CR 609.4b (issue #2890) — the CAST this plan pays for, when there is
     *  one. Routed through the shared `getCastManaSubstitutions` so a
     *  cast-scoped "spend mana as though it were mana of any color/type"
     *  permission (Robber of the Rich's stolen card, North Star's one-shot
     *  grant) widens what each source can pay, under exactly the same scoping
     *  the real payment applies — including North Star's "that spell's MANA
     *  cost" limit, which `cost` (kicker folded, or an alternative cost) is
     *  compared against. Omitted for an activated ability's cost and for
     *  morph, which the permission never reaches. */
    cast?: {
        cardInstanceId: string;
        cardDef: CardDefinition | null | undefined;
        chosenX?: number;
    }
): ManaTap[] | null {
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((s, c) => s + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return [];

    // Issue #1754 — both-players view, built once per call and shared across
    // every source below via the same `manaGateBattlefields` helper (issue
    // #1754 finding 6, `constants.ts`) the gate's `coloredCostLeftover`
    // (rules.ts) builds from `opts.state`, so THIS payment-planning path
    // (fixed-cost sources, actually tapping for a cost already settled on) is
    // board-aware for every board-dependent mana ability, not only the
    // self-referential ones a self-only view already covered. Issue #1757
    // closed the one remaining gap this used to flag: the {X} CEILING
    // `enumerateCastMoves` computes before ever reaching this function now
    // passes its own `state` into `maxAffordableX` too (below), so a
    // board-dependent source (Fellwar Stone) that funds a larger X is visible
    // to the ceiling exactly like it is to this planner.
    const boardBattlefields = manaGateBattlefields(state);

    const sources: PlanSource[] = [];
    /** Upper bound on the mana this board can produce — one activation per
     *  physical permanent, taking that permanent's largest single yield
     *  (issue #3027). Only ever used to reject early, so an over-estimate is
     *  safe and an under-estimate would drop payable plans. */
    let capacity = 0;
    for (const c of MANA_COLORS) {
        const n = player.manaPool[c] ?? 0;
        for (let i = 0; i < n; i++) {
            sources.push({ options: new Map([[c, { via: "tap" }]]) });
            capacity++;
        }
    }
    // Issue #2420 — ONE cheap pass classifying every permanent (tapped ones
    // included: a `tapOtherFilter` ability carries no {T}, so a tapped Urza
    // is still a converter). `mayHaveNonTapManaAbility` reads the PRINTED
    // definition, and on an ordinary board — lands and `{T}` rocks — it is
    // false throughout, which then skips BOTH the converter scan and the
    // per-permanent post-layer ability walk below (review round 3, finding 3:
    // this planner is on `enumerateCastMoves`'s hot path, i.e. every ISMCTS
    // rollout, and must not make an ordinary board pay for a feature no card
    // on it has).
    const nonTapFlags: boolean[] = [];
    let anyNonTapManaAbility = false;
    for (const perm of player.battlefield) {
        const flag = mayHaveNonTapManaAbility(perm);
        nonTapFlags.push(flag);
        if (flag) anyNonTapManaAbility = true;
    }
    // Which permanents ANOTHER permanent's `tapOtherFilter` mana ability
    // (Urza, Lord High Artificer) can tap for mana, and into which colours.
    // The SAME authority the castability census reads (`coloredCostLeftover`,
    // rules.ts), so a board this planner can pay and a board the census
    // offers "cast" on are decided by one model.
    const converterLegs = anyNonTapManaAbility
        ? collectManaConverterLegs(state, player)
        : NO_MANA_CONVERTER_LEGS;
    for (
        let permIndex = 0;
        permIndex < player.battlefield.length;
        permIndex++
    ) {
        const perm = player.battlefield[permIndex];
        if (perm.isTapped) continue;
        // Issue #1754 — full both-players board view: covers Mox Opal /
        // Fanatic of Rhonas (self-referential) AND Fellwar Stone
        // (opponent-scanning), matching the gate's board visibility exactly.
        // ONE scan per permanent: `view` carries the colour→index map, the
        // raw option list it was derived from AND the index convention, so
        // recovering which ABILITY backs a colour costs no second scan
        // (review round 3, finding 3 — the second scan measured 55-65% on the
        // hot `enumerateCastMoves` path).
        const view = getProducibleManaSourceView(
            perm,
            player.id,
            boardBattlefields
        );
        // CR 302.1 / 302.6 (issue #2420) — summoning sickness restricts only
        // a {T}/{Q}-in-cost ability, never a source's activation in general.
        const sick = isTapLockedBySummoningSickness(perm);
        // From the prefilter pass above: false for every permanent on an
        // ordinary board, and then the post-layer ability walk below is
        // skipped entirely and summoning sickness gates the whole permanent
        // exactly as it did before this issue.
        const mayBeNonTap = nonTapFlags[permIndex];
        const options = new Map<Color, PlanOption>();
        /** The largest yield of any ONE realisation stored on this permanent —
         *  its whole contribution to `capacity`, since only one activation per
         *  permanent is ever executed (issue #3027). */
        let permCapacity = 0;
        if (mayBeNonTap || !sick) {
            const abilities = mayBeNonTap
                ? getEffectiveActivatedAbilities(perm)
                : undefined;
            /** Lazily resolved post-layer ability list for the yield check
             *  below, on a board the prefilter spared the walk (issue #3027).
             *  Allocated only when this permanent has a 2+-mana option. */
            let permAbilities:
                | ReturnType<typeof getEffectiveActivatedAbilities>
                | undefined;
            for (let index = 0; index < view.detailed.length; index++) {
                const opt = view.detailed[index];
                const src = opt.source;
                // `undefined` = an intrinsic basic-land-subtype option
                // (CR 305.6), which is always a plain {T} — as is every
                // option at all when the prefilter said so.
                const ability =
                    abilities && src.kind === "activated"
                        ? abilities.find(
                              ({ ability: a }) => a.id === src.abilityId
                          )?.ability
                        : undefined;
                // CR 602.1 — a `tapOtherFilter` leg taps a DIFFERENT
                // permanent, so its mana is never THIS permanent's own unit;
                // it is attributed to whichever permanent it taps, below.
                if (ability?.cost.tapOtherFilter) continue;
                // A basic-subtype option and a `cost.tap` ability both drop
                // out while sick-locked; a pure `cost.mana` ability
                // (Farrelite Priest) stays — it taps nothing of its own, so
                // summoning sickness never applied to it (CR 302.6).
                if (sick && (!ability || ability.cost.tap)) continue;
                const manaChoiceIndex = view.needIndex ? index : undefined;
                // Issue #3027 — the QUANTITY this one activation makes, which
                // the planner used to discard (it read `opt.mana[c] > 0` and
                // kept the boolean) while the castability census it mirrors
                // has counted one unit per individual mana since issue #132.
                let realisation: PlanOption;
                if (!ability || ability.cost.tap) {
                    // A gross yield is credited only when the tap pays the
                    // WHOLE cost — see `tapActivationExecutesWholeCost`.
                    //
                    // `ability` being undefined here does NOT mean "no ability
                    // to check": the prefilter above skips the post-layer
                    // walk entirely on an ordinary board, so `abilities` is
                    // undefined and every option looks intrinsic. Only
                    // `src.kind === "basic"` really is (CR 305.6); an
                    // `"activated"` option must be resolved before its yield
                    // can be trusted. The lookup happens ONLY when the option
                    // makes 2+ mana — false for every land and {T} rock — so
                    // the hot path still pays nothing for it, and a resolution
                    // that finds nothing falls back to one mana.
                    const produces = explicitYield(opt.mana);
                    let creditable: ManaCost | undefined;
                    if (produces) {
                        const resolved =
                            src.kind === "basic"
                                ? undefined
                                : (
                                      abilities ??
                                      (permAbilities ??=
                                          getEffectiveActivatedAbilities(perm))
                                  ).find(
                                      ({ ability: a }) => a.id === src.abilityId
                                  )?.ability;
                        const whole =
                            src.kind === "basic"
                                ? true
                                : !!resolved &&
                                  tapActivationExecutesWholeCost(resolved);
                        if (whole) creditable = produces;
                    }
                    realisation = plainTapOption(manaChoiceIndex, creditable);
                } else {
                    const generic = pureGenericManaSubCost(
                        ability.cost.mana ?? {}
                    );
                    // `isAutoPayableManaAbilityCost` (constants.ts) admits
                    // only tap | tapOtherFilter | pure-generic mana, and the
                    // first two are handled above — so a non-tap ability with
                    // a non-pure-generic `cost.mana` cannot reach here. Fail
                    // closed rather than mis-tap if one ever does.
                    if (generic === null) continue;
                    // A non-tap ability admitted here has ONLY its pure-generic
                    // `cost.mana` leg (`isAutoPayableManaAbilityCost` rejects
                    // every `NEVER_AUTO_PAYABLE_COST_LEGS` member on this
                    // path), and `fundGenericFromPlain` plans exactly that leg
                    // — so the gross yield IS creditable here.
                    const produces = explicitYield(opt.mana);
                    realisation = {
                        via: "mana-cost",
                        abilityId: ability.id,
                        manaChoiceIndex,
                        generic,
                        ...(produces ? { produces } : {}),
                    };
                }
                let stored = false;
                for (const c of MANA_COLORS) {
                    if ((opt.mana[c] ?? 0) > 0 && !options.has(c)) {
                        options.set(c, realisation);
                        stored = true;
                    }
                }
                if (stored) {
                    const y = optionYieldTotal(realisation);
                    if (y > permCapacity) permCapacity = y;
                }
            }
        }
        // The converter widening (see `manaConverters.ts`): only for a colour
        // this permanent cannot already produce by itself — its own tap is
        // strictly cheaper than an extra activation for the same mana.
        for (const leg of converterLegs.get(perm.id) ?? []) {
            for (const c of leg.colors) {
                if (options.has(c)) continue;
                options.set(c, {
                    via: "converter",
                    converterId: leg.converterId,
                    abilityId: leg.abilityId,
                });
                // A converter leg is always exactly one mana
                // (`isSingleTapOtherManaAbility`).
                if (permCapacity < 1) permCapacity = 1;
            }
        }
        if (options.size === 0) continue;
        sources.push({ cardInstanceId: perm.id, options });
        // Issue #3027 — the cheap early reject must count what the board can
        // actually MAKE, not how many permanents it has: `sources.length` is
        // the yield-blind count that rejected a Black Lotus paying {U}{U}
        // before a single pip was considered. One activation per permanent,
        // so a source contributes the largest yield of any ONE realisation.
        // `permCapacity` is accumulated as the options are built (above), so
        // an ordinary board pays no second pass over the map for it.
        capacity += permCapacity;
    }
    if (capacity < totalRequired) return null;

    // CR 609.4b (issue #2890) — a live mana substitution widens what a source
    // may PAY, not what it produces: a source that taps for `from` can now
    // satisfy a `to` pip, realised by the very same tap. Applied to the working
    // copy only, ONE hop (two substitution rules never chain), and only where
    // the source cannot already make the colour — its own production is always
    // the cheaper realisation. This keeps the Bot's payment planner in step
    // with the castability gate it shares a board model with; without it the
    // gate would offer a cast this planner could not fund and the move would be
    // silently dropped, so the Bot could never use the permission at all.
    const substitutions = cast
        ? getCastManaSubstitutions(
              state,
              player,
              cast.cardInstanceId,
              cast.cardDef,
              cost,
              cast.chosenX
          )
        : getManaSubstitutions(state, player.id);
    const remaining = sources.map((s) => {
        const options = new Map(s.options);
        for (const sub of substitutions) {
            const via = s.options.get(sub.from as Color);
            if (via && !options.has(sub.to as Color)) {
                options.set(sub.to as Color, via);
            }
        }
        return { cardInstanceId: s.cardInstanceId, options };
    });
    const taps: ManaTap[] = [];

    /** Mana this plan has already PRODUCED and not yet spent (issue #3027).
     *
     *  This is where the surplus of a multi-mana activation lives, and it is
     *  deliberately NOT a "partly spent source": the physical permanent is
     *  still removed from `remaining` the instant it is used, exactly as
     *  before, so "one permanent, one activation" stays true BY CONSTRUCTION
     *  rather than by bookkeeping (see `PlanOption`'s header for what the
     *  bookkeeping version cost). The planner therefore only ever sees
     *  UNSPENT permanents and FLOATING mana — never a half-used source. Any
     *  mana still floating when the plan completes is simply left in the pool
     *  and empties at end of step (CR 500.4), which is what a human tapping a
     *  Lotus for a two-mana spell also does. */
    const floating: Partial<Record<Color, number>> = {};
    let floatingTotal = 0;

    /** Credit one activation's whole yield. `color` is the colour the option
     *  was selected FOR, and doubles as the identity of an option with no
     *  explicit `produces` — the ordinary one-mana case.
     *
     *  The last branch is a CR 609.4b SUBSTITUTION realisation: `remaining`
     *  below maps `sub.to` onto the option that produces `sub.from`, so the
     *  option's own `produces` does not contain the colour it was selected
     *  for. A substitution rule licenses spending mana of `from` as `to`, so
     *  the quantity creditable as `color` is the amount of the ONE substituted
     *  colour, not the option's total (issue #3027, review finding 2). A
     *  single-colour yield is therefore credited whole — every mana of it is
     *  `from` (Sol Ring's `{C}{C}` under a `C → U` grant really does pay
     *  {U}{U}) — while a MIXED yield credits one, because the option does not
     *  record which of its colours the substitution matched and only that
     *  component qualifies. Crediting the total there would let one tap of a
     *  `{W}{U}` source pay two red pips under Sunglasses of Urza's `W → R`, of
     *  which only the white one may legally be spent as red. Under-crediting
     *  is always safe: it is what the same source paid before this issue. */
    const creditYield = (opt: PlanOption, color: Color): void => {
        const produces = opt.via === "converter" ? undefined : opt.produces;
        if (produces && (produces[color] ?? 0) > 0) {
            for (const c of MANA_COLORS) {
                const n = produces[c] ?? 0;
                if (n > 0) {
                    floating[c] = (floating[c] ?? 0) + n;
                    floatingTotal += n;
                }
            }
            return;
        }
        let credited = 1;
        if (produces) {
            let colours = 0;
            let only = 0;
            for (const c of MANA_COLORS) {
                const n = produces[c] ?? 0;
                if (n > 0) {
                    colours++;
                    only = n;
                }
            }
            if (colours === 1) credited = only;
        }
        floating[color] = (floating[color] ?? 0) + credited;
        floatingTotal += credited;
    };

    /** Spend one floating mana of `color`, if any. */
    const spendFloating = (color: Color): boolean => {
        const n = floating[color] ?? 0;
        if (n <= 0) return false;
        floating[color] = n - 1;
        floatingTotal--;
        return true;
    };

    /** Spend one floating mana of ANY colour on a generic pip, in
     *  `MANA_COLORS` order so the choice is deterministic. */
    const spendFloatingAny = (): boolean => {
        if (floatingTotal <= 0) return false;
        for (const c of MANA_COLORS) {
            if ((floating[c] ?? 0) > 0) {
                floating[c]!--;
                floatingTotal--;
                return true;
            }
        }
        return false;
    };

    /** Fund `count` GENERIC mana strictly from PLAIN sources — never another
     *  non-tap mana ability (`isPlainTapSource`) — pushing the funding taps
     *  onto `taps` BEFORE the caller's own entry so the pool already covers
     *  it when that entry is realised. `false` when the plain pool can't
     *  cover it (issue #2420). */
    const fundGenericFromPlain = (count: number): boolean => {
        let need = count;
        while (need > 0) {
            // Issue #3027 — mana this plan has already produced pays the
            // sub-cost before any further permanent is committed to it.
            if (spendFloatingAny()) {
                need--;
                continue;
            }
            let idx = -1;
            let bestSize = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                const color = s.options.keys().next().value as
                    | Color
                    | undefined;
                if (color === undefined) continue;
                if (!isPlainTapSource(s, color)) continue;
                if (!s.cardInstanceId) {
                    // Pool mana — free, always preferred.
                    idx = i;
                    break;
                }
                if (s.options.size < bestSize) {
                    bestSize = s.options.size;
                    idx = i;
                }
            }
            if (idx === -1) return false;
            const color = remaining[idx].options.keys().next().value as Color;
            if (!consume(idx, color)) return false;
            if (!spendFloatingAny()) return false;
            need--;
        }
        return true;
    };

    const consume = (idx: number, color: Color): boolean => {
        const src = remaining[idx];
        const cardInstanceId = src.cardInstanceId;
        if (!cardInstanceId) {
            // Pool mana — consumed by the server at commit, never a tap. Still
            // credited and debited like any other yield (issue #3027) so the
            // caller has ONE spend path; the net effect is unchanged.
            remaining.splice(idx, 1);
            floating[color] = (floating[color] ?? 0) + 1;
            floatingTotal++;
            return true;
        }
        const opt = src.options.get(color);
        if (!opt) return false;
        // The source is spent whichever way its mana is realised — ONE
        // physical permanent, ONE unit (issue #2420). Removed BEFORE the
        // `mana-cost` funding below so an ability can never fund itself.
        remaining.splice(idx, 1);
        if (opt.via === "converter") {
            // CR 602.1 — the ability's cost taps THIS permanent; its own
            // source (Urza) is never tapped by it and is not a source row at
            // all, so no plan can spend either of them twice.
            taps.push({
                cardInstanceId: opt.converterId,
                abilityId: opt.abilityId,
                tapOtherIds: [cardInstanceId],
            });
            creditYield(opt, color);
            return true;
        }
        if (opt.via === "mana-cost") {
            if (opt.generic > 0 && !fundGenericFromPlain(opt.generic)) {
                return false;
            }
            taps.push({
                cardInstanceId,
                abilityId: opt.abilityId,
                ...(opt.manaChoiceIndex !== undefined
                    ? { manaChoiceIndex: opt.manaChoiceIndex }
                    : {}),
            });
            // GROSS yield, credited only after the sub-cost above was funded
            // — so the ability can never fund itself and the net matches the
            // census's own netting (issue #3027).
            creditYield(opt, color);
            return true;
        }
        taps.push(
            opt.manaChoiceIndex === undefined
                ? { cardInstanceId }
                : { cardInstanceId, manaChoiceIndex: opt.manaChoiceIndex }
        );
        creditYield(opt, color);
        return true;
    };

    // Issue #2420 review round 2 finding 1 — a `consume()` failure must
    // SKIP the failed source, never null the WHOLE plan. Only the
    // `mana-cost` shape can still fail (Farrelite Priest with nothing plain
    // left to fund its {1}); the `converter` shape cannot, because the
    // permanent it taps IS the source row being consumed and that row only
    // ever holds an UNTAPPED, not-yet-spent permanent. One unexecutable
    // source must not destroy a plan other sources can still satisfy.
    //
    // `pickCandidate` returns the current best (idx, color) among sources
    // not yet excluded this need, or `null` when none remain. A failed
    // `consume()` call can partially mutate `remaining` / `taps` before
    // returning false (a `mana-cost` sub-cost funding itself from plain
    // sources, then running out) — those partial effects are rolled back
    // before the source is marked excluded and the next candidate is tried.
    const consumeBest = (
        pickCandidate: (
            excluded: Set<PlanSource>
        ) => { idx: number; color: Color } | null
    ): boolean => {
        const excluded = new Set<PlanSource>();
        for (;;) {
            const candidate = pickCandidate(excluded);
            if (!candidate) return false;
            const src = remaining[candidate.idx];
            const remainingSnapshot = [...remaining];
            const tapsLen = taps.length;
            // Issue #3027 — the floating pool is part of the partial effect a
            // failed `consume()` can leave behind (`fundGenericFromPlain`
            // spends from it), so it rolls back with `remaining` and `taps`.
            // ONLY the `mana-cost` realisation can fail after touching it:
            // a plain tap and a converter credit as their last act and return
            // true, so a board with no such ability — every ordinary one —
            // allocates no snapshot at all.
            const canFail =
                src.options.get(candidate.color)?.via === "mana-cost";
            const floatingSnapshot = canFail ? { ...floating } : undefined;
            const floatingTotalSnapshot = floatingTotal;
            if (consume(candidate.idx, candidate.color)) return true;
            remaining.length = 0;
            remaining.push(...remainingSnapshot);
            taps.length = tapsLen;
            if (floatingSnapshot) {
                for (const c of MANA_COLORS) floating[c] = floatingSnapshot[c];
            }
            floatingTotal = floatingTotalSnapshot;
            excluded.add(src);
        }
    };

    // Colored requirements first, taking the least-flexible source that can
    // produce that color (basic land before dual, etc.) — but never one that
    // has to burn a SECOND source to fund itself while a self-sufficient one
    // is available (`planOptionRank`, issue #2420).
    for (const c of MANA_COLORS) {
        let need = cost[c] ?? 0;
        while (need > 0) {
            // Issue #3027 — mana a previous activation already produced pays
            // this pip before any further permanent is committed, so a source
            // is never tapped while its own surplus would cover the need.
            if (spendFloating(c)) {
                need--;
                continue;
            }
            const ok = consumeBest((excluded) => {
                let bestIdx = -1;
                let bestSize = Infinity;
                let bestRank = Infinity;
                let bestYield = Infinity;
                for (let i = 0; i < remaining.length; i++) {
                    const s = remaining[i];
                    if (excluded.has(s)) continue;
                    const opt = s.options.get(c);
                    if (!opt) continue;
                    const rank = planOptionRank(s, c);
                    // Lexicographic (rank, colour-count, YIELD). The yield key
                    // is last and only ever separates sources the first two
                    // tie, so a board of one-mana sources — every land, every
                    // {T} rock — keeps byte-identical selection (issue #3027).
                    // Where it does fire it stops the greedy burning a Black
                    // Lotus on a pip an equally flexible single-mana source
                    // already covers.
                    const yieldTotal = optionYieldTotal(opt);
                    if (
                        rank < bestRank ||
                        (rank === bestRank &&
                            (s.options.size < bestSize ||
                                (s.options.size === bestSize &&
                                    yieldTotal < bestYield)))
                    ) {
                        bestIdx = i;
                        bestSize = s.options.size;
                        bestRank = rank;
                        bestYield = yieldTotal;
                    }
                }
                return bestIdx === -1 ? null : { idx: bestIdx, color: c };
            });
            if (!ok) return null;
            // STRUCTURALLY UNREACHABLE, kept fail-closed (issue #3027 review
            // finding 6): the option was selected because it produces `c`, so
            // `creditYield` has just credited at least one `c`. It is here so
            // that a future `creditYield` branch which does not can never
            // silently under-pay a pip instead of failing the plan.
            if (!spendFloating(c)) return null;
            need--;
        }
    }

    // Generic remainder: prefer pool sources (no tap), then least-flexible card.
    let generic = cost.X ?? 0;
    while (generic > 0) {
        // Floating first (issue #3027): the surplus of a coloured activation
        // pays the generic remainder — a Black Lotus tapped for the {U} of
        // {1}{U} funds the {1} with the two mana it already made.
        if (spendFloatingAny()) {
            generic--;
            continue;
        }
        if (remaining.length === 0) return null;
        const ok = consumeBest((excluded) => {
            let idx = remaining.findIndex(
                (s) => !s.cardInstanceId && !excluded.has(s)
            );
            if (idx !== -1) {
                const color = remaining[idx].options.keys().next().value as
                    | Color
                    | undefined;
                if (color !== undefined) return { idx, color };
            }
            // Least-flexible card, preferring a self-sufficient realisation
            // over one that has to burn a second source to fund itself
            // (`planOptionRank`, issue #2420). On a board with no such
            // ability every rank is 0 and this is the pre-existing
            // "smallest option set, first colour" pick, unchanged.
            let bestSize = Infinity;
            let bestRank = Infinity;
            let bestYield = Infinity;
            let bestColor: Color | undefined;
            idx = -1;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                if (excluded.has(s)) continue;
                let rank = Infinity;
                let color: Color | undefined;
                for (const c of s.options.keys()) {
                    const r = planOptionRank(s, c);
                    if (r < rank) {
                        rank = r;
                        color = c;
                    }
                }
                if (color === undefined) continue;
                // Same lexicographic (rank, colour-count, yield) tie-break as
                // the coloured loop — see there (issue #3027).
                const yieldTotal = optionYieldTotal(s.options.get(color)!);
                if (
                    rank < bestRank ||
                    (rank === bestRank &&
                        (s.options.size < bestSize ||
                            (s.options.size === bestSize &&
                                yieldTotal < bestYield)))
                ) {
                    bestSize = s.options.size;
                    bestRank = rank;
                    bestYield = yieldTotal;
                    bestColor = color;
                    idx = i;
                }
            }
            if (idx === -1 || bestColor === undefined) return null;
            return { idx, color: bestColor };
        });
        if (!ok) return null;
        // Structurally unreachable, kept fail-closed — see the coloured loop.
        if (!spendFloatingAny()) return null;
        generic--;
    }

    return taps;
}

// ---------------------------------------------------------------------------
// Combination helpers
// ---------------------------------------------------------------------------

/** All size-`k` combinations of `items`, capped at `MAX_COMBINATIONS`.
 *  Exported for reuse by the Expected-Input-driven enumeration
 *  (`legalActions.ts`, issue #801). */
export function combinations<T>(items: T[], k: number): T[][] {
    const out: T[][] = [];
    const pick = (start: number, acc: T[]) => {
        if (out.length >= MAX_COMBINATIONS) return;
        if (acc.length === k) {
            out.push([...acc]);
            return;
        }
        for (let i = start; i < items.length; i++) {
            acc.push(items[i]);
            pick(i + 1, acc);
            acc.pop();
        }
    };
    pick(0, []);
    return out;
}

/** Power set of `items`, capped at `MAX_COMBINATIONS`. */
function powerSet<T>(items: T[]): T[][] {
    const out: T[][] = [[]];
    for (const item of items) {
        const next: T[][] = [];
        for (const subset of out) {
            next.push(subset);
            if (out.length + next.length <= MAX_COMBINATIONS) {
                next.push([...subset, item]);
            }
        }
        out.length = 0;
        out.push(...next);
        if (out.length >= MAX_COMBINATIONS) break;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cast / target / X / mode expansion
// ---------------------------------------------------------------------------

/** Variable-count requirements (X or {min,max}) do NOT auto-advance inside the
 *  executor's batched `selectTargets` — they rest for their own confirm — which
 *  is why only the LAST target group of an announcement may be one. Structural
 *  gate only; whether a confirm is actually owed is
 *  `announcedTargetsNeedConfirm` below, which reads the RESOLVED count. */
function isVariableCount(req: TargetRequirement | undefined): boolean {
    if (!req) return false;
    return req.count === "X" || typeof req.count === "object";
}

/** CR 601.2c — does the executor's batched `selectTargets` leave the
 *  announcement's LAST target group RESTING, so the Move owes a trailing
 *  `confirmTargets`?
 *
 *  Answered from the RESOLVED count the announcing mutation will open the
 *  selection with (`announcedTargetCount`, the shared authority) against the
 *  number of targets this Move picked for that group — never from "the
 *  requirement is variable-count AND the tuple is non-empty", which was wrong
 *  at both ends of an "up to N" range (issue #2870):
 *
 *    - **0 chosen** — the only possible answer when the board offers no legal
 *      target and `min` is 0 (Pest Infestation for X ≥ 1 with no artifacts or
 *      enchantments in play). `selectTargets` rejects an empty array, so the
 *      submission is confirm-ONLY; declaring `confirmTargets: false` sent no
 *      mutation at all, left the `PendingTarget` live, and the next
 *      `tapForPayment` threw against an expected input of `"target"`.
 *    - **max chosen** — the last pick already auto-finalized the selection
 *      (`applyOneTargetSelection` → `advanceTargetGroupOrFinalize`), so a
 *      confirm afterwards throws "No target selection in progress".
 *
 *  Both stranded the announcement at an owed `"target"` input of ANNOUNCED
 *  origin, which the owed-target gate is fail-closed against by design, so the
 *  Bot answered `no-move` and the liveness ladder span cast → cancel → re-cast.
 *
 *  Assumes the executor submits no per-target divide `amount` (it does not), so
 *  CR 601.2d's budget-spent auto-finalize cannot fire mid-batch; only the count
 *  cap `announcedTargetCount` already applies is in play. */
function announcedTargetsNeedConfirm(
    lastReq: TargetRequirement | undefined,
    lastGroupSize: number,
    chosenX: number | undefined
): boolean {
    const count = announcedTargetCount(lastReq, chosenX);
    // No selection is opened at all — nothing to confirm.
    if (count === undefined) return false;
    return !pendingTargetCountMaxReached(count, lastGroupSize);
}

// Exported for a direct unit test (issue #2365) — proof that the bot's
// per-requirement count resolution no longer lets an unresolved `"X"` reach
// `enumerateTargetTuples`'s `for (let size = min; size <= max; size++)` loop
// below it, where `size <= "X"` used to coerce to `NaN` (always false) and
// silently drop every non-empty tuple instead of erroring.
export function targetCount(
    req: TargetRequirement,
    chosenX: number | undefined
): {
    min: number;
    max: number;
} {
    // Single shared resolver (issue #2365) — this used to re-derive the
    // literal `"X"` case inline and fall through `req.count.max ?? min` for
    // the object form, which passed an unresolved `"X"` string straight
    // through for an `{ min, max: "X" }` "up to X" range.
    const resolved = resolveTargetRequirementCount(req.count, chosenX);
    if (typeof resolved === "number") return { min: resolved, max: resolved };
    return { min: resolved.min, max: resolved.max ?? resolved.min };
}

/** Every legal target tuple for one (mode) requirement at a chosen X. Returns
 *  `[[]]` (the empty tuple) when the requirement is absent or satisfiable with
 *  zero targets, so a no-target cast is always represented. */
function enumerateTargetTuples(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    req: TargetRequirement | undefined,
    chosenX: number | undefined
): TargetSelection[][] {
    if (!req) return [[]];
    // CR 612.6 — a color-targeted requirement follows the source's active
    // color-word changes (Sleight of Mind on a Circle of Protection retargets
    // its "<color> source of your choice" to the new color).
    const effReq =
        req.colorFilter !== undefined
            ? {
                  ...req,
                  colorFilter: substituteColorFilter(card, req.colorFilter),
              }
            : req;
    const legal = getLegalTargets(
        state,
        effReq,
        // moves.ts enumerates legal targets for casting a spell from hand, so
        // the source is always a spell (vs an activated ability). The bot
        // enumerator reads the SAME gate the human path does.
        targetingSourceFromCard(card, true),
        player.id,
        chosenX
    );
    // CR 601.2c / 601.2d — when the ANNOUNCEMENT opens no target selection at
    // all, the only tuple is the empty one. `targetCount` below sees the count
    // alone, so it misses the zero DIVIDE BUDGET case (#2905 review, item 2):
    // Spoils of War / Meteor Shower at X = 0 carry `count: { min: 1 }`, which
    // resolves to a 1-target tuple, while `announceCast` sets
    // `requiresTargets = false` and opens nothing. The executor's
    // `selectTargets` is gated on the tuple being non-empty rather than on
    // `confirmTargets`, so it fired against no selection and threw — the same
    // freeze this issue is about, reached through the count rather than the
    // confirm.
    if (announcedTargetCount(effReq, chosenX) === undefined) return [[]];
    const { min, max } = targetCount(effReq, chosenX);
    if (max === 0) return [[]];

    const tuples: TargetSelection[][] = [];
    for (let size = min; size <= max; size++) {
        if (size === 0) {
            tuples.push([]);
            continue;
        }
        for (const combo of combinations(legal, size)) {
            // CR 601.2c (issue #1104) — a `sameController`-constrained
            // requirement's per-candidate legality is unconstrained in
            // isolation (checked by `getLegalTargets` above, correctly:
            // nothing to compare against for a lone candidate); the
            // constraint is COMBINATORIAL — every permanent in the combo
            // must share one live controller. `combinations` has no notion
            // of that relation, so it's enforced as a post-filter here,
            // mirroring the single-authority check `selectTarget` runs
            // per-pick (`sameControllerDescriptor`, `gre/targetFilters.ts`).
            if (effReq.sameController && !comboSharesController(state, combo)) {
                continue;
            }
            tuples.push(combo);
            if (tuples.length >= MAX_COMBINATIONS) return tuples;
        }
    }
    // A spell that requires ≥1 target but has none stays castable only when the
    // requirement is optional (min 0); otherwise getLegalActions wouldn't have
    // offered "cast". Guard anyway so we never emit an unfulfillable move.
    return tuples.length > 0 ? tuples : min === 0 ? [[]] : [];
}

/** CR 601.2c — every legal target tuple across ALL of a cast's independent
 *  target GROUPS (the primary requirement plus each
 *  `additionalTargetRequirements` entry, card- or mode-level), as the FLAT
 *  concatenation the rest of the pipeline expects.
 *
 *  Flat is the authoritative shape, not a convenience: `finalizeTargetSelection`
 *  (`game.ts`) commits `[...priorSelected, ...selected]` onto the stack item in
 *  declaration order, and an Effect Script reads groups positionally off that
 *  one list (`{ target: 0 }` = the artifact, `{ target: 1 }` = the enchantment
 *  for Hull Breach's third mode). Producing the same flat list here means both
 *  the executor (one batched `selectTargets`) and the in-search appliers — which
 *  copy `move.targets` straight onto the stack item — get the complete
 *  announcement, so mode `both` no longer evaluates identically to mode
 *  `artifact` in the tree.
 *
 *  Groups are enumerated independently against the SAME pre-cast board the
 *  server validates each group against in `announceCast`, and the cartesian
 *  product is capped at `MAX_COMBINATIONS`. An empty group list, or one whose
 *  requirements are all absent/zero-count, yields the single empty tuple.
 *
 *  Each tuple carries `lastGroupSize` — how many of its targets belong to the
 *  LAST group (issue #2870). The flat list alone cannot answer that, and the
 *  last group is the only one whose fill level decides whether the
 *  announcement rests for a `confirmTargets` (`announcedTargetsNeedConfirm`);
 *  deriving it from `targets.length` treats a multi-group cast's fixed prefix
 *  as if it filled the variable group. */
function enumerateTargetGroupTuples(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    groups: (TargetRequirement | undefined)[],
    chosenX: number | undefined
): { targets: TargetSelection[]; lastGroupSize: number }[] {
    let acc: { targets: TargetSelection[]; lastGroupSize: number }[] = [
        { targets: [], lastGroupSize: 0 },
    ];
    for (const req of groups) {
        const groupTuples = enumerateTargetTuples(
            state,
            player,
            card,
            req,
            chosenX
        );
        // CR 601.2c — a group with no legal way to be filled makes the whole
        // announcement illegal (`announceCast` throws "Not enough legal
        // targets"), so the cast is not a move at all.
        if (groupTuples.length === 0) return [];
        const next: { targets: TargetSelection[]; lastGroupSize: number }[] =
            [];
        for (const prefix of acc) {
            for (const tuple of groupTuples) {
                next.push({
                    targets: [...prefix.targets, ...tuple],
                    lastGroupSize: tuple.length,
                });
                if (next.length >= MAX_COMBINATIONS) break;
            }
            if (next.length >= MAX_COMBINATIONS) break;
        }
        acc = next;
    }
    return acc;
}

/** CR 601.2c (issue #1104) — true iff every PERMANENT-type target in `combo`
 *  shares one live controllerId (Barrin's Spite's "two target creatures
 *  controlled by the same player"). A combo of size ≤ 1, or one with no
 *  permanent members, trivially passes (nothing to compare). */
function comboSharesController(
    state: GameState,
    combo: TargetSelection[]
): boolean {
    let controllerId: string | undefined;
    for (const t of combo) {
        if (t.type !== "permanent") continue;
        let found: string | undefined;
        for (const p of state.players) {
            const card = p.battlefield.find((c) => c.id === t.id);
            if (card) {
                found = card.controllerId;
                break;
            }
        }
        if (found === undefined) return false; // CR 608.2b — shouldn't happen
        if (controllerId === undefined) controllerId = found;
        else if (controllerId !== found) return false;
    }
    return true;
}

/** CR 603.3d / 115.7 / 707.10b (issue #2283) — every legal answer to the
 *  ENGINE-RAISED pending target selection `playerId` owes right now.
 *
 *  Returns `[]` when there is no such selection: no pending target, one owed to
 *  the OPPONENT, or one this player is mid-ANNOUNCING (a `"cast"` / `"ability"`
 *  continuation the executor drives atomically inside one cast/activation
 *  sequence — surfacing moves there would let a second decision interleave into
 *  a half-built announcement). The classification is
 *  `raisedPendingTargetOwedBy`, compile-time exhaustive over
 *  `PendingTarget["kind"]`.
 *
 *  Legality comes from the same `getLegalTargets` + lowered-requirement pair
 *  the accepting site (`applyOneTargetSelection`, `game.ts`) validates with, so
 *  an enumerated submission is one the server accepts — a rejected submission
 *  re-freezes the bot exactly as hard as no submission at all. */
export function enumerateRaisedTargetMoves(
    state: GameState,
    playerId: string
): Move[] {
    const pt = raisedPendingTargetOwedBy(state, playerId);
    if (!pt) return [];

    const already = pt.selected.length;
    const legal = getLegalTargets(
        state,
        requirementFromPendingTarget(pt),
        // CR 702.16b / 611 — protection and `cantBeTargeted` guards read the
        // source's live characteristics; the same helper the human path uses.
        pendingTargetingSource(state, pt.cardInstanceId, pt.kind),
        playerId,
        pt.chosenX,
        // CR 601.2c — objects already chosen under this requirement are
        // excluded by `getLegalTargets` itself (the single authority).
        pt.selected
    );

    const minTotal = typeof pt.count === "number" ? pt.count : pt.count.min;
    const rawMax =
        typeof pt.count === "number"
            ? pt.count
            : (pt.count.max ?? already + legal.length);
    // CR 601.2d — a divide-as-you-choose selection can never have more targets
    // than points to divide (each target must receive at least 1).
    const budgetMax =
        pt.divideTotal !== undefined
            ? pt.divideTotal
            : Number.POSITIVE_INFINITY;
    const maxTotal = Math.min(rawMax, budgetMax, already + legal.length);

    const lo = Math.max(0, minTotal - already);
    const hi = maxTotal - already;
    if (hi < lo) return [];

    const moves: Move[] = [];
    for (let size = lo; size <= hi; size++) {
        const total = already + size;
        // CR 601.2c — a fixed-N selection auto-finalizes on the last pick, so
        // confirming it afterwards hits "No target selection in progress".
        const confirmTargets = !pendingTargetCountMaxReached(pt.count, total);
        if (size === 0) {
            // "Up to N" declined. `selectTargets` rejects an empty array, so
            // this submission is confirm-only — and it is legal only when the
            // selection can actually rest at zero.
            if (confirmTargets) {
                moves.push({
                    kind: "submit-target",
                    targets: [],
                    confirmTargets,
                });
            }
            continue;
        }
        for (const combo of combinations(legal, size)) {
            // CR 601.2c (issue #1104) — `sameController` is a COMBINATORIAL
            // constraint `getLegalTargets` cannot see per-candidate; mirror the
            // post-filter `enumerateTargetTuples` applies for casts.
            if (pt.sameController && !comboSharesController(state, combo)) {
                continue;
            }
            moves.push({
                kind: "submit-target",
                targets: combo,
                confirmTargets,
            });
            if (moves.length >= MAX_COMBINATIONS) return moves;
        }
    }
    return moves;
}

/** Every legal `cast-spell` Move for ONE card out of ONE zone, priced through
 *  `castRawManaCost` (the single cost authority every real commit site reads).
 *
 *  Exported for `gre/ai/choiceCandidates.ts` (issue #2983). Both reflexive
 *  cast windows are choice NODES: the Madness window (CR 702.35a) and the
 *  Rebound window (CR 702.88a). Their candidates come from a generator rather
 *  than from this module's own priority-window walk, and it must offer the SAME
 *  cast, at the SAME price, this function would. Calling it is what makes that
 *  true by construction instead of by review; the codebase already carries two
 *  hand-rolled reimplementations of "build a cast" (issue #2473) and a third
 *  is exactly what this export exists to avoid.
 *
 *  The resulting import cycle (`moves` → `choiceCandidates` → `moves`) is safe:
 *  this is a hoisted function DECLARATION referenced only from inside a
 *  function body over there, so neither module reads the other's bindings while
 *  it initialises. `cast-window-choice.bot.test.ts` covers it. */
export function enumerateCastMoves(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    /** CR 118.9-analog / 119.4 (issue #2398, Bolas's Citadel) — when set, this
     *  cast pays NO mana at all and instead pays this much life, because the
     *  permission that supplied it replaces the whole mana cost
     *  (`libraryTopCastLifeCost`, gre/rules.ts — the same single authority the
     *  server's commit sites read, so the enumerated Move and the mutation
     *  charge the identical amount). Absent for every ordinary cast. */
    opts?: { lifeInsteadOfMana?: number; castFromZone?: CastFromZone }
): Move[] {
    const castFromZone = opts?.castFromZone ?? "hand";
    const moves = enumerateCastMovesFromZone(state, player, card, opts);
    if (castFromZone === "hand") return moves;
    // Stamp the zone once, here, rather than at each of the four `moves.push`
    // sites below (printed cost, bestow, morph, dash) — a new cast variant
    // cannot forget it.
    return moves.map((m) =>
        m.kind === "cast-spell" ? { ...m, castFromZone } : m
    );
}

function enumerateCastMovesFromZone(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    opts?: { lifeInsteadOfMana?: number; castFromZone?: CastFromZone }
): Move[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const lifeInsteadOfMana = opts?.lifeInsteadOfMana;
    // CR 119.4 — a player may pay life only while their life total covers it.
    if (lifeInsteadOfMana !== undefined && player.life < lifeInsteadOfMana) {
        return [];
    }
    // CR 601.3 / 702.34a / 702.35a — what this cast actually PAYS from the zone
    // it comes from, through `castRawManaCost` (`gre/castCost.ts`), the ONE
    // authority the real commit paths read. Byte-identical to the previous
    // `getInstanceManaCost(card)` for a HAND cast — that is exactly what the
    // helper returns for `"hand"` — while a flashback cast now prices the
    // flashback cost, a madness cast the madness cost, and a waived exile /
    // graveyard grant nothing at all, instead of the printed cost none of them
    // pays. Before this the enumerator had no way to reach those costs at all:
    // the helper lived in `convex/game.ts`, which imports this module.
    const castFromZone: CastFromZone = opts?.castFromZone ?? "hand";
    const rawCost =
        lifeInsteadOfMana !== undefined
            ? {}
            : (castRawManaCost(state, card, castFromZone) ?? {});

    // Bot-only prune (#938): a copy-on-ETB spell (Clone, Copy Artifact, Vesuvan
    // Doppelganger, Dance of Many) is a legal but strictly wasteful cast when no
    // permanent it could copy exists — it resolves into a do-nothing permanent
    // while spending its mana and a card. Skip enumerating the cast while NO
    // permanent on ANY battlefield matches the declarative `copySourceFilter`
    // (the copy is chosen "of any … on the battlefield", so all controllers
    // count). CR legality is unchanged — this only constrains the Bot's move
    // generation, never a human/server cast. Keyed off card data so the whole
    // copy-on-ETB class inherits the guard without a card-id allowlist.
    if (def?.copySourceFilter) {
        const hasCopySource = state.players.some((p) =>
            p.battlefield.some((c) =>
                // Layered view, not the raw instance: a `colors`/P-T clause on
                // a copy filter would otherwise fail CLOSED and silently
                // suppress the cast for the bot (issue #1209 — the same class
                // as the cost pre-checks below).
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    def.copySourceFilter!,
                    { supertypesOf: liveSupertypesOf }
                )
            )
        );
        if (!hasCopySource) return [];
    }

    // Modal spells (CR 700.2): one variant per mode, each with its own targets.
    //
    // CR 601.2c — a variant's target requirements are a LIST of independent
    // GROUPS, not a single requirement: the primary one plus every entry of
    // `additionalTargetRequirements` (Fumarole's "target creature and target
    // land"; Hull Breach's third mode, whose groups live on the MODE, issue
    // #1953). Reading only the primary requirement here enumerated a mode-3
    // Hull Breach with ONE target: `announceCast` then filled group 0, left the
    // enchantment group pending, and the executor's next `tapForPayment` threw
    // on `assertExpectedInput(expect: "priority")` — the Bot stalling on a move
    // it generated itself.
    //
    // Both `??` chains below are the SAME shape `announceCast` uses, checked
    // line by line against `game.ts`:
    //  - primary  ← `chosenMode?.targetRequirement ??
    //    castAdjustedTargetRequirement(cardDef, kickerPayments)`
    //    (game.ts `activeTargetRequirement`). `??`, NOT a ternary on `mode`:
    //    a modal card whose chosen MODE carries no requirement while the CARD
    //    does — Prismatic Ward, Chromatic Armor, Magical Hack, Phantasmal
    //    Terrain, Sleight of Mind, where `modes` are the as-enters colour /
    //    subtype pick and the target lives on the card — must still fall back
    //    to the card level. A ternary yielded `undefined` for every mode, so
    //    the Bot emitted one zero-target cast per colour and the executor's
    //    next `tapForPayment` threw the same `expect: "priority"` stall.
    //    `castAdjustedTargetRequirement` is mirrored here by
    //    `kickedTargetRequirement` (`gre/kicker.ts`) — a Kicker payment can no
    //    longer collapse to the base requirement (issue #2081): the fallback
    //    now reads whichever `kickerPayments` THIS variant actually pays.
    //  - extra    ← `chosenMode?.additionalTargetRequirements ??
    //    cardDef.additionalTargetRequirements ?? []` (game.ts
    //    `additionalRequirements`) — textually the same chain.
    const groupsFor = (
        mode?: {
            targetRequirement?: TargetRequirement;
            additionalTargetRequirements?: TargetRequirement[];
        },
        kickerPayments?: KickerPayments
    ): (TargetRequirement | undefined)[] => {
        const primary =
            mode?.targetRequirement ??
            (def ? kickedTargetRequirement(def, kickerPayments) : undefined);
        const extra =
            mode?.additionalTargetRequirements ??
            def?.additionalTargetRequirements ??
            [];
        return [primary, ...extra];
    };
    // CR 614.12a (issue #2019) — a card whose modal pick is an AS-ENTERS choice
    // (Voice of All, Prismatic Ward, Quirion Elves, Jihad) does not announce a
    // mode: `announceCast` rejects a supplied `chosenModeId` outright, so
    // enumerating one Move per mode here would generate moves the mutation
    // throws on. The pick is answered later, at the CR 614 chokepoint, through
    // the ordinary `option-pick` PendingChoice the Brain already realises.
    const modeShapes =
        def?.modes && def.modes.length > 0 && !declaresAsEntersMode(def)
            ? def.modes.map((m) => ({
                  modeId: m.id as string | undefined,
                  mode: m,
              }))
            : [{ modeId: undefined, mode: undefined }];

    // CR 601.2b / 118.8 / 601.2h — a CASTER-CHOSEN additional cost is a real
    // decision with real board consequences (discard a card vs lose 3 life), so
    // the Bot gets ONE Move per PAYABLE leg and the search values them against
    // each other — exactly the modal treatment above. `payableAdditionalCostLegs`
    // is the SAME authority `getLegalActions`' cast gate and the human client's
    // picker read, so a leg enumerated here is always a leg `announceCast`
    // accepts. A card with no disjunction yields the single `undefined` variant,
    // leaving every existing card's enumeration byte-identical; a card whose
    // every leg is unpayable never reaches here at all (the gate above already
    // dropped "cast").
    const legVariants: (string | undefined)[] = (() => {
        const payable = payableAdditionalCostLegs(
            player,
            def?.additionalCosts,
            card.id
        );
        return payable.length > 0 ? payable.map((l) => l.id) : [undefined];
    })();
    // CR 702.33 (issue #2081) — one Move per BOUNDED Kicker-payment variant
    // (see the bound rationale on `enumerateKickerVariants`, gre/kicker.ts),
    // always including `undefined` (not kicked). A card with no `kickers`
    // yields the single `undefined` variant, leaving every non-Kicker card's
    // enumeration byte-identical.
    const kickerVariants: (KickerPayments | undefined)[] = def
        ? enumerateKickerVariants(state, player, def, card)
        : [undefined];
    // CR 702.27a (issue #2081) — Buyback is a simple binary axis: pay the flat
    // extra mana cost, or don't. No shipped card combines Buyback with a
    // Kicker (catalogue census, issue #2081 investigation), so this axis and
    // `kickerVariants` are never both non-trivial for the same card — the
    // cross product below stays cheap regardless.
    const buybackVariants: boolean[] = def?.buyback ? [false, true] : [false];
    // CR 601.2f / 601.2h (issue #2081 fixup, review round 2) — a paid
    // Kicker's permanent leg can ALSO collide with the specific `oneOf` leg a
    // given (leg, kickerPayments) pairing carries, not just with the card's
    // BASE `additionalCosts.sacrificeFilter` (`enumerateKickerVariants`
    // already filtered that half, and the board-wide static-sacrifice half,
    // before `kickerVariants` above was built — neither depends on which
    // leg gets chosen). This second check runs HERE, below the leg
    // cross-product, because only here is the paired leg known —
    // `kickerLegPermanentSlotWouldCollide`'s doc (`gre/kicker.ts`) has the
    // full rationale.
    const announceVariants = legVariants.flatMap((additionalCostLegId) =>
        kickerVariants
            .filter(
                (kickerPayments) =>
                    !def ||
                    !kickerLegPermanentSlotWouldCollide(
                        def,
                        kickerPayments,
                        additionalCostLegId
                    )
            )
            .flatMap((kickerPayments) =>
                buybackVariants.flatMap((buybackPaid) =>
                    modeShapes.map(({ modeId, mode }) => ({
                        modeId,
                        additionalCostLegId,
                        kickerPayments,
                        buybackPaid,
                        groups: groupsFor(mode, kickerPayments),
                    }))
                )
            )
    );

    // X spells: enumerate X = 0..maxAffordable. Fixed (numeric) costs use a
    // single X = undefined. The X ceiling comes from the SHARED
    // `maxAffordableX` (rules.ts) — the same helper the human castability gate
    // uses — passed the SAME `state` the gate's own `hasEnoughLegalTargets`
    // call forwards (issue #1757; previously omitted here, so a board-dependent
    // mana source — Fellwar Stone, a Metalcraft-satisfied Mox Opal — reached a
    // higher ceiling at the gate than the Bot ever enumerated) — so the Bot
    // and `hasEnoughLegalTargets`'s own probe can never disagree on the
    // reachable range. That agreement is scoped to the gate's PROBE, not to
    // the cast path's actual reachable range: `maxAffordableX` deliberately
    // does not model CR 601.2f cost reductions (mirrors
    // `canPotentiallyPayCost`), while this loop's `normCost` DOES fold
    // `applyCostModifiers` per candidate X below, and `announceCast`
    // (game.ts) enforces no `maxAffordableX` ceiling at all on the human's
    // announced X — so under a live cost reducer a human can legally announce
    // an X the Bot never enumerates here. Each X this loop DOES enumerate is
    // still re-checked below via `planManaPayment`, so an X the shared greedy
    // ceiling over-counts is filtered there (never over-offered) — the
    // asymmetry only ever under-enumerates the Bot's X range, never
    // over-offers it.
    // CR 107.3 — a board-count upper bound on X ("X can't be greater than the
    // number of snow lands you control", Winter's Chill) caps the enumeration
    // to the same ceiling the cast mutation enforces, so the Bot never offers
    // an X the human cast path would reject.
    const hasX = typeof rawCost.X === "string";
    // CR 107.3b (issue #2398 review round 1 finding 5; widened by issue #2971
    // review finding 1) — `announceCast` decides whether this cast OWES an X
    // from the card's PRINTED mana cost (`cardDef.manaCost`), never from the
    // cost the zone actually charges, and rejects a Move with no `chosenX`
    // outright ("Must choose X (>= 0) for this spell"). So whenever the printed
    // cost carries an `{X}` that the zone cost does NOT — a library-top cast
    // whose mana cost the permission replaced, a Flashback cost with no X of
    // its own (Flash of Insight, printed {X}{1}{U}, flashback {1}{U}), a waived
    // exile/graveyard grant on an X spell (Fireball under Dauthi Voidwalker) —
    // "the only legal choice for X is 0", and the enumeration announces exactly
    // that rather than omitting `chosenX` and relying on the mutation to fill
    // it in. `executor.ts` forwards `move.chosenX` verbatim, so an omission
    // here IS the #2283/#2284 bot-freeze class: a Move the server refuses.
    // Derived from the two costs rather than from `lifeInsteadOfMana`, which
    // named only the library-top instance of the same shape.
    // CR 601.2b / 118.8 (issue #2980) — ONE shape escapes that lock: a
    // flashback cost whose own NON-MANA leg carries the variable ("Flashback—
    // {1}{U}, Exile X blue cards from your graveyard", Flash of Insight). CR
    // 601.2b makes the caster announce "the value of that variable" for any
    // variable cost paid as the spell is cast, not only one in the MANA cost,
    // and `announceCast` agrees: its own lock fires solely for the library-top
    // mana-cost replacement (`libraryTopPayment`), so it accepts any X ≥ 0
    // here and sizes the exile picker to it. The enumerator was strictly
    // STRICTER than the server, which made the whole flashback half of that
    // card unreachable for the Bot at any X but 0 — i.e. useless.
    // Gated on `!hasEscape` for the same reason `buildCastExileCostChoice` is
    // (CR 702.138 escape beats CR 702.34 flashback): under Underworld Breach an
    // escape cast of Flash of Insight pays `{X}{1}{U}` in MANA, so its ceiling
    // is `maxAffordableX` — not the count of blue cards in the graveyard, which
    // is what the flashback cost spends (issue #2980 review, F6).
    //
    // Read off the RAW `additionalCosts` rather than the leg-resolved spec:
    // `xValues` is computed once for the whole card, above the `announceVariants`
    // cross-product where `additionalCostLegId` is chosen. Inert today — Flash
    // of Insight declares the field top-level and no card carries it inside a
    // `oneOf` leg — but a card that did would keep this ceiling for every leg.
    const flashbackExileX =
        castFromZone === "graveyard" && !hasEscape(state, card)
            ? def?.additionalCosts?.flashbackExileFromGraveyard
            : undefined;
    const xLockedToZero =
        !hasX &&
        typeof getInstanceManaCost(card)?.X === "string" &&
        flashbackExileX === undefined;
    // CR 118.8 (issue #2980) — when the variable is paid in GRAVEYARD CARDS
    // rather than mana, the eligible fodder is the ceiling: `maxAffordableX`
    // prices X against untapped mana and would answer 0 for a flashback cast
    // that has already spent every land on its fixed `{1}{U}`, which is
    // precisely the position Flash of Insight is cast from. The per-X
    // `planCastCostPicks` below re-checks payability and drops any X this
    // ceiling over-counts, so the two can only ever under-offer.
    const xCeiling =
        flashbackExileX !== undefined
            ? flashbackExileEligibleCount(
                  player,
                  flashbackExileX.color,
                  card.id
              )
            : def?.castXUpperBound === "snow-lands"
              ? Math.min(
                    maxAffordableX(player, card, state),
                    countSnowLands(player.battlefield)
                )
              : maxAffordableX(player, card, state);
    // CR 601.2b — a cast announces an X whenever a variable cost is paid as it
    // is cast: an `{X}` in the cost the ZONE charges (`hasX`), or — issue #2980
    // — a flashback cost whose non-mana leg carries the variable instead
    // (Flash of Insight). The second shape adds NOTHING to `normCost`
    // (`normalizeManaCost` folds an X the cost does not have as 0), so each
    // variant differs only in the exile cost `planCastCostPicks` prices below.
    const xValues: (number | undefined)[] = xLockedToZero
        ? [0]
        : hasX || flashbackExileX !== undefined
          ? Array.from({ length: xCeiling + 1 }, (_, i) => i)
          : [undefined];

    // CR 107.4f — a Phyrexian cost ({B/P}, {U/P}) is paid pip-by-pip with mana
    // or 2 life. The Bot takes the most-life affordable split (the canonical
    // line for these cards: pay life, keep mana up); `solvePhyrexianSplit` folds
    // the mana-paid pips into the colored cost below and reports the life owed.
    const phyPips = phyrexianPipCount(rawCost);

    // CR 601.2f (ADR 0063, issue #1337, perf hoist issue #1663) — hoisted out
    // of the mode×X loop below: `getCostModifiers` scans the FULL battlefield
    // of both players for cost-modifier static effects, and its result is
    // mode/X-invariant — no shipped `appliesToSpell` predicate reads the
    // spell's chosen mode or X (they only read the announced card's static
    // characteristics, board state and the modifier's own carrier permanent).
    // Computing it once per candidate card instead of once per (mode, X)
    // avoids N+1 redundant full-battlefield scans for an X spell, which
    // matters here since `enumerateCastMoves` runs inside the ISMCTS search
    // loop. If a future `appliesToSpell` predicate becomes mode/X-dependent,
    // this hoist must be revisited (move the call back inside the loop).
    const costModifiers =
        phyPips === 0 ? getCostModifiers(state, card, "spell") : undefined;

    // CR 601.3c / 601.2f (issue #2146) — the conditional-flash SURCHARGE the
    // Invasion cycle prices its off-window cast at ("You may cast this spell as
    // though it had flash if you pay {2} more to cast it"). Mandatory once the
    // cast happens outside the caster's own sorcery window, and `announceCast`
    // charges it there unconditionally — so the tap plan built below MUST cover
    // it or the Bot announces a cast it can never pay for: the executor
    // announces FIRST and taps afterwards, so the cast parks in `pendingCast`,
    // `enumerateMoves` returns [] while one is open, and the only exit left is
    // the `abort-announcement` rung — tap for nothing, cancel, re-enumerate the
    // identical move (the bot-freeze shape). Verdict and amount are
    // mode/X-invariant (board + card only), so both are hoisted here beside
    // `costModifiers` rather than recomputed per (mode, X).
    const flashSurchargeOwed = flashSurchargeRequired(state, player.id, card);
    const flashSurcharge = flashSurchargeOf(card);

    const moves: Move[] = [];
    for (const {
        modeId,
        groups,
        additionalCostLegId,
        kickerPayments,
        buybackPaid,
    } of announceVariants) {
        // CR 601.2c — the executor sends every announced target in ONE batched
        // `selectTargets` call and then AT MOST ONE trailing `confirmTargets`.
        // A fixed-count group auto-advances inside that batch
        // (`advanceTargetGroupOrFinalize` mutates the pending target in place,
        // so the batch's identity pin still holds), which is what makes a flat
        // concatenation of the groups executable. A VARIABLE-count group
        // (X / `{min,max}`) does NOT auto-advance — it waits for its own
        // confirm — so only the LAST group may be variable; anything else
        // would need a confirm mid-batch the executor has no shape for. This
        // is a structural property of the requirement list, not a card list:
        // no shipped card has a non-final variable group, and if one lands the
        // Bot declines to enumerate it rather than emitting an unexecutable
        // move.
        if (groups.slice(0, -1).some((g) => isVariableCount(g))) continue;
        const lastReq = groups[groups.length - 1];
        // CR 601.2f / 701.21 / 701.13 (issue #2135) — the mandatory
        // additional-cost parks: the card's OWN filtered sacrifice
        // (`additionalCosts.sacrificeFilter`, flattened through the chosen
        // `oneOf` leg) plus Drought's board-wide static sacrifice (CR 118.8),
        // and the exile additional cost (Soul Exchange, CR 701.13). K=1 for
        // every cast-side park (`gre/parkKinds.ts`): one deterministic plan,
        // carried ON the move so the search applies exactly what the executor
        // later submits. Computed once per announce-variant — the plan is
        // X-invariant (it reads the board and the flattened additional cost,
        // never the chosen X). `null` = a leg has no legal payment (e.g. a
        // black spell under Drought with no Swamp), which the castability gate
        // does not check for static sacrifices; fail closed rather than emit a
        // move the executor cannot pay.
        // CR 702.34a / 118.8 (issue #2980) — ONE leg is X-dependent: Flash of
        // Insight's `flashbackExileFromGraveyard` exiles exactly the announced
        // X cards. For that card, and only that card, the plan is recomputed
        // per candidate X inside the loop below; every other cast keeps the
        // hoist (the plan reads the board and the flattened additional cost,
        // never the chosen X), so no X spell pays for a battlefield rescan per
        // candidate X.
        const exilePlanDependsOnX =
            castFromZone === "graveyard" &&
            def?.additionalCosts?.flashbackExileFromGraveyard !== undefined;
        const hoistedCostPicks =
            def && !exilePlanDependsOnX
                ? planCastCostPicks(
                      state,
                      player,
                      card,
                      def,
                      additionalCostLegId,
                      {
                          castFromZone,
                      }
                  )
                : undefined;
        if (hoistedCostPicks === null) continue;
        for (const x of xValues) {
            const normCost = normalizeManaCost(rawCost, { chosenX: x ?? 0 });
            // CR 702.33a / 601.2f (issue #2081) — a paid Kicker's MANA leg
            // joins the total ON TOP of the printed cost (CR 702.33a), folded
            // BEFORE the flash surcharge and cost modifiers, mirroring
            // `game.ts`'s cast-commit fold order exactly (`foldKickerCosts`
            // called before `foldFlashSurchargeCost`/`applyCostModifiers`
            // there). No-op for the `undefined` (unkicked) variant and for
            // every card without `kickers`.
            if (def) foldKickerCosts(normCost, def, kickerPayments);
            // CR 702.27a / 601.2f (issue #2081) — mirrors the fold above for
            // Buyback's flat extra mana cost. No-op unless this variant's
            // `buybackPaid` axis chose to pay it.
            if (def) foldBuybackCost(normCost, def, buybackPaid);
            // CR 601.3c / 601.2f — the surcharge is an ADDITIONAL cost, so it
            // joins the total BEFORE cost modifiers apply, exactly where
            // `announceCast` / `finalizeTargetSelection` fold it (they call the
            // same helper). No-op for every card without the rider and for the
            // same card inside its caster's sorcery window.
            foldFlashSurchargeCost(
                normCost,
                flashSurcharge,
                flashSurchargeOwed
            );
            // CR 601.2f (ADR 0063, issue #1337) — fold in battlefield
            // cost-modifier static effects (Stone Calendar, Mana Matrix,
            // Planar Gate, Power Artifact, Urza's Filter) AND a spell's own
            // `selfCostReduction` (Emry) before planning the tap payment,
            // mirroring the gate (`canPotentiallyPayCost` in rules.ts, which
            // folds the same modifiers onto whatever cost the branch probes —
            // unconditionally, on every cast branch, since issue #2981; it was
            // an opt-in flag set on three branches before that). Without this
            // the enumerator built its tap plan from the unreduced printed cost
            // and disagreed with `getLegalActions` — the bot could never cast a
            // spell whose affordability depends on a reduction. Phyrexian costs keep the pre-existing
            // unmodified path: no shipped card combines the two (mirrors the
            // same carve-out in `canPotentiallyPayCost`). `costModifiers` is
            // hoisted above the loop (see comment there) — only
            // `applyCostModifiers` (mutating the per-iteration `normCost`)
            // stays here.
            if (costModifiers) {
                applyCostModifiers(normCost, costModifiers);
            }
            // CR 118.9-analog / 119.4 (issue #2398) — a cast whose mana cost
            // the permission replaced starts its life leg at the substituted
            // amount; a Phyrexian split (below) can only add to it, and no
            // shipped card combines the two.
            //
            // CR 702.33a / 119.4 (issue #2081) — a paid Kicker's LIFE leg
            // (Phyrexian Scuta's "pay 3 life") joins the same total; no
            // shipped card combines a life-leg Kicker with either of the
            // replacements above.
            let payLife =
                (lifeInsteadOfMana ?? 0) +
                (def ? kickerLifeCost(def, kickerPayments) : 0);
            if (phyPips > 0) {
                const split = solvePhyrexianSplit(
                    player,
                    card,
                    rawCost,
                    x ?? 0,
                    state
                );
                if (split === null) continue;
                for (const [c, n] of Object.entries(split.manaAdditions)) {
                    if (n && n > 0) normCost[c] = (normCost[c] ?? 0) + n;
                }
                // `+=`, not `=` (issue #2398 review round 1, finding 5): the
                // substituted life above is a payment this cast already owes,
                // so a Phyrexian split ADDS to it rather than replacing it —
                // what the comment on `payLife`'s initializer has always
                // claimed. Unreachable today (a replaced cost is `{}`, whose
                // `phyPips` is 0), so this is the comment and the code agreeing
                // rather than a behaviour change.
                payLife += split.lifePips * PHYREXIAN_LIFE_PER_PIP;
            }
            // CR 702.66 / 601.2g — Delve (`payWith`, ADR 0063): graveyard cards
            // exiled while casting pay for {1} of GENERIC mana each, so a spell
            // the Bot cannot pay for with mana alone may still be castable.
            // Discount the generic portion by exactly the MINIMUM number of
            // exiles the caster is forced to make — the same
            // `genericManaShortfall` the announce path uses to seed
            // `offsetGeneric.min`, so the tap plan below and the delve pick the
            // driver later submits (`cast-exile-cost`, which exiles `min`) cover
            // the cost between them with nothing left over and nothing missing.
            // Without this the enumerator drops the cast entirely and the Bot
            // never casts a delve spell off a short board.
            // CR 702.66 / 601.2g — Delve rides the cast's ONE exile-picker
            // slot, so it is unavailable when this cast's own exile additional
            // cost has already claimed it (an escape cast, a non-mana flashback
            // cast). `announceCast` gates the delve picker the same way; an
            // enumerator that discounted the cost anyway would build a tap plan
            // short of what the server charges and park the announcement
            // unpayable (issue #2980 review, F1).
            const delveFuel =
                spellHasDelve(card) &&
                !castExileCostOccupiesPayWithSlot(
                    state,
                    player,
                    card,
                    castFromZone,
                    {
                        additionalCosts: resolveAdditionalCosts(
                            def?.additionalCosts,
                            additionalCostLegId
                        ),
                        chosenX: x,
                    }
                )
                    ? delveEligibleCards(player, card.id).length
                    : 0;
            if (delveFuel > 0) {
                const shortfall = genericManaShortfall(
                    player,
                    card,
                    normCost,
                    state
                );
                applyGenericOffset(
                    normCost,
                    Math.min(
                        delveFuel,
                        genericPortion(normCost),
                        Number.isFinite(shortfall) ? shortfall : 0
                    )
                );
            }
            const castCostPicks = exilePlanDependsOnX
                ? planCastCostPicks(
                      state,
                      player,
                      card,
                      def,
                      additionalCostLegId,
                      { castFromZone, chosenX: x }
                  )
                : hoistedCostPicks;
            // `null` = a leg has no legal payment: a black spell under Drought
            // with no Swamp (which the castability gate does not check at all),
            // or an exile cost the graveyard cannot fund at THIS X (which the
            // gate cannot check, since it runs before an X is announced). Fail
            // closed rather than emit a move the executor announces and cannot
            // pay.
            if (castCostPicks === null) continue;
            const tapPlan = planManaPayment(state, player, normCost, {
                cardInstanceId: card.id,
                cardDef: def,
                chosenX: x,
            });
            if (tapPlan === null) continue;
            for (const { targets, lastGroupSize } of enumerateTargetGroupTuples(
                state,
                player,
                card,
                groups,
                x
            )) {
                moves.push({
                    kind: "cast-spell",
                    cardInstanceId: card.id,
                    chosenModeId: modeId,
                    ...(additionalCostLegId ? { additionalCostLegId } : {}),
                    ...(kickerPayments ? { kickerPayments } : {}),
                    ...(buybackPaid ? { buybackPaid } : {}),
                    chosenX: x,
                    targets,
                    // Only the LAST group can be variable (guarded above), so
                    // it alone decides whether the cast needs a confirm.
                    confirmTargets: announcedTargetsNeedConfirm(
                        lastReq,
                        lastGroupSize,
                        x
                    ),
                    tapPlan,
                    ...(payLife > 0 ? { payLife } : {}),
                    ...(castCostPicks ? { castCostPicks } : {}),
                });
                if (moves.length >= MAX_COMBINATIONS) return moves;
            }
        }
    }

    // CR 702.103a/b (issue #2388) — the BESTOW cast mode: "As you cast this
    // spell, you may choose to cast it bestowed. If you do, you pay [cost]
    // rather than its mana cost", and the spell "becomes an Aura enchantment
    // and gains enchant creature". A second, independent variant axis rather
    // than another `modeVariants` entry, because it changes BOTH halves of
    // what a mode row carries: the base cost (`def.bestow.mana`, not the
    // printed cost) and the target groups (the gained "enchant creature", not
    // the card's own `targetRequirement` — a bestow creature has none). The
    // loop above is written around a single `rawCost`, so folding a
    // second cost into it would mean threading a cost through the X /
    // Phyrexian / delve machinery for a mode that has none of those: no
    // printed Bestow cost carries {X} or a Phyrexian pip, and a bestow cast is
    // never a delve/flashback cast.
    //
    // `hasLegalBestowHost` is only a cheap pre-filter; the real gate is
    // `enumerateTargetGroupTuples` below, which emits nothing when no creature
    // is a legal target — so the Bot can never announce a bestow cast the
    // mutation would reject for want of a target (the executor announces
    // first and taps afterwards, which is exactly the shape that strands it in
    // `pendingCast`).
    if (def?.bestow && hasLegalBestowHost(state)) {
        const bestowCost = normalizeManaCost(def.bestow.mana ?? {}, {
            chosenX: 0,
        });
        foldFlashSurchargeCost(bestowCost, flashSurcharge, flashSurchargeOwed);
        // CR 601.2f — the same battlefield cost modifiers the printed-cost
        // branch folds; a bestow cost is a mana cost like any other.
        const bestowModifiers = getCostModifiers(state, card, "spell");
        applyCostModifiers(bestowCost, bestowModifiers);
        const bestowTapPlan = planManaPayment(state, player, bestowCost, {
            cardInstanceId: card.id,
            cardDef: def,
        });
        if (bestowTapPlan !== null) {
            for (const { targets, lastGroupSize } of enumerateTargetGroupTuples(
                state,
                player,
                card,
                [BESTOW_TARGET_REQUIREMENT],
                undefined
            )) {
                moves.push({
                    kind: "cast-spell",
                    cardInstanceId: card.id,
                    alternativeCostId: def.bestow.id,
                    targets,
                    // CR 601.2c — the gained "enchant creature" is a
                    // fixed-count single group, so it auto-finalizes on the
                    // last pick and owes no trailing confirm. Read through the
                    // shared predicate rather than hardcoded, so a future
                    // bestow-shaped requirement cannot silently keep the wrong
                    // literal.
                    confirmTargets: announcedTargetsNeedConfirm(
                        BESTOW_TARGET_REQUIREMENT,
                        lastGroupSize,
                        undefined
                    ),
                    tapPlan: bestowTapPlan,
                });
                if (moves.length >= MAX_COMBINATIONS) return moves;
            }
        }
    }

    // CR 702.37a/c — the MORPH cast mode: "You may cast this card as a 2/2
    // face-down creature with no text, no name, no subtypes, and no mana cost
    // by paying {3} rather than paying its mana cost." A third variant axis
    // beside the printed-cost loop and Bestow, and for the same reason Bestow
    // is one: it replaces the base cost (the rule's flat {3}, never the
    // printed one) AND the object cast (a face-down 2/2 with no text, hence
    // no targets, no modes and no X — `morphCards.test.ts` enforces that a
    // morph card declares none of those, so there is nothing here to thread).
    //
    // The Bot needs this variant for the same reason it needed Bestow: every
    // other alternative cost only changes what the caster PAYS, so skipping
    // one is merely suboptimal, while skipping this one puts a whole class of
    // board state — a face-down creature, and the unmorph line that follows —
    // permanently out of reach.
    const morphCast = morphCastAlternativeCost(def ?? undefined);
    if (morphCast) {
        const morphCost = normalizeManaCost(morphCast.mana ?? {}, {
            chosenX: 0,
        });
        foldFlashSurchargeCost(morphCost, flashSurcharge, flashSurchargeOwed);
        // CR 601.2f / 702.37c / 707.2 (issue #2970 review) — the same
        // battlefield cost modifiers every other cast branch folds, but read
        // against the FACE-DOWN characteristics: a face-down spell is a
        // colourless, nameless 2/2 creature spell, so "any effects … that
        // would apply to casting a card with these characteristics" are the
        // ones keyed on those, not on the real card's. The instance is still
        // face up at enumeration time, hence the throwaway view — the SAME one
        // `announceCast` and `getLegalActions` price against, so the tap plan
        // and the charged total cannot disagree. This was previously written
        // off as unreachable in the shipped pool; it is not — Gloom
        // (`lea/black.ts`) keys on colour, which a face-down spell loses, and
        // taxed a face-down Exalted Angel {3}.
        const morphModifiers = getCostModifiers(
            state,
            faceDownCastView(card),
            "spell"
        );
        applyCostModifiers(morphCost, morphModifiers);
        const morphTapPlan = planManaPayment(state, player, morphCost);
        if (morphTapPlan !== null) {
            moves.push({
                kind: "cast-spell",
                cardInstanceId: card.id,
                alternativeCostId: morphCast.id,
                targets: [],
                confirmTargets: false,
                tapPlan: morphTapPlan,
            });
        }
    }

    // CR 702.109a (issue #1964) — the DASH cast mode: "you may cast this
    // creature by paying [cost] rather than paying its mana cost. If you do,
    // it gains haste and it's returned to its owner's hand at the beginning
    // of the next end step." A FOURTH variant axis, but the simplest one:
    // unlike Bestow/Morph, Dash changes NOTHING about the object cast — same
    // creature, same (usually absent) targets — only what the caster PAYS. It
    // was entirely unreachable to the Bot before this: the printed-cost loop
    // above reads only `getInstanceManaCost` (the PRINTED cost), so a card
    // whose printed cost the Bot can't afford — the exact situation Dash
    // exists for — enumerated ZERO cast moves, and the value-model fix
    // (`opValuers.ts`/`cardScriptValue.ts`, same issue) has nothing to bite on
    // without a dash-cast Move for the search to actually choose. No shipped
    // dash card carries a spell-level `targetRequirement`/`modes` (CR 702.109
    // dash creatures are never modal, and a creature's own ETB target, if any,
    // belongs to its TRIGGERED ability — announced when THAT ability goes on
    // the stack, CR 603.3d, never to the cast itself) — skip enumerating
    // (fail CLOSED) rather than silently drop a target group a future
    // dash-with-targets card might carry. Also skipped under the
    // `lifeInsteadOfMana` replacement (CR 118.9 stacking with another cost
    // replacement is an edge case no shipped card combination reaches).
    if (
        def?.dash &&
        lifeInsteadOfMana === undefined &&
        !def.targetRequirement &&
        !(def.modes && def.modes.length > 0)
    ) {
        const dashCost = normalizeManaCost(def.dash.mana ?? {}, {
            chosenX: 0,
        });
        foldFlashSurchargeCost(dashCost, flashSurcharge, flashSurchargeOwed);
        // CR 601.2f — the same battlefield cost modifiers every other cast
        // branch folds.
        const dashModifiers = getCostModifiers(state, card, "spell");
        applyCostModifiers(dashCost, dashModifiers);
        const dashTapPlan = planManaPayment(state, player, dashCost, {
            cardInstanceId: card.id,
            cardDef: def,
        });
        if (dashTapPlan !== null) {
            moves.push({
                kind: "cast-spell",
                cardInstanceId: card.id,
                alternativeCostId: def.dash.id,
                targets: [],
                confirmTargets: false,
                tapPlan: dashTapPlan,
            });
        }
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Activated abilities (conservative: tap + mana stack abilities only)
// ---------------------------------------------------------------------------

function enumerateAbilityMoves(
    state: GameState,
    player: PlayerState,
    perm: CardInstanceState,
    opts?: { anyPlayerOnly?: boolean; zone?: "battlefield" | "graveyard" }
): Move[] {
    // CR 611.2a / 613.1f (layer 6) — read the POST-LAYER ability set, the
    // same authority every other consumer reads (`getEffectiveActivatedAbilities`),
    // not the definition's printed list. A permanent whose definition declares
    // NO activated abilities can still hold granted ones (an Aura's
    // `activated-grant` static effect, a resolving `grantActivatedAbility`),
    // and the printed-list-only early return this replaces made every such
    // grant invisible to the bot (issue #2469). The authority also applies
    // the "loses all abilities" rule PER ability by timestamp (CR 613.7,
    // `grantOutrankedByAbilityLoss`) rather than the coarse all-or-nothing
    // this enumerator used to apply on `abilitiesSuppressedBy`: a grant
    // NEWER than the suppression survives, one older does not.
    const effectiveAbilities = getEffectiveActivatedAbilities(perm);
    if (effectiveAbilities.length === 0) return [];

    const fromGraveyard = opts?.zone === "graveyard";
    const moves: Move[] = [];
    for (const { ability } of effectiveAbilities) {
        // When scanning an opponent's permanent (CR 113.3c / 602.1), only "any
        // player may activate" and "only your opponents may activate" abilities
        // are legal for this player.
        if (
            opts?.anyPlayerOnly &&
            !ability.activatableByAnyPlayer &&
            !ability.activatableByOpponentsOnly
        )
            continue;
        // On the player's OWN permanent, an "only your opponents may activate"
        // ability (Clergy) is never a legal move for the controller (CR 602.1).
        if (!opts?.anyPlayerOnly && ability.activatableByOpponentsOnly)
            continue;
        // CR 113.6 / 702.29a / 702.129a — a zone-restricted ability functions
        // ONLY from the zone it opts into: Cycling (`activateFromHand`) from
        // the hand, Ashen Ghoul / Eternalize (`activateFromGraveyard`) from the
        // graveyard. Mirrors the server gate (`game.ts` activateAbility) and
        // the human UI gate (`getStackAbilities` / `getGraveyardStackAbilities`,
        // src/lib/card-utils.ts).
        //
        // Before issue #2339 this enumerator scanned the BATTLEFIELD only and
        // skipped both flags unconditionally, so the bot was structurally blind
        // to every graveyard-source ability — Ashen Ghoul included. `zone` now
        // says which zone the caller is scanning, and the gate is the same
        // rule read from either side.
        if (fromGraveyard) {
            if (!ability.activateFromGraveyard) continue;
            // A card in a graveyard is not a permanent (CR 110.1), so it has no
            // tap state and a {T} leg is unpayable there.
            if (ability.cost.tap) continue;
        } else if (ability.activateFromHand || ability.activateFromGraveyard) {
            continue;
        }
        // Only abilities that use the stack are macro-moves here; mana abilities
        // are funded on demand by the cast planner, never activated standalone.
        if (!ability.useStack) continue;
        // Conditional abilities need a runtime predicate we don't replicate;
        // leave them to a later slice rather than enumerate possibly-illegal
        // moves. (Documented limitation — server would reject anyway.)
        if (ability.canActivate || ability.getTargetRequirement) continue;
        // CR 606 (issue #2491) — a loyalty ability (planeswalker) carries a
        // signed `cost.loyalty` and three restrictions: the per-permanent
        // once-per-turn lock (CR 606.3), the controller's own main phase with
        // an empty stack (CR 606.3), and the negative-cost floor (CR 606.6).
        // This enumerator used to skip every one of them unconditionally — 13
        // shipped planeswalkers, 37 loyalty abilities, none reachable by the
        // bot — because the rule lived only on the mutation path and
        // `convex/gre/**` cannot import `convex/game.ts`. The rule now lives
        // HERE, in pure engine code (`gre/loyalty.ts`), and the mutation's
        // `assertLoyaltyActivationLegal` is a throwing wrapper over this exact
        // predicate. One authority, so the enumerator can never offer a
        // loyalty move the server rejects — the divergence that half-applies
        // the bot's `activateAbility → selectTarget` sequence.
        if (loyaltyActivationViolation(state, perm, ability) !== null) continue;
        // CR 602.5 — once-per-turn enforcement.
        if (
            ability.oncePerTurn &&
            (perm.activationsThisTurn?.[ability.id] ?? 0) > 0
        ) {
            continue;
        }
        // CR 702.142a (Boast, issue #2375) — "Activate only if this creature
        // attacked this turn". A DECLARATIVE field precisely so this
        // enumerator can read it: the `canActivate` skip a few lines above
        // means a closure-gated Boast would never be enumerated at all, so the
        // bot could never boast. Mirrors the server's own
        // `assertActivationTimingLegal`; `hasAttackedThisTurn` is absent (not
        // `false`) when the creature did not attack, so the comparison is
        // against `true`.
        if (
            ability.requiresAttackedThisTurn &&
            perm.hasAttackedThisTurn !== true
        ) {
            continue;
        }
        // CR 611.1 — a self-animate ability (manlands: Mishra's Factory, Jade
        // Statue) is a no-op while the source is already animated (one
        // animation at a time; `state.ts` `animateAsCreature` returns early
        // when `card.animation` is set). Enumerating it would let the bot pay
        // the activation cost for zero gain, so it's not a legal macro-move
        // while animated.
        if (ability.animatesSelf && perm.animation) {
            continue;
        }
        // CR 117.1b — phase/turn restrictions.
        if (
            ability.activationPhaseRestriction &&
            ability.activationPhaseRestriction.length > 0 &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            continue;
        }
        if (ability.controllerTurnOnly && state.activePlayerId !== player.id) {
            continue;
        }
        // CR 602.5d / 307.5 — "activate only as a sorcery" (Equip is the
        // canonical shape). Without this the enumerator hands the bot an
        // Equip move in DECLARE_ATTACKERS; the server rejects it, but a
        // TARGETED ability rejected mid-chain leaves the bot's `activateAbility
        // → selectTarget` sequence half-applied. Mirrors the server's own
        // `assertActivationTimingLegal`.
        if (ability.sorcerySpeedOnly && !isSorceryTiming(state)) {
            continue;
        }
        // Tap cost: source must be untapped and not summoning-locked.
        if (ability.cost.tap) {
            if (perm.isTapped) continue;
            if (isTapLockedBySummoningSickness(perm)) continue;
        }
        // CR 118.3 — "discard the last card you drew this turn" cost
        // (Jandor's Ring) is unpayable when no such card is in hand.
        if (ability.cost.discardLastDrawn && !canPayDiscardLastDrawn(player)) {
            continue;
        }
        // CR 118 / 122.1c — "remove N <type> counters" (Thallid) is unpayable
        // when the source is short. The server validates this up front and
        // throws, so without the gate the bot enumerates — and, since issue
        // #1920 made an activation's payoff visible, PREFERS — a move the
        // mutation rejects. Measured before this gate: a Thallid with one spore
        // counter, turn 3 precombat main, 200 iterations at seed 1, chose the
        // activation (1.0 against `pass` 0.99826) while `main` chose `pass`.
        if (
            ability.cost.removeCounter &&
            !canPayRemoveCounterCost(perm, ability.cost.removeCounter)
        ) {
            continue;
        }
        // CR 119.4 — a life cost is unpayable below that much life; the server
        // throws "Not enough life" on the same comparison.
        if (
            ability.cost.life !== undefined &&
            !canPayLifeCost(player, ability.cost.life)
        ) {
            continue;
        }
        // CR 118.3 — "discard a card at random" is illegal with an EMPTY hand
        // (Ring of Renewal, Coral Helm); the server throws "No card in hand to
        // discard". The one cost leg whose payer does not throw — it clamps to
        // hand size — so it read as safe while being illegal, and the search
        // pushed an activation the mutation rejects.
        if (ability.cost.discardAtRandom && !canPayDiscardAtRandom(player)) {
            continue;
        }
        // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>" cost is
        // unpayable when no matching permanent is on the player's battlefield
        // (Atog, Ashnod's Altar, Orcish Mechanics, etc.). Matched through
        // `effectivePermanentView` — the SAME view the server's candidate scan
        // (`sacrificeCandidates`) uses. A raw `CardInstanceState` carries no
        // derived `colors`, so a colour-filtered cost (Thelonite Monk's
        // "a green creature", Homarid Spawning Bed's "a blue creature",
        // Freyalise Supplicant's "a red or white creature") matched nothing and
        // the bot dropped the whole activation as illegal (issue #1209).
        // CR 602.1 / 118.5 (issue #2398) — the cost gives up
        // `sacrificeFilterCount` matching permanents ("Sacrifice ten nonland
        // permanents", Bolas's Citadel), defaulting to 1. Counted, not merely
        // existence-checked, so the bot never enumerates an activation the
        // server would reject for want of victims.
        if (
            ability.cost.sacrificeFilter &&
            player.battlefield.filter((c) =>
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    ability.cost.sacrificeFilter!,
                    {
                        selfControllerId: player.id,
                        // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact"
                        // (Legion Extruder): the source can't pay its own cost
                        // with itself. Without this id an `excludeSource`
                        // filter matches nothing here (fail-closed) and the bot
                        // simply never enumerates the activation.
                        selfInstanceId: perm.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
            ).length < (ability.cost.sacrificeFilterCount ?? 1)
        ) {
            continue;
        }
        // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
        // (Survival of the Fittest) is unpayable when no matching card is in
        // the player's hand.
        if (
            ability.cost.discardFilter &&
            player.hand.filter((c) =>
                handCardMatchesFilter(c, ability.cost.discardFilter!.filter)
            ).length < ability.cost.discardFilter.count
        ) {
            continue;
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" cost
        // (Night Soil) is unpayable unless one graveyard holds enough matching
        // cards. The whole cost must come from ONE graveyard (CR 118.5).
        if (ability.cost.exileFromGraveyard) {
            const { count, cardType, owner } = ability.cost.exileFromGraveyard;
            // CR 118.5 — `owner: "you"` restricts the source to the activating
            // player's own graveyard (Grim Lavamancer); default = any player's.
            const sources = owner === "you" ? [player] : state.players;
            const payable = sources.some(
                (p) =>
                    p.graveyard.filter(
                        (c) =>
                            cardType === undefined || c.types.includes(cardType)
                    ).length >= count
            );
            if (!payable) continue;
        }
        // CR 602.1 / 118.8 — "tap N untapped permanents matching <filter> you
        // control" cost is unpayable without N matching untapped permanents
        // other than the source (Hand of Justice).
        if (ability.cost.tapOtherFilter) {
            const { filter } = ability.cost.tapOtherFilter;
            const available = player.battlefield
                .filter(
                    (c) =>
                        c.id !== perm.id &&
                        !c.isTapped &&
                        // Same view the server's `tapOtherCandidates` uses —
                        // a raw instance has no derived `colors`, so Hand of
                        // Justice's "three untapped WHITE creatures you
                        // control" matched nothing here and the enumerator
                        // emitted ZERO activations for it (issue #1209).
                        matchesPermanentFilter(
                            effectivePermanentView(state, c),
                            filter,
                            {
                                selfControllerId: player.id,
                                supertypesOf: liveSupertypesOf,
                            }
                        )
                )
                .map((c) => ({
                    id: c.id,
                    // CR 702.122a/b — crew contribution (effective power plus
                    // the creature's own `crewPowerBonus`).
                    power: crewPowerContribution(
                        getEffectivePower(state, c),
                        tryGetDefinition((c.card as { id?: string }).id ?? "")
                            ?.crewPowerBonus ?? 0
                    ),
                }));
            if (!canPayTapOtherCost(ability.cost.tapOtherFilter, available))
                continue;
        }
        // Mana cost: must be payable. The {T} part of the cost is paid by the
        // activate mutation itself, not by the tap plan.
        const manaCost: Record<string, number> = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        // FEM Merseine (CR 601.2f / 202.3) — "Pay enchanted creature's mana
        // cost": fold the attached host's printed cost into the affordability
        // check so the Brain only offers the activation when it can pay.
        if (ability.cost.manaEqualToEnchantedCreatureCost) {
            const hostId = perm.attachedTo;
            const host = hostId
                ? state.players
                      .flatMap((p) => p.battlefield)
                      .find((c) => c.id === hostId)
                : undefined;
            if (!host) continue;
            const hostCardId = (host.card as { id?: string }).id;
            const hostCost = (
                hostCardId ? tryGetDefinition(hostCardId) : undefined
            )?.manaCost;
            const hostNorm = hostCost ? normalizeManaCost(hostCost) : {};
            for (const [sym, amt] of Object.entries(hostNorm)) {
                manaCost[sym] = (manaCost[sym] ?? 0) + amt;
            }
        }
        // Chromatic Armor (CR 601.2f) — "{X}: … X is the number of sleight
        // counters": fold the source's own counter count into the affordability
        // check so the Brain only offers the activation when it can pay.
        if (ability.cost.manaEqualToCounterCount) {
            const have =
                perm.counters?.[ability.cost.manaEqualToCounterCount.type] ?? 0;
            if (have > 0) manaCost.X = (manaCost.X ?? 0) + have;
        }
        const tapPlan = planManaPayment(state, player, manaCost);
        if (tapPlan === null) continue;

        // Modal activated abilities (CR 700.2 / 602.2b, issue #1341): one
        // variant per mode, each with its OWN target requirement — the same
        // shape modal spells use above. A non-modal ability keeps its single
        // ability-level requirement.
        //
        // Reflexive self-EXCLUDE (issue #2399) is applied through the SAME
        // shared helper `activateAbilityOnState` uses, so the bot enumerates
        // exactly the tuples the mutation would accept — an "ANOTHER target"
        // ability whose only other legal target is itself must yield NO move
        // here, not a move the server then rejects.
        const selfExcluded = (req: TargetRequirement | undefined) =>
            req ? applySelfExclusion(req, perm.id) : req;
        // CR 601.2c via CR 602.2b (issue #2361) — an activated ability may
        // declare ADDITIONAL independent target groups beyond its primary
        // requirement (Oko, Thief of Crowns' −5, whose two groups differ in
        // `controller` AND `powerFilter`). The ability-side twin of the cast
        // path's `groupsFor`: primary first, then each extra, flattened in
        // declaration order — the same order `finalizeTargetSelection` hands
        // the mutation, so the Effect Script's positional `{ target: N }` refs
        // line up. `AbilityMode` has no per-mode twin of the field, so the
        // extras are always read off the ability itself.
        const abilityExtraGroups = (
            ability.additionalTargetRequirements ?? []
        ).map((r) => selfExcluded(r));
        const abilityModeVariants =
            ability.modes && ability.modes.length > 0
                ? ability.modes.map((m) => ({
                      modeId: m.id as string | undefined,
                      req: selfExcluded(m.targetRequirement),
                  }))
                : [
                      {
                          modeId: undefined,
                          req: selfExcluded(ability.targetRequirement),
                      },
                  ];
        // CR 602.1 / 118 — the deferred cost legs (discard / exile-from-
        // graveyard / tap-other) are paid by NAMING cards, and the server never
        // commits the activation until they are named. The picks therefore ride
        // on the move (one variant per discard candidate worth searching over —
        // WHICH creature a tutor engine eats is the decision the card is
        // about), so the search applies exactly what the executor submits.
        // An empty list means a leg has no legal payment: not a legal move.
        const pickVariants = enumerateActivationCostPicks(
            state,
            player,
            perm,
            ability
        );
        if (pickVariants.length === 0) continue;

        for (const { modeId, req } of abilityModeVariants) {
            // CR 601.2c via CR 602.2b — one enumerator for both shapes (issue
            // #2870). The single-group case is `[req]`, which
            // `enumerateTargetGroupTuples` handles identically to the old
            // `enumerateTargetTuples` call while ALSO reporting how much of the
            // tuple belongs to the last group — the only group whose fill level
            // decides whether a trailing `confirmTargets` is owed. The
            // one-branch version read `req` (the FIRST group) against the WHOLE
            // flat tuple, so an ability with additional groups asked the wrong
            // requirement about the wrong count.
            const abilityGroups = [req, ...abilityExtraGroups];
            // The ability-side twin of the cast path's identical guard
            // (#2905 review, item 3): a VARIABLE-count group does not
            // auto-advance inside the executor's one batched `selectTargets`, so
            // only the LAST group may be one — anything else needs a confirm
            // mid-batch the executor has no shape for, and its later picks would
            // land back on the first group. This is the precondition
            // `enumerateTargetGroupTuples` is written against; the site adopted
            // that enumerator without it. Vacuous today (Oko, Thief of Crowns'
            // −5 is the only ability with `additionalTargetRequirements` and
            // both its groups are `count: 1`), so the Bot declines to enumerate
            // rather than emitting an unexecutable move if one ever lands.
            if (abilityGroups.slice(0, -1).some((g) => isVariableCount(g))) {
                continue;
            }
            const lastAbilityReq = abilityGroups[abilityGroups.length - 1];
            for (const { targets, lastGroupSize } of enumerateTargetGroupTuples(
                state,
                player,
                perm,
                abilityGroups,
                undefined
            )) {
                for (const costPicks of pickVariants) {
                    moves.push({
                        kind: "activate-ability",
                        cardInstanceId: perm.id,
                        abilityId: ability.id,
                        ...(modeId ? { chosenModeId: modeId } : {}),
                        targets,
                        confirmTargets: announcedTargetsNeedConfirm(
                            lastAbilityReq,
                            lastGroupSize,
                            undefined
                        ),
                        tapPlan,
                        ...(costPicks ? { costPicks } : {}),
                    });
                    if (moves.length >= MAX_COMBINATIONS) return moves;
                }
            }
        }
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Combat declaration
// ---------------------------------------------------------------------------

function otherPlayer(
    state: GameState,
    playerId: string
): PlayerState | undefined {
    return state.players.find((p) => p.id !== playerId);
}

/** Every legal attacker declaration for the active player (CR 508.1),
 *  respecting must-attack requirements (CR 508.1d), eligibility, and the
 *  Caverns of Despair cap. Exported for the Expected-Input-driven enumeration
 *  (`legalActions.ts`, issue #801). */
export function enumerateAttackerMoves(
    state: GameState,
    player: PlayerState
): Move[] {
    const defender = otherPlayer(state, player.id);
    const defBf = defender?.battlefield;
    const eligible = player.battlefield.filter(
        (c) => validateAttackerEligibility(c, defBf, state).eligible
    );
    const required = new Set(
        getRequiredAttackerIds(player.battlefield, state, defBf, undefined)
    );
    const optional = eligible.filter((c) => !required.has(c.id));
    const requiredIds = [...required];

    // CR 508.1a — the battlefield-wide cap on declared attackers (Caverns of
    // Despair at two, Dueling Grounds at one).
    const cap = getAttackerCap(state);

    // CR 508.1d — requirements are obeyed to the MAXIMUM number possible
    // without violating a restriction, and the cap is a restriction. The legal
    // declarations are therefore exactly: a `quota`-sized subset of the
    // required creatures (the declarer picks WHICH when the cap admits fewer
    // than all), plus any subset of the voluntary creatures that fits in the
    // leftover slack. This is precisely the reachable output set of
    // `foldAttackRequirements` — the same authority `confirmAttackers` and the
    // auto-pass confirm normalize through — so the bot can never propose a
    // declaration the mutation would rewrite, and never miss one it would
    // accept. (`gre/combat.ts` carries the rule; the shared `quota` is the
    // seam.)
    const quota = maxObeyableAttackRequirements(requiredIds.length, cap);
    // `combinations` (not `powerSet(...).filter`) — the purpose-built helper
    // enumerates size-`quota` subsets directly, so `MAX_COMBINATIONS` bounds
    // the ANSWER rather than a power set that would be truncated to 64 members
    // before the size filter ever ran (with 8 required creatures under a cap of
    // 2 that filter would have seen a fraction of the 28 real choices).
    const requiredBases: string[][] =
        quota === requiredIds.length
            ? [requiredIds]
            : combinations(requiredIds, quota);
    const slack = cap === undefined ? Number.POSITIVE_INFINITY : cap - quota;

    const subsets = requiredBases.flatMap((base) =>
        powerSet(optional)
            .filter((subset) => subset.length <= slack)
            .map((subset) => [...base, ...subset.map((c) => c.id)])
    );

    const baseMoves: Move[] = subsets.map((attackerIds) => ({
        kind: "declare-attackers" as const,
        attackerIds,
    }));

    // CR 508.1a (issue #1220) — the bot must also be able to attack a
    // planeswalker the defender controls, not only the defending player. For
    // each defending planeswalker, add one variant per non-empty subset that
    // directs the whole declared attack at that planeswalker (attackTargets
    // maps every attacker → that planeswalker). This keeps the option available
    // to the search without a per-attacker combinatorial blow-up; the evaluator
    // picks the player-vs-planeswalker split. `applyMove` drops targets for
    // attackers/planeswalkers that are no longer legal.
    const defenderPlaneswalkers = (defBf ?? []).filter((c) =>
        isPlaneswalker(c)
    );
    const pwMoves: Move[] = [];
    for (const pw of defenderPlaneswalkers) {
        for (const attackerIds of subsets) {
            if (attackerIds.length === 0) continue;
            const attackTargets: Record<string, string> = {};
            for (const id of attackerIds) attackTargets[id] = pw.id;
            pwMoves.push({
                kind: "declare-attackers" as const,
                attackerIds,
                attackTargets,
            });
        }
    }

    return [...baseMoves, ...pwMoves];
}

/** Every legal blocker assignment for the declaring player (CR 509.1),
 *  respecting per-blocker eligibility, the Caverns of Despair blocker cap
 *  (CR 509.1a), and menace-style minimums (CR 509.1b). Exported for the
 *  Expected-Input-driven enumeration (`legalActions.ts`, issue #801). */
export function enumerateBlockerMoves(
    state: GameState,
    player: PlayerState
): Move[] {
    const combat = state.combat;
    if (!combat) return [{ kind: "declare-blockers", assignments: [] }];
    const attackerIds = combat.attackerIds;
    const attackers = attackerIds
        .map((id) => findCard(state, id))
        .filter((c): c is CardInstanceState => c !== undefined);

    // For each candidate blocker, the attackers it may legally block, plus the
    // option to stay back (null).
    const perBlocker: {
        blocker: CardInstanceState;
        options: (string | null)[];
    }[] = [];
    for (const blocker of player.battlefield) {
        if (!blocker.types.includes("Creature")) continue;
        if (blocker.isTapped) continue;
        const legal = attackers.filter(
            (atk) =>
                validateBlockerEligibility(
                    atk,
                    blocker,
                    player.battlefield,
                    state
                ).eligible
        );
        if (legal.length === 0) continue;
        // Single-block this slice (max-block grants beyond 1 are a later slice).
        getMaxBlockTargets(blocker); // reserved for multi-block expansion
        perBlocker.push({
            blocker,
            options: [null, ...legal.map((a) => a.id)],
        });
    }

    if (perBlocker.length === 0) {
        return [{ kind: "declare-blockers", assignments: [] }];
    }

    // Cartesian product of per-blocker choices, capped.
    let combos: { blockerId: string; attackerId: string }[][] = [[]];
    for (const { blocker, options } of perBlocker) {
        const next: { blockerId: string; attackerId: string }[][] = [];
        for (const combo of combos) {
            for (const opt of options) {
                next.push(
                    opt === null
                        ? combo
                        : [...combo, { blockerId: blocker.id, attackerId: opt }]
                );
                if (next.length >= MAX_COMBINATIONS) break;
            }
            if (next.length >= MAX_COMBINATIONS) break;
        }
        combos = next;
        if (combos.length >= MAX_COMBINATIONS) break;
    }

    // CR 509.1a — drop combos that declare more than the battlefield-wide cap
    // of distinct blocking creatures (Caverns of Despair, Dueling Grounds).
    // The empty assignment always survives, so the bot can never be left
    // without a legal declare-blockers move.
    const blockerCap = getBlockerCap(state);
    const capped =
        blockerCap === undefined
            ? combos
            : combos.filter(
                  (assignments) =>
                      new Set(assignments.map((a) => a.blockerId)).size <=
                      blockerCap
              );

    // CR 509.1b — minimum-blocker thresholds (menace, and the parametrized
    // `minimum-blockers:N` rules-text form). Drop combos that block such an
    // attacker with fewer than its minimum number of distinct blockers; the
    // server rejects these at confirm time, so the bot must not consider them
    // legal moves either (mirrors the cap filter above). Both sides read the
    // SAME `getMinimumBlockers`, so a new source can never desync them.
    const minLegal = capped.filter((assignments) => {
        const blockerCountByAttacker = new Map<string, number>();
        for (const a of assignments) {
            blockerCountByAttacker.set(
                a.attackerId,
                (blockerCountByAttacker.get(a.attackerId) ?? 0) + 1
            );
        }
        for (const atk of attackers) {
            const blockedBy = blockerCountByAttacker.get(atk.id) ?? 0;
            if (blockedBy > 0 && blockedBy < getMinimumBlockers(atk)) {
                return false;
            }
        }
        return true;
    });

    return minLegal.map((assignments) => ({
        kind: "declare-blockers" as const,
        assignments,
    }));
}

function findCard(state: GameState, id: string): CardInstanceState | undefined {
    for (const p of state.players) {
        const c = p.battlefield.find((x) => x.id === id);
        if (c) return c;
    }
    return undefined;
}

/** CR 113.1b / 605.3a (issue #2903) — enumerate the activated abilities
 *  granted to a PLAYER by effects (Channel's "Pay 1 life: Add {C}."), which
 *  hang off `PlayerState.grantedAbilities` rather than any permanent and are
 *  therefore invisible to `enumerateAbilityMoves`'s battlefield/graveyard scan.
 *
 *  Each grant is a REFERENCE (`sourceCardId` + `abilityId`) resolved through
 *  the card-definition lookup — the same lookup `activatePlayerAbility`
 *  (`convex/game.ts`) does at activation time, since there is no instance to
 *  read the template off. A MANA ability is enumerated here as a standalone
 *  move (unlike a permanent's, which `planManaPayment` funds on demand): the
 *  tap planner reads only permanents and the pool, so a player-level grant has
 *  no other way to reach the search.
 *
 *  Timing: the enumerator only ever runs in the player's own priority window
 *  (`enumerateMoves` gates on `priorityPlayerId`), so CR 605.3a's priority
 *  requirement is already satisfied by construction; the "while paying a cost"
 *  window (CR 605.3a) is not a search decision node. Affordability mirrors the
 *  mutation's gates: a life cost is payable only with `life >= cost` (CR
 *  119.4), a tap/sacrifice cost is rejected (no source permanent), and a
 *  phase restriction (CR 602.5) is honoured. Conditional (`canActivate`) and
 *  targeted (`getTargetRequirement` / `targetRequirement`) templates are
 *  skipped, matching `enumerateAbilityMoves`' documented limitation — the
 *  server would reject them and the search cannot answer a target anyway. */
function enumerateGrantedAbilityMoves(
    state: GameState,
    player: PlayerState
): Move[] {
    const grants = player.grantedAbilities;
    if (!grants || grants.length === 0) return [];
    const moves: Move[] = [];
    for (const grant of grants) {
        const template = tryGetDefinition(
            grant.sourceCardId
        )?.activatedAbilities?.find((a) => a.id === grant.abilityId);
        if (!template) continue;
        // Conditional abilities need a runtime predicate the search does not
        // replicate; targeted abilities would need a target selection the move
        // shape does not carry (mirrors `enumerateAbilityMoves`).
        if (template.canActivate || template.getTargetRequirement) continue;
        if (template.targetRequirement) continue;
        // Player-scoped grants have no source permanent, so tap/sacrifice
        // costs are not meaningful — the mutation rejects them, and offering
        // one would be a move the server then refuses (CR 113.1b).
        if (template.cost.tap || template.cost.sacrifice) continue;
        // A player grant's MANA cost is paid from the pool (the mutation's
        // `isManaCostCovered` path); the bot's move shape carries no pool
        // payment for it and no shipped player grant has one, so fail CLOSED
        // until one does (mirrors the tap/sacrifice and conditional skips).
        if (template.cost.mana) continue;
        // CR 602.5 — phase-restricted templates are equally illegal when
        // activated via a player-scoped grant (mirrors the mutation).
        if (
            template.activationPhaseRestriction &&
            template.activationPhaseRestriction.length > 0 &&
            !template.activationPhaseRestriction.includes(state.phase)
        ) {
            continue;
        }
        // CR 119.4 — a life cost is unpayable below that much life; the server
        // throws "Not enough life" on the same comparison.
        if (
            template.cost.life !== undefined &&
            !canPayLifeCost(player, template.cost.life)
        ) {
            continue;
        }
        moves.push({
            kind: "activate-granted-ability",
            grantedAbilityInstanceId: grant.id,
            abilityId: grant.abilityId,
            sourceCardId: grant.sourceCardId,
        });
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Per-caller knobs for {@link enumerateMoves}. */
export type EnumerateMovesOptions = {
    /** Drop moves that are PROVABLY dominated by `pass` — a cast/activation
     *  whose full resolution changes nothing but the mover's own cost
     *  (Damnation on a creature-free board, issue #1887). BOT paths only:
     *  `legalActions` (the human affordance surface) and scripted setup
     *  realisation must keep seeing the complete legal set, since the server
     *  stays the sole authority on legality and a dominated move is still
     *  perfectly LEGAL — just never worth searching.
     *
     *  COST: a probe is three `cloneGameState`s plus a whole-`GameState` deep
     *  compare, ~6× the cost of the enumeration itself on a hand of cheap
     *  instants. Enable it ONCE per decision, never per tree node — see
     *  `searchWithTrace`, which prunes at the root and reuses the verdict for
     *  the root layer of every iteration (issue #1905 review finding 3). */
    pruneDominatedNoOps?: boolean;
    /** Called with each move `pruneDominatedNoOps` dropped, in enumeration
     *  order. Lets a caller reuse the (expensive) verdict elsewhere instead of
     *  re-probing — `searchWithTrace` turns it into the deny-set that keeps the
     *  dominated move out of the tree's root layer too. */
    onPruned?: (move: Move) => void;
};

/** The complete set of legal macro-moves for `playerId` at the current decision
 *  point. Empty when the player owes no action right now. Pure. */
export function enumerateMoves(
    state: GameState,
    playerId: string,
    options?: EnumerateMovesOptions
): Move[] {
    if (state.gameOver) return [];
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return [];

    // Pre-game mulligan declaration window (CR 103.5).
    if (state.phase === "MULLIGAN") {
        const m = state.mulligan;
        if (m && !m.bottoming && m.declaringPlayerId === playerId) {
            return [
                { kind: "mulligan", decision: "keep" },
                { kind: "mulligan", decision: "mull" },
            ];
        }
        return [];
    }

    // Combat declarations are gated before priority can pass (CR 508/509); the
    // server rejects passPriority until they are confirmed, so resolve them
    // first regardless of who holds priority.
    const combat = state.combat;
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        combat &&
        !combat.confirmed &&
        state.activePlayerId === playerId
    ) {
        return enumerateAttackerMoves(state, player);
    }
    if (
        state.phase === "DECLARE_BLOCKERS" &&
        combat &&
        combat.confirmed &&
        !combat.blockersConfirmed &&
        state.activePlayerId !== playerId
    ) {
        return enumerateBlockerMoves(state, player);
    }

    // A live mid-resolution CHOICE is a first-class decision node (PRD #1423,
    // issue #1425): the choice REPLACES the action space, so the enumerator
    // surfaces the head choice's candidate answers instead of nothing. Chooser =
    // the queue head's `playerId` (APNAP already applied by the engine at
    // enqueue, CR 101.4). Checked BEFORE the priority-holder gate: while a
    // choice is pending, priority belongs to the chooser by construction, and
    // only the chooser is offered moves. A kind with no registered generator
    // (`choiceCandidates` returns []) keeps the historical behavior — no moves,
    // the driver waits and the executor resolves it.
    const headChoice = state.pendingChoices?.[0];
    if (headChoice) {
        if (
            headChoice.playerId !== playerId ||
            state.pendingCast ||
            state.pendingTarget ||
            state.pendingActivation ||
            state.pendingCompanionPay
        ) {
            return [];
        }
        return choiceCandidates(state, headChoice).map((c) => c.move);
    }

    // CR 603.3d / 115.7 / 707.10b (issue #2283) — an ENGINE-RAISED target
    // selection is a first-class decision node, exactly like the pending choice
    // above: the engine opened it AT its owner during resolution, it freezes
    // priority, and nothing else the owner could do is legal until it is
    // answered. Before this branch the enumerator returned nothing for it (the
    // blanket "a pending target is always a continuation the executor drives"
    // below), so a bot that controlled a targeted trigger with two legal
    // targets froze the game forever — Flickerwisp, Badgermole Cub, Azure
    // Beastbinder. An ANNOUNCED (`"cast"` / `"ability"`) pending target keeps
    // the old behaviour and falls through to the blanket gate below.
    if (
        state.pendingTarget &&
        pendingTargetOrigin(state.pendingTarget.kind) === "raised"
    ) {
        return enumerateRaisedTargetMoves(state, playerId);
    }

    // Ordinary priority window. A mid-flight pending cast/target/activation is a
    // continuation the executor drives atomically, not a fresh macro-move —
    // surface nothing so the driver waits.
    if (state.priorityPlayerId !== playerId) return [];
    if (
        state.pendingCast ||
        state.pendingTarget ||
        state.pendingActivation ||
        state.pendingCompanionPay
    ) {
        return [];
    }

    const moves: Move[] = [{ kind: "pass" }];
    // CR 116.2 / 702.139a (ADR 0064) — the companion summon special action.
    // Single source of truth for legality, shared with the human mutation
    // (`summonCompanion`, game.ts) and the legal-actions surface
    // (legalActions.ts, via this enumerator).
    if (canSummonCompanion(state, player)) {
        moves.push({ kind: "summon-companion" });
    }
    // CR 116.2b / 702.37e — the turn-face-up special action, one Move per
    // face-down permanent this player controls that has an affordable morph
    // cost. Same single-source-of-truth arrangement as the companion line
    // above: the predicate behind `turnableFaceUpPermanents` (`canTurnFaceUp`,
    // gre/morph.ts) is the one the `turnPermanentFaceUp` mutation and the wire
    // affordance flag also read, so the Bot can never enumerate an action the
    // server would reject.
    for (const faceDown of turnableFaceUpPermanents(state, player)) {
        moves.push({ kind: "turn-face-up", cardInstanceId: faceDown.id });
    }
    for (const card of player.hand) {
        const actions = getLegalActions(state, player, card);
        if (actions.includes("play")) {
            moves.push({ kind: "play-land", cardInstanceId: card.id });
        }
        if (actions.includes("cast")) {
            moves.push(...enumerateCastMoves(state, player, card));
        }
    }
    // CR 305.9 — a land can be played from a NON-hand zone whenever an effect
    // grants the permission: the graveyard under `playsLandsFromGraveyard`
    // (Icetill Explorer / Crucible of Worlds / Ramunap Excavator, #1190), or
    // the TOP of the library under `playsLandsFromTopOfLibrary` (Courser of
    // Kruphix). Legality itself is unchanged — `getLegalActions` has always
    // returned "play" for these — but this enumerator only ever fed it HAND
    // cards, so the Bot could hold any of those permanents and never once use
    // the permission. The candidate SET is what was missing, not the rule.
    // Only lands are considered here: `getLegalActions` returns "play" for a
    // land and "cast" for everything else. The graveyard CAST mechanisms are
    // enumerated separately — retrace immediately below (issue #2358); the
    // others (Flashback, Escape, the broad/per-card/permanent permissions) are
    // NOT enumerated anywhere, a standing gap recorded in
    // docs/findings/2358-graveyard-cast-moves.md (the previous wording here
    // claimed they were "enumerated elsewhere"; there is no elsewhere).
    for (const card of player.graveyard) {
        if (!card.types.includes("Land")) continue;
        if (getLegalActions(state, player, card).includes("play")) {
            moves.push({ kind: "play-land", cardInstanceId: card.id });
        }
    }
    // CR 702.81a (issue #2358) — the RETRACE cast. A nonland card in the
    // player's own graveyard that currently has retrace is castable for its
    // printed mana cost plus discarding a land card, and without this loop the
    // Bot could hold Wrenn and Six's emblem and never once use it: the
    // candidate SET never included the graveyard for a CAST (only for a land
    // PLAY, above, and for graveyard-source activated abilities, below).
    //
    // Gated on `hasRetrace` FIRST, before `getLegalActions`: that function's
    // final "cast is for all non-land cards" fallback is zone-blind, so handing
    // it an arbitrary graveyard card reports "cast" for a spell the commit path
    // would then refuse to locate — the same trap the library-top branch below
    // documents. Scoped to retrace deliberately: the OTHER graveyard-cast
    // mechanisms (Flashback CR 702.34, Escape CR 702.138, the broad/specific/
    // permanent permissions) are equally missing from this enumerator, but that
    // is a pre-existing gap whose fix needs the sandbox executors to learn every
    // one of their stack flags — see docs/findings/2358-graveyard-cast-moves.md.
    for (const card of player.graveyard) {
        if (!hasRetrace(state, card)) continue;
        if (!getLegalActions(state, player, card).includes("cast")) continue;
        moves.push(
            ...enumerateCastMoves(state, player, card, {
                castFromZone: "graveyard",
            })
        );
    }
    // CR 601.3 (issue #2971) — every OTHER graveyard-cast mechanism. The gap
    // the two loops above document is closed here: Flashback (CR 702.34), the
    // broad player-wide permission (Yawgmoth's Will), the per-card grant
    // (Malcolm, Emry), a card's own intrinsic permission (Hogaak, CR 702.51)
    // and the once-per-turn permanent permission (Lurrus, CR 702.139). A Bot
    // holding six shipped flashback cards played none of them from the
    // graveyard, ever — `getLegalActions` returned "cast" for all of them, only
    // the candidate SET was missing.
    //
    // `graveyardCastMechanism` FIRST, `getLegalActions` second, for the same
    // fail-closed reason the retrace loop states: the gate's final "cast is for
    // all non-land cards" fallback is zone-blind and would report "cast" for a
    // graveyard card no mechanism permits, which `locateCastSource` then
    // refuses to locate.
    //
    // ESCAPE (CR 702.138) and a non-mana FLASHBACK cost used to be dropped here
    // by a `searchCanModelGraveyardCast` predicate, because the `cast-spell`
    // Move had no field for "exile N other cards from your graveyard" and an
    // escape cast priced as if the exile were free would park unpayable at the
    // real mutation. Both costs now ride on the Move
    // (`CastCostPicks.exileCostCardIds` / `.sacrificeIds`, issue #2980) and are
    // charged in both sandboxes, so the predicate is gone: the ONE remaining
    // fail-closed gate is `planCastCostPicks` returning `null` for a board that
    // cannot pay a leg, checked inside `enumerateCastMoves`.
    for (const card of player.graveyard) {
        const mechanism = graveyardCastMechanism(
            state,
            player,
            card,
            player.id
        );
        if (mechanism === undefined || mechanism === "retrace") continue;
        if (!getLegalActions(state, player, card).includes("cast")) continue;
        moves.push(
            ...enumerateCastMoves(state, player, card, {
                castFromZone: "graveyard",
            })
        );
    }
    // CR 601.3 (issue #2971) — a cast from EXILE. Scanned across EVERY player's
    // exile, not just this player's own: a grant may be CROSS-PLAYER (CR 400.7
    // — Dauthi Voidwalker's opponent-exile free cast, Robber of the Rich's
    // stolen top card, Elite Spellbinder handing the OWNER a taxed cast), so
    // the card sits in one player's zone while another holds the permission.
    // That is exactly the split `getLegalActions`' `casterId` parameter exists
    // for, so it is passed here.
    //
    // Lands are excluded: a land in exile under a play grant is PLAYED, never
    // cast (CR 305.9), and has its own enumeration
    // (`resolvePlayLandSourceZone`) — which is also what keeps a cast-only
    // grant on a land from being offered as either.
    for (const zoneOwner of state.players) {
        for (const card of zoneOwner.exile) {
            if (card.types.includes("Land")) continue;
            if (!exileCastPermission(card, player.id)) continue;
            if (
                !getLegalActions(
                    state,
                    zoneOwner,
                    card,
                    false,
                    player.id
                ).includes("cast")
            ) {
                continue;
            }
            moves.push(
                ...enumerateCastMoves(state, player, card, {
                    castFromZone: "exile",
                })
            );
        }
    }
    // Library: index 0 ONLY — the permission is positional and the rest of the
    // library is hidden (CR 400.2). Feeding the whole library here would leak
    // hidden information into the Bot's move set even though `getLegalActions`
    // would reject every other position.
    const libraryTop = player.library[0];
    if (
        libraryTop &&
        libraryTop.types.includes("Land") &&
        getLegalActions(state, player, libraryTop).includes("play")
    ) {
        moves.push({ kind: "play-land", cardInstanceId: libraryTop.id });
    }
    // CR 601.3 (issue #2398, Bolas's Citadel) — the SPELL half of the
    // same top-of-library permission. Index 0 ONLY, for the same
    // hidden-information reason as the land loop above. Without this the Bot
    // could hold Citadel and never once cast off the top: `getLegalActions`
    // has the branch, but the candidate SET never included the library.
    //
    // The permission is checked FIRST, before `getLegalActions`: that
    // function's final "cast is for all non-land cards" fallback is
    // zone-BLIND (only the land branch above it scopes itself to a zone), so
    // handing it an unpermissioned library card reports "cast" for the
    // printed mana cost — a move `locateCastSource` then refuses to resolve,
    // which surfaces as a search error rather than an illegal cast. Gating
    // here keeps the candidate set exactly the cards the permission covers.
    if (
        libraryTop &&
        !libraryTop.types.includes("Land") &&
        isCastableLibraryTopSpell(state, player, libraryTop.id) &&
        getLegalActions(state, player, libraryTop).includes("cast")
    ) {
        const lifeCost = libraryTopCastLifeCost(state, player, libraryTop);
        moves.push(
            ...enumerateCastMoves(state, player, libraryTop, {
                // Only pass the substitution when the permission actually
                // replaces the mana cost: a grant with no `manaCostReplacement`
                // (Vizier of the Menagerie's shape) casts for the printed cost,
                // which is exactly what `undefined` selects.
                ...(canCastSpellsFromTopOfLibrary(state, player)
                    ?.manaCostReplacement === "life-equal-to-mana-value"
                    ? { lifeInsteadOfMana: lifeCost }
                    : {}),
            })
        );
    }
    for (const perm of player.battlefield) {
        moves.push(...enumerateAbilityMoves(state, player, perm));
    }
    // CR 113.6 / 602.5b / 702.129a (issue #2339) — GRAVEYARD-source activated
    // abilities (Eternalize, Ashen Ghoul's reanimation). Only the graveyard's
    // OWNER may activate them (CR 602.1 "from YOUR graveyard"), so the
    // opponent's graveyard is deliberately not scanned. Until this issue the
    // enumerator skipped these abilities outright, which meant the bot could
    // never see one at all.
    for (const card of player.graveyard) {
        moves.push(
            ...enumerateAbilityMoves(state, player, card, {
                zone: "graveyard",
            })
        );
    }
    // CR 113.3c — "any player may activate" abilities (Ifh-Bíff Efreet) can be
    // fired off an OPPONENT's permanent. Enumerate only those there; the bot
    // still pays from its own pool (planManaPayment reads `player`).
    const opponent = otherPlayer(state, player.id);
    if (opponent) {
        for (const perm of opponent.battlefield) {
            moves.push(
                ...enumerateAbilityMoves(state, player, perm, {
                    anyPlayerOnly: true,
                })
            );
        }
    }
    // CR 113.1b (issue #2903) — PLAYER-level granted activated abilities
    // (Channel's "Pay 1 life: Add {C}."). Enumerated off `PlayerState
    // .grantedAbilities`, a storage location no permanent-scanning loop above
    // reaches; the grant is legal only for its holder, so only the acting
    // player's own grants are scanned (mirroring the graveyard loop's
    // "your own graveyard" scoping).
    moves.push(...enumerateGrantedAbilityMoves(state, player));
    // Dominance pruning (issue #1887). `pass` is `moves[0]` and is never a
    // probe candidate, so the floor can never be emptied — the filter can only
    // ever remove strictly-dominated alternatives.
    if (!options?.pruneDominatedNoOps) return moves;
    return moves.filter((m) => {
        if (!isProbeEligibleMove(state, playerId, m)) return true;
        if (!isDominatedNoOpMove(state, playerId, m)) return true;
        options.onPruned?.(m);
        return false;
    });
}
