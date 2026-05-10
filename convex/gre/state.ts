import type {
    AnimateSpec,
    CardType,
    DurationSpec,
    GameEvent,
    ManaCost as CardManaCost,
    MovableZone,
    PermanentFilter,
    SpellContext,
    TargetRequirement,
    TargetSelection,
} from "../cards/types";
import { getCardById, tryGetCardById } from "../cards";
import { getResolveFn } from "../cards/effectRegistry";
import type { Phase, Zone } from "./types";
import {
    getActivatedManaColor,
    getBasicLandMana,
    isAura,
    isDamageablePermanent,
    MANA_COLORS,
    PERMANENT_TYPES,
} from "./constants";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import { isProtectedFromSource } from "./protection";
import { randomInt, seededShuffle } from "./rng";
import { collectTriggers } from "./triggers";
import { getColorsFromCost } from "../cards/colors";

/** Stored form of a temporary-effect duration. Mirrors `DurationSpec` but
 *  with the symbolic `player` field resolved to a concrete `playerId` at
 *  creation time so purge at replay time is deterministic (CR 611.2).
 *
 *  A phase boundary matches when `state.phase === boundaryFor(phase)` AND
 *  (`playerId === undefined || playerId === state.activePlayerId`). On a
 *  match with `skip > 0`, skip decrements. On a match with `skip === 0`,
 *  the effect expires. */
export type Duration = {
    phase: "end-of-turn" | "end-of-combat";
    /** Number of matching boundaries still to skip. Undefined = 0. */
    skip?: number;
    /** Resolved at creation time. Undefined = any active player's boundary. */
    playerId?: string;
};

/** Converts a card-facing DurationSpec into the stored shape by resolving
 *  the symbolic `player` field against the effect's controller. */
export function resolveDuration(
    spec: DurationSpec,
    controllerId: string,
    state: GameState
): Duration {
    let playerId: string | undefined;
    if (spec.player === "controller") playerId = controllerId;
    else if (spec.player === "opponent")
        playerId = getOpponentId(state, controllerId);
    const duration: Duration = { phase: spec.phase };
    if (spec.skip !== undefined) duration.skip = spec.skip;
    if (playerId !== undefined) duration.playerId = playerId;
    return duration;
}

/** Returns the duration after one phase-boundary tick, or null if it has
 *  expired. Non-matching boundaries return the duration unchanged. The
 *  caller is responsible for splicing out expired entries and any side
 *  effects (e.g. removing granted keywords from `staticAbilities`). */
export function tickDuration(
    duration: Duration,
    view: { phase: Phase; activePlayerId: string }
): Duration | null {
    const boundary: Phase =
        duration.phase === "end-of-turn" ? "CLEANUP" : "END_OF_COMBAT";
    if (view.phase !== boundary) return duration;
    if (
        duration.playerId !== undefined &&
        duration.playerId !== view.activePlayerId
    ) {
        return duration;
    }
    const skip = duration.skip ?? 0;
    if (skip === 0) return null;
    const next: Duration = { ...duration, skip: skip - 1 };
    if (next.skip === 0) delete next.skip;
    return next;
}

// Re-export for consumers that imported from here previously
export { getBasicLandMana } from "./constants";

export type CardInstanceState = {
    id: string;
    /** Immutable reference to the original card definition. */
    card: Record<string, unknown>;
    controllerId: string;
    ownerId: string;
    zone: Zone;
    /** Mutable types — initialized from card definition, can be modified by effects. */
    types: CardType[];
    /** Mutable subtypes — initialized from card definition, can be modified by effects. */
    subtypes: string[];
    /** Mutable power — initialized from card definition for creatures. */
    power?: number;
    /** Mutable toughness — initialized from card definition for creatures. */
    toughness?: number;
    /** Keyword abilities (flying, vigilance, defender, etc.). Initialized from card definition. */
    staticAbilities: string[];
    isTapped: boolean;
    /** Mana choice made when activating a manaChoices ability (e.g. Birds of Paradise).
     *  Stored so untap can refund the exact mana that was added. Cleared at untap step. */
    chosenMana?: CardManaCost;
    /** Set when this land's mana has been consumed by a spell. Cannot be manually untapped. Resets at untap step. */
    manaCommitted?: boolean;
    /** Set when a creature enters the battlefield. Cleared at untap step. Prevents attacking. */
    isSummoningSick?: boolean;
    /** Set during combat when this creature is declared as attacker. Cleared at END_OF_COMBAT. */
    isAttacking?: boolean;
    /** Set during combat when this creature is declared as blocker. Cleared at END_OF_COMBAT. */
    isBlocking?: boolean;
    /** Set when the creature is declared as an attacker this turn (CR 506.2).
     *  Unlike isAttacking, this is not cleared at END_OF_COMBAT — it persists
     *  through to CLEANUP so end-step triggers like Berserk's delayed destroy
     *  ("if it attacked this turn") can see it. */
    hasAttackedThisTurn?: boolean;
    /** Set when the creature is declared as a blocker this turn. Mirrors
     *  `hasAttackedThisTurn`: persists past END_OF_COMBAT (which clears
     *  `isBlocking`) so end-of-combat triggers like Clockwork Beast's
     *  "if it attacked or blocked this combat" can see it. Cleared at
     *  CLEANUP. */
    hasBlockedThisTurn?: boolean;
    /** Keyword abilities granted for a limited duration (CR 113.1 / 611.1b).
     *  Each entry is also pushed to `staticAbilities` for read-time lookups
     *  (combat logic inspects `staticAbilities.includes("trample")`) and is
     *  spliced back out either when the parametric `duration` expires or,
     *  for grants sourced from an attached aura, when the aura leaves the
     *  battlefield. Exactly one of `duration` / `auraId` is set per entry. */
    grantedStaticAbilities?: {
        ability: string;
        duration?: Duration;
        /** Instance id of the aura that produced this grant (CR 303.4e).
         *  The entry is removed when the aura unattaches or leaves play. */
        auraId?: string;
    }[];
    /** Activated abilities granted to this permanent by a lord-style static
     *  effect (CR 113.1, 611). Each entry references an ability template on
     *  another card def — the template is looked up at activation time via
     *  `getCardById(sourceCardId).activatedAbilities`. The grant is keyed by
     *  `auraId` (the granting source's instance id) so it can be spliced out
     *  when the source leaves play. Used by Zombie Master ("Other Zombies
     *  have '{B}: Regenerate this creature.'"). */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
    }[];
    /** Damage marked on the creature this turn (CR 120.3). Accumulates across
     *  damage events; checked against effective toughness for lethal damage
     *  (CR 704.5g). Removed at CLEANUP (CR 514.2). */
    damageMarked?: number;
    /** Regeneration shields stacked on this permanent (CR 701.15a). Each shield
     *  is consumed once: the next time the permanent would be destroyed, the
     *  shield replaces the destroy with "remove all damage, tap, remove from
     *  combat" (CR 614.5, 506.4). Unused shields wear off at CLEANUP — the
     *  ability text says "this turn". */
    regenerationShields?: number;
    /** Instance ids of sources that dealt damage to this creature this turn
     *  (CR 120.3). Carried into the graveyard with the dying instance so
     *  "whenever another creature dies, if ~ dealt damage to it this turn"
     *  triggers (Sengir Vampire) can inspect the victim post-death. Cleared
     *  at CLEANUP (CR 514.2). */
    damagedBySources?: string[];
    /** Instance id of the permanent this card is attached to (CR 303.4b).
     *  Set on auras when they ETB. Cleared by SBA 704.5m when the host
     *  becomes illegal. Non-aura permanents leave this undefined. */
    attachedTo?: string;
    /** Stack of control-changing effects currently applied to this permanent
     *  (CR 613.1b, layer 2). Each entry records the aura that imposed the
     *  change and `previousControllerId` — whoever controlled the card right
     *  before that aura attached. Top-of-stack determines the current
     *  `controllerId`; when the stack is empty, control collapses to
     *  `ownerId` (CR 108.3, owners are immutable).
     *
     *  Layering: two CMs stacked on the same creature are resolved by
     *  timestamp — the latest-applied wins while present. Removing the top
     *  pops and restores the entry's `previousControllerId`. Removing a
     *  middle entry (an older CM destroyed while a newer one still applies)
     *  splices it out and patches the next entry's `previousControllerId`
     *  so a later pop still lands on the correct value. */
    controlChanges?: Array<{
        auraId: string;
        previousControllerId: string;
    }>;
    /** Temporary "becomes a creature" animation (CR 208.2, 611.1). Set by
     *  `animateAsCreature`; on expiry the engine restores the saved P/T
     *  and splices back out the types / subtypes that the animation added.
     *  `savedPower` / `savedToughness` capture the pre-animation values so
     *  the restore is exact even if later buffs changed `power` / `toughness`. */
    animation?: {
        savedPower: number | undefined;
        savedToughness: number | undefined;
        /** True if "Creature" was added to `types` by the animation. */
        addedCreatureType: boolean;
        /** Subtype added to `subtypes` by the animation (undefined if none
         *  or already present). Exactly one occurrence is spliced out on
         *  expiry. */
        addedSubtype?: string;
        duration: Duration;
    };
    /** Temporary P/T modifications scoped to a phase boundary (CR 611.1,
     *  611.2). Pushed by `addTemporaryPTBuff` ("until end of turn" /
     *  "until end of combat" pump effects). Each entry contributes additively
     *  to effective power/toughness at read time and is spliced out by
     *  `tickAllDurations` when its `duration` expires (CR 514.2, 511.3). */
    temporaryPTMods?: {
        power: number;
        toughness: number;
        duration: Duration;
    }[];
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d folds P/T-modifying types (+1/+1, +1/+0, ...) into effective
     *  stat reads. Mutated by `addCounter`/`removeCounter`. Cleared on
     *  hand/library moves via `resetBattlefieldTransientState`; preserved on
     *  graveyard/exile so post-death lookups can read the moment-of-death
     *  count. */
    counters?: Record<string, number>;
};

/** A one-shot damage prevention effect (CR 615.1, 615.6). The next time the
 *  given source would deal damage to `playerId`, that damage is prevented and
 *  this effect is consumed. An unconsumed effect is purged when its
 *  parametric `duration` expires. Used by Circle of Protection. */
export type PreventionEffect = {
    /** Id of the source permanent (on battlefield) or stack item whose next
     *  damage to `playerId` should be prevented. Matched against
     *  `sourceInstanceId` on damage events. */
    sourceInstanceId: string;
    /** The player whose incoming damage is prevented. */
    playerId: string;
    duration: Duration;
};

/** A reference to an activated ability template granted to a player by
 *  another card's effect (CR 113.1). Stores only ids — the actual ability
 *  is resolved at activation time via `getCardById(sourceCardId)`. */
export type GrantedAbilityInstance = {
    /** Unique instance id ("grant-N") generated from GameState.nextGrantSeq. */
    id: string;
    /** Card definition id whose `activatedAbilities[]` contains the template. */
    sourceCardId: string;
    /** The ability's id on that card definition. */
    abilityId: string;
    duration: Duration;
    /** Turn on which the grant was created; used for bookkeeping/debug. */
    grantedAtTurn: number;
};

export type PlayerState = {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    deck: Record<string, unknown>;
    hand: CardInstanceState[];
    library: CardInstanceState[];
    graveyard: CardInstanceState[];
    exile: CardInstanceState[];
    battlefield: CardInstanceState[];
    manaPool: Record<string, number>;
    /** Set when a player attempts to draw from an empty library (CR 704.5b). */
    hasDrawnFromEmpty?: boolean;
    /** Number of lands played by this player during the current turn
     *  (CR 305.2 / 117.2c). Reset to 0 at the start of each turn. */
    landsPlayedThisTurn?: number;
    /** Activated abilities granted by effects (e.g. Channel's "Pay 1 life:
     *  Add {C}." until end of turn). Each entry is a reference to a template
     *  on another card; duration controls when CLEANUP purges it. */
    grantedAbilities?: GrantedAbilityInstance[];
};

export type StackItem = CardInstanceState & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
    /** Value chosen for X at cast-time for spells with X in their cost
     *  (CR 107.3, 601.2b). Undefined for spells without X. Read on
     *  resolution by SpellContext.getX(). */
    chosenX?: number;
    /** If set, this stack item is an activated ability (not a spell). Source permanent stays on battlefield. */
    abilityId?: string;
    /** When the activated ability was GRANTED to the source by another card
     *  (CR 113.1, e.g. Zombie Master's "{B}: Regenerate this creature."), the
     *  template lives on the granting card's def, not on the source's own
     *  card def. Set to the granting card def id; resolveTopOfStack uses it
     *  to look up `activatedAbilities[abilityId]`. Undefined for native
     *  activated abilities. */
    grantedSourceCardId?: string;
    /** If set, this stack item is a triggered ability (CR 603). The source
     *  permanent stays on the battlefield; the trigger vanishes on resolution. */
    triggeredAbilityId?: string;
    /** Instance id of the source permanent that produced this trigger (the
     *  id on the battlefield, not the stack item id). Captured at trigger
     *  time; read by `SpellContext.sourceInstanceId` on resolution so the
     *  resolver can re-inspect the source (intervening-if, CR 603.4). */
    triggerSourceId?: string;
    /** The originating event captured at trigger time. Passed to resolve(). */
    triggerEvent?: GameEvent;
    /** If set, this stack item is a delayed triggered ability (CR 603.7a)
     *  queued by an earlier spell's resolution. The resolve function lives on
     *  `cardDef.delayedTriggers[triggerId]` and receives `delayedPayload`. */
    delayedTriggerId?: string;
    /** Serializable payload captured when the delayed trigger was scheduled.
     *  Holds instance / player ids so the trigger can look up live targets at
     *  fire time (CR 603.7a). */
    delayedPayload?: Record<string, string>;
    /** Resume checkpoint for a multi-step resolve (CR 608.3). Index into
     *  `CardDefinition.resolveSteps`. Advanced by the engine after a step
     *  completes without enqueueing pending choices. Undefined = start from
     *  step 0. */
    resolutionStep?: number;
    /** Player choices already collected during this resolution. Keyed by
     *  `${step}:${choiceId}` (e.g. "0:p1"). Read by `requestChoice` at resume
     *  to return prior selections without re-enqueueing them. */
    collectedChoices?: Record<string, string[]>;
};

/** A delayed triggered ability waiting to fire (CR 603.7a). Queued on
 *  `GameState.delayedTriggers` at spell resolution time and scanned whenever
 *  the trigger condition (e.g. "at the beginning of the next end step") is
 *  met. Holds only serializable data — resolve() lives on the card def and is
 *  looked up at fire time. */
export type DelayedTriggerInstance = {
    /** Unique id "delayed-N" from GameState.nextDelayedSeq. */
    id: string;
    /** Card def that owns the trigger template. */
    sourceCardId: string;
    /** id on `cardDef.delayedTriggers`. */
    triggerId: string;
    /** Controller of the delayed trigger (CR 113.7). */
    controller: string;
    /** When the trigger should fire. */
    timing: "next-end-step";
    /** Payload carried over from the scheduling spell's resolution. */
    payload: Record<string, string>;
};

/** Tracks an in-progress spell cast during the payment phase (CR 601.2). */
export type PendingCast = {
    playerId: string;
    cardInstanceId: string;
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
    /** If true, the caster wants priority back after their spell hits the stack
     *  (Ctrl-initiated cast). If false/undefined, the caster is auto-skipped. */
    keepPriority?: boolean;
    /** Value chosen for X at announce time. Propagated to the stack item. */
    chosenX?: number;
};

/** Tracks an in-progress activated-ability payment (CR 602.1, 602.2b).
 *  Mirrors PendingCast but for a battlefield source. The ability's tap /
 *  sacrifice costs are DEFERRED to commit time so cancellation reverts
 *  cleanly. Mana is paid incrementally by tapping lands, and commit pushes
 *  the ability on the stack (or resolves it for useStack: false). */
export type PendingActivation = {
    playerId: string;
    /** Source permanent on the battlefield. */
    cardInstanceId: string;
    /** Ability id on the source's card definition. */
    abilityId: string;
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
    /** True iff the ability has a {T} cost — applied at commit. */
    tapSource: boolean;
    /** True iff the ability has a sacrifice cost — applied at commit. */
    sacrificeSource: boolean;
    /** Counter-removal cost (CR 122.6 — "Remove a [type] counter from this
     *  creature"). Applied at commit. */
    removeCounterCost?: { type: string; count: number };
    /** Value chosen for X at activation announcement (CR 107.3 / 601.2b).
     *  Forwarded to the stack item at commit so resolve reads it via
     *  SpellContext.getX(). */
    chosenX?: number;
    /** Mirrors PendingCast.keepPriority. */
    keepPriority?: boolean;
    /** Targets chosen at target-selection time (CR 602.2b) and propagated to
     *  the stack item at commit. Empty/undefined for abilities without
     *  targetRequirement. */
    targets?: TargetSelection[];
    /** Source card def id when the ability was granted to the activator's
     *  permanent by another card (CR 113.1). Pipes through to StackItem so
     *  resolveTopOfStack reads the correct template. Undefined for native
     *  activated abilities. */
    grantedSourceCardId?: string;
};

/** Mid-resolution player choice requested by a spell/ability's resolve step
 *  (CR 608.2, 101.4). Enqueued by `SpellContext.requestChoice`; consumed by
 *  the `selectResolutionChoice` mutation. While one or more entries are
 *  present, priority is frozen and no other actions are legal — the engine
 *  is suspended between resolve steps. FIFO order encodes APNAP: the first
 *  entry is the choice currently awaiting input. */
export type PendingChoice = {
    /** Stack item whose resolve step enqueued this choice. */
    stackItemId: string;
    /** Resolution step index (into CardDefinition.resolveSteps) that enqueued
     *  the choice. Used with `choiceId` to key into
     *  `StackItem.collectedChoices` on resume. */
    step: number;
    /** Deterministic id within a step. Usually equals `playerId` — a step
     *  that enqueues multiple choices for the same player must disambiguate. */
    choiceId: string;
    /** Player who must make the choice. */
    playerId: string;
    /** Semantic kind — drives the UI prompt. "keep-permanents" = pick N
     *  permanents to keep on the battlefield (the rest are sacrificed by the
     *  step). "keep-hand" = pick N cards in hand to keep (the rest are
     *  discarded by the step). "may-pay" = optional yes/no answer with an
     *  optional mana cost paid on accept (Soul Net's "you may pay {1}",
     *  Verduran Enchantress's "may draw a card" — `cost` undefined for the
     *  cost-less variant). */
    kind:
        | "keep-permanents"
        | "keep-hand"
        | "search-library"
        | "mulligan-bottom"
        | "may-pay";
    /** Zone of the choosable items — restricts the set offered to the chooser.
     *  Undefined for choice kinds that don't pick from a zone (`may-pay`). */
    zone?: "battlefield" | "hand" | "library";
    /** Optional battlefield filter (card types / subtypes / keywords). Ignored
     *  for hand choices. */
    filter?: PermanentFilter;
    /** Exact number of items to pick. For `may-pay`, this is always 1 and the
     *  selection is the literal string "yes" or "no". */
    count: number;
    /** Ids already selected by the chooser. For `may-pay`, the entry is
     *  "yes" or "no" — committed by `submitMayPay`. */
    selected: string[];
    /** Prompt text shown to the chooser (e.g. "Choose 2 lands to keep"). */
    prompt: string;
    /** For `kind: "may-pay"`, the mana cost paid on accept (CR 117.3a /
     *  118.4). Undefined for cost-less yes/no choices ("may draw a card"). */
    cost?: ManaCost;
};

/** Tracks target selection for a spell being announced (CR 601.2c) or an
 *  activated ability with targets (CR 602.2b). */
export type PendingTarget = {
    playerId: string;
    /** For spells: id of the card being cast (in hand). For activated
     *  abilities (`kind: "ability"`): id of the permanent on the battlefield. */
    cardInstanceId: string;
    /** What kind of targets are needed (matches TargetRequirement.type). */
    targetType: TargetRequirement["type"];
    /** Fixed N, or a range for variable-target spells. Target selection ends
     *  automatically when selected.length === count (fixed) or the caller
     *  invokes confirmTargets with selected.length within [min, max]. */
    count: number | { min: number; max?: number };
    /** If set, restricts legal targets to sources of the given color
     *  (CR 202.2). Propagated from TargetRequirement.colorFilter. */
    colorFilter?: string;
    /** If set, restricts legal permanent targets by subtype (CR 205.3).
     *  Propagated from TargetRequirement.subtypeFilter. Match if the
     *  permanent's subtypes include at least one of these. */
    subtypeFilter?: string[];
    /** Zone the target lives in (CR 109.2). Default "battlefield" — set to
     *  "graveyard" for reanimation/recursion spells like Regrowth. Propagated
     *  from TargetRequirement.zone. */
    zone?: "battlefield" | "graveyard";
    /** Restricts targets by relationship to the chooser. Propagated from
     *  TargetRequirement.controller. Honored only when zone is non-default. */
    controller?: "you" | "opponent" | "any";
    /** Targets already selected. */
    selected: TargetSelection[];
    /** Mirrors PendingCast.keepPriority — propagated when the pending cast is created. */
    keepPriority?: boolean;
    /** Propagated from announceCast when the spell has X in its mana cost. */
    chosenX?: number;
    /** Distinguishes a spell cast (default) from an activated ability that
     *  requires targets (CR 602.2b). When "ability", `abilityId` is set and
     *  costs are paid at finalization instead of at announcement. */
    kind?: "cast" | "ability";
    /** For `kind: "ability"` only — id of the activated ability template on
     *  the source card definition. */
    abilityId?: string;
    /** For `kind: "ability"` only — set when the activated ability was granted
     *  to the source by another card (CR 113.1, e.g. Zombie Master granting
     *  "{B}: Regenerate ~" to other Zombies). The template is looked up via
     *  this card def id; the ability resolves with the source permanent as
     *  `ctx.sourceInstanceId`. Undefined for native activated abilities. */
    grantedSourceCardId?: string;
};

/** Pre-game mulligan tracking (CR 103.5, London mulligan). Present only while
 *  `phase === "MULLIGAN"`. After all players have locked in their opening hand
 *  and any required bottoming choices have resolved, this field is cleared and
 *  the engine advances to UNTAP / UPKEEP of turn 1. */
export type MulliganState = {
    /** Cumulative mulligans taken per player, parallel to `GameState.players`.
     *  Drives how many cards must be put on the bottom after the player keeps. */
    mulligansTaken: number[];
    /** Per-player declaration in the current round: "keep" | "mull" | null
     *  (null = not yet declared this round). Resets after each round executes. */
    declarations: ("keep" | "mull" | null)[];
    /** Per-player lock — once true, the player has chosen to keep and no
     *  further mulligans are allowed (CR 103.5). */
    locked: boolean[];
    /** Player currently expected to declare in the active round (sequential
     *  declarations in turn order from the starting player, CR 103.5). Empty
     *  string while bottoming. */
    declaringPlayerId: string;
    /** True once all players are locked. The engine has enqueued one
     *  `mulligan-bottom` PendingChoice per player with `mulligansTaken > 0`. */
    bottoming: boolean;
};

export type GameState = {
    players: PlayerState[];
    stack: StackItem[];
    turn: number;
    activePlayerId: string;
    priorityPlayerId: string;
    /** Number of consecutive priority passes (resets on any action). Resolves top of stack at 2. */
    passCount: number;
    phase: Phase;
    /** Seed for the per-game PRNG. Logged on GAME_INITIALIZED for replay. */
    rngSeed: number;
    /** Monotonic counter advanced by every consumption of randomness (shuffle,
     *  discard at random, coin flips). With rngSeed, the event log is
     *  sufficient to reproduce the exact random choices made during a game. */
    rngCounter: number;
    /** Active spell payment in progress (CR 601.2). */
    pendingCast?: PendingCast;
    /** Active activated-ability payment in progress (CR 602.1). Mutually
     *  exclusive with pendingCast. */
    pendingActivation?: PendingActivation;
    /** Active target selection in progress (CR 601.2c). */
    pendingTarget?: PendingTarget;
    /** Mid-resolution choices awaiting player input (CR 608.2, 101.4). FIFO:
     *  front entry is active. Non-empty blocks priority and further actions —
     *  the engine is suspended between resolve steps of the top stack item. */
    pendingChoices?: PendingChoice[];
    /** Player IDs that auto-pass priority for the rest of this turn. Resets on new turn. */
    autoPassPlayers?: string[];
    /** Player ID that auto-passes the very next time priority lands on them, then
     *  is cleared. Set when a player casts/activates without holding Ctrl so they
     *  don't waste a priority round responding to their own action (CR 117). */
    singleShotAutoPass?: string;
    /** Active combat state. Set at DECLARE_ATTACKERS, cleared at END_OF_COMBAT. */
    combat?: {
        attackerIds: string[];
        confirmed: boolean;
        /** blockerId → attackerId mapping. */
        blockerAssignments: Record<string, string>;
        /** Blocker currently being assigned by the defending player (visible to both clients). */
        pendingBlockerId?: string;
        blockersConfirmed: boolean;
        /** attackerId → ordered list of blocker IDs (set by attacking player after blockers declared, CR 510.1). */
        blockerOrder?: Record<string, string[]>;
        /** true once attacking player has confirmed the blocker ordering. */
        blockerOrderConfirmed?: boolean;
        /** attackerId → { blockerId/defenderId: damage } for damage distribution. */
        damageAssignments?: Record<string, Record<string, number>>;
        /** false = waiting for manual assignment, undefined = auto-applied or not yet at damage step. */
        damageConfirmed?: boolean;
    };
    /** Player who can undo the last mana ability activation. Cleared on any non-mana action. */
    undoableBy?: string;
    /** Monotonic counter advanced by each grantAbility() call. Used to
     *  generate deterministic `grant-N` ids for GrantedAbilityInstance so
     *  replays reproduce the same ids. */
    nextGrantSeq?: number;
    /** Pre-game mulligan tracking (CR 103.5). Set during init, cleared by
     *  `finalizeMulligan` when all opening hands are locked and any required
     *  bottoming choices have resolved. */
    mulligan?: MulliganState;
    /** Set when a player loses the game. Contains winner/loser info. */
    gameOver?: {
        winnerId: string;
        loserId: string;
        reason: "life" | "decked" | "concede";
    };
    /** Queue of player IDs scheduled to take an extra turn (CR 500.7).
     *  LIFO: pushed at the end, popped from the end — the last extra turn
     *  created is the next one taken. Consumed by advanceTurn(). */
    extraTurns?: string[];
    /** Active one-shot damage prevention effects (CR 615.1). Each effect is
     *  consumed the first time a matching (source, player) damage event
     *  occurs. Cleared at CLEANUP for "end-of-turn" effects (CR 514.2). */
    preventionEffects?: PreventionEffect[];
    /** Delayed triggered abilities awaiting their firing condition (CR 603.7a).
     *  Scanned at phase entry for matching `timing`. Each instance fires once
     *  then is spliced out. */
    delayedTriggers?: DelayedTriggerInstance[];
    /** Monotonic counter backing DelayedTriggerInstance.id generation. */
    nextDelayedSeq?: number;
    /** Buffer of game events emitted during the current action that have not
     *  yet been scanned for triggered abilities (CR 603.2). Filled by the
     *  state mutators (CREATURE_DIED on death, etc.) and drained by the
     *  caller (combat damage step, `resolveTopOfStack`) which runs
     *  `collectTriggers` and pushes any matching abilities onto the stack. */
    pendingEvents?: GameEvent[];
    /** Count of creatures that have died this turn. Incremented in
     *  `removePermanentTo` whenever a creature moves battlefield→graveyard;
     *  reset at turn start. Read by Scavenging Ghoul and similar
     *  count-based triggers. */
    deathsThisTurn?: number;
};

/** Returns true if a prevention effect matches (source, player) and consumes
 *  it. Called from every damage-dealing path (spell/ability, combat). */
export function consumePreventionIfAny(
    state: GameState,
    sourceInstanceId: string,
    playerId: string
): boolean {
    if (!state.preventionEffects || state.preventionEffects.length === 0) {
        return false;
    }
    const idx = state.preventionEffects.findIndex(
        (e) =>
            e.sourceInstanceId === sourceInstanceId && e.playerId === playerId
    );
    if (idx === -1) return false;
    state.preventionEffects.splice(idx, 1);
    if (state.preventionEffects.length === 0) {
        state.preventionEffects = undefined;
    }
    return true;
}

/** Resolves the top item of the stack (CR 608.3). Returns the resolved
 *  item, or `null` if the resolution was suspended awaiting mid-resolution
 *  player choices (CR 608.2, 101.4). Suspension leaves the item on the stack
 *  with `resolutionStep` checkpointed; callers must wait for pending choices
 *  to be submitted before re-invoking.
 *
 *  After a successful resolution, drains `state.pendingEvents` and pushes any
 *  matching triggered abilities (CR 603.2) onto the stack, restarting priority
 *  at the active player (CR 117.3c). Suspended resolutions skip the scan —
 *  events emitted partway through a stepped resolve are deferred to the
 *  resume call that completes the spell. */
export function resolveTopOfStack(state: GameState): StackItem | null {
    const result = resolveTopOfStackInner(state);
    if (result !== null) {
        processPendingActionTriggers(state);
    }
    return result;
}

/** Drains `state.pendingEvents`, scans for matching triggered abilities, and
 *  pushes them onto the stack (CR 603.2). Hands priority back to the active
 *  player (CR 117.3c) when at least one trigger lands on the stack. Safe to
 *  call repeatedly — a no-op when the queue is empty. */
export function processPendingActionTriggers(state: GameState): void {
    const events = flushPendingEvents(state);
    if (events.length === 0) return;
    const triggers = collectTriggers(state, events);
    if (triggers.length === 0) return;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

function resolveTopOfStackInner(state: GameState): StackItem | null {
    if (state.stack.length === 0) throw new Error("Stack is empty");

    const top = state.stack[state.stack.length - 1];
    const cardId = (top.card as { id?: string }).id;
    const cardDef = cardId ? getCardById(cardId) : undefined;
    const isSpell =
        !top.abilityId && !top.triggeredAbilityId && !top.delayedTriggerId;

    // --- Stepped spell resolve (CR 608.2, 101.4) ---
    // Peek-and-pop: the item stays on the stack while steps run so that
    // suspension between steps preserves it for resume. Only popped after
    // every step has completed without enqueueing pending choices.
    if (isSpell && cardDef?.resolveSteps && cardDef.resolveSteps.length > 0) {
        const start = top.resolutionStep ?? 0;
        for (let i = start; i < cardDef.resolveSteps.length; i++) {
            // Commit the current step index BEFORE running the step so that
            // `requestChoice` inside the step keys its collectedChoices
            // entries under the correct step. Without this, a replay after
            // advancing from step N to step N+1 would read stored choices
            // under the wrong key.
            top.resolutionStep = i;
            const ctx = buildSpellContext(state, top);
            cardDef.resolveSteps[i](ctx);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                return null; // suspended — wait for selectResolutionChoice
            }
        }
        // All steps completed — pop and finalize
        delete top.resolutionStep;
        delete top.collectedChoices;
        state.stack.pop();
        finalizeSpellResolution(state, top, cardDef);
        return top;
    }

    // --- Legacy pop-first paths (no stepping) ---
    const item = state.stack.pop() as StackItem;

    // Delayed triggered ability resolution (CR 603.7a). Resolver is looked
    // up on the scheduling card's def; payload carries ids captured at
    // scheduling time.
    if (item.delayedTriggerId && cardDef) {
        const trigger = cardDef.delayedTriggers?.find(
            (t) => t.id === item.delayedTriggerId
        );
        if (trigger) {
            const ctx = buildSpellContext(state, item);
            trigger.resolve(ctx, item.delayedPayload ?? {});
        }
        return item;
    }

    // Triggered ability resolution (CR 603.3). Source permanent stays on
    // battlefield; the trigger vanishes after resolve.
    if (item.triggeredAbilityId && cardDef && item.triggerEvent) {
        const ability = cardDef.triggeredAbilities?.find(
            (a) => a.id === item.triggeredAbilityId
        );
        if (ability) {
            const ctx = buildSpellContext(state, item);
            ability.resolve(ctx, item.triggerEvent);
        }
        return item;
    }

    // Activated ability resolution — execute effect and discard (CR 602.2).
    // For abilities granted by another card (CR 113.1), the template is read
    // from the granting card's `grantTemplates` via `grantedSourceCardId`.
    if (item.abilityId) {
        let ability;
        if (item.grantedSourceCardId) {
            const grantingDef = tryGetCardById(item.grantedSourceCardId);
            ability = grantingDef?.grantTemplates?.find(
                (a) => a.id === item.abilityId
            );
        } else {
            ability = cardDef?.activatedAbilities?.find(
                (a) => a.id === item.abilityId
            );
        }
        if (ability?.resolve) {
            const ctx = buildSpellContext(state, item);
            ability.resolve(ctx);
        }
        return item;
    }

    // Single-shot spell resolution (CR 608.2b). Resolve fn is resolved via
    // `getResolveFn` so cards declaring `effect: "<shorthand>"` are compiled
    // through the registry the same as imperative `resolve()` bodies.
    if (cardDef) {
        const resolveFn = getResolveFn(cardDef);
        if (resolveFn) {
            const ctx = buildSpellContext(state, item);
            resolveFn(ctx);
        }
    }
    finalizeSpellResolution(state, item, cardDef);
    return item;
}

/** Moves a resolved spell from the stack to its destination zone (CR 608.3
 *  for permanents, CR 608.2k for instants/sorceries). Extracted so both
 *  stepped and single-shot paths share the same transition. */
function finalizeSpellResolution(
    state: GameState,
    item: StackItem,
    cardDef:
        | {
              entersTapped?: boolean;
              entersWith?: {
                  counters?: { type: string; count: number | "X" }[];
              };
          }
        | undefined
): void {
    const isPermanent = item.types.some((t) =>
        PERMANENT_TYPES.includes(t as (typeof PERMANENT_TYPES)[number])
    );
    const controller = getPlayer(state, item.castById);

    if (isPermanent) {
        // CR 303.4: an Aura enters the battlefield attached to its target.
        // CR 608.2b: re-check target legality at resolution; if illegal, the
        // aura fizzles to the graveyard (CR 303.4i) instead of entering play.
        if (isAura(item)) {
            const target = item.targets?.[0];
            const host =
                target && target.type === "permanent"
                    ? findOnBattlefield(state, target.id)?.card
                    : null;
            const isLegalHost =
                host !== null &&
                host !== undefined &&
                isLegalAuraHost(host, item) &&
                // CR 702.16b: the target can't have acquired protection
                // matching the aura's color between cast and resolution.
                !isProtectedFromSource(host, item);
            if (!isLegalHost) {
                item.zone = "graveyard";
                getPlayer(state, item.ownerId).graveyard.push(item);
                return;
            }
            item.attachedTo = host.id;
        }
        item.zone = "battlefield";
        item.isTapped = cardDef?.entersTapped === true;
        if (item.types.includes("Creature")) {
            item.isSummoningSick = true;
        }
        controller.battlefield.push(item);
        // CR 122.1, 614.1c — apply ETB-counters before the layer system runs
        // so effective P/T reads include them immediately (Rock Hydra,
        // Clockwork Beast).
        const etbCounters = cardDef?.entersWith?.counters;
        if (etbCounters && etbCounters.length > 0) {
            const counters: Record<string, number> = {
                ...(item.counters ?? {}),
            };
            for (const entry of etbCounters) {
                const n =
                    entry.count === "X"
                        ? Math.max(0, item.chosenX ?? 0)
                        : entry.count;
                if (n <= 0) continue;
                counters[entry.type] = (counters[entry.type] ?? 0) + n;
            }
            if (Object.keys(counters).length > 0) item.counters = counters;
        }
        // CR 611.2 — first absorb any existing battlefield source's
        // keyword-grant effects that match this new permanent (e.g. Goblin
        // King's "Goblins have mountainwalk" reaches a Goblin entering after
        // the King). Then push out this permanent's own keyword-grants to
        // every matching permanent (aura → host via AURA_AFFECTS_HOST;
        // lord-style → all matching subtype/etc.).
        applyExistingGrantsTo(state, item);
        applySourceStaticEffects(state, item);
        if (isAura(item)) {
            // CR 613.1b layer 2 — apply any control-changing static effect
            // the aura declares (e.g. Control Magic). Runs after keyword
            // grants so both reads observe a consistent host.
            applyAuraControlChange(state, item);
        }
    } else {
        const owner = getPlayer(state, item.ownerId);
        item.zone = "graveyard";
        owner.graveyard.push(item);
    }
}

/** Applies every `keyword-grant` static effect declared on `source`'s card
 *  definition (CR 611) by scanning the whole battlefield and pushing the
 *  granted keyword into every permanent for which `applies(target, source)`
 *  returns true. For auras the canonical `AURA_AFFECTS_HOST` predicate
 *  narrows the match to a single host (CR 303.4e); lord-style sources like
 *  Goblin King ("other Goblins have mountainwalk") use a subtype-based
 *  predicate and grant the keyword to every matching permanent. The grant is
 *  recorded on each affected permanent's `grantedStaticAbilities` keyed by
 *  `source.id` so `unapplySourceStaticEffects` can splice it back out when
 *  the source leaves play. No-op if the source has no keyword-grant effects
 *  or no permanent matches its predicate. */
export function applySourceStaticEffects(
    state: GameState,
    source: CardInstanceState
): void {
    const cardId = (source.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : null;
    const effects = def?.staticEffects ?? [];
    if (effects.length === 0) return;
    for (const player of state.players) {
        for (const target of player.battlefield) {
            for (const effect of effects) {
                if (effect.kind === "keyword-grant") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    target.staticAbilities = [
                        ...target.staticAbilities,
                        effect.keyword,
                    ];
                    target.grantedStaticAbilities = [
                        ...(target.grantedStaticAbilities ?? []),
                        { ability: effect.keyword, auraId: source.id },
                    ];
                } else if (effect.kind === "activated-grant" && cardId) {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    target.grantedActivatedAbilities = [
                        ...(target.grantedActivatedAbilities ?? []),
                        {
                            sourceCardId: cardId,
                            abilityId: effect.abilityId,
                            auraId: source.id,
                        },
                    ];
                }
            }
        }
    }
}

/** Aura-flavored alias kept for back-compat at the call site that resolves an
 *  aura cast. Behaves identically to `applySourceStaticEffects`. */
export const applyAuraStaticEffects = applySourceStaticEffects;

/** Reverse of `applySourceStaticEffects`: walks the whole battlefield and
 *  splices out every grant whose `auraId` matches `source.id`. Call before
 *  the source transitions off the battlefield (destroy, exile, SBA detach,
 *  return to hand). Splices exactly one occurrence per granted keyword so
 *  native duplicates on a target are preserved (CR 113.1). */
export function unapplySourceStaticEffects(
    state: GameState,
    source: CardInstanceState
): void {
    for (const player of state.players) {
        for (const target of player.battlefield) {
            const grants = target.grantedStaticAbilities;
            if (grants && grants.length > 0) {
                const kept: typeof grants = [];
                for (const g of grants) {
                    if (g.auraId !== source.id) {
                        kept.push(g);
                        continue;
                    }
                    const idx = target.staticAbilities.indexOf(g.ability);
                    if (idx !== -1) {
                        target.staticAbilities = [
                            ...target.staticAbilities.slice(0, idx),
                            ...target.staticAbilities.slice(idx + 1),
                        ];
                    }
                }
                target.grantedStaticAbilities =
                    kept.length > 0 ? kept : undefined;
            }
            const activated = target.grantedActivatedAbilities;
            if (activated && activated.length > 0) {
                const keptA = activated.filter((g) => g.auraId !== source.id);
                target.grantedActivatedAbilities =
                    keptA.length > 0 ? keptA : undefined;
            }
        }
    }
}

/** Aura-flavored alias kept for back-compat. */
export const unapplyAuraStaticEffects = unapplySourceStaticEffects;

/** Applies every existing battlefield source's `keyword-grant` static effects
 *  to a newly-arrived permanent. Called from `finalizeSpellResolution` so
 *  lord-style buffs (Goblin King → mountainwalk on each Goblin) reach a
 *  Goblin that enters the battlefield AFTER the King is already in play.
 *  Skips the new permanent's own keyword-grants — those are applied via
 *  `applySourceStaticEffects(state, newPermanent)` separately. */
export function applyExistingGrantsTo(
    state: GameState,
    newPermanent: CardInstanceState
): void {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (source.id === newPermanent.id) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : null;
            const effects = def?.staticEffects ?? [];
            for (const effect of effects) {
                if (effect.kind === "keyword-grant") {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    newPermanent.staticAbilities = [
                        ...newPermanent.staticAbilities,
                        effect.keyword,
                    ];
                    newPermanent.grantedStaticAbilities = [
                        ...(newPermanent.grantedStaticAbilities ?? []),
                        { ability: effect.keyword, auraId: source.id },
                    ];
                } else if (effect.kind === "activated-grant" && cardId) {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    newPermanent.grantedActivatedAbilities = [
                        ...(newPermanent.grantedActivatedAbilities ?? []),
                        {
                            sourceCardId: cardId,
                            abilityId: effect.abilityId,
                            auraId: source.id,
                        },
                    ];
                }
            }
        }
    }
}

/** CR 303.4 / 702.5a: a host is legal if it satisfies the aura's enchant
 *  restriction. The restriction is read from the aura's `targetRequirement`
 *  — e.g. Control Magic enchants creatures, Steal Artifact enchants
 *  artifacts. Only `CardType` restrictions are supported; `player`/`any`/
 *  `spell` targets don't make sense for an aura. */
function isLegalAuraHost(
    host: CardInstanceState,
    aura: CardInstanceState
): boolean {
    const cardId = (aura.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : null;
    const req = def?.targetRequirement;
    if (!req) return false;
    const types = Array.isArray(req.type) ? req.type : [req.type];
    for (const t of types) {
        if (t === "player" || t === "any" || t === "spell" || t === "card")
            continue;
        if (host.types.includes(t)) return true;
    }
    return false;
}

/** Applies the first matching `control-change` static effect declared on
 *  `aura`'s card definition (CR 613.1b, layer 2). Pushes an entry onto the
 *  host's `controlChanges` stack, flips `controllerId` to the aura's
 *  controller, moves the host into that player's battlefield array so zone
 *  iteration stays consistent, and sets summoning sickness (CR 702.10c —
 *  continuity of control broke). No-op if the aura has no host, no
 *  control-change effect, or the host is already under the aura's
 *  controller. */
export function applyAuraControlChange(
    state: GameState,
    aura: CardInstanceState
): void {
    const hostId = aura.attachedTo;
    if (!hostId) return;
    const found = findOnBattlefield(state, hostId);
    if (!found) return;
    const cardId = (aura.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : null;
    const effects = def?.staticEffects ?? [];
    const applies = effects.some(
        (e) =>
            e.kind === "control-change" &&
            e.applies(found.card, aura, STATIC_EFFECT_CTX)
    );
    if (!applies) return;
    const newControllerId = aura.controllerId;
    if (found.card.controllerId === newControllerId) return;
    const stack = found.card.controlChanges ?? [];
    found.card.controlChanges = [
        ...stack,
        { auraId: aura.id, previousControllerId: found.card.controllerId },
    ];
    found.card.controllerId = newControllerId;
    if (found.card.types.includes("Creature")) {
        found.card.isSummoningSick = true;
    }
    found.player.battlefield.splice(found.idx, 1);
    getPlayer(state, newControllerId).battlefield.push(found.card);
}

/** Reverse of `applyAuraControlChange`. Removes this aura's entry from the
 *  host's `controlChanges` stack:
 *  - If it's the top entry: pop and restore `controllerId` to the entry's
 *    `previousControllerId`. When the stack becomes empty, the next CM to
 *    arrive will see `controllerId === ownerId` (CR 108.3); the collapse
 *    already happens because the entry popped here carries the owner for
 *    the first CM in the chain.
 *  - If it's a middle entry (an older CM destroyed while a newer one is
 *    still active): splice it out and patch the next entry's
 *    `previousControllerId` to match, so when that newer CM eventually
 *    pops it lands on the correct pre-chain value.
 *
 *  Resets summoning sickness whenever `controllerId` actually changes
 *  (CR 702.10c). No-op if the aura is not in the host's stack. */
export function unapplyAuraControlChange(
    state: GameState,
    aura: CardInstanceState
): void {
    const hostId = aura.attachedTo;
    if (!hostId) return;
    const found = findOnBattlefield(state, hostId);
    if (!found) return;
    const stack = found.card.controlChanges ?? [];
    const idx = stack.findIndex((e) => e.auraId === aura.id);
    if (idx === -1) return;
    const entry = stack[idx];
    const isTop = idx === stack.length - 1;
    if (!isTop) {
        // Middle removal: splice and patch the next entry so the chain's
        // "below me" pointer survives. controllerId does not change here.
        const patched = stack.slice();
        patched[idx + 1] = {
            ...patched[idx + 1],
            previousControllerId: entry.previousControllerId,
        };
        patched.splice(idx, 1);
        found.card.controlChanges = patched.length > 0 ? patched : undefined;
        return;
    }
    const restoredControllerId = entry.previousControllerId;
    const nextStack = stack.slice(0, -1);
    found.card.controlChanges = nextStack.length > 0 ? nextStack : undefined;
    if (found.card.controllerId === restoredControllerId) return;
    found.card.controllerId = restoredControllerId;
    if (found.card.types.includes("Creature")) {
        found.card.isSummoningSick = true;
    }
    found.player.battlefield.splice(found.idx, 1);
    getPlayer(state, restoredControllerId).battlefield.push(found.card);
}

/** Finds a card on any player's battlefield by instance id. */
function findOnBattlefield(
    state: GameState,
    cardId: string
): { card: CardInstanceState; player: PlayerState; idx: number } | null {
    for (const player of state.players) {
        const idx = player.battlefield.findIndex((c) => c.id === cardId);
        if (idx !== -1) return { card: player.battlefield[idx], player, idx };
    }
    return null;
}

/** Replacement-aware destroy (CR 614.5, 701.15a). If the permanent has at
 *  least one regeneration shield, consume one and apply the regen rider:
 *  remove all marked damage, tap it, and remove it from combat (CR 506.4).
 *  The permanent stays on the battlefield. Otherwise, route through
 *  `removePermanentTo` to the graveyard.
 *
 *  When `opts.cantBeRegenerated` is true (Wrath of God, Terror, etc.), the
 *  regeneration replacement is suppressed (CR 701.15c) — shields stay
 *  unspent and the permanent goes to the graveyard. Indestructible still
 *  protects (CR 702.12).
 *
 *  Returns true if the permanent was actually destroyed (sent to graveyard),
 *  false if a shield saved it. Callers that emit follow-up events on death
 *  (e.g. CREATURE_DIED) should gate on the return value.
 *
 *  No-op (returns false) if the id is not on the battlefield. */
export function regenerateOrDestroy(
    state: GameState,
    cardId: string,
    opts?: { cantBeRegenerated?: boolean }
): boolean {
    const found = findOnBattlefield(state, cardId);
    if (!found) return false;
    // CR 702.12 — permanents with indestructible can't be destroyed. Spell or
    // ability damage / "destroy" effects skip the graveyard move entirely; the
    // permanent stays on the battlefield with no replacement rider applied.
    // (A creature with indestructible and lethal damage marks survives — the
    // marked damage stays, but SBA 704.5g doesn't fire on it.)
    if (found.card.staticAbilities.includes("indestructible")) return false;
    const shields = found.card.regenerationShields ?? 0;
    if (shields > 0 && !opts?.cantBeRegenerated) {
        const next = shields - 1;
        if (next === 0) delete found.card.regenerationShields;
        else found.card.regenerationShields = next;
        // CR 701.15a — the regen rider: heal all marked damage, tap, and
        // remove from combat if attacking or blocking.
        if (found.card.damageMarked !== undefined) {
            delete found.card.damageMarked;
        }
        found.card.isTapped = true;
        const wasInCombat =
            found.card.isAttacking === true || found.card.isBlocking === true;
        if (found.card.isAttacking) found.card.isAttacking = undefined;
        if (found.card.isBlocking) found.card.isBlocking = undefined;
        if (wasInCombat && state.combat) {
            // Removing from combat (CR 506.4) — strip the creature from any
            // attacker/blocker bookkeeping so subsequent damage steps and
            // legality checks ignore it. Blockers that were assigned to this
            // attacker remain in combat unblocked (we don't auto-cascade,
            // CR 506.4d's "creatures stop being blocking" is rare and
            // out-of-scope for this minimal regen pass).
            state.combat.attackerIds = state.combat.attackerIds.filter(
                (id) => id !== cardId
            );
            if (state.combat.blockerAssignments[cardId] !== undefined) {
                const next = { ...state.combat.blockerAssignments };
                delete next[cardId];
                state.combat.blockerAssignments = next;
            }
        }
        return false;
    }
    removePermanentTo(state, cardId, "graveyard");
    return true;
}

/** Removes a permanent from battlefield and moves it to the target zone of its owner.
 *  When `toZone` is "hand" or "library", the card becomes a new object
 *  (CR 400.7) and battlefield-only transient state (tap, marked damage, regen
 *  shields, summoning sickness, combat flags, granted/animation state) is
 *  cleared so a later re-cast or reanimation re-enters cleanly. For
 *  graveyard/exile the historical state is preserved (e.g. `damagedBySources`
 *  is read post-death by Sengir-style triggers). */
export function removePermanentTo(
    state: GameState,
    cardId: string,
    toZone: "graveyard" | "exile" | "hand" | "library"
): void {
    const initial = findOnBattlefield(state, cardId);
    if (!initial) return;
    // CR 611.2 — a static effect from a source stops applying when the source
    // leaves the battlefield. Revert the grant(s) before the move so readers
    // never observe a dangling keyword. Auras additionally need their
    // control-change unapplied; non-aura hosts need any auras attached to
    // them reverted (orphan auras stay on the battlefield with stale
    // `attachedTo` and are swept by `checkAuraAttachmentSBA`, CR 704.5n).
    if (isAura(initial.card)) {
        unapplyAuraControlChange(state, initial.card);
        unapplySourceStaticEffects(state, initial.card);
    } else {
        unapplySourceStaticEffects(state, initial.card);
        unapplyAurasAttachedTo(state, cardId);
    }
    // Re-locate after unapply: a reversed control-change may have moved the
    // host between players' battlefield arrays, invalidating `initial.idx`.
    const found = findOnBattlefield(state, cardId);
    if (!found) return;
    const [creature] = found.player.battlefield.splice(found.idx, 1);
    const wasCreature = creature.types.includes("Creature");
    const snapshotControllerId = creature.controllerId;
    const snapshotDamagedBy = creature.damagedBySources ?? [];
    // CR 603.10 last known information — capture effective P/T before the
    // card leaves play so death triggers ("damage equal to that creature's
    // toughness") read the moment-of-death values. Layered buffs from sources
    // still on the battlefield are folded in here.
    const snapshotPower = wasCreature ? getEffectivePower(state, creature) : 0;
    const snapshotToughness = wasCreature
        ? getEffectiveToughness(state, creature)
        : 0;
    creature.zone = toZone;
    creature.attachedTo = undefined;
    if (toZone === "hand" || toZone === "library") {
        resetBattlefieldTransientState(creature);
    }
    const owner = getPlayer(state, creature.ownerId);
    (owner[toZone] as CardInstanceState[]).push(creature);
    // CR 700.4 — a creature "dies" when it's put into a graveyard from the
    // battlefield. Queued on `pendingEvents` so the caller can scan for
    // matching triggers (CR 603.2) once the current action settles.
    if (toZone === "graveyard" && wasCreature) {
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "CREATURE_DIED",
                creatureInstanceId: cardId,
                creatureControllerId: snapshotControllerId,
                damagedBySources: snapshotDamagedBy,
                creaturePower: snapshotPower,
                creatureToughness: snapshotToughness,
            },
        ];
        // Running tally of creatures that have died this turn. Read by
        // triggers like Scavenging Ghoul ("for each creature that died this
        // turn"). Reset at turn start (CR 514.2 — strictly speaking this is
        // bookkeeping derived from the event log, not an SBA).
        state.deathsThisTurn = (state.deathsThisTurn ?? 0) + 1;
    }
}

/** Emits a SPELL_CAST event for a freshly-pushed stack item (CR 601.2i).
 *  Reads the spell's card definition to derive types, subtypes, and colors
 *  so trigger predicates can filter without re-resolving the registry. */
export function emitSpellCastEvent(state: GameState, item: StackItem): void {
    const cardId = (item.card as { id?: string }).id;
    if (!cardId) return;
    const def = tryGetCardById(cardId);
    const colors = def?.manaCost ? getColorsFromCost(def.manaCost) : [];
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "SPELL_CAST",
            casterId: item.castById,
            spellInstanceId: item.id,
            spellCardId: cardId,
            spellTypes: item.types,
            spellSubtypes: item.subtypes,
            spellColors: colors,
        },
    ];
}

/** Drains the pending event queue, returning all queued events in FIFO order
 *  and clearing the buffer. Used by the engine after each action to feed
 *  `collectTriggers` (CR 603.2) and push any newly-matched triggered abilities
 *  onto the stack. */
export function flushPendingEvents(state: GameState): GameEvent[] {
    const out = state.pendingEvents ?? [];
    if (out.length === 0) return [];
    state.pendingEvents = undefined;
    return out;
}

/** Reverses every aura currently attached to `hostId` — keyword grants and
 *  control changes — without removing the auras themselves. Called when the
 *  host leaves the battlefield so the host doesn't carry dangling grants
 *  into its destination zone (CR 611.2). The orphan auras are left on the
 *  battlefield with stale `attachedTo` and are cleaned up by
 *  `checkAuraAttachmentSBA` (CR 704.5n). */
function unapplyAurasAttachedTo(state: GameState, hostId: string): void {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.attachedTo !== hostId) continue;
            if (!isAura(card)) continue;
            unapplyAuraControlChange(state, card);
            unapplyAuraStaticEffects(state, card);
        }
    }
}

/** CR 400.7 — when a card moves from the battlefield to a non-graveyard /
 *  non-exile zone (hand, library), it becomes a new object with no memory of
 *  its previous existence. Strips battlefield-only transient fields so the
 *  same instance, if it later returns to play, ETBs cleanly. */
function resetBattlefieldTransientState(card: CardInstanceState): void {
    card.isTapped = false;
    delete card.damageMarked;
    delete card.regenerationShields;
    delete card.isSummoningSick;
    delete card.isAttacking;
    delete card.isBlocking;
    delete card.hasAttackedThisTurn;
    delete card.hasBlockedThisTurn;
    delete card.damagedBySources;
    delete card.controlChanges;
    delete card.grantedStaticAbilities;
    delete card.grantedActivatedAbilities;
    delete card.animation;
    delete card.chosenMana;
    delete card.manaCommitted;
    delete card.counters;
    delete card.temporaryPTMods;
}

/** Predicate: does the card match every constraint in the filter? Omitted
 *  fields don't constrain (AND semantics). */
export function matchesPermanentFilter(
    card: CardInstanceState,
    filter: PermanentFilter
): boolean {
    if (filter.types !== undefined) {
        const types = Array.isArray(filter.types)
            ? filter.types
            : [filter.types];
        if (!types.some((t) => card.types.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subtypes = Array.isArray(filter.subtypes)
            ? filter.subtypes
            : [filter.subtypes];
        if (!subtypes.some((s) => card.subtypes.includes(s))) return false;
    }
    if (
        filter.requireAbility !== undefined &&
        !card.staticAbilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.excludeAbility !== undefined &&
        card.staticAbilities.includes(filter.excludeAbility)
    ) {
        return false;
    }
    return true;
}

/** Normalizes the polymorphic `destroyAll` argument into a filter object. */
function normalizeDestroyAllFilter(
    filter: CardType | CardType[] | PermanentFilter | undefined
): PermanentFilter {
    if (filter === undefined) return {};
    if (typeof filter === "string" || Array.isArray(filter)) {
        return { types: filter };
    }
    return filter;
}

/** Builds a SpellContext with primitives bound to the current game state. */
function buildSpellContext(state: GameState, item: StackItem): SpellContext {
    function requirePermanent(target: TargetSelection): CardInstanceState {
        const found = findOnBattlefield(state, target.id);
        if (!found) throw new Error(`Creature ${target.id} not on battlefield`);
        return found.card;
    }

    return {
        caster: item.castById,
        controller: item.castById,
        // Triggered abilities (CR 603) get a fresh stack-item id, but their
        // resolver needs to reference the originating permanent (e.g. for
        // intervening-if re-check at CR 603.4). `triggerSourceId` is captured
        // in `buildTriggerItem` for exactly this purpose.
        sourceInstanceId: item.triggerSourceId ?? item.id,
        targets: item.targets ?? [],
        allPlayerIds: state.players.map((p) => p.id),

        forEachPlayer(fn: (playerId: string) => void) {
            for (const p of state.players) fn(p.id);
        },

        dealDamage(target: TargetSelection, amount: number) {
            if (target.type === "player") {
                // CR 615.1: a prevention effect replaces the would-be damage
                // with nothing. Matched against the current stack item's id
                // (the spell/ability dealing the damage).
                if (consumePreventionIfAny(state, item.id, target.id)) return;
                getPlayer(state, target.id).life -= amount;
                state.pendingEvents = [
                    ...(state.pendingEvents ?? []),
                    {
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: item.id,
                        sourceControllerId: item.controllerId,
                        target,
                        amount,
                        isCombat: false,
                    },
                ];
            } else {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                // CR 120.3: damage can only be dealt to creatures, planeswalkers,
                // players and battles. Damage on any other permanent is a no-op.
                if (!isDamageablePermanent(found.card)) return;
                // CR 702.16e: any damage that would be dealt by sources with
                // the stated quality to a permanent with protection is
                // prevented. `item` is the stack item resolving (spell or
                // ability); its colors come from its mana cost (CR 202.2).
                if (isProtectedFromSource(found.card, item)) return;
                // CR 120.3: damage is marked on the creature and accumulates
                // until CLEANUP (CR 514.2). Lethal damage (CR 704.5g) is
                // applied inline using the post-accumulation marked total
                // compared to effective toughness (layer 7c).
                found.card.damageMarked =
                    (found.card.damageMarked ?? 0) + amount;
                found.card.damagedBySources = [
                    ...(found.card.damagedBySources ?? []),
                    item.id,
                ];
                state.pendingEvents = [
                    ...(state.pendingEvents ?? []),
                    {
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: item.id,
                        sourceControllerId: item.controllerId,
                        target,
                        amount,
                        isCombat: false,
                    },
                ];
                if (
                    found.card.damageMarked >=
                    getEffectiveToughness(state, found.card)
                ) {
                    // CR 704.5g lethal → regen shield gets a chance to
                    // replace the destroy (CR 614.5, 701.15a).
                    regenerateOrDestroy(state, target.id);
                }
            }
        },
        preventNextDamageFromSource(
            sourceInstanceId: string,
            playerId: string,
            duration: DurationSpec
        ): void {
            // CR 615.1, 615.6: "The next time a [source] would deal damage
            // to [player], prevent that damage." Stored as a one-shot
            // replacement effect and consumed by the first matching damage
            // event. `duration` scopes the unconsumed remainder.
            state.preventionEffects = [
                ...(state.preventionEffects ?? []),
                {
                    sourceInstanceId,
                    playerId,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        gainLife(playerId: string, amount: number) {
            getPlayer(state, playerId).life += amount;
        },
        loseLife(playerId: string, amount: number) {
            getPlayer(state, playerId).life -= amount;
        },
        getLife(playerId: string): number {
            return getPlayer(state, playerId).life;
        },
        getPower(target: TargetSelection): number {
            if (target.type === "player") return 0;
            const found = findOnBattlefield(state, target.id);
            return found ? getEffectivePower(state, found.card) : 0;
        },
        getToughness(target: TargetSelection): number {
            if (target.type === "player") return 0;
            const found = findOnBattlefield(state, target.id);
            return found ? getEffectiveToughness(state, found.card) : 0;
        },
        modifyPower(target: TargetSelection, amount: number): void {
            if (target.type === "player") return;
            const card = requirePermanent(target);
            card.power = (card.power ?? 0) + amount;
        },
        modifyToughness(target: TargetSelection, amount: number): void {
            if (target.type === "player") return;
            const card = requirePermanent(target);
            card.toughness = (card.toughness ?? 0) + amount;
        },
        // CR 611.1, 611.2: layered P/T modification scoped to a phase boundary.
        // Stored as a list on the card so the cleanup pass can splice each
        // entry out independently when its duration expires; effective P/T
        // reads sum these on top of base + static buffs.
        addTemporaryPTBuff(
            target: TargetSelection,
            power: number,
            toughness: number,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.temporaryPTMods = [
                ...(found.card.temporaryPTMods ?? []),
                {
                    power,
                    toughness,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        // CR 122.1: put `count` counters of `type` on the permanent. Stored
        // on the card itself so wire-format projection carries them; layer 7d
        // reads them at stat-lookup time for P/T-modifying types.
        addCounter(target: TargetSelection, type: string, count: number): void {
            if (count <= 0) return;
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const next = { ...(found.card.counters ?? {}) };
            next[type] = (next[type] ?? 0) + count;
            found.card.counters = next;
        },
        // CR 122.6: remove up to `count` counters of `type`. Returns the
        // number actually removed (clamped to current count).
        removeCounter(
            target: TargetSelection,
            type: string,
            count: number
        ): number {
            if (count <= 0) return 0;
            if (target.type !== "permanent") return 0;
            const found = findOnBattlefield(state, target.id);
            if (!found) return 0;
            const current = found.card.counters?.[type] ?? 0;
            if (current === 0) return 0;
            const removed = Math.min(count, current);
            const remaining = current - removed;
            const next = { ...(found.card.counters ?? {}) };
            if (remaining === 0) delete next[type];
            else next[type] = remaining;
            found.card.counters =
                Object.keys(next).length > 0 ? next : undefined;
            return removed;
        },
        getCounterCount(target: TargetSelection, type: string): number {
            if (target.type !== "permanent") return 0;
            const found = findOnBattlefield(state, target.id);
            if (!found) return 0;
            return found.card.counters?.[type] ?? 0;
        },
        getDeathsThisTurn(): number {
            return state.deathsThisTurn ?? 0;
        },
        getController(target: TargetSelection): string {
            if (target.type === "player") return target.id;
            return requirePermanent(target).controllerId;
        },
        getIsTapped(target: TargetSelection): boolean {
            if (target.type === "player") return false;
            const found = findOnBattlefield(state, target.id);
            return found ? found.card.isTapped : false;
        },
        destroy(
            target: TargetSelection,
            opts?: { cantBeRegenerated?: boolean }
        ): boolean {
            if (target.type === "player")
                throw new Error("Cannot destroy a player");
            // CR 614.5 / 701.15a — destroy is the canonical replacement
            // hook for regeneration shields. `cantBeRegenerated` suppresses
            // that replacement (CR 701.15c, e.g. Terror, Wrath of God).
            // Return value reports whether the permanent actually moved to
            // the graveyard (false if a shield saved it, indestructible
            // protected it, or the target had already left play).
            return regenerateOrDestroy(state, target.id, opts);
        },
        exile(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot exile a player");
            removePermanentTo(state, target.id, "exile");
        },
        // CR 701.10: to return a permanent to its owner's hand. Routed through
        // removePermanentTo so aura cleanup (611.2) and transient-state reset
        // (400.7) happen in the right order. No-op if already off-battlefield
        // (CR 608.2b).
        returnToHand(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot return a player to hand");
            removePermanentTo(state, target.id, "hand");
        },
        // CR 701.20a: to tap a permanent is to turn it sideways from an
        // untapped position. Already-tapped permanents are unaffected.
        // Silently no-ops if the target has left the battlefield (CR 608.2b).
        tap(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot tap a player");
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.isTapped = true;
        },
        // CR 701.20b: to untap a permanent is to rotate it back to upright.
        // Already-untapped permanents are unaffected. Silently no-ops if the
        // target has left the battlefield (CR 608.2b).
        untap(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot untap a player");
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.isTapped = false;
        },
        destroyAll(
            filter?: CardType | CardType[] | PermanentFilter,
            opts?: { cantBeRegenerated?: boolean }
        ): void {
            const normalized = normalizeDestroyAllFilter(filter);
            const ids: string[] = [];
            for (const player of state.players) {
                for (const card of player.battlefield) {
                    if (matchesPermanentFilter(card, normalized)) {
                        ids.push(card.id);
                    }
                }
            }
            for (const id of ids) {
                // Each victim independently gets a chance to consume a
                // regeneration shield (CR 614.5, 701.15a) — unless the caller
                // opts out via `cantBeRegenerated` (CR 701.15c).
                regenerateOrDestroy(state, id, opts);
            }
        },
        // CR 121.1: cards are drawn one at a time. Stops if the library empties
        // (CR 704.5b: hasDrawnFromEmpty flagged by drawCard; SBA ends the game).
        drawCards(playerId: string, amount: number): void {
            const player = getPlayer(state, playerId);
            for (let i = 0; i < amount; i++) {
                if (drawCard(player) === null) break;
            }
        },
        // CR 400.7: general zone-change primitive. Iterates over a snapshot
        // of source ids so moveCard's splice doesn't perturb iteration.
        moveZone(playerId: string, from: MovableZone, to: MovableZone): void {
            if (from === to) return;
            const player = getPlayer(state, playerId);
            const fromField = ZONE_TO_FIELD[from];
            const ids = (player[fromField] as CardInstanceState[]).map(
                (c) => c.id
            );
            for (const id of ids) moveCard(player, id, from, to);
        },
        moveCardById(
            playerId: string,
            cardInstanceId: string,
            from: MovableZone,
            to: MovableZone
        ): void {
            if (from === to) return;
            const player = getPlayer(state, playerId);
            const fromField = ZONE_TO_FIELD[from];
            const exists = (player[fromField] as CardInstanceState[]).some(
                (c) => c.id === cardInstanceId
            );
            if (!exists) return;
            moveCard(player, cardInstanceId, from, to);
        },
        // CR 701.20: randomize a player's library. Uses the seeded PRNG so
        // replays reproduce the same ordering.
        shuffleLibrary(playerId: string): void {
            seededShuffle(state, getPlayer(state, playerId).library);
        },
        // CR 701.5a: to counter a spell is to remove it from the stack and put
        // it into its owner's graveyard. If the target is no longer on the
        // stack (already resolved/countered), this is a silent no-op — the
        // countering spell simply fails to find a legal target (CR 608.2b).
        counter(target: TargetSelection): void {
            if (target.type !== "spell") {
                throw new Error("counter() requires a spell target");
            }
            const idx = state.stack.findIndex((s) => s.id === target.id);
            if (idx === -1) return; // target no longer on stack — fizzle silently
            const [item] = state.stack.splice(idx, 1);
            const owner = getPlayer(state, item.ownerId);
            // Activated abilities are not cards: they just vanish (CR 701.5a, 113.7a).
            if (item.abilityId) return;
            item.zone = "graveyard";
            owner.graveyard.push(item);
        },
        discardAtRandom(playerId: string, amount: number): void {
            const player = getPlayer(state, playerId);
            const picks = Math.min(amount, player.hand.length);
            for (let i = 0; i < picks; i++) {
                const idx = randomInt(state, player.hand.length);
                moveCard(player, player.hand[idx].id, "hand", "graveyard");
            }
        },
        addMana(cost: CardManaCost): void {
            const player = getPlayer(state, item.castById);
            for (const [color, amount] of Object.entries(cost)) {
                if (color === "X" || typeof amount !== "number" || amount <= 0)
                    continue;
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        },
        getX(): number {
            return item.chosenX ?? 0;
        },
        // CR 120.1: damage divided evenly, rounded down, among target
        // creatures/players. E.g. 5 damage / 2 targets = 2 each (remainder
        // discarded). Empty targets list is a silent no-op.
        dealDividedDamage(
            targets: TargetSelection[],
            totalAmount: number
        ): void {
            if (targets.length === 0 || totalAmount <= 0) return;
            const per = Math.floor(totalAmount / targets.length);
            if (per <= 0) return;
            for (const target of targets) {
                this.dealDamage(target, per);
            }
        },
        // CR 120.3: damage is dealt simultaneously to every matching entity.
        // Snapshot creature ids before iterating — dealDamage may remove them
        // from the battlefield (SBA lethal) and players have not yet taken
        // damage at that moment.
        dealDamageToEach(
            amount: number,
            filter: {
                creatures?: boolean | Omit<PermanentFilter, "types">;
                players?: boolean;
            }
        ): void {
            if (amount <= 0) return;
            if (filter.creatures) {
                const spec: PermanentFilter = {
                    types: "Creature",
                    ...(typeof filter.creatures === "object"
                        ? filter.creatures
                        : {}),
                };
                const ids: string[] = [];
                for (const player of state.players) {
                    for (const card of player.battlefield) {
                        if (!isDamageablePermanent(card)) continue;
                        if (matchesPermanentFilter(card, spec)) {
                            ids.push(card.id);
                        }
                    }
                }
                for (const id of ids) {
                    this.dealDamage({ type: "permanent", id }, amount);
                }
            }
            if (filter.players) {
                for (const player of state.players) {
                    this.dealDamage({ type: "player", id: player.id }, amount);
                }
            }
        },
        // Grants an activated ability to a player for a limited duration
        // (CR 113.1). The ability is stored as a reference — the template is
        // looked up at activation time via getCardById. Used by Channel.
        grantAbility(
            playerId: string,
            sourceCardId: string,
            abilityId: string,
            duration: DurationSpec
        ): void {
            state.nextGrantSeq = (state.nextGrantSeq ?? 0) + 1;
            const instance: GrantedAbilityInstance = {
                id: `grant-${state.nextGrantSeq}`,
                sourceCardId,
                abilityId,
                duration: resolveDuration(duration, item.castById, state),
                grantedAtTurn: state.turn,
            };
            const player = getPlayer(state, playerId);
            player.grantedAbilities = [
                ...(player.grantedAbilities ?? []),
                instance,
            ];
        },
        // CR 500.7: extra turns are taken after the current turn. Multiple
        // extra turns created on the same turn stack LIFO — the last created
        // is the next taken. advanceTurn() pops from the end of the queue.
        takeExtraTurn(playerId: string): void {
            // Validate the target player exists (throws if not).
            getPlayer(state, playerId);
            state.extraTurns = [...(state.extraTurns ?? []), playerId];
        },
        // CR 113.1 / 611.1b: grants a keyword static ability for a limited
        // duration. The keyword is pushed to `staticAbilities` so combat
        // lookups (attacker.staticAbilities.includes("trample")) resolve
        // without any special casing; the grant is tracked separately so
        // the phase-boundary purge can splice the duplicate back out.
        grantStaticAbility(
            target: TargetSelection,
            ability: string,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.staticAbilities = [
                ...found.card.staticAbilities,
                ability,
            ];
            found.card.grantedStaticAbilities = [
                ...(found.card.grantedStaticAbilities ?? []),
                {
                    ability,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        // CR 208.2, 611.1: turns the target permanent into a creature with
        // the given base P/T and optional subtype for the duration. We
        // mutate the instance state directly so all existing readers
        // (layers, combat, SBAs) see the creature-ness without special
        // casing; the `animation` record tracks exactly what was added so
        // the phase-boundary purge can restore the original shape.
        //
        // Caveat: this does not currently re-trigger summoning sickness on
        // a permanent that entered this turn but wasn't a creature at ETB
        // (CR 302.1). Acceptable for Jade Statue whose typical play pattern
        // is "play on T_n, animate on T_{n+1}".
        animateAsCreature(target: TargetSelection, spec: AnimateSpec): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const card = found.card;
            if (card.animation) return; // already animated — one at a time
            const addedCreatureType = !card.types.includes("Creature");
            const addedSubtype =
                spec.subtype !== undefined &&
                !card.subtypes.includes(spec.subtype)
                    ? spec.subtype
                    : undefined;
            card.animation = {
                savedPower: card.power,
                savedToughness: card.toughness,
                addedCreatureType,
                addedSubtype,
                duration: resolveDuration(spec.duration, item.castById, state),
            };
            if (addedCreatureType) {
                card.types = [...card.types, "Creature"];
            }
            if (addedSubtype !== undefined) {
                card.subtypes = [...card.subtypes, addedSubtype];
            }
            card.power = spec.power;
            card.toughness = spec.toughness;
        },
        // CR 603.7a: queues a delayed triggered ability. The template lives
        // on the scheduling card's def and is looked up by id when the
        // firing condition (e.g. END_STEP) is reached.
        scheduleDelayedTrigger(
            sourceCardId: string,
            triggerId: string,
            timing: "next-end-step",
            payload: Record<string, string>
        ): void {
            state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
            const instance: DelayedTriggerInstance = {
                id: `delayed-${state.nextDelayedSeq}`,
                sourceCardId,
                triggerId,
                controller: item.castById,
                timing,
                payload,
            };
            state.delayedTriggers = [
                ...(state.delayedTriggers ?? []),
                instance,
            ];
        },
        hasAttackedThisTurn(target: TargetSelection): boolean {
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            return found?.card.hasAttackedThisTurn === true;
        },

        // --- Mid-resolution choices (CR 608.2, 101.4) ---
        // See PendingChoice in this file for the suspension protocol.
        requestChoice(req): string[] | undefined {
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored;
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: req.playerId,
                kind: req.kind,
                zone: req.zone,
                count: req.count,
                selected: [],
                prompt: req.prompt,
            };
            if (req.filter) entry.filter = req.filter;
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        requestMayPay(req): boolean | undefined {
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored[0] === "yes";
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: req.playerId,
                kind: "may-pay",
                count: 1,
                selected: [],
                prompt: req.prompt,
            };
            if (req.cost) entry.cost = req.cost;
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        apNapOrder(): string[] {
            const order = [state.activePlayerId];
            for (const p of state.players) {
                if (p.id !== state.activePlayerId) order.push(p.id);
            }
            return order;
        },
        getLandCount(playerId: string): number {
            return getPlayer(state, playerId).battlefield.filter((c) =>
                c.types.includes("Land")
            ).length;
        },
        getCreatureCount(playerId: string): number {
            return getPlayer(state, playerId).battlefield.filter((c) =>
                c.types.includes("Creature")
            ).length;
        },
        getHandSize(playerId: string): number {
            return getPlayer(state, playerId).hand.length;
        },
        getBattlefieldIds(
            playerId: string,
            filter?: PermanentFilter
        ): string[] {
            const bf = getPlayer(state, playerId).battlefield;
            if (!filter) return bf.map((c) => c.id);
            return bf
                .filter((c) => matchesPermanentFilter(c, filter))
                .map((c) => c.id);
        },
        getHandIds(playerId: string): string[] {
            return getPlayer(state, playerId).hand.map((c) => c.id);
        },
        // CR 701.16: to sacrifice a permanent is for its controller to put
        // it into its owner's graveyard. Indestructible does not prevent
        // sacrifice (CR 701.16a). No-op if the id is not on the battlefield.
        sacrifice(cardInstanceId: string): void {
            removePermanentTo(state, cardInstanceId, "graveyard");
        },
        // CR 701.8: to discard a card is to move it from its owner's hand
        // into that player's graveyard. No-op if the card is no longer in
        // hand (e.g. already moved by a concurrent step).
        discardCard(playerId: string, cardInstanceId: string): void {
            const player = getPlayer(state, playerId);
            const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return;
            moveCard(player, cardInstanceId, "hand", "graveyard");
        },
        // CR 701.15a: stacks one regeneration shield on the target permanent.
        // The shield is consumed by the next destroy event on that permanent
        // (CR 614.5). Silent no-op if the target has left the battlefield
        // (CR 608.2b).
        applyRegenerationShield(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.regenerationShields =
                (found.card.regenerationShields ?? 0) + 1;
        },
        // CR 303.4b: an aura is attached to its host. Returns the host id, or
        // undefined if the source is not on the battlefield or not currently
        // attached (e.g. between resolve and ETB during projection edge cases).
        getAttachedTo(sourceInstanceId: string): string | undefined {
            const found = findOnBattlefield(state, sourceInstanceId);
            return found?.card.attachedTo;
        },
    };
}

const ZONE_TO_FIELD: Record<Exclude<Zone, "stack">, keyof PlayerState> = {
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
    graveyard: "graveyard",
    exile: "exile",
};

export function getPlayer(state: GameState, playerId: string): PlayerState {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
}

/** Returns the id of the other player (2-player game). */
export function getOpponentId(state: GameState, playerId: string): string {
    const opponent = state.players.find((p) => p.id !== playerId);
    if (!opponent) throw new Error("Opponent not found");
    return opponent.id;
}

/**
 * Draws the top card of a player's library to their hand (CR 121.1).
 * If the library is empty, marks hasDrawnFromEmpty (CR 704.5b) and returns null.
 */
export function drawCard(player: PlayerState): CardInstanceState | null {
    if (player.library.length === 0) {
        player.hasDrawnFromEmpty = true;
        return null;
    }
    return moveCard(player, player.library[0].id, "library", "hand");
}

/** Moves a card between player zones (not stack). Returns the moved card.
 *  Card is appended to the destination zone (library push = bottom, since
 *  drawCard reads from index 0). */
export function moveCard(
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack">,
    to: Exclude<Zone, "stack">
): CardInstanceState {
    const fromField = ZONE_TO_FIELD[from];
    const toField = ZONE_TO_FIELD[to];

    const sourceZone = player[fromField] as CardInstanceState[];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) {
        throw new Error(`Card ${cardInstanceId} not found in ${from}`);
    }

    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = to;

    const targetZone = player[toField] as CardInstanceState[];
    targetZone.push(card);

    return card;
}

/** Removes a card from a player zone and returns it. */
export function removeFromZone(
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack">
): CardInstanceState {
    const fromField = ZONE_TO_FIELD[from];
    const sourceZone = player[fromField] as CardInstanceState[];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) {
        throw new Error(`Card ${cardInstanceId} not found in ${from}`);
    }
    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = "stack";
    return card;
}

type ManaCost = Record<string, number | string | undefined>;

/** Checks if a player can pay a mana cost. Returns null if yes, or a description of what's missing. */
export function checkManaCost(
    manaPool: Record<string, number>,
    cost: ManaCost
): string | null {
    const pool = { ...manaPool };

    // Pay colored/colorless costs first
    for (const color of MANA_COLORS) {
        const required = (cost[color] as number | undefined) ?? 0;
        if (required > 0) {
            if ((pool[color] ?? 0) < required) {
                return formatManaCost(cost);
            }
            pool[color] = (pool[color] ?? 0) - required;
        }
    }

    // Pay generic cost with any remaining mana
    const generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) {
        let available = 0;
        for (const color of MANA_COLORS) {
            available += pool[color] ?? 0;
        }
        if (available < generic) {
            return formatManaCost(cost);
        }
    }

    return null;
}

/** Removes counters from `card` to satisfy a `removeCounter` activation cost
 *  (CR 122.6 / 602.1). Caller must validate availability beforehand —
 *  throws if the card has fewer counters than the cost requires. */
export function payRemoveCounterCost(
    card: CardInstanceState,
    cost: { type: string; count: number }
): void {
    const have = card.counters?.[cost.type] ?? 0;
    if (have < cost.count) {
        throw new Error("Not enough counters to pay activation cost");
    }
    const remaining = have - cost.count;
    const next = { ...(card.counters ?? {}) };
    if (remaining === 0) delete next[cost.type];
    else next[cost.type] = remaining;
    card.counters = Object.keys(next).length > 0 ? next : undefined;
}

/** Deducts mana cost from pool. Colored first, then generic (greedy: highest pool first). */
export function payManaCost(
    manaPool: Record<string, number>,
    cost: ManaCost
): void {
    // Pay colored/colorless costs
    for (const color of MANA_COLORS) {
        const required = (cost[color] as number | undefined) ?? 0;
        if (required > 0) {
            manaPool[color] = (manaPool[color] ?? 0) - required;
        }
    }

    // Pay generic with colors that have the most mana available
    let generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) {
        const sorted = [...MANA_COLORS].sort(
            (a, b) => (manaPool[b] ?? 0) - (manaPool[a] ?? 0)
        );
        for (const color of sorted) {
            const available = manaPool[color] ?? 0;
            const take = Math.min(available, generic);
            if (take > 0) {
                manaPool[color] -= take;
                generic -= take;
                if (generic === 0) break;
            }
        }
    }
}

/**
 * After paying a mana cost, mark tapped lands as committed so they can't be manually untapped.
 * For each color spent, finds tapped-but-uncommitted lands of that color and marks them.
 * Generic mana commits lands greedy (highest pool color first, matching payManaCost behavior).
 */
export function commitLandsForCost(
    player: PlayerState,
    cost: Record<string, number>
): void {
    const remaining = { ...cost };

    /** Returns the mana color a tapped source produces. Prefers chosenMana
     *  (set by tapUntap for choice-based abilities — e.g. dual lands and
     *  Birds of Paradise) so the correct color is matched against the cost.
     *  Falls back to intrinsic subtype mana or fixed activated ability. */
    const getManaColor = (card: CardInstanceState): string | null => {
        if (card.chosenMana) {
            for (const color of MANA_COLORS) {
                if (
                    ((card.chosenMana as Record<string, number>)[color] ?? 0) >
                    0
                ) {
                    return color;
                }
            }
        }
        return getBasicLandMana(card) ?? getActivatedManaColor(card);
    };

    // Commit mana sources for colored costs first
    for (const color of MANA_COLORS) {
        let needed = remaining[color] ?? 0;
        if (needed <= 0) continue;
        for (const card of player.battlefield) {
            if (needed <= 0) break;
            if (
                card.isTapped &&
                !card.manaCommitted &&
                getManaColor(card) === color
            ) {
                card.manaCommitted = true;
                needed--;
            }
        }
    }

    // Commit mana sources for generic cost (same greedy order as payManaCost)
    let generic = remaining.X ?? 0;
    if (generic > 0) {
        const sorted = [...MANA_COLORS].sort((a, b) => {
            const countA = player.battlefield.filter(
                (c) => c.isTapped && !c.manaCommitted && getManaColor(c) === a
            ).length;
            const countB = player.battlefield.filter(
                (c) => c.isTapped && !c.manaCommitted && getManaColor(c) === b
            ).length;
            return countB - countA;
        });
        for (const color of sorted) {
            for (const card of player.battlefield) {
                if (generic <= 0) break;
                if (
                    card.isTapped &&
                    !card.manaCommitted &&
                    getManaColor(card) === color
                ) {
                    card.manaCommitted = true;
                    generic--;
                }
            }
            if (generic <= 0) break;
        }
    }
}

/** Converts a ManaCost (with possible string X) to a pure numeric record.
 *  When the raw cost has `X: "X"`, the caster's chosen X value is folded into
 *  the generic portion of the cost (CR 107.3, 601.2b). Additional generic mana
 *  from cost modifiers (e.g. Fireball's "+{1} per extra target", CR 601.2f) is
 *  added on top of the generic portion.
 */
export function normalizeManaCost(
    cost: ManaCost,
    opts: { chosenX?: number; additionalGeneric?: number } = {}
): Record<string, number> {
    const result: Record<string, number> = {};
    let extraGeneric = opts.additionalGeneric ?? 0;
    for (const [key, val] of Object.entries(cost)) {
        if (key === "X" && typeof val === "string") {
            extraGeneric += opts.chosenX ?? 0;
            continue;
        }
        const n = typeof val === "number" ? val : 0;
        if (n > 0) result[key] = n;
    }
    if (extraGeneric > 0) {
        result.X = (result.X ?? 0) + extraGeneric;
    }
    return result;
}

/** Returns true if manaPool fully covers the normalized cost. */
export function isManaCostCovered(
    manaPool: Record<string, number>,
    cost: Record<string, number>
): boolean {
    const pool = { ...manaPool };

    // Check colored/colorless
    for (const color of MANA_COLORS) {
        const required = cost[color] ?? 0;
        if (required > 0) {
            if ((pool[color] ?? 0) < required) return false;
            pool[color] = (pool[color] ?? 0) - required;
        }
    }

    // Check generic
    const generic = cost.X ?? 0;
    if (generic > 0) {
        let available = 0;
        for (const color of MANA_COLORS) {
            available += pool[color] ?? 0;
        }
        if (available < generic) return false;
    }

    return true;
}

function formatManaCost(cost: ManaCost): string {
    const parts: string[] = [];
    const generic = (cost.X as number | undefined) ?? 0;
    if (generic > 0) parts.push(`${generic}`);
    for (const color of MANA_COLORS) {
        const n = (cost[color] as number | undefined) ?? 0;
        for (let i = 0; i < n; i++) parts.push(`{${color}}`);
    }
    return parts.join("") || "0";
}
