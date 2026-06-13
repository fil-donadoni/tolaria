import type {
    AnimateSpec,
    CardType,
    Color,
    DurationSpec,
    GameEvent,
    ManaCost as CardManaCost,
    MovableZone,
    PermanentFilter,
    PermanentView,
    SpellContext,
    StaticEffect,
    TargetRequirement,
    TargetSelection,
    TokenSpec,
    TriggerFizzledEvent,
} from "../cards/types";
import { registerTokenDefinition, tryGetCardById } from "../cards";
import { getResolveFn } from "../cards/effectRegistry";
import { matchesPermanentFilter } from "../cards/filters";
import type { Phase, Zone } from "./types";
import {
    getActivatedManaColor,
    getBasicLandMana,
    isAura,
    isDamageablePermanent,
    manaValue,
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
import {
    applyDamageReplacements,
    applyDiscardReplacements,
    applyLifeChangeReplacements,
    applyTransientDamageRedirections,
    describeDamageSource,
} from "./replacements";
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
    /** Reference to the card definition. Production constructions write only
     *  `{ id }` and rely on `getCardById` to hydrate the rest from the
     *  in-memory registry; token ids encode the full token shape (see
     *  `maybeSynthesizeToken`) so the same lookup also rehydrates tokens on
     *  the client. The looser `Record<string, unknown>` shape exists for
     *  legacy test fixtures that inline synthetic card metadata — engine
     *  code MUST NOT read any field other than `id`. */
    card: Record<string, unknown>;
    /** True for permanents created by token-creation effects (CR 111).
     *  The CR 704.5d state-based action wipes tokens out of any
     *  non-battlefield zone immediately after the move event has been
     *  observed. */
    isToken?: boolean;
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
    /** Mode chosen at cast time for modal permanents (CR 700.2c). Survives
     *  from the stack to the battlefield so the layer system can read
     *  mode-specific static effects (e.g. Phantasmal Terrain). */
    chosenModeId?: string;
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
    /** Keywords suppressed by a keyword-remove static effect (CR 613.1a
     *  layer 6). Each entry records the removed keyword and the source that
     *  removed it so `unapplySourceStaticEffects` can restore it. */
    removedKeywords?: { keyword: string; sourceId: string }[];
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
    /** Per-turn activation counter keyed by ability id (CR 602.5 — "activate
     *  this ability only once each turn"). Incremented on activation commit,
     *  reset at the active player's turn start. Read by the activation
     *  validator to enforce `ActivatedAbility.oncePerTurn`. */
    activationsThisTurn?: Record<string, number>;
    /** When set, the lethal-damage SBA exiles this creature instead of sending
     *  it to the graveyard (CR 614.1a — Disintegrate). Also incompatible with
     *  regeneration: the SBA path treats this identically to `cantBeRegenerated`.
     *  Transient — cleared at CLEANUP (CR 514.2). */
    exileOnDeath?: boolean;
    /** When set, the creature must attack this combat if able (CR 508.1d).
     *  Set by Nettling Imp's activated ability. Checked by combat enforcement
     *  in `mustAttack()`. Transient — cleared at CLEANUP (CR 514.2). */
    mustAttackThisTurn?: boolean;
    /** Tracks card types added by `StaticTypeAdd` effects (layer 4 surrogate
     *  — see `cards/types.ts` for the model's limits). One entry per
     *  `(auraId, type)` pair so multiple concurrent sources don't double-add
     *  and unapplying one source only removes the type when no other source
     *  still grants it. The `type` itself is also pushed into `types[]` at
     *  apply time so every existing `types.includes(...)` read observes the
     *  effect; `unapplySourceStaticEffects` removes from `types[]` once the
     *  last origin entry is gone, provided the type wasn't printed. */
    grantedTypes?: { type: string; auraId: string }[];
    /** Layer 4 subtype replacements (CR 305.7). Each entry records one
     *  source's override. The engine also snapshots `printedSubtypes` before
     *  the first replacement so unapply can restore them. When multiple
     *  sources overlap, the last entry's subtypes are the active ones. */
    grantedSubtypes?: { subtypes: string[]; sourceId: string }[];
    /** Layer 5 color grants (CR 305.7). Each entry records one source's
     *  granted colors. Used by Kormus Bell ("black creatures"). */
    grantedColors?: { color: string; sourceId: string }[];
    /** Original printed subtypes, snapshotted before the first subtype-set
     *  static effect overwrites `subtypes`. Undefined until a subtype-set
     *  effect fires. Used by `unapplySourceStaticEffects` to restore the
     *  printed value when the last grant is removed. */
    printedSubtypes?: string[];
    /** Temporary multi-block grant (CR 509.1a). When set, this creature can
     *  block up to 1 + canBlockAdditional attackers. 999 = "any number".
     *  Cleared at CLEANUP. Static multi-block (Two-Headed Giant) is read from
     *  the CardDefinition instead. */
    canBlockAdditional?: number;
    /** Transient flag: this creature must block every attacker it can this
     *  turn (Blaze of Glory). Cleared at CLEANUP. */
    mustBlockAllThisTurn?: boolean;
    /** Layer 5 color override (CR 305.7, 613.1d). When set, getColors()
     *  returns this array instead of mana-cost-derived + grantedColors.
     *  Set by lace instants ("target spell or permanent becomes [color]"). */
    colorOverride?: Color[];
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

/** A damage-prevention shield on a specific target (CR 615.1). Absorbs up to
 *  `remaining` damage from any source per event, decrementing as it consumes.
 *  An entry whose `remaining` reaches 0 is purged immediately. Unconsumed
 *  remainder wears off when `duration` expires. Used by Samite Healer,
 *  Conservator, and other prevent-N-to-target effects. */
export type TargetPreventionShield = {
    targetType: "permanent" | "player";
    targetId: string;
    remaining: number;
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
    /** Count of turns this player has taken so far in the game (CR 500.1).
     *  Starting player begins at 1 once UNTAP begins; the non-starting player
     *  reaches 1 when their first turn starts. Extra turns (CR 500.7)
     *  increment the recipient's counter normally. Distinct from
     *  `GameState.turn`, which is the global sequence number. */
    turnsTaken?: number;
    /** Activated abilities granted by effects (e.g. Channel's "Pay 1 life:
     *  Add {C}." until end of turn). Each entry is a reference to a template
     *  on another card; duration controls when CLEANUP purges it. */
    grantedAbilities?: GrantedAbilityInstance[];
    /** When true, this player's next turn is skipped entirely (CR 614.10).
     *  Checked and cleared by advanceTurn(). Set by Time Vault's untap ability. */
    skipNextTurn?: boolean;
    /** Override for this player's maximum hand size (CR 402.2). Absent means
     *  the default `MAX_HAND_SIZE` (7). `"unlimited"` represents the Library
     *  of Leng / Reliquary Tower clause "you have no maximum hand size";
     *  numeric values cover cards that set hand size to a specific count.
     *  Read by the cleanup discard step (CR 514.1) via
     *  `effectiveMaxHandSize`. */
    maxHandSizeOverride?: number | "unlimited";
};

export type StackItem = CardInstanceState & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
    /** Value chosen for X at cast-time for spells with X in their cost
     *  (CR 107.3, 601.2b). Undefined for spells without X. Read on
     *  resolution by SpellContext.getX(). */
    chosenX?: number;
    /** Mode id chosen at announcement for modal spells (CR 700.2). On
     *  resolution, dispatch lookups the matching entry in
     *  `card.modes` and runs `mode.resolve` instead of `card.resolve`. */
    chosenModeId?: string;
    /** Snapshot of the permanent sacrificed as an additional cost at
     *  announcement (CR 117.9 / 601.2f). Captured at commit and read at
     *  resolve via `SpellContext.getAdditionalSacrificeMv`. */
    additionalSacrificeSnapshot?: { cardInstanceId: string; mv: number };
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
    /** True iff this stack item is a COPY of a spell (CR 707.10, Fork). A
     *  copy is not a real card: when it finishes resolving it ceases to exist
     *  rather than moving to a graveyard (CR 707.10/112.5), and it can never
     *  return to a hand/library. Set by `SpellContext.copyStackItem`. */
    isCopy?: boolean;
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
    timing: "next-end-step" | "next-end-of-combat";
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
    /** Mode id chosen at announcement for modal spells (CR 700.2 / 700.2c).
     *  Undefined for non-modal spells. Propagated to the stack item. */
    chosenModeId?: string;
    /** In-progress additional cost picker (CR 117.9 / 601.2f). Set when the
     *  card has `additionalCosts.sacrificeFilter`. `pickedId` is undefined
     *  until the player calls `selectAdditionalCost`; commit is blocked
     *  while it is undefined regardless of mana coverage. On commit the
     *  picked permanent is sacrificed and its mana value is snapshotted on
     *  the resulting stack item. */
    additionalCost?: {
        kind: "sacrifice";
        filter: PermanentFilter;
        pickedId?: string;
    };
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

/** Choice family taxonomy (definitions in `gre/types.ts` to avoid an import
 *  cycle with `cards/types.ts`).
 *
 *  - `zone-pick`: chooser selects N items from a specified zone
 *    (`battlefield`/`hand`/`library`). All flow through
 *    `selectResolutionChoice`. Adding a new card semantic that picks from a
 *    zone? Add a single entry to `ZonePickKind`.
 *  - `yes-no`: a single boolean answer, optionally gated by a mana cost
 *    (paid via the regular cost-payment flow). Flows through `submitMayPay`.
 *  - `order`: chooser determines an ordered subset of cards (today only the
 *    mulligan bottom-N ordering). Flows through `submitMulliganBottomOrder`.
 *
 *  Adding a kind in a new family means a new submission mutation and a new
 *  family-specific assertion in `assertNoPendingChoices`. Adding a kind in an
 *  existing family means a single union member plus a label entry in the UI
 *  registry — `bun run check:all` catches missing labels at compile time via
 *  the exhaustive `Record<PendingChoiceKind, ...>` typing. */
import type {
    ZonePickKind,
    YesNoChoiceKind,
    OrderChoiceKind,
    PendingChoiceKind,
} from "./types";
export type {
    ZonePickKind,
    YesNoChoiceKind,
    OrderChoiceKind,
    PendingChoiceKind,
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
    /** Semantic kind — see {@link PendingChoiceKind} taxonomy. */
    kind: PendingChoiceKind;
    /** Owner of the zone being picked from. Defaults to `playerId` (the
     *  chooser picks from their own zone). Set explicitly when the chooser
     *  picks items from another player's zone — e.g. Demonic Hordes prompts
     *  the OPPONENT (chooser) to pick a Land from the CONTROLLER's
     *  battlefield to sacrifice. The UI uses `zoneOwnerId ?? playerId` to
     *  decide which battlefield receives click routing for the choice. */
    zoneOwnerId?: string;
    /** Zone of the choosable items — restricts the set offered to the chooser.
     *  Undefined for choice kinds that don't pick from a zone (`may-pay`). */
    zone?: "battlefield" | "hand" | "library";
    /** Optional battlefield filter (card types / subtypes / keywords). Ignored
     *  for hand choices. */
    filter?: PermanentFilter;
    /** Number of items to pick. Two shapes:
     *  - `number` (fixed N) — the chooser must select exactly N.
     *  - `{ min, max }` (range) — tactical zero-branch (ADR 0003 cap-style:
     *    `untap-pick` under Winter Orb / Smoke). Done button enables at
     *    `min`; client submits at most `max`. Use `getPendingChoiceMax` /
     *    `getPendingChoiceMin` to read either shape.
     *  For `may-pay`, this is always 1 (Pay / Skip). */
    count: number | { min: number; max: number };
    /** Prompt text shown to the chooser (e.g. "Choose 2 lands to keep"). */
    prompt: string;
    /** For `kind: "may-pay"`, the mana cost paid on accept (CR 117.3a /
     *  118.4). Undefined for cost-less yes/no choices ("may draw a card"). */
    cost?: ManaCost;
};

/** Reads the upper bound out of a `PendingChoice.count`, regardless of
 *  whether it's the fixed-N shape or the `{ min, max }` range shape. The
 *  commit threshold for `selectResolutionChoice` accumulation is always the
 *  max — picking past max is a contract violation. */
export function getPendingChoiceMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

/** Reads the lower bound out of a `PendingChoice.count`. For fixed-N
 *  choices min === count (the player must pick exactly N). For range
 *  choices min is the floor — typically 0 for cap-style restrictions where
 *  ADR 0003's "tactical zero-branch" applies (Winter Orb skip, Smoke skip). */
export function getPendingChoiceMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

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
    /** If set, restricts legal permanent targets by effective power
     *  (CR 613 layer 7c). Propagated from TargetRequirement.powerFilter.
     *  Both bounds inclusive. */
    powerFilter?: { min?: number; max?: number };
    /** If set, restricts legal permanent targets by effective toughness
     *  (CR 613 layer 7c). Propagated from TargetRequirement.toughnessFilter.
     *  Both bounds inclusive. */
    toughnessFilter?: { min?: number; max?: number };
    /** If set, excludes permanents whose subtypes include any of these
     *  (CR 205.3). Propagated from TargetRequirement.excludeSubtypes. */
    excludeSubtypes?: string[];
    /** Mana value range (CR 202.3). Propagated from TargetRequirement.mvFilter
     *  after resolving any `"X"` placeholders against the announced chosenX.
     *  Used by Spell Blast ("counter target spell with mana value X"). */
    mvFilter?: { min?: number; max?: number; equals?: number };
    /** Restricts legal SPELL targets by card type (CR 114.1). Propagated from
     *  TargetRequirement.spellTypeFilter. Used by Fork ("target instant or
     *  sorcery spell"). Ignored for non-spell target types. */
    spellTypeFilter?: CardType[];
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
    /** Mode id chosen at announcement for modal spells (CR 700.2 / 700.2c).
     *  Propagated through pendingCast → stack item. Determines which mode's
     *  `targetRequirement` governs this selection. */
    chosenModeId?: string;
    /** Distinguishes a spell cast (default) from an activated ability that
     *  requires targets (CR 602.2b). When "ability", `abilityId` is set and
     *  costs are paid at finalization instead of at announcement. When
     *  "copy-retarget", target selection re-points the targets of a spell
     *  COPY already on the stack (CR 707.10b — Fork's "you may choose new
     *  targets for the copy"); `cardInstanceId` holds the copy's stack id and
     *  finalization writes the chosen targets onto that stack item instead of
     *  casting anything. */
    kind?: "cast" | "ability" | "copy-retarget";
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
        /** blockerId → attackerIds mapping. Each blocker maps to the array of
         *  attackers it is blocking. Normally length 1; multi-block creatures
         *  (Two-Headed Giant, Blaze of Glory) may have 2+. */
        blockerAssignments: Record<string, string[]>;
        /** Blocker currently being assigned by the defending player (visible to both clients). */
        pendingBlockerId?: string;
        blockersConfirmed: boolean;
        /** sourceId → { targetId/defenderId: damage } for damage distribution.
         *  A source is any combat-damage dealer: an attacker (targets are its
         *  blockers / the defender on trample) or a blocker (targets are the
         *  band members it is blocking). Banding (CR 702.21) is the only thing
         *  that produces blocker sources with 2+ targets. */
        damageAssignments?: Record<string, Record<string, number>>;
        /** false = waiting for manual assignment, undefined = auto-applied or not yet at damage step. */
        damageConfirmed?: boolean;
        /** Attacking bands declared this combat (CR 702.21e). A band is a
         *  group of attacking creatures (1+ with banding, at most 1 without)
         *  that attacks as a unit and is blocked as a group. */
        bands?: { bandId: string; memberIds: string[] }[];
        /** sourceId → playerId responsible for assigning that source's combat
         *  damage this step. Normally the source's controller; banding
         *  (CR 702.21j-k) shifts authority to the controller of the banding
         *  creature(s) among the source's combat opponents. Only populated for
         *  sources that need a manual choice (2+ targets). */
        damageAssignerIds?: Record<string, string>;
        /** Player IDs that have confirmed their portion of the damage-
         *  assignment step. Combat damage applies once every distinct assigner
         *  in `damageAssignerIds` has confirmed. */
        damageAssignmentConfirmedBy?: string[];
    };
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
    /** Active damage-absorption shields on specific targets (CR 615.1).
     *  Decremented per damage event; entry purged at 0 or at `duration`
     *  expiry. Source-agnostic — any source's damage is reduced. */
    targetPreventionShields?: TargetPreventionShield[];
    /** Delayed triggered abilities awaiting their firing condition (CR 603.7a).
     *  Scanned at phase entry for matching `timing`. Each instance fires once
     *  then is spliced out. */
    delayedTriggers?: DelayedTriggerInstance[];
    /** Monotonic counter backing DelayedTriggerInstance.id generation. */
    nextDelayedSeq?: number;
    /** Monotonic counter advanced by each createToken() call. Generates
     *  deterministic `token-N` ids so replays reproduce the same identifiers. */
    nextTokenSeq?: number;
    /** Monotonic counter for card instance IDs. Each call to
     *  `allocInstanceId` increments this and returns the string form. */
    nextInstanceId?: number;
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
    /** Cumulative damage taken by each player this turn (CR 120.3 tally).
     *  Map `playerId → total damage`. Incremented every time damage actually
     *  lands on a player (after replacement / prevention / protection).
     *  Read by Simulacrum's "equal to the damage dealt to you this turn"
     *  clause. Reset at turn start. */
    damageDealtToPlayerThisTurn?: Record<string, number>;
    /** Transient one-shot damage redirections (CR 614). Distinct from
     *  permanent-bound `replacementEffects` (CardDefinition) — these are
     *  state-level shields produced by spells / activated abilities
     *  (Reverse Damage, Jade Monolith's {1}, Personal Incarnation's {0}).
     *  Each shield is consumed by a matching damage event. The unconsumed
     *  remainder is purged when `duration` expires. */
    damageRedirections?: DamageRedirection[];
    /** Per-player preferences that drive "may"-style replacement opt-ins.
     *  Persisted in state so the choice is replay-stable and toggleable
     *  through a mutation rather than requiring mid-event suspension.
     *  Empty / undefined means "accept the replacement" (the typical CR
     *  decision for Library of Leng-style cards). */
    playerPreferences?: Record<string, PlayerPreferences>;
    /** Resume cursor for a multi-restriction untap step (CR 502.1). Present
     *  only while `untapStep` is mid-processing — the dispatcher walks
     *  `StaticUntapRestriction` instances in deterministic order and
     *  enqueues an `untap-pick` `PendingChoice` per binding restriction;
     *  when the choice is committed, the engine re-enters `untapStep` and
     *  resumes from `restrictionCursor`. Cleared once every restriction is
     *  processed and the post-step untap+flag cleanup has run. */
    pendingUntapStep?: { restrictionCursor: number };
    /** Suspension marker for the cleanup-step mandatory discard (CR 514.1).
     *  Set when the active player's hand exceeds their maximum hand size at
     *  CLEANUP entry: the dispatcher enqueues a `discard-hand` `PendingChoice`
     *  (with `stackItemId: ""` — the same sentinel used by `untap-pick`) and
     *  parks this cursor so the commit handler knows it is closing out a
     *  cleanup discard rather than a spell-driven one (e.g. Disrupting
     *  Scepter). Cleared once the discards land and the remainder of CLEANUP
     *  (CR 514.2 — damage wipe, "until end of turn" expiry) runs. */
    pendingCleanupDiscard?: { playerId: string };
    /** When true, all combat damage is prevented this turn (CR 615, Fog).
     *  Checked at the top of `applyAllCombatDamage`; cleared at CLEANUP. */
    preventAllCombatDamageThisTurn?: boolean;
    /** One-shot damage-cap shields (Forcefield, CR 615). When an unblocked
     *  creature would deal combat damage to the shielded player, reduce to
     *  `maxDamage`. Consumed on first use; cleared at CLEANUP. */
    damageCapShields?: { playerId: string; maxDamage: number }[];
    /** Player protected by Island Sanctuary's draw-skip: can only be attacked
     *  by creatures with flying or islandwalk. Cleared at the start of that
     *  player's next turn (via advanceTurn). */
    islandSanctuaryProtection?: string;
    /** Player whose creatures must all attack this combat if able (CR 508.1d,
     *  Siren's Call). Checked in `getRequiredAttackerIds` alongside the
     *  per-creature `mustAttackThisTurn`. Cleared at CLEANUP. */
    allCreaturesMustAttack?: string;
};

/** Player-level replacement preferences. Each entry is opt-in: undefined
 *  means "use the replacement effect's default behavior" (typically the
 *  player accepts the redirect). Set `libraryOfLengRouting: "graveyard"`
 *  to bypass Library of Leng's discard replacement. */
export type PlayerPreferences = {
    /** Library of Leng (CR 614 discard → library top). Set to "graveyard"
     *  to opt OUT of the library-top reroute and let the discard go to the
     *  graveyard normally. Default "library" (Library of Leng activates). */
    libraryOfLengRouting?: "library" | "graveyard";
};

/** State-level transient damage replacement (CR 614). Three kinds cover the
 *  LEA reanimation / replacement subset:
 *
 *  - `prevent-from-source-gain-life`: source X's next damage to a chosen
 *    player is fully prevented; the player gains life equal to the
 *    prevented amount. Reverse Damage.
 *  - `to-self-redirect-to-owner`: the next N damage that would be dealt to
 *    a specific permanent is redirected to its owner. Personal
 *    Incarnation's `{0}` activated ability.
 *  - `from-source-to-permanent-redirect-to-player`: the next damage that
 *    source X would deal to a specific creature is dealt to a chosen
 *    player instead. Jade Monolith's `{1}` activated ability. */
export type DamageRedirection =
    | {
          kind: "prevent-from-source-gain-life";
          sourceInstanceId: string;
          playerId: string;
          duration: Duration;
      }
    | {
          kind: "to-self-redirect-to-owner";
          targetInstanceId: string;
          remaining: number;
          duration: Duration;
      }
    | {
          kind: "from-source-to-permanent-redirect-to-player";
          /** Source filter. `undefined` matches any source (Jade Monolith's
           *  oracle is "a source of your choice" but with no further
           *  re-target step at activation; the engine simplifies to "any
           *  source this turn" for the chosen creature). */
          sourceInstanceId?: string;
          targetInstanceId: string;
          redirectToPlayerId: string;
          /** Remaining charges. `1` = one-shot, decrements per match. */
          remaining: number;
          duration: Duration;
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

/** Reduces an incoming damage amount by any matching `targetPreventionShields`
 *  on `state` (CR 615.1). Shields are consumed in declaration order until the
 *  damage is fully absorbed or no shields remain. Returns the residual damage
 *  the caller should actually apply (0 = fully prevented). Mutates the shield
 *  list in place — entries reduced to 0 are spliced out, and the field is
 *  cleared when empty. */
export function applyTargetPrevention(
    state: GameState,
    targetType: "permanent" | "player",
    targetId: string,
    amount: number
): number {
    if (amount <= 0) return amount;
    const shields = state.targetPreventionShields;
    if (!shields || shields.length === 0) return amount;
    let remaining = amount;
    for (const s of shields) {
        if (remaining <= 0) break;
        if (s.targetType !== targetType) continue;
        if (s.targetId !== targetId) continue;
        const absorbed = Math.min(s.remaining, remaining);
        s.remaining -= absorbed;
        remaining -= absorbed;
    }
    state.targetPreventionShields = shields.filter((s) => s.remaining > 0);
    if (state.targetPreventionShields.length === 0) {
        state.targetPreventionShields = undefined;
    }
    return remaining;
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
    // Unknown ids (e.g. synthetic test fixtures) collapse to the vanilla
    // ETB-or-graveyard path. Production stack items always carry registry
    // ids, but tryGetCardById keeps the resolver robust either way.
    const cardDef = cardId ? (tryGetCardById(cardId) ?? undefined) : undefined;
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

    // --- Peek-and-pop for non-stepped paths ---
    // Run the resolve handler against the top of the stack without popping
    // first. If the handler suspends by enqueueing a pending choice (CR
    // 608.2 / 117.3a — e.g. `requestMayPay`, `requestChoice`), leave the
    // item on the stack so the resume mutations (`submitMayPay`,
    // `selectResolutionChoice`) can locate it via `stackItemId` and write
    // back `collectedChoices`. The next `resolveTopOfStack` call replays
    // the resolve which now reads the stored answer and runs to completion.

    // Delayed triggered ability resolution (CR 603.7a). Resolver is looked
    // up on the scheduling card's def; payload carries ids captured at
    // scheduling time.
    if (top.delayedTriggerId && cardDef) {
        const trigger = cardDef.delayedTriggers?.find(
            (t) => t.id === top.delayedTriggerId
        );
        if (trigger) {
            const ctx = buildSpellContext(state, top);
            trigger.resolve(ctx, top.delayedPayload ?? {});
            if ((state.pendingChoices?.length ?? 0) > 0) return null;
        }
        delete top.collectedChoices;
        state.stack.pop();
        return top;
    }

    // Triggered ability resolution (CR 603.3). Source permanent stays on
    // battlefield; the trigger vanishes after resolve.
    if (top.triggeredAbilityId && cardDef && top.triggerEvent) {
        const ability = cardDef.triggeredAbilities?.find(
            (a) => a.id === top.triggeredAbilityId
        );
        if (ability) {
            // CR 603.4d — intervening-if re-evaluation at resolution. If the
            // predicate is now false, the trigger fizzles: no `resolve`
            // invocation, item removed, TRIGGER_FIZZLED queued so downstream
            // triggers can react and the event log records the fizzle.
            if (ability.interveningIf && top.triggerSourceId) {
                // CR 603.10 LKI: locate the source wherever it lives. On the
                // battlefield `sourceCard.id` is the real instance id; off it
                // (graveyard-zone triggers like Nether Shadow) we fall back to
                // the stack item, whose `id` was reallocated — so pin the
                // identity to `triggerSourceId` instead.
                const located = findOnBattlefield(state, top.triggerSourceId);
                const sourceCard = located?.card ?? top;
                const selfView: PermanentView = {
                    id: located ? sourceCard.id : top.triggerSourceId,
                    controllerId: sourceCard.controllerId,
                    ownerId: sourceCard.ownerId,
                    types: sourceCard.types,
                    subtypes: sourceCard.subtypes,
                    isTapped: sourceCard.isTapped,
                    power: sourceCard.power,
                    toughness: sourceCard.toughness,
                    attachedTo: sourceCard.attachedTo,
                    counters: sourceCard.counters,
                    card: sourceCard.card as Record<string, unknown>,
                };
                if (!ability.interveningIf(top.triggerEvent, selfView, state)) {
                    const fizzleEvent: TriggerFizzledEvent = {
                        type: "TRIGGER_FIZZLED",
                        triggerSourceId: top.triggerSourceId,
                        triggeredAbilityId: top.triggeredAbilityId,
                        reason: "intervening-if-false",
                    };
                    state.pendingEvents = [
                        ...(state.pendingEvents ?? []),
                        fizzleEvent,
                    ];
                    delete top.collectedChoices;
                    state.stack.pop();
                    return top;
                }
            }
            const ctx = buildSpellContext(state, top);
            ability.resolve(ctx, top.triggerEvent);
            if ((state.pendingChoices?.length ?? 0) > 0) return null;
        }
        delete top.collectedChoices;
        state.stack.pop();
        return top;
    }

    // Activated ability resolution — execute effect and discard (CR 602.2).
    // For abilities granted by another card (CR 113.1), the template is read
    // from the granting card's `grantTemplates` via `grantedSourceCardId`.
    if (top.abilityId) {
        let ability;
        if (top.grantedSourceCardId) {
            const grantingDef = tryGetCardById(top.grantedSourceCardId);
            ability = grantingDef?.grantTemplates?.find(
                (a) => a.id === top.abilityId
            );
        } else {
            ability = cardDef?.activatedAbilities?.find(
                (a) => a.id === top.abilityId
            );
        }
        if (ability?.resolve) {
            const ctx = buildSpellContext(state, top);
            ability.resolve(ctx);
            if ((state.pendingChoices?.length ?? 0) > 0) return null;
        }
        delete top.collectedChoices;
        state.stack.pop();
        return top;
    }

    // Single-shot spell resolution (CR 608.2b). For modal spells (CR 700.2)
    // the chosen mode's resolve is dispatched instead of the card-level
    // resolve. The mode id was locked at announcement (CR 700.2c) and rides
    // through pendingCast → stack item.
    if (cardDef) {
        if (top.chosenModeId && cardDef.modes && cardDef.modes.length > 0) {
            const mode = cardDef.modes.find((m) => m.id === top.chosenModeId);
            if (mode?.resolve) {
                const ctx = buildSpellContext(state, top);
                mode.resolve(ctx);
                if ((state.pendingChoices?.length ?? 0) > 0) return null;
            }
        } else {
            const resolveFn = getResolveFn(cardDef);
            if (resolveFn) {
                const ctx = buildSpellContext(state, top);
                resolveFn(ctx);
                if ((state.pendingChoices?.length ?? 0) > 0) return null;
            }
        }
    }
    delete top.collectedChoices;
    state.stack.pop();
    finalizeSpellResolution(state, top, cardDef);
    return top;
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
            let host: CardInstanceState | undefined;

            if (target && target.type === "graveyard-card" && target.playerId) {
                // CR 303.4i — "enchant <card type> in a graveyard" auras
                // reanimate the target before attaching: the card is moved
                // from the named graveyard to the aura caster's battlefield,
                // then the aura attaches to the new permanent. Animate Dead
                // is the canonical example.
                const ownerPlayer = getPlayer(state, target.playerId);
                const idx = ownerPlayer.graveyard.findIndex(
                    (c) => c.id === target.id
                );
                if (idx !== -1) {
                    const [reanimated] = ownerPlayer.graveyard.splice(idx, 1);
                    putReanimatedOnBattlefield(
                        state,
                        reanimated,
                        item.castById
                    );
                    host = reanimated;
                }
            } else if (target && target.type === "permanent") {
                host = findOnBattlefield(state, target.id)?.card;
            }

            const isLegalHost =
                host !== undefined &&
                isLegalAuraHost(host, item) &&
                // CR 702.16b: the target can't have acquired protection
                // matching the aura's color between cast and resolution.
                !isProtectedFromSource(host, item);
            if (!isLegalHost || host === undefined) {
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
        // so effective P/T reads include them immediately (Clockwork Beast).
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
        // CR 603.6 — ETB notification for self-ETB triggers ("when ~ enters
        // the battlefield, ..."). Drained by `processPendingActionTriggers`
        // after this resolve completes.
        emitPermanentEntered(state, item);
    } else {
        // CR 707.10 / 112.5 — a copy of an instant/sorcery spell is not a real
        // card: once it finishes resolving it simply ceases to exist instead
        // of being put into a graveyard.
        if (item.isCopy) return;
        const owner = getPlayer(state, item.ownerId);
        item.zone = "graveyard";
        owner.graveyard.push(item);
    }
}

/** Emits PERMANENT_ENTERED for a card that has just been placed on the
 *  battlefield (CR 603.6). Snapshots last-known type info so the trigger
 *  matcher can filter without a registry lookup. */
export function emitPermanentEntered(
    state: GameState,
    card: { id: string; controllerId: string; types: CardType[]; card: unknown }
): void {
    const cardId = (card.card as { id?: string }).id;
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "PERMANENT_ENTERED",
            instanceId: card.id,
            controllerId: card.controllerId,
            cardId,
            types: [...card.types],
        },
    ];
}

/** Returns the effective static effects for a card, merging card-level and
 *  mode-level effects when a `chosenModeId` is present (CR 700.2c). */
function getEffectiveStaticEffects(
    def:
        | {
              staticEffects?: StaticEffect[];
              modes?: { id: string; staticEffects?: StaticEffect[] }[];
          }
        | null
        | undefined,
    chosenModeId: string | undefined
): StaticEffect[] {
    const cardEffects = def?.staticEffects ?? [];
    if (!chosenModeId || !def?.modes) return cardEffects;
    const mode = def.modes.find((m) => m.id === chosenModeId);
    const modeEffects = mode?.staticEffects ?? [];
    if (modeEffects.length === 0) return cardEffects;
    if (cardEffects.length === 0) return modeEffects;
    return [...cardEffects, ...modeEffects];
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
    const effects = getEffectiveStaticEffects(def, source.chosenModeId);
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
                } else if (effect.kind === "type-add") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const wasCreature = target.types.includes("Creature");
                    const origins = target.grantedTypes ?? [];
                    for (const type of effect.types) {
                        const already = origins.some(
                            (o) => o.auraId === source.id && o.type === type
                        );
                        if (already) continue;
                        origins.push({ type, auraId: source.id });
                        if (!target.types.includes(type as CardType)) {
                            target.types = [...target.types, type as CardType];
                        }
                    }
                    target.grantedTypes =
                        origins.length > 0 ? origins : undefined;
                    if (
                        !wasCreature &&
                        target.types.includes("Creature") &&
                        target.isSummoningSick === undefined
                    ) {
                        target.isSummoningSick = true;
                    }
                } else if (effect.kind === "color-grant") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const colorGrants = target.grantedColors ?? [];
                    for (const color of effect.colors) {
                        const already = colorGrants.some(
                            (g) => g.sourceId === source.id && g.color === color
                        );
                        if (!already) {
                            colorGrants.push({ color, sourceId: source.id });
                        }
                    }
                    target.grantedColors =
                        colorGrants.length > 0 ? colorGrants : undefined;
                } else if (effect.kind === "subtype-set") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    if (!target.printedSubtypes) {
                        target.printedSubtypes = [...target.subtypes];
                    }
                    const grants = target.grantedSubtypes ?? [];
                    const already = grants.some(
                        (g) => g.sourceId === source.id
                    );
                    if (!already) {
                        grants.push({
                            subtypes: effect.subtypes,
                            sourceId: source.id,
                        });
                    }
                    target.grantedSubtypes =
                        grants.length > 0 ? grants : undefined;
                    target.subtypes = [...effect.subtypes];
                } else if (effect.kind === "keyword-remove") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const idx = target.staticAbilities.indexOf(effect.keyword);
                    if (idx !== -1) {
                        target.staticAbilities = [
                            ...target.staticAbilities.slice(0, idx),
                            ...target.staticAbilities.slice(idx + 1),
                        ];
                        target.removedKeywords = [
                            ...(target.removedKeywords ?? []),
                            { keyword: effect.keyword, sourceId: source.id },
                        ];
                    }
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
            const types = target.grantedTypes;
            if (types && types.length > 0) {
                const removed = types.filter((g) => g.auraId === source.id);
                const kept = types.filter((g) => g.auraId !== source.id);
                target.grantedTypes = kept.length > 0 ? kept : undefined;
                if (removed.length > 0) {
                    // Strip each removed type from `types[]` only if no
                    // remaining origin still grants it AND it wasn't printed.
                    const targetCardId = (target.card as { id?: string }).id;
                    const def = targetCardId
                        ? tryGetCardById(targetCardId)
                        : undefined;
                    const printedTypes = (def?.types ?? []) as string[];
                    for (const r of removed) {
                        const stillGranted = kept.some(
                            (g) => g.type === r.type
                        );
                        if (stillGranted) continue;
                        if (printedTypes.includes(r.type)) continue;
                        target.types = target.types.filter((t) => t !== r.type);
                    }
                }
            }
            const subtypeGrants = target.grantedSubtypes;
            if (subtypeGrants && subtypeGrants.length > 0) {
                const kept = subtypeGrants.filter(
                    (g) => g.sourceId !== source.id
                );
                target.grantedSubtypes = kept.length > 0 ? kept : undefined;
                if (kept.length > 0) {
                    target.subtypes = [...kept[kept.length - 1].subtypes];
                } else {
                    target.subtypes = [
                        ...(target.printedSubtypes ?? target.subtypes),
                    ];
                    target.printedSubtypes = undefined;
                }
            }
            const colorGrants = target.grantedColors;
            if (colorGrants && colorGrants.length > 0) {
                const kept = colorGrants.filter(
                    (g) => g.sourceId !== source.id
                );
                target.grantedColors = kept.length > 0 ? kept : undefined;
            }
            const removals = target.removedKeywords;
            if (removals && removals.length > 0) {
                const kept: typeof removals = [];
                for (const r of removals) {
                    if (r.sourceId !== source.id) {
                        kept.push(r);
                        continue;
                    }
                    target.staticAbilities = [
                        ...target.staticAbilities,
                        r.keyword,
                    ];
                }
                target.removedKeywords = kept.length > 0 ? kept : undefined;
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
            const effects = getEffectiveStaticEffects(def, source.chosenModeId);
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
                } else if (effect.kind === "type-add") {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    const wasCreature = newPermanent.types.includes("Creature");
                    const origins = newPermanent.grantedTypes ?? [];
                    for (const type of effect.types) {
                        const already = origins.some(
                            (o) => o.auraId === source.id && o.type === type
                        );
                        if (already) continue;
                        origins.push({ type, auraId: source.id });
                        if (!newPermanent.types.includes(type as CardType)) {
                            newPermanent.types = [
                                ...newPermanent.types,
                                type as CardType,
                            ];
                        }
                    }
                    newPermanent.grantedTypes =
                        origins.length > 0 ? origins : undefined;
                    if (
                        !wasCreature &&
                        newPermanent.types.includes("Creature") &&
                        newPermanent.isSummoningSick === undefined
                    ) {
                        newPermanent.isSummoningSick = true;
                    }
                } else if (effect.kind === "color-grant") {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    const colorGrants = newPermanent.grantedColors ?? [];
                    for (const color of effect.colors) {
                        const already = colorGrants.some(
                            (g) => g.sourceId === source.id && g.color === color
                        );
                        if (!already) {
                            colorGrants.push({ color, sourceId: source.id });
                        }
                    }
                    newPermanent.grantedColors =
                        colorGrants.length > 0 ? colorGrants : undefined;
                } else if (effect.kind === "subtype-set") {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    if (!newPermanent.printedSubtypes) {
                        newPermanent.printedSubtypes = [
                            ...newPermanent.subtypes,
                        ];
                    }
                    const grants = newPermanent.grantedSubtypes ?? [];
                    const already = grants.some(
                        (g) => g.sourceId === source.id
                    );
                    if (!already) {
                        grants.push({
                            subtypes: effect.subtypes,
                            sourceId: source.id,
                        });
                    }
                    newPermanent.grantedSubtypes =
                        grants.length > 0 ? grants : undefined;
                    newPermanent.subtypes = [...effect.subtypes];
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
        if (
            t === "player" ||
            t === "any" ||
            t === "spell" ||
            t === "spell-or-permanent" ||
            t === "card"
        )
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

/** Increments the per-turn damage tally for `playerId` (CR 120.3). Called
 *  by every damage path after the damage actually lands (post replacement +
 *  prevention + protection). Read by Simulacrum's "equal to the damage
 *  dealt to you this turn" clause. */
export function bumpDamageDealtToPlayer(
    state: GameState,
    playerId: string,
    amount: number
): void {
    if (amount <= 0) return;
    const tally = { ...(state.damageDealtToPlayerThisTurn ?? {}) };
    tally[playerId] = (tally[playerId] ?? 0) + amount;
    state.damageDealtToPlayerThisTurn = tally;
}

/** Runs the CR 614 replacement layer for a damage event. Returns the
 *  rewritten target/amount (after every applicable replacement has been
 *  consulted in CR 616 order) or null if a replacement consumed the event.
 *  Shared by `SpellContext.dealDamage` and the combat damage steps so all
 *  damage paths go through the same redirection/cancel pipeline. */
export function runDamageReplacement(
    state: GameState,
    sourceInstanceId: string,
    sourceControllerId: string,
    target: TargetSelection,
    amount: number,
    isCombat: boolean
): { target: TargetSelection; amount: number } | null {
    const desc = describeDamageSource(state, sourceInstanceId);
    const continuous = applyDamageReplacements(state, {
        kind: "damage",
        sourceInstanceId,
        sourceControllerId,
        sourceColors: desc.colors,
        sourceTypes: desc.types,
        sourceStaticAbilities: desc.staticAbilities,
        target,
        amount,
        isCombat,
    });
    if (continuous === null) return null;
    const transient = applyTransientDamageRedirections(state, continuous);
    if (transient === null) return null;
    return { target: transient.target, amount: transient.amount };
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
    // CR 614.1a (Disintegrate) — exileOnDeath suppresses regeneration and
    // routes death to exile instead of graveyard.
    const exileOnDeath = found.card.exileOnDeath === true;
    const cantRegen = opts?.cantBeRegenerated || exileOnDeath;
    const shields = found.card.regenerationShields ?? 0;
    if (shields > 0 && !cantRegen) {
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
    removePermanentTo(state, cardId, exileOnDeath ? "exile" : "graveyard");
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
    // CR 603.10 last-known-information snapshot for PERMANENT_LEFT. Capture
    // attachedTo here because the aura cleanup below clears it on the
    // leaving card; LTB-triggers on the aura itself (Animate Dead) read this
    // payload to identify the host they need to sacrifice.
    const lkiAttachedTo = initial.card.attachedTo;
    const lkiTypes: ReadonlyArray<CardType> = [...initial.card.types];
    const lkiCardId = (initial.card.card as { id?: string }).id;
    const lkiWasAura = isAura(initial.card);
    const lkiOwnerId = initial.card.ownerId;
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
                creatureTypes: lkiTypes,
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
    // CR 603.10 — LTB notification for triggers that fire on the leaving
    // permanent itself ("when this Aura leaves the battlefield, ..."). The
    // matching trigger source is located by `collectTriggers` in `toZone`
    // via the `recentlyLeft` lookup, mirroring CREATURE_DIED.
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "PERMANENT_LEFT",
            instanceId: cardId,
            controllerId: snapshotControllerId,
            ownerId: lkiOwnerId,
            cardId: lkiCardId,
            types: lkiTypes,
            wasAura: lkiWasAura,
            attachedToBeforeLeave: lkiAttachedTo,
            toZone,
        },
    ];
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

/** Emits a PERMANENT_TAPPED event for a permanent that just transitioned from
 *  untapped to tapped (CR 701.20a). `forMana: true` marks the canonical
 *  "tapped for mana" condition (CR 605) read by Manabarbs / Mana Flare /
 *  Wild Growth; non-mana taps still emit so triggers like Lifetap fire. */
export function emitPermanentTapped(
    state: GameState,
    card: CardInstanceState,
    forMana: boolean,
    manaProduced?: CardManaCost
): void {
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "PERMANENT_TAPPED",
            permanentId: card.id,
            controllerId: card.controllerId,
            permanentTypes: [...card.types],
            permanentSubtypes: [...card.subtypes],
            forMana,
            ...(manaProduced ? { manaProduced } : {}),
        },
    ];
}

/** Removes any queued PERMANENT_TAPPED event for `permanentId`. Called by
 *  payment-rollback paths (untapForPayment, cancelCast, cancelActivation) so
 *  a tap that was undone before commit doesn't fire its triggers. */
export function discardPermanentTappedEvent(
    state: GameState,
    permanentId: string
): void {
    if (!state.pendingEvents) return;
    const filtered = state.pendingEvents.filter(
        (e) => !(e.type === "PERMANENT_TAPPED" && e.permanentId === permanentId)
    );
    state.pendingEvents = filtered.length === 0 ? undefined : filtered;
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
    delete card.removedKeywords;
    delete card.animation;
    delete card.chosenMana;
    delete card.manaCommitted;
    delete card.counters;
    delete card.temporaryPTMods;
    delete card.exileOnDeath;
    delete card.colorOverride;
}

/** Reanimation helper: drops a card that has been removed from its source
 *  zone onto `controllerId`'s battlefield. Mirrors the "non-Aura permanent"
 *  branch of `finalizeSpellResolution` so existing lord-grants reach the
 *  new permanent (CR 611.2) and the card's own keyword-grants reach the
 *  battlefield. Caller is responsible for removing the card from its
 *  origin zone (graveyard/exile) BEFORE invoking this so the move stays
 *  atomic. Used both by `returnToBattlefield` (Resurrection) and the
 *  graveyard-target aura branch (Animate Dead, CR 303.4i). */
function putReanimatedOnBattlefield(
    state: GameState,
    card: CardInstanceState,
    controllerId: string
): void {
    // CR 400.7 — zone change creates a new object: clear battlefield-only
    // transient state. Then re-establish the fresh-permanent defaults.
    resetBattlefieldTransientState(card);
    card.zone = "battlefield";
    card.controllerId = controllerId;
    card.attachedTo = undefined;
    if (card.types.includes("Creature")) {
        card.isSummoningSick = true;
    }
    getPlayer(state, controllerId).battlefield.push(card);
    // CR 611.2 first read: existing battlefield grants reach the newcomer
    // (Goblin King-style "Goblins have mountainwalk" still grants to a
    // Goblin reanimated under any controller).
    applyExistingGrantsTo(state, card);
    // CR 611.2 second read: the reanimated permanent's own static effects
    // push out to matching battlefield permanents (e.g. a reanimated
    // Goblin King re-grants mountainwalk to allied Goblins).
    applySourceStaticEffects(state, card);
    // CR 603.6 — ETB notification for self-ETB triggers, matching the
    // finalizeSpellResolution path so reanimated permanents behave like
    // freshly-cast ones for trigger purposes.
    emitPermanentEntered(state, card);
}

/** Single source of truth lives in `convex/cards/filters.ts` (ADR 0002).
 *  Re-exported here so existing call sites keep working. */
export { matchesPermanentFilter };

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

/** Content-derived id for a synthesized token CardDefinition (CR 707.1).
 *  Two `createToken` calls with the same spec shape share one definition
 *  entry (and thus one image / one frontend lookup); two specs that differ
 *  on any field get two distinct ids. Stable across replays. The optional
 *  9th segment is an `imagePrintId` (Scryfall UUID of a printed token) so
 *  the client lazy-synthesizer can recover the same image link without a
 *  separate registration call. */
function tokenDefinitionId(spec: TokenSpec): string {
    const parts = [
        spec.name,
        spec.types.join(","),
        (spec.subtypes ?? []).join(","),
        (spec.supertypes ?? []).join(","),
        spec.power ?? "",
        spec.toughness ?? "",
        (spec.colors ?? []).join(""),
        (spec.staticAbilities ?? []).join(","),
        spec.imagePrintId ?? "",
    ];
    return `token:${parts.join("|")}`;
}

/** Builds a SpellContext with primitives bound to the current game state. */
function buildSpellContext(state: GameState, item: StackItem): SpellContext {
    function requirePermanent(target: TargetSelection): CardInstanceState {
        const found = findOnBattlefield(state, target.id);
        if (!found) throw new Error(`Creature ${target.id} not on battlefield`);
        return found.card;
    }

    const ctx: SpellContext = {
        caster: item.castById,
        controller: item.castById,
        // Triggered abilities (CR 603) get a fresh stack-item id, but their
        // resolver needs to reference the originating permanent (e.g. for
        // intervening-if re-check at CR 603.4). `triggerSourceId` is captured
        // in `buildTriggerItem` for exactly this purpose.
        sourceInstanceId: item.triggerSourceId ?? item.id,
        targets: item.targets ?? [],
        allPlayerIds: state.players.map((p) => p.id),

        getAttachedToId(): string | undefined {
            const src = findOnBattlefield(
                state,
                item.triggerSourceId ?? item.id
            );
            return src?.card.attachedTo;
        },

        hasRemovedKeyword(permanentId: string, keyword: string): boolean {
            const found = findOnBattlefield(state, permanentId);
            return (
                found?.card.removedKeywords?.some(
                    (r) => r.keyword === keyword
                ) ?? false
            );
        },

        forEachPlayer(fn: (playerId: string) => void) {
            for (const p of state.players) fn(p.id);
        },

        dealDamage(target: TargetSelection, amount: number) {
            // CR 614 replacement effects run BEFORE CR 615 prevention. May
            // rewrite target (Simulacrum / Veteran Bodyguard / Personal
            // Incarnation redirect damage to themselves) or cancel
            // (Jade Monolith's activated redirect cancels by rewriting).
            const replaced = runDamageReplacement(
                state,
                item.id,
                item.controllerId,
                target,
                amount,
                false
            );
            if (replaced === null) return;
            target = replaced.target;
            amount = replaced.amount;
            if (target.type === "player") {
                // CR 615.1: a prevention effect replaces the would-be damage
                // with nothing. Matched against the current stack item's id
                // (the spell/ability dealing the damage).
                if (consumePreventionIfAny(state, item.id, target.id)) return;
                // CR 615.1: target-keyed prevention shields absorb up to N
                // damage per event regardless of source.
                const reduced = applyTargetPrevention(
                    state,
                    "player",
                    target.id,
                    amount
                );
                if (reduced <= 0) return;
                getPlayer(state, target.id).life -= reduced;
                bumpDamageDealtToPlayer(state, target.id, reduced);
                const desc = describeDamageSource(state, item.id);
                state.pendingEvents = [
                    ...(state.pendingEvents ?? []),
                    {
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: item.id,
                        sourceControllerId: item.controllerId,
                        target,
                        amount: reduced,
                        isCombat: false,
                        sourceColors: desc.colors,
                        sourceTypes: desc.types,
                        sourceSubtypes: desc.subtypes,
                        sourceStaticAbilities: desc.staticAbilities,
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
                const reduced = applyTargetPrevention(
                    state,
                    "permanent",
                    target.id,
                    amount
                );
                if (reduced <= 0) return;
                // CR 120.3: damage is marked on the creature and accumulates
                // until CLEANUP (CR 514.2). Lethal damage (CR 704.5g) is
                // applied inline using the post-accumulation marked total
                // compared to effective toughness (layer 7c).
                found.card.damageMarked =
                    (found.card.damageMarked ?? 0) + reduced;
                found.card.damagedBySources = [
                    ...(found.card.damagedBySources ?? []),
                    item.id,
                ];
                const desc = describeDamageSource(state, item.id);
                state.pendingEvents = [
                    ...(state.pendingEvents ?? []),
                    {
                        type: "DAMAGE_DEALT",
                        sourceInstanceId: item.id,
                        sourceControllerId: item.controllerId,
                        target,
                        amount: reduced,
                        isCombat: false,
                        sourceColors: desc.colors,
                        sourceTypes: desc.types,
                        sourceSubtypes: desc.subtypes,
                        sourceStaticAbilities: desc.staticAbilities,
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
        addDamageRedirectionShield(shield): void {
            const resolved = resolveDuration(
                shield.duration,
                item.castById,
                state
            );
            state.damageRedirections = [
                ...(state.damageRedirections ?? []),
                shield.kind === "prevent-from-source-gain-life"
                    ? {
                          kind: "prevent-from-source-gain-life",
                          sourceInstanceId: shield.sourceInstanceId,
                          playerId: shield.playerId,
                          duration: resolved,
                      }
                    : shield.kind === "to-self-redirect-to-owner"
                      ? {
                            kind: "to-self-redirect-to-owner",
                            targetInstanceId: shield.targetInstanceId,
                            remaining: shield.remaining,
                            duration: resolved,
                        }
                      : {
                            kind: "from-source-to-permanent-redirect-to-player",
                            sourceInstanceId: shield.sourceInstanceId,
                            targetInstanceId: shield.targetInstanceId,
                            redirectToPlayerId: shield.redirectToPlayerId,
                            remaining: shield.remaining,
                            duration: resolved,
                        },
            ];
        },
        preventNextNDamageToTarget(
            target: TargetSelection,
            amount: number,
            duration: DurationSpec
        ): void {
            // CR 615.1: damage absorption shield on the target. Decremented
            // per damage event regardless of source. Permanent target must
            // still be on the battlefield; a stale id silently no-ops.
            if (amount <= 0) return;
            if (target.type === "permanent") {
                if (!findOnBattlefield(state, target.id)) return;
            } else if (target.type === "player") {
                // player target is always valid (CR 109.5 — players persist).
            } else {
                return;
            }
            state.targetPreventionShields = [
                ...(state.targetPreventionShields ?? []),
                {
                    targetType: target.type,
                    targetId: target.id,
                    remaining: amount,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        gainLife(playerId: string, amount: number) {
            if (amount <= 0) return;
            // CR 614 — Lich's "if you would gain life, draw cards instead"
            // intercepts here. The replacement consumes the event (no actual
            // life gain) and runs `drawCards` via its apply ctx.
            const repl = applyLifeChangeReplacements(state, {
                kind: "lifegain",
                playerId,
                amount,
            });
            if (repl === null) return;
            getPlayer(state, repl.playerId).life += repl.amount;
        },
        loseLife(playerId: string, amount: number) {
            if (amount <= 0) return;
            // CR 614 — Lich's "if you would lose life, sacrifice instead"
            // intercepts here. The replacement may rewrite the amount or
            // cancel it entirely (replacing with its own side-effects).
            const repl = applyLifeChangeReplacements(state, {
                kind: "lifeloss",
                playerId,
                amount,
            });
            if (repl === null) return;
            getPlayer(state, repl.playerId).life -= repl.amount;
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
        setSubtypes(target: TargetSelection, subtypes: string[]): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.subtypes = [...subtypes];
            found.card.grantedSubtypes = undefined;
            found.card.printedSubtypes = undefined;
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
            if (target.type === "spell") {
                const si = state.stack.find((s) => s.id === target.id);
                if (si) return si.castById;
            }
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
        // CR 400.7 reanimation: locate `cardInstanceId` in `playerId`'s
        // graveyard or exile, splice it out, and put it onto `playerId`'s
        // battlefield via `putReanimatedOnBattlefield` (CR 611.2 grant
        // application, CR 302.1 summoning sickness for creatures). Returns
        // false on silent fizzle when the id is not in `fromZone` at
        // resolution (CR 608.2b — illegal target became unreachable
        // between cast and resolution). Used by Resurrection.
        returnToBattlefield(
            playerId: string,
            cardInstanceId: string,
            fromZone: "graveyard" | "exile"
        ): boolean {
            const player = getPlayer(state, playerId);
            const pile =
                fromZone === "graveyard" ? player.graveyard : player.exile;
            const idx = pile.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return false;
            const [card] = pile.splice(idx, 1);
            putReanimatedOnBattlefield(state, card, playerId);
            return true;
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
                const cardId = player.hand[idx].id;
                // CR 614 — Library of Leng's "may put it on top of library
                // instead" intercepts each discard. If the replacement
                // consumes the event the card has already been routed
                // elsewhere by the apply ctx; skip the default discard.
                const repl = applyDiscardReplacements(state, {
                    kind: "discard",
                    playerId,
                    cardInstanceId: cardId,
                });
                if (repl === null) continue;
                moveCard(player, repl.cardInstanceId, "hand", "graveyard");
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
        addManaTo(playerId: string, cost: CardManaCost): void {
            const player = getPlayer(state, playerId);
            for (const [color, amount] of Object.entries(cost)) {
                if (color === "X" || typeof amount !== "number" || amount <= 0)
                    continue;
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        },
        getX(): number {
            return item.chosenX ?? 0;
        },
        // CR 202.3 / 202.3b — mana value lookup. For permanents on the
        // battlefield, X in the printed cost counts as 0 (the chosen X is
        // not currently preserved on the resulting permanent). For stack
        // spells, X folds in the chosen value from the stack item.
        // Players / graveyard-card / synthetic targets return 0.
        getAdditionalSacrificeMv(): number | undefined {
            return item.additionalSacrificeSnapshot?.mv;
        },
        getManaValue(target: TargetSelection): number {
            if (target.type === "permanent") {
                const found = findOnBattlefield(state, target.id);
                if (!found) return 0;
                const cardId = (found.card.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                return manaValue(def?.manaCost);
            }
            if (target.type === "spell") {
                const stackItem = state.stack.find((s) => s.id === target.id);
                if (!stackItem) return 0;
                const cardId = (stackItem.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                const base = manaValue(def?.manaCost);
                return base + (stackItem.chosenX ?? 0);
            }
            return 0;
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
        // CR 104.3 — direct loss assignment used by Lich's LTB-trigger. The
        // call bypasses the CR 614 lose-game replacement loop: this is a
        // triggered ability resolving (CR 603), not a CR 104.3 condition,
        // so it's not itself a replaceable lose-game event.
        loseGame(playerId: string): void {
            getPlayer(state, playerId);
            const opponent = state.players.find((p) => p.id !== playerId);
            state.gameOver = {
                loserId: playerId,
                winnerId: opponent?.id ?? playerId,
                reason: "life",
            };
        },
        getDamageDealtThisTurn(playerId: string): number {
            return state.damageDealtToPlayerThisTurn?.[playerId] ?? 0;
        },
        // CR 111 / 707.1: token creation. The token enters as a brand-new
        // permanent under `controllerId`, owner = controller (CR 111.2 — token
        // owner is the player who created it). Tokens carry no card-registry
        // id; their colors are encoded as a synthetic mana cost so hasColor /
        // projection treat them like printed cards. Existing battlefield
        // sources' lord-style grants reach the new token via
        // `applyExistingGrantsTo` (CR 611). CR 704.5d cleanup is handled by
        // `checkTokenExistenceSBA` if the token ever leaves the battlefield.
        createToken(spec, controllerId, count = 1): string[] {
            const owner = getPlayer(state, controllerId);
            const ids: string[] = [];
            const manaCost: CardManaCost = {};
            for (const c of spec.colors ?? []) {
                manaCost[c] = (manaCost[c] ?? 0) + 1;
            }
            // Synthesize + register one CardDefinition per unique spec
            // shape. Multiple copies of the same Wasp share the same def
            // entry; the frontend reads display data through the registry
            // exactly like printed cards. The id is content-derived so
            // replays are deterministic.
            const defId = tokenDefinitionId(spec);
            registerTokenDefinition({
                id: defId,
                name: spec.name,
                manaCost,
                types: [...spec.types],
                ...(spec.subtypes ? { subtypes: [...spec.subtypes] } : {}),
                ...(spec.supertypes
                    ? { supertypes: [...spec.supertypes] }
                    : {}),
                power: spec.power,
                toughness: spec.toughness,
                ...(spec.staticAbilities
                    ? { staticAbilities: [...spec.staticAbilities] }
                    : {}),
                ...(spec.imagePrintId
                    ? { imagePrintId: spec.imagePrintId }
                    : {}),
            });
            for (let i = 0; i < count; i++) {
                state.nextTokenSeq = (state.nextTokenSeq ?? 0) + 1;
                const id = `token-${state.nextTokenSeq}`;
                const token: CardInstanceState = {
                    id,
                    isToken: true,
                    card: { id: defId },
                    controllerId,
                    ownerId: controllerId,
                    zone: "battlefield",
                    types: [...spec.types],
                    subtypes: spec.subtypes ? [...spec.subtypes] : [],
                    staticAbilities: spec.staticAbilities
                        ? [...spec.staticAbilities]
                        : [],
                    power: spec.power,
                    toughness: spec.toughness,
                    isTapped: false,
                    isSummoningSick: spec.types.includes("Creature")
                        ? true
                        : undefined,
                };
                owner.battlefield.push(token);
                applyExistingGrantsTo(state, token);
                applySourceStaticEffects(state, token);
                ids.push(id);
            }
            return ids;
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
            timing: "next-end-step" | "next-end-of-combat",
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

        preventAllCombatDamage(): void {
            state.preventAllCombatDamageThisTurn = true;
        },

        setIslandSanctuaryProtection(playerId: string): void {
            state.islandSanctuaryProtection = playerId;
        },

        addDamageCapShield(playerId: string, maxDamage: number): void {
            state.damageCapShields = [
                ...(state.damageCapShields ?? []),
                { playerId, maxDamage },
            ];
        },

        setExileOnDeath(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            if (!found.card.types.includes("Creature")) return;
            found.card.exileOnDeath = true;
        },

        getActivationCount(abilityId: string): number {
            const source = findOnBattlefield(state, item.id);
            if (!source) return 0;
            return source.card.activationsThisTurn?.[abilityId] ?? 0;
        },

        setMustAttackThisTurn(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            if (!found.card.types.includes("Creature")) return;
            found.card.mustAttackThisTurn = true;
        },

        setCanBlockAdditional(target: TargetSelection, value: number): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.canBlockAdditional = value;
        },

        setAllCreaturesMustAttack(playerId: string): void {
            state.allCreaturesMustAttack = playerId;
        },

        removeFromCombat(target: TargetSelection): void {
            if (target.type !== "permanent" || !state.combat) return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const card = found.card;
            if (card.isAttacking) {
                card.isAttacking = false;
                state.combat.attackerIds = state.combat.attackerIds.filter(
                    (id) => id !== target.id
                );
            }
            if (card.isBlocking) {
                card.isBlocking = false;
                // Remove from blocker assignments and check if any attacker
                // becomes unblocked (sole blocker removed)
                const ba = state.combat.blockerAssignments;
                if (ba[target.id]) {
                    delete ba[target.id];
                }
            }
        },

        setMustBlockAll(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.mustBlockAllThisTurn = true;
        },

        setColorOverride(target: TargetSelection, colors: Color[]): void {
            if (target.type === "permanent") {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                found.card.colorOverride = colors;
            } else if (target.type === "spell") {
                const si = state.stack.find((s) => s.id === target.id);
                if (!si) return;
                si.colorOverride = colors;
            }
        },
        copyStackItem(targetStackItemId, modifications): string | null {
            const targetIdx = state.stack.findIndex(
                (s) => s.id === targetStackItemId
            );
            if (targetIdx === -1) return null;
            const original = state.stack[targetIdx];
            // CR 707.10 — abilities aren't spells; this primitive copies only
            // instant/sorcery SPELLS. Copies of permanent spells (which would
            // create token permanents) are out of scope.
            if (
                original.abilityId ||
                original.triggeredAbilityId ||
                original.delayedTriggerId
            ) {
                return null;
            }
            if (
                !original.types.includes("Instant") &&
                !original.types.includes("Sorcery")
            ) {
                return null;
            }
            const copy: StackItem = structuredClone(original);
            copy.id = allocInstanceId(state);
            copy.isCopy = true;
            // CR 707.10b — the copy is controlled by the controller of the
            // effect that created it (e.g. Fork's controller), not by the
            // original spell's controller.
            copy.castById = item.castById;
            copy.controllerId = item.controllerId;
            copy.ownerId = item.controllerId;
            if (modifications?.colorOverride) {
                copy.colorOverride = modifications.colorOverride;
            }
            // Insert the copy directly above the original so it resolves
            // first. `item` (the copying spell) is the current top of the
            // stack and is popped immediately after this resolve completes;
            // inserting just below it leaves the copy as the new top.
            const selfIdx = state.stack.findIndex((s) => s.id === item.id);
            const insertAt = selfIdx === -1 ? state.stack.length : selfIdx;
            state.stack.splice(insertAt, 0, copy);
            return copy.id;
        },
        requestCopyRetarget(copyStackItemId): void {
            const copy = state.stack.find((s) => s.id === copyStackItemId);
            if (!copy) return;
            const cardId = (copy.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : undefined;
            // A copy of a modal spell retargets within its chosen mode
            // (CR 700.2); otherwise use the card-level requirement.
            const req =
                (copy.chosenModeId
                    ? def?.modes?.find((m) => m.id === copy.chosenModeId)
                          ?.targetRequirement
                    : undefined) ?? def?.targetRequirement;
            if (!req) return; // copied spell targets nothing — keep as-is
            // CR 107.3 — resolve an "X" target count against the copy's X.
            const rawCount = req.count;
            const count =
                rawCount === "X" ? Math.max(0, copy.chosenX ?? 0) : rawCount;
            const minNeeded = typeof count === "number" ? count : count.min;
            if (minNeeded <= 0) return; // no targets to choose
            const subtypeFilter = req.subtypeFilter
                ? Array.isArray(req.subtypeFilter)
                    ? req.subtypeFilter
                    : [req.subtypeFilter]
                : undefined;
            const excludeSubtypes = req.excludeSubtypes
                ? Array.isArray(req.excludeSubtypes)
                    ? req.excludeSubtypes
                    : [req.excludeSubtypes]
                : undefined;
            // Inline mvFilter "X" resolution (mirrors rules.resolveMvFilter;
            // duplicated to avoid a state ↔ rules import cycle).
            const resolveMv = (
                v: number | "X" | undefined
            ): number | undefined =>
                v === undefined
                    ? undefined
                    : v === "X"
                      ? (copy.chosenX ?? 0)
                      : v;
            const mvFilter = req.mvFilter
                ? {
                      ...(req.mvFilter.min !== undefined
                          ? { min: resolveMv(req.mvFilter.min)! }
                          : {}),
                      ...(req.mvFilter.max !== undefined
                          ? { max: resolveMv(req.mvFilter.max)! }
                          : {}),
                      ...(req.mvFilter.equals !== undefined
                          ? { equals: resolveMv(req.mvFilter.equals)! }
                          : {}),
                  }
                : undefined;
            // CR 707.10b — the copy's controller may choose new targets.
            state.pendingTarget = {
                playerId: item.castById,
                cardInstanceId: copy.id,
                targetType: req.type,
                count,
                selected: [],
                kind: "copy-retarget",
                ...(req.colorFilter ? { colorFilter: req.colorFilter } : {}),
                ...(req.zone ? { zone: req.zone } : {}),
                ...(req.controller ? { controller: req.controller } : {}),
                ...(subtypeFilter ? { subtypeFilter } : {}),
                ...(req.powerFilter ? { powerFilter: req.powerFilter } : {}),
                ...(req.toughnessFilter
                    ? { toughnessFilter: req.toughnessFilter }
                    : {}),
                ...(excludeSubtypes ? { excludeSubtypes } : {}),
                ...(mvFilter ? { mvFilter } : {}),
                ...(req.spellTypeFilter
                    ? {
                          spellTypeFilter: Array.isArray(req.spellTypeFilter)
                              ? req.spellTypeFilter
                              : [req.spellTypeFilter],
                      }
                    : {}),
            };
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

                prompt: req.prompt,
            };
            if (req.filter) entry.filter = req.filter;
            if (req.zoneOwnerId) entry.zoneOwnerId = req.zoneOwnerId;
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
        hasSubtype(target: TargetSelection, subtype: string): boolean {
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            return found?.card.subtypes.includes(subtype) ?? false;
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
            // CR 614 — Library of Leng's discard replacement intercepts here.
            const repl = applyDiscardReplacements(state, {
                kind: "discard",
                playerId,
                cardInstanceId,
            });
            if (repl === null) return;
            moveCard(player, repl.cardInstanceId, "hand", "graveyard");
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
        // CR 303.4 / 701.3d: move an aura from its current host to a new one
        // without it leaving the battlefield. Revert the aura's grants from
        // the old host, repoint `attachedTo`, then re-apply to the new host so
        // keyword/control/P-T effects follow the aura (CR 611.2). Returns false
        // if the aura or new host is not on the battlefield (caller leaves the
        // aura where it is — SBA 704.5n will sweep an orphan to the graveyard).
        reattachAura(auraInstanceId: string, newHostId: string): boolean {
            const aura = findOnBattlefield(state, auraInstanceId);
            const newHost = findOnBattlefield(state, newHostId);
            if (!aura || !newHost) return false;
            unapplySourceStaticEffects(state, aura.card);
            aura.card.attachedTo = newHostId;
            applySourceStaticEffects(state, aura.card);
            return true;
        },
        // CR 701.20a: tap all lands controlled by playerId. Used by Mana Short
        // and Drain Power.
        tapAllLands(playerId: string): void {
            const player = getPlayer(state, playerId);
            for (const card of player.battlefield) {
                if (card.types.includes("Land") && !card.isTapped) {
                    card.isTapped = true;
                }
            }
        },
        // CR 106.4: empty a player's mana pool, returning what was drained.
        drainManaPool(playerId: string): CardManaCost {
            const player = getPlayer(state, playerId);
            const drained: CardManaCost = {};
            for (const color of Object.keys(player.manaPool)) {
                const amount = player.manaPool[color];
                if (amount > 0) {
                    drained[color as keyof CardManaCost] = amount;
                    player.manaPool[color] = 0;
                }
            }
            return drained;
        },
        // CR 614.10: mark a player to skip their next turn (Time Vault).
        setSkipNextTurn(playerId: string): void {
            getPlayer(state, playerId).skipNextTurn = true;
        },

        // --- Library peek / reorder (CR 401.4) ---

        peekLibraryTop(playerId: string, n: number): string[] {
            return getPlayer(state, playerId)
                .library.slice(0, n)
                .map((c) => c.id);
        },
        reorderLibraryTop(playerId: string, orderedIds: string[]): void {
            const player = getPlayer(state, playerId);
            const n = orderedIds.length;
            const topCards = player.library.splice(0, n);
            const reordered = orderedIds.map((id) => {
                const card = topCards.find((c) => c.id === id);
                if (!card)
                    throw new Error(`Card ${id} not in top ${n} of library`);
                return card;
            });
            player.library.unshift(...reordered);
        },
        revealHand(targetPlayerId: string): string[] | undefined {
            return ctx.requestChoice({
                playerId: item.castById,
                choiceId: `reveal-${targetPlayerId}`,
                kind: "reveal-hand",
                zone: "hand",
                count: 0,
                zoneOwnerId: targetPlayerId,
                prompt: `Look at ${getPlayer(state, targetPlayerId).name}'s hand.`,
            });
        },
    };
    return ctx;
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

export function allocInstanceId(counter: { nextInstanceId?: number }): string {
    counter.nextInstanceId = (counter.nextInstanceId ?? 0) + 1;
    return String(counter.nextInstanceId);
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

/** Active "spend X as though Y" mana-substitution rules for one player.
 *  `from`-color mana may be spent to satisfy `to`-color requirements. */
export type ManaSubstitution = { from: string; to: string };

/** Deducts mana cost from pool. Colored first, then generic (greedy: highest
 *  pool first). When `substitutions` are supplied (CR 609.4b), a colored
 *  requirement the exact color can't fully cover is topped up from
 *  substitutable colors before the generic phase. Mirrors the coverage logic
 *  in `isManaCostCovered`, so payment only runs after coverage is confirmed. */
export function payManaCost(
    manaPool: Record<string, number>,
    cost: ManaCost,
    substitutions: ManaSubstitution[] = []
): void {
    // Pay colored/colorless costs from their exact color, clamping at the
    // available amount so substitution can cover any shortfall (CR 609.4b).
    const deficits: Record<string, number> = {};
    for (const color of MANA_COLORS) {
        const required = (cost[color] as number | undefined) ?? 0;
        if (required <= 0) continue;
        const paid = Math.min(manaPool[color] ?? 0, required);
        manaPool[color] = (manaPool[color] ?? 0) - paid;
        if (paid < required) deficits[color] = required - paid;
    }

    // Cover remaining colored deficits from substitutable colors.
    for (const [color, deficitAmount] of Object.entries(deficits)) {
        let need = deficitAmount;
        for (const sub of substitutions) {
            if (need <= 0) break;
            if (sub.to !== color) continue;
            const take = Math.min(manaPool[sub.from] ?? 0, need);
            manaPool[sub.from] = (manaPool[sub.from] ?? 0) - take;
            need -= take;
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

/** Scan the battlefield for `cost-modifier` static effects that apply to
 *  the given spell or ability source and return the accumulated cost increase
 *  as a normalized mana cost record (CR 601.2f). */
export function getCostModifiers(
    state: GameState,
    card: PermanentView,
    kind: "spell" | "ability"
): Record<string, number> {
    const increase: Record<string, number> = {};
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : null;
            const effects = getEffectiveStaticEffects(def, source.chosenModeId);
            for (const effect of effects) {
                if (effect.kind !== "cost-modifier") continue;
                const pred =
                    kind === "spell"
                        ? effect.appliesToSpell
                        : effect.appliesToAbility;
                if (!pred || !pred(card, STATIC_EFFECT_CTX)) continue;
                const norm = normalizeManaCost(effect.costIncrease);
                for (const [k, v] of Object.entries(norm)) {
                    increase[k] = (increase[k] ?? 0) + v;
                }
            }
        }
    }
    return increase;
}

/** Scan the battlefield for `mana-substitution` static effects whose source
 *  is controlled by `playerId` and return the active "spend `from` as though
 *  `to`" rules (CR 609.4b). Derived fresh per payment so the substitution
 *  vanishes the moment the source leaves play (Sunglasses of Urza). */
export function getManaSubstitutions(
    state: GameState,
    playerId: string
): ManaSubstitution[] {
    const out: ManaSubstitution[] = [];
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (source.controllerId !== playerId) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : null;
            const effects = getEffectiveStaticEffects(def, source.chosenModeId);
            for (const effect of effects) {
                if (effect.kind !== "mana-substitution") continue;
                out.push({ from: effect.from, to: effect.to });
            }
        }
    }
    return out;
}

/** Merge a cost-modifier increase into a base normalized cost (mutates). */
export function applyCostIncrease(
    baseCost: Record<string, number>,
    increase: Record<string, number>
): void {
    for (const [k, v] of Object.entries(increase)) {
        baseCost[k] = (baseCost[k] ?? 0) + v;
    }
}

/** Returns true if manaPool fully covers the normalized cost. With
 *  `substitutions` (CR 609.4b), a colored requirement may be paid partly or
 *  wholly with a substitutable color once its exact color is exhausted. */
export function isManaCostCovered(
    manaPool: Record<string, number>,
    cost: Record<string, number>,
    substitutions: ManaSubstitution[] = []
): boolean {
    const pool = { ...manaPool };

    // Check colored/colorless — exact color first, then substitutable colors.
    for (const color of MANA_COLORS) {
        let required = cost[color] ?? 0;
        if (required <= 0) continue;
        const direct = Math.min(pool[color] ?? 0, required);
        pool[color] = (pool[color] ?? 0) - direct;
        required -= direct;
        if (required > 0) {
            for (const sub of substitutions) {
                if (required <= 0) break;
                if (sub.to !== color) continue;
                const take = Math.min(pool[sub.from] ?? 0, required);
                pool[sub.from] = (pool[sub.from] ?? 0) - take;
                required -= take;
            }
            if (required > 0) return false;
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
