import type {
    AnimateSpec,
    CardType,
    Color,
    ControlChangeCondition,
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
    TextChange,
    TokenSpec,
    TriggerFizzledEvent,
} from "../cards/types";
import {
    registerTokenDefinition,
    tryGetCardById,
    isPrintedInSet as isCardPrintedInSet,
} from "../cards";
import { turnFaceDown } from "./faceDown";
import { getResolveFn } from "../cards/effectRegistry";
import { matchesPermanentFilter } from "../cards/filters";
import type { Phase, Zone, PhaseReturnCondition } from "./types";
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
import { isGuardedAgainst } from "./permanentGuard";
import { getEffectiveBlockGraph } from "./banding";
import { colorWordsPresent, landTypesPresent } from "./textChanges";
import { randomInt, seededShuffle } from "./rng";
import {
    applyDamageReplacements,
    applyDestroyReplacements,
    applyDiscardReplacements,
    applyLifeChangeReplacements,
    applyTapReplacements,
    applyTransientDamageRedirections,
    describeDamageSource,
} from "./replacements";
import { collectTriggers } from "./triggers";
import { getColorsFromCost } from "../cards/colors";
import {
    applyCopy,
    findTriggeredAbility,
    revertCopy,
    type CopyOptions,
} from "./copy";

/** Stored form of a temporary-effect duration. Mirrors `DurationSpec` but
 *  with the symbolic `player` field resolved to a concrete `playerId` at
 *  creation time so purge at replay time is deterministic (CR 611.2).
 *
 *  A phase boundary matches when `state.phase === boundaryFor(phase)` AND
 *  (`playerId === undefined || playerId === state.activePlayerId`). On a
 *  match with `skip > 0`, skip decrements. On a match with `skip === 0`,
 *  the effect expires. */
export type Duration = {
    phase: "end-of-turn" | "end-of-combat" | "upkeep";
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
        duration.phase === "end-of-turn"
            ? "CLEANUP"
            : duration.phase === "upkeep"
              ? "UPKEEP"
              : "END_OF_COMBAT";
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
    /** Set during combat when this creature is declared as attacker. Cleared
     *  when the END_OF_COMBAT step ends (CR 511.2 — attackers remain attacking
     *  until the end of combat step ends), not when it begins. */
    isAttacking?: boolean;
    /** Set during combat when this creature is declared as blocker. Cleared
     *  when the END_OF_COMBAT step ends (CR 511.2), not when it begins. */
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
    /** Set the moment this permanent deals damage to a player who is not its
     *  controller (i.e. an opponent), for the remainder of the turn (CR 120.3).
     *  Read by end-step "if ~ dealt damage to an opponent this turn" triggers
     *  (Whirling Dervish, LEG). Cleared at CLEANUP (CR 514.2). */
    dealtDamageToOpponentThisTurn?: boolean;
    /** Snapshot taken at the top of this permanent's controller's untap step
     *  (CR 502.1): true if the permanent was untapped when the turn's untap
     *  step began. Read by upkeep triggers phrased "if ~ started the turn
     *  untapped" (Rasputin Dreamweaver, LEG). Refreshed each untap step. */
    startedTurnUntapped?: boolean;
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
    /** Triggered abilities granted to this permanent by an anthem-style static
     *  effect (CR 113.1, 611). Each entry references a triggered-ability
     *  template (`triggeredGrantTemplates`) on another card def — the template
     *  is unioned into the permanent's effective triggers by
     *  `effectiveTriggeredAbilities`, so the trigger collector scans and
     *  resolves it as if it were printed on this permanent. Keyed by `auraId`
     *  (the granting source's instance id) so it can be spliced out when the
     *  source leaves play. Used by Energy Flux ("All artifacts have 'At the
     *  beginning of your upkeep, sacrifice this artifact unless you pay {2}.'"). */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
    }[];
    /** Keywords suppressed by a keyword-remove static effect (CR 613.1a
     *  layer 6). Each entry records the removed keyword and the source that
     *  removed it so `unapplySourceStaticEffects` can restore it. */
    removedKeywords?: { keyword: string; sourceId: string }[];
    /** Keywords removed for a limited duration by a one-shot effect (CR 611.1b
     *  layer 6 — Shelkin Brownie / Tolaria stripping banding and "bands with
     *  other" abilities until end of turn). Each entry records the keyword
     *  spliced out of `staticAbilities` and the `duration` after which it is
     *  restored. Purged at the same phase boundary as `grantedStaticAbilities`;
     *  on expiry one occurrence of the keyword is pushed back so a native
     *  duplicate isn't double-restored (CR 113.1). Distinct from
     *  `removedKeywords`, which is source-keyed and tied to a continuous static
     *  effect's lifetime rather than a fixed duration. */
    temporaryRemovedKeywords?: { keyword: string; duration: Duration }[];
    /** Instance ids of `ability-loss` static-effect sources that have stripped
     *  this permanent of ALL its abilities (CR 613.1f — "loses all abilities",
     *  Titania's Song). While non-empty: native activated abilities don't
     *  resolve, triggered abilities are excluded from the trigger scan, and the
     *  intrinsic mana ability is unavailable. Keyword abilities are stripped
     *  imperatively into `removedKeywords` (so the existing restore path
     *  rebuilds them). Multiple sources stack; the last source to unapply
     *  clears the suppression. */
    abilitiesSuppressedBy?: string[];
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
        /** Instance id of the source that imposed this control change — an aura
         *  (Control Magic) or a non-aura control-granting permanent (Aladdin,
         *  Old Man of the Sea, Ghazbán Ogre). Named `auraId` for back-compat. */
        auraId: string;
        previousControllerId: string;
        /** Optional "for as long as" condition (CR 611.2b). When present, the
         *  conditional-control SBA (`checkConditionalControlChanges`) reverts
         *  this entry the moment the condition stops holding. Absent = an
         *  indefinite control change that only reverts when its source leaves
         *  or is explicitly undone. */
        condition?: ControlChangeCondition;
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
    /** Layer 7b set-P/T effects scoped to a phase boundary (CR 613.4b, ADR
     *  0017). Each entry SETS power and/or toughness to a fixed value
     *  (independently optional). The latest entry per characteristic wins at
     *  read time (array order = timestamp, CR 613.7). Spliced out by
     *  `tickAllDurations` when `duration` expires, exactly like
     *  `temporaryPTMods`. Pushed by `setBasePT`. */
    temporaryPTSet?: {
        power?: number;
        toughness?: number;
        duration: Duration;
    }[];
    /** Conditional P/T modifications held "for as long as [the source] remains
     *  tapped" (CR 611.2 — duration tied to a continuously re-evaluated game
     *  state rather than a phase boundary; ATQ cluster E — Ashnod's Battle Gear,
     *  Tawnos's Weaponry). Each entry adds to effective power/toughness at read
     *  time (layer 7d, alongside `temporaryPTMods`) while its `sourceId`
     *  permanent is on the battlefield AND tapped; `checkSourceTappedEffects`
     *  (SBA) splices out entries whose source has left or untapped. Pushed by
     *  `SpellContext.addSourceTappedPTBuff`. */
    sourceTappedPTMods?: {
        power: number;
        toughness: number;
        /** Instance id of the permanent whose tapped state gates this entry. */
        sourceId: string;
    }[];
    /** Source ids that prevent this permanent from untapping during its
     *  controller's untap step "for as long as [each source] remains tapped"
     *  (CR 302.6 / 502.1 untap-prevention with a state-tied duration; ATQ
     *  cluster E — Phyrexian Gremlins). The untap step skips this permanent
     *  while the array is non-empty; `checkSourceTappedEffects` (SBA) removes
     *  ids whose source has left or untapped. Pushed by
     *  `SpellContext.lockUntapWhileSourceTapped`. */
    untapLockedBy?: string[];
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d folds P/T-modifying types (+1/+1, +1/+0, ...) into effective
     *  stat reads. Mutated by `addCounter`/`removeCounter`. Cleared on
     *  hand/library moves via `resetBattlefieldTransientState`; preserved on
     *  graveyard/exile so post-death lookups can read the moment-of-death
     *  count. */
    counters?: Record<string, number>;
    /** World-rule timestamp (CR 704.5m / 613.7m): the monotonic seq this
     *  permanent was stamped with when it was first observed carrying the
     *  World supertype. Lower = has been a world permanent longer; the
     *  world-rule SBA keeps only the permanent(s) with the highest seq
     *  (shortest time) and graveyards the rest. Permanents first seen in the
     *  same SBA sweep share a seq, encoding a simultaneous tie. Assigned and
     *  read only by `checkWorldRuleSBA`; cleared when the permanent leaves the
     *  battlefield (a World permanent re-entering becomes a fresh world
     *  permanent and is re-stamped). */
    worldSeq?: number;
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
    /** Face-down marker (CR 708.2 — Illusionary Mask, ADR 0013). While set,
     *  this permanent is a 2/2 colourless nameless vanilla creature with no
     *  abilities: `card.id` is swapped to the face-down sentinel and the
     *  stored characteristic fields are set to the vanilla 2/2, so every
     *  reader observes the override. The real definition id is retained in
     *  `faceDownOf` for the turn-up and for the controller's own view. */
    faceDown?: boolean;
    /** The true definition id of a face-down permanent (ADR 0013). Hidden
     *  from non-controllers by `projectPublicState`; the controller's view
     *  restores `card.id` to this value. Restored on turn-up. */
    faceDownOf?: string;
    /** Transient combat pile label (Raging River, CR 509.2 variant —
     *  ADR 0012). Set when a divider assigns this creature to the "left" or
     *  "right" pile; consumed by `validateBlockerEligibility` against the
     *  attacker's `combatBlockRestrictions` entry. Cleared at end of combat. */
    pileLabel?: string;
    /** Temporary multi-block grant (CR 509.1a). When set, this creature can
     *  block up to 1 + canBlockAdditional attackers. 999 = "any number".
     *  Cleared at CLEANUP. Static multi-block (Two-Headed Giant) is read from
     *  the CardDefinition instead. */
    canBlockAdditional?: number;
    /** Transient flag: this creature must block every attacker it can this
     *  turn (Blaze of Glory). Cleared at CLEANUP. */
    mustBlockAllThisTurn?: boolean;
    /** Transient flag: this creature can't block this turn (CR 509.1b).
     *  Twin of `mustBlockAllThisTurn`. Set by Ydwen Efreet's lost block
     *  flip; enforced in `validateBlockerEligibility`. Cleared at CLEANUP. */
    cantBlockThisTurn?: boolean;
    /** Transient flag: this creature can't be blocked this turn (CR 509.1b).
     *  Set on an attacker by Tawnos's Wand ("target creature with power 2 or
     *  less can't be blocked this turn"). Read by `validateBlockerEligibility`
     *  on the attacker side so every would-be blocker is rejected. Cleared at
     *  CLEANUP (CR 514.2). */
    cantBeBlockedThisTurn?: boolean;
    /** A player chosen as this permanent enters the battlefield and stored for
     *  the rest of the game (CR 603.6b / 614.12 — "as ~ enters, choose an
     *  opponent"). Set via `SpellContext.setChosenPlayer` from an ETB trigger;
     *  read by static / triggered abilities that act on the chosen player
     *  (Cursed Rack — chosen opponent's max hand size is four; The Rack —
     *  damage at the chosen player's upkeep). Cleared when the permanent leaves
     *  the battlefield (a new object, CR 400.7). */
    chosenPlayerId?: string;
    /** Layer 5 color override (CR 305.7, 613.1d). When set, getColors()
     *  returns this array instead of mana-cost-derived + grantedColors.
     *  Set by lace instants ("target spell or permanent becomes [color]"). */
    colorOverride?: Color[];
    /** Text-changing effects (CR 612, layer 3). Each entry replaces every
     *  instance of one word with another inside this object's structured text.
     *  Applied at read time by `applySubstitution` (gre/textChanges.ts) at the
     *  word-bearing parser chokepoints (land subtype → mana/landwalk, color
     *  words). Absent on essentially every instance — readers fast-path when
     *  undefined. Carried on the instance so the effect ends on a zone change
     *  for free (CR 612.7 — a new object). Set by Magical Hack / Sleight of
     *  Mind. Entries apply in array (timestamp) order. */
    textChanges?: TextChange[];
    /** Copy effect anchor (CR 707.2, 706). When this permanent is a copy of
     *  another (Clone, Copy Artifact, Vesuvan Doppelganger), `card.id` is
     *  overwritten with the copied object's definition id so every
     *  characteristic reader (abilities, colors, P/T, types) observes the
     *  copy automatically. `copiedFrom` holds this instance's ORIGINAL printed
     *  definition id — the value `card.id` is restored to when the copy leaves
     *  the battlefield (`revertCopy`). Its presence marks the instance as an
     *  active copy and survives Vesuvan's upkeep re-copy unchanged. */
    copiedFrom?: string;
    /** Token provenance link (CR 111, 707.1). Instance id of the permanent
     *  that created this token via `createToken(..., createdBy)`. Lets a
     *  source later identify the tokens it made — Tetravus exiles "tokens
     *  created with this creature" to put +1/+1 counters back on itself. Only
     *  set on tokens whose creator passed its own instance id; undefined for
     *  every other permanent. Persisted (serialize) so the link survives a DB
     *  round-trip; cleared with the rest of the instance when the token leaves
     *  the battlefield (a new object, CR 400.7). */
    createdBy?: string;
    /** Persistent, viewer-scoped card knowledge (ADR 0026, PRD #338). The set
     *  of player ids that currently know this instance's identity while it
     *  sits in a Hidden Zone (library, hand, face-down exile). A _look_ effect
     *  adds the looker; a _reveal_ effect adds all players; face-down exile
     *  adds the controller. Persists across hidden→hidden moves and is cleared
     *  only by an uncertainty event (`clearKnowledge`): shuffle, unwitnessed
     *  discard, or entering a public zone. Never crosses the wire raw — the
     *  projection turns it into identity gating + the derived `seenByOpponent`
     *  flag. */
    knownTo?: string[];
};

/** ADR 0026 — clears persistent card knowledge over a Hidden Zone. The single
 *  principle: knowledge of viewer V over zone Z is cleared when Z changes in a
 *  way V did not choose-and-witness.
 *
 *  - `selectorId` is a player id → that player chose-and-witnessed the change,
 *    so only their knowledge survives; everyone else is cleared. (Not used by
 *    slice 1, reserved for owner-chosen discard.)
 *  - `selectorId === null` → the change was random/unwitnessed (shuffle), so
 *    ALL viewers are cleared (CR 701.20 — nobody knows the new order, not even
 *    the player who shuffled).
 *
 *  Mutates each card in place, deleting an emptied `knownTo` so the slim
 *  serialization and projection stay clean. */
export function clearKnowledge(
    cards: CardInstanceState[],
    selectorId: string | null
): void {
    for (const card of cards) {
        if (!card.knownTo) continue;
        if (selectorId === null) {
            delete card.knownTo;
            continue;
        }
        const survivors = card.knownTo.filter((id) => id === selectorId);
        if (survivors.length > 0) card.knownTo = survivors;
        else delete card.knownTo;
    }
}

/** ADR 0026 / PRD #338 — grants persistent knowledge: adds `knowerId` to the
 *  `knownTo` set of each library/hand card in `cardInstanceIds` owned by
 *  `zoneOwnerId`. Idempotent. No-op for ids not currently in that owner's
 *  library or hand. Backs `SpellContext.markKnown`. */
export function grantKnowledge(
    state: GameState,
    zoneOwnerId: string,
    cardInstanceIds: string[],
    knowerId: string
): void {
    const owner = getPlayer(state, zoneOwnerId);
    const ids = new Set(cardInstanceIds);
    for (const card of [...owner.library, ...owner.hand]) {
        if (!ids.has(card.id)) continue;
        const known = card.knownTo ?? [];
        if (!known.includes(knowerId)) card.knownTo = [...known, knowerId];
    }
}

/** ADR 0026 / PRD #338 (slice 2) — the _reveal_ class of knowledge: grants
 *  knowledge of `cardInstanceIds` (owned by `zoneOwnerId`) to EVERY player in
 *  the game. A reveal differs from a look only in which players are added
 *  (CR 701.16 — "reveal" makes a card known to all players), so this is just
 *  `grantKnowledge` looped over `state.players`. The card stays face-up to all
 *  until an uncertainty event clears it (e.g. shuffle, CR 701.20). Idempotent.
 *  Backs `SpellContext.markKnownToAll`. */
export function grantKnowledgeToAll(
    state: GameState,
    zoneOwnerId: string,
    cardInstanceIds: string[]
): void {
    for (const player of state.players) {
        grantKnowledge(state, zoneOwnerId, cardInstanceIds, player.id);
    }
}

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
    /** Floating mana carrying a spend restriction (CR 106.6 — e.g.
     *  Metamorphosis's "spend only to cast creature spells"). Distinct from
     *  the fungible `manaPool`; consumed first when a permitted spell is cast
     *  (see `payManaCostForSpell`) and emptied with `manaPool` at end of
     *  step/phase (CR 500.4). Absent when the player has no restricted mana. */
    restrictedMana?: RestrictedMana[];
    /** Set when a player attempts to draw from an empty library (CR 704.5b). */
    hasDrawnFromEmpty?: boolean;
    /** Number of lands played by this player during the current turn
     *  (CR 305.2 / 117.2c). Reset to 0 at the start of each turn. */
    landsPlayedThisTurn?: number;
    /** Instance id of the last card this player drew during the current turn
     *  (the card most recently moved from library to hand by a draw). Set by
     *  `drawCard`, cleared at the start of each turn (`advanceTurn`). Used as
     *  the discard cost for Jandor's Ring ("discard the last card you drew
     *  this turn"). Stale when that card has since left the hand — consumers
     *  must re-check the card is still in hand before using it. */
    lastDrawnCardId?: string;
    /** Instance ids of every card this player has drawn during the current turn,
     *  in draw order (CR 121.1). Appended by every draw path; cleared at the
     *  start of each turn (`advanceTurn`). Unlike `lastDrawnCardId` (only the
     *  most recent), this is the full tally — read by Sylvan Library's "cards in
     *  your hand drawn this turn". Entries may name cards that have since left
     *  the hand; consumers intersect with the current hand when needed. */
    drawnThisTurn?: string[];
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
    /** Arboria (CR 508.1c) — per-turn history of whether this player cast a
     *  spell or put a nontoken permanent onto the battlefield during their
     *  CURRENT turn. Set by `emitSpellCastEvent` / `emitPermanentEntered`,
     *  frozen into `qualifyingActionLastTurn` and reset by `advanceTurn`. */
    qualifyingActionThisTurn?: boolean;
    /** Arboria (CR 508.1c) — the frozen value of `qualifyingActionThisTurn`
     *  from this player's most recently completed turn. When false/undefined
     *  the player "took no qualifying action last turn", so Arboria forbids
     *  attacks against them until after their next turn. */
    qualifyingActionLastTurn?: boolean;
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
    timing: "next-end-step" | "next-end-of-combat" | "next-draw-step";
    /** Payload carried over from the scheduling spell's resolution. */
    payload: Record<string, string>;
    /** For `next-draw-step`: the player whose draw step fires this trigger
     *  (CR 504). Undefined for the global-boundary timings. */
    targetPlayerId?: string;
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
    /** In-progress "sacrifice a permanent matching <filter>" cost picker
     *  (CR 602.1, 118.5 — Antiquities sacrifice-for-value engines). Set when
     *  the ability has `cost.sacrificeFilter`. `pickedId` is undefined until
     *  the player calls `selectActivationCost`; commit is blocked while it is
     *  undefined regardless of mana coverage. On commit the picked permanent
     *  is sacrificed and its mana value is snapshotted onto the resulting
     *  stack item (read at resolve via getAdditionalSacrificeMv — Priest of
     *  Yawgmoth). Mirrors PendingCast.additionalCost. */
    sacrificeChoice?: {
        filter: PermanentFilter;
        pickedId?: string;
    };
    /** Counter-removal cost (CR 122.6 — "Remove a [type] counter from this
     *  creature"). Applied at commit. */
    removeCounterCost?: { type: string; count: number };
    /** True iff the ability has a "discard the last card you drew this turn"
     *  cost (Jandor's Ring). The card is discarded at commit. */
    discardLastDrawnSource?: boolean;
    /** "Discard N cards at random" cost (CR 118.3 — Coral Helm). The cards are
     *  discarded at commit via the seeded PRNG. */
    discardAtRandomCount?: number;
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
    OptionChoiceKind,
    RandomRevealKind,
    RandomKind,
    RealizedOutcome,
    PendingChoiceKind,
    ManaRestriction,
} from "./types";
export type {
    ZonePickKind,
    YesNoChoiceKind,
    OrderChoiceKind,
    OptionChoiceKind,
    RandomRevealKind,
    RandomKind,
    RealizedOutcome,
    PendingChoiceKind,
    ManaRestriction,
};

/** A unit of restricted mana floating in a player's pool (CR 106.6). Produced
 *  by effects like Metamorphosis ("Add X mana of any one color … Spend this
 *  mana only to cast creature spells"). Kept separate from the fungible
 *  `manaPool` so the spend restriction can be enforced at payment time; emptied
 *  alongside `manaPool` at end of step/phase (CR 500.4). */
export type RestrictedMana = {
    color: string;
    amount: number;
    restriction: ManaRestriction;
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
    /** When true, the choosable set spans EVERY player's battlefield rather
     *  than a single owner's (CR 707 — Clone / Copy Artifact "a copy of any
     *  creature/artifact on the battlefield"). Only meaningful for
     *  `zone: "battlefield"`; the UI routes clicks to all battlefields. */
    allControllers?: boolean;
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
    /** Precomputed allow-list of choosable instance ids — the chooser may
     *  pick only from these (in addition to the zone-membership check). Used
     *  when eligibility can't be expressed as a `PermanentFilter` (e.g.
     *  Illusionary Mask's "creature whose cost could be paid by the {X}
     *  spent" — a mana-value bound, not a type/keyword filter). Undefined =
     *  no extra restriction. The frontend reads it to gate clickability. */
    candidateIds?: string[];
    /** For `kind: "choose-damage-target"` only — the player ids that are legal
     *  damage targets (CR 115.4 — "any target" includes players). The chooser's
     *  submission carries either a damageable permanent id (from `candidateIds`)
     *  or one of these player ids. The frontend routes player-life clicks for
     *  this kind; the backend validates the pick against this allow-list. */
    candidatePlayerIds?: string[];
    /** For `kind: "option-pick"` only — the abstract options the chooser picks
     *  exactly one of (CR 614.12 "as it enters, choose …"). Not zone members;
     *  the submission carries the chosen option `id` verbatim and the backend
     *  validates it against this list. The frontend renders one button per
     *  option. Used by Primal Clay / Shapeshifter (choose-body-on-entry). */
    options?: { id: string; label: string }[];

    // --- random-reveal family (CR 705, ADR 0023) ---
    /** For `kind: "random-reveal"` only — which random device produced the
     *  outcome. Drives the overlay widget (`coin` animation now, `die`
     *  deferred). */
    randomKind?: RandomKind;
    /** For `kind: "random-reveal"` only — number of faces of the device
     *  (2 for a coin). Carried so a future die can reuse the envelope without
     *  the engine assuming coin-ness. */
    sides?: number;
    /** For `kind: "random-reveal"` only — the 0-based index the device landed
     *  on (the bit the engine drew). For a coin: 1 = heads (the flipper wins),
     *  0 = tails. The realized outcome lives in `realized`; `result` is the
     *  raw index the animation lands on. */
    result?: number;
    /** For `kind: "random-reveal"` only — the realized outcome descriptor:
     *  the `face` the device landed on (defaults `WIN`/`LOSE`) and the
     *  one-line `consequence` preview the overlay renders. Public (CR 705),
     *  survives projection to both clients. */
    realized?: RealizedOutcome;
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
    /** Restricts legal PLAYER targets to players who attacked this turn
     *  (CR 506.2). Propagated from TargetRequirement.playerAttackedThisTurn.
     *  Used by Fire and Brimstone. Ignored for non-player target types. */
    playerAttackedThisTurn?: boolean;
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
    /** Player IDs that pressed "Pass Turn" (Enter) while NOT holding priority.
     *  A standing intent: the moment priority next lands on the player,
     *  `drainAutoPasses` promotes them into `autoPassPlayers` (rest-of-turn
     *  auto-pass) and clears the entry. Cancellable before it fires. Unlike
     *  `autoPassPlayers` it survives the turn boundary so an intent that never
     *  got a priority window still fires on the player's next priority. */
    queuedEndTurn?: string[];
    /** Active combat state. Set at DECLARE_ATTACKERS, cleared at END_OF_COMBAT. */
    combat?: {
        attackerIds: string[];
        confirmed: boolean;
        /** blockerId → attackerIds mapping. Each blocker maps to the array of
         *  attackers it is blocking. Normally length 1; multi-block creatures
         *  (Two-Headed Giant, Blaze of Glory) may have 2+. */
        blockerAssignments: Record<string, string[]>;
        /** Ids of attackers that became blocked this combat (CR 509.1h). Set
         *  when blockers are locked in; read at the damage step so an attacker
         *  that lost every blocker still counts as blocked (deals no combat
         *  damage to the defender without trample, all of it with trample —
         *  CR 510.1c). Distinct from the live blocker count: removing a blocker
         *  from combat does NOT un-block its attacker. */
        blockedAttackerIds?: string[];
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
    /** Set when the game ends. Contains winner/loser info for a decisive game,
     *  or `isDraw: true` for a drawn game (CR 104.4 — Divine Intervention's
     *  "the game is a draw"). For a draw `winnerId`/`loserId` are empty strings:
     *  there is neither a winner nor a loser. */
    gameOver?: {
        winnerId: string;
        loserId: string;
        reason: "life" | "decked" | "concede" | "draw";
        /** True when the game ended in a draw (CR 104.4a). No winner, no loser. */
        isDraw?: boolean;
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
    /** Monotonic counter backing the world-rule timestamp (CR 704.5m / 613.7m).
     *  The world-rule SBA stamps every World permanent that lacks a
     *  `worldSeq` with the current value, advancing the counter once per SBA
     *  sweep that finds newly-arrived World permanents. All World permanents
     *  first observed in the same sweep share one seq — that's the
     *  "simultaneous tie" the world rule resolves by destroying all of them. */
    nextWorldSeq?: number;
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
    /** Cumulative damage dealt to each player this turn BY ARTIFACT SOURCES
     *  (CR 120.3 tally, narrowed to artifact sources). Map
     *  `playerId → total artifact damage`. Incremented only when the damage
     *  source is an Artifact, after replacement / prevention / protection have
     *  reduced the amount. Read by Reverse Polarity's "twice the damage dealt
     *  to you so far this turn by artifacts" clause. Reset at turn start. */
    artifactDamageToPlayerThisTurn?: Record<string, number>;
    /** Transient one-shot damage redirections (CR 614). Distinct from
     *  permanent-bound `replacementEffects` (CardDefinition) — these are
     *  state-level shields produced by spells / activated abilities
     *  (Reverse Damage, Jade Monolith's {1}, Personal Incarnation's {0}).
     *  Each shield is consumed by a matching damage event. The unconsumed
     *  remainder is purged when `duration` expires. */
    damageRedirections?: DamageRedirection[];
    /** Combat-scoped block restrictions not sourced from a card definition
     *  (Raging River pile combat — ADR 0012). Each entry restricts one
     *  attacker: it can be blocked only by flying creatures or creatures whose
     *  `pileLabel` equals `allowedPileLabel`. Consumed generically by
     *  `validateBlockerEligibility`; set up at the trigger's resolution, lives
     *  one combat, and is cleared at end of combat. Persisted so a mid-combat
     *  save (declare-blockers priority) keeps the pile rules. */
    combatBlockRestrictions?: {
        attackerId: string;
        allowedPileLabel: string;
    }[];
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
    pendingUntapStep?: {
        restrictionCursor: number;
        /** Cursor into the optional-untap pass ("you may choose not to untap
         *  this", CR 502.1; ATQ cluster E). Set once all data-driven
         *  restrictions are resolved; keys into the active player's
         *  `may-choose-not-to-untap` permanents in battlefield order so the
         *  per-permanent prompts suspend/resume deterministically. */
        optionalCursor?: number;
    };
    /** Suspension marker for the cleanup-step mandatory discard (CR 514.1).
     *  Set when the active player's hand exceeds their maximum hand size at
     *  CLEANUP entry: the dispatcher enqueues a `discard-hand` `PendingChoice`
     *  (with `stackItemId: ""` — the same sentinel used by `untap-pick`) and
     *  parks this cursor so the commit handler knows it is closing out a
     *  cleanup discard rather than a spell-driven one (e.g. Disrupting
     *  Scepter). Cleared once the discards land and the remainder of CLEANUP
     *  (CR 514.2 — damage wipe, "until end of turn" expiry) runs. */
    pendingCleanupDiscard?: { playerId: string };
    /** Armed one-shot draw replacements (CR 614 — Aladdin's Lamp). Each entry
     *  replaces the NEXT draw `playerId` would take this turn: look at the top
     *  `x` cards, keep one to draw, bottom the rest in a random order. The
     *  draw step (`drawStep`) consumes the first matching entry and suspends on
     *  a `draw-look-keep` `PendingChoice`. Turn-scoped — "this turn" — so it is
     *  cleared in `advanceTurn`; multiple entries (stacked activations / Lamps)
     *  each cover one subsequent draw in FIFO order. */
    drawLookReplacements?: Array<{ playerId: string; x: number }>;
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
    /** Transient destroy-replacement shields (CR 614, Pyramids mode 2). Each
     *  entry replaces the next destruction of its keyed permanent before
     *  `duration` expires. Consumed via `destroyWithReplacements`; unconsumed
     *  remainder purged at expiry. See ADR 0020. */
    destroyReplacementShields?: DestroyReplacementShield[];
    /** Per-instance "prevent all combat damage to and by this permanent"
     *  shields (CR 615, Ebony Horse). Consumed in the combat damage step;
     *  unconsumed remainder purged at `duration` expiry. */
    combatDamageImmunity?: CombatDamageImmunity[];
    /** CR 702.26 — permanents currently phased out, grouped into bundles
     *  (host + attached Auras/Equipment). Phased permanents live here instead
     *  of any battlefield array, so every battlefield reader treats them as
     *  nonexistent for free. Bundles return via `removePermanentTo`'s
     *  source-leaves hook (Oubliette). See ADR 0021. */
    phasedOut?: PhasedOutBundle[];
    /** CR 603.7a / ADR 0028 — creatures held in exile by an exile-and-return
     *  effect (Tawnos's Coffin), awaiting their source's "leaves the
     *  battlefield or becomes untapped" trigger. Unlike `phasedOut`, the
     *  exiled cards live in their owners' `exile` arrays (a real zone change:
     *  leaves/enters triggers fire, the returned object is new). A bundle holds
     *  only the linkage and the noted counter snapshot — pure metadata, no fat
     *  card state — so it serializes as plain data. Its existence is also the
     *  "delayed return is armed" flag (see TriggerStateView.exileHeld). */
    exileHeld?: ExileReturnBundle[];
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
      }
    | {
          /** Eye for an Eye (CR 614): the next time the chosen source would
           *  deal damage to `playerId`, that damage to the player proceeds
           *  unchanged AND an equal amount is dealt to the source's
           *  controller. Decrements per match. */
          kind: "reflect-to-source-controller";
          sourceInstanceId: string;
          playerId: string;
          remaining: number;
          duration: Duration;
      };

/** Transient destroy-replacement shield (CR 614, Pyramids). The next time the
 *  keyed permanent would be destroyed before `duration` expires, the
 *  destruction is replaced: the permanent stays and its marked damage is
 *  removed. One-shot per charge. See ADR 0020. */
export type DestroyReplacementShield = {
    targetInstanceId: string;
    remaining: number;
    duration: Duration;
};

/** Per-instance "prevent all combat damage to and by this permanent" shield
 *  (CR 615, Ebony Horse). Consumed in the combat damage step. */
export type CombatDamageImmunity = {
    instanceId: string;
    duration: Duration;
};

/** CR 702.26 — a group of permanents silently pulled off the battlefield while
 *  phased out. The host plus every Aura/Equipment attached to it phase as a
 *  unit (CR 702.26d indirect phasing): they stay attached, keep their counters
 *  and `attachedTo` links, and do NOT hit the graveyard (the aura-attachment
 *  SBA never sees them because they're not in any battlefield array). Phased
 *  permanents are "treated as though they don't exist" for free — every reader
 *  iterates the battlefield arrays they've been removed from. */
export interface PhasedOutBundle {
    /** Stable bundle id (allocated via `allocInstanceId`). */
    id: string;
    /** Full fat state of each phased permanent, host first. Each card's
     *  `controllerId` determines which battlefield it returns to on phase-in
     *  (phasing never changes control, CR 702.26g). */
    cards: CardInstanceState[];
    /** When this bundle phases back in. */
    returnOn: PhaseReturnCondition;
    /** Applied to the HOST (cards[0]) on phase-in. Oubliette taps the
     *  creature "as it phases in this way". */
    onPhaseIn?: { tap?: boolean };
}

/** CR 603.7a / ADR 0028 — an exile-and-return holding record. The host
 *  creature and its Auras are exiled (a real zone change, so leaves/enters
 *  triggers fire and the returned object is new), and this bundle remembers
 *  what to put back when the source's "leaves the battlefield or becomes
 *  untapped" trigger resolves (Tawnos's Coffin). The exiled cards themselves
 *  stay in their owners' `exile` arrays — the bundle holds only ids, owners,
 *  and the noted counter snapshot, so it is pure serializable metadata. */
export interface ExileReturnBundle {
    /** Stable bundle id (allocated via `allocInstanceId`). */
    id: string;
    /** Instance id of the holding permanent (the coffin). The return triggers
     *  match their `self` against this; LKI keeps it valid after the source
     *  leaves. */
    sourceId: string;
    /** Exiled host creature: instance id + owner (the zone it returns to —
     *  control reverts to the owner, CR 110.2 / the card's "under its owner's
     *  control"). */
    hostId: string;
    hostOwnerId: string;
    /** Exiled Auras that were attached to the host, in attachment order. They
     *  return attached to the restored host (CR 303.4). */
    attached: { id: string; ownerId: string }[];
    /** Counter kinds and counts noted on the host as it was exiled (CR 122),
     *  re-applied to the returned (new) object. */
    counters: Record<string, number>;
    /** The host returns tapped (Tawnos's Coffin: "tapped"). */
    returnTapped: boolean;
}

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

/** Re-checks a single chosen target's legality at resolution (CR 608.2b/c).
 *  A target is illegal when the object it points at has left the zone it was
 *  chosen in: a permanent off the battlefield, a spell off the stack, a
 *  graveyard card no longer in that graveyard, or a vanished player.
 *
 *  Scope note: this gate intentionally checks ZONE EXISTENCE only, the actual
 *  crash class this fixes (a `resolve()` body reading a target that already
 *  left, e.g. Swords' `getController`). Characteristic-based illegality
 *  acquired after targeting — protection (CR 702.16b), shroud/hexproof
 *  (CR 702.11/702.18) — is enforced at target *selection* and at the aura
 *  re-check in `finalizeSpellResolution`; folding it in here would also reject
 *  deliberately-constructed in-isolation effects (e.g. Deathlace recoloring a
 *  protected creature to exercise the layer-3 primitive). */
function isTargetStillLegal(
    state: GameState,
    target: TargetSelection
): boolean {
    switch (target.type) {
        case "player":
            // CR 800.4a — a player can leave the game, but in 1v1 the target
            // player always exists; treat a missing player id as illegal.
            return state.players.some((p) => p.id === target.id);
        case "spell":
            // CR 608.2b — a spell target that has left the stack (resolved or
            // countered) is now illegal.
            return state.stack.some((s) => s.id === target.id);
        case "graveyard-card": {
            const owner = state.players.find((p) => p.id === target.playerId);
            return owner?.graveyard.some((c) => c.id === target.id) ?? false;
        }
        case "permanent":
            // CR 608.2b — left the battlefield => illegal (the Swords crash).
            return findOnBattlefield(state, target.id) !== null;
        default:
            return false;
    }
}

/** Global target-legality gate run before any `resolve()` dispatch (CR
 *  608.2b/608.2c). Returns one of:
 *   - `"fizzle"`  — the item has one or more targets and EVERY target is now
 *                   illegal; it must be countered by the game rules and must
 *                   NOT resolve (CR 608.2b).
 *   - `"resolve"` — the item is untargeted, or at least one target is still
 *                   legal. For the partially-illegal case the item's `targets`
 *                   array is pruned in place to the legal subset so each card's
 *                   `resolve()` only reads legal targets (CR 608.2c "does as
 *                   much as possible"; an illegal target is skipped).
 *
 *  Untargeted spells/abilities (`targets` empty/undefined) always resolve. */
function targetLegalityGate(
    state: GameState,
    item: StackItem
): "fizzle" | "resolve" {
    const targets = item.targets ?? [];
    if (targets.length === 0) return "resolve"; // untargeted — unaffected

    const legal = targets.filter((t) => isTargetStillLegal(state, t));
    if (legal.length === 0) return "fizzle"; // CR 608.2b — all targets illegal

    // CR 608.2c — prune illegal targets; the spell does as much as possible.
    if (legal.length !== targets.length) item.targets = legal;
    return "resolve";
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

    // --- Target-legality gate (CR 608.2b/608.2c) ---
    // Re-check chosen targets BEFORE dispatching any resolve handler. Only run
    // on a fresh resolution (resolutionStep undefined) so a spell suspended
    // mid-resolve for player choices isn't re-gated on resume. If every target
    // is now illegal the item is countered by the game rules: a spell goes to
    // its owner's graveyard, an ability simply leaves the stack — neither runs
    // its effect. Partially-legal items have `targets` pruned to the legal
    // subset (handled inside the gate) and resolve normally.
    if (top.resolutionStep === undefined) {
        if (targetLegalityGate(state, top) === "fizzle") {
            delete top.collectedChoices;
            state.stack.pop();
            // CR 608.2b — a countered SPELL is put into its owner's graveyard;
            // a countered ability ceases to exist. `isSpell` distinguishes the
            // two. Aura/permanent spells route through finalizeSpellResolution
            // which (for the non-permanent branch) handles the graveyard move;
            // for permanent spells a fully-illegal target means it never enters
            // play, so it likewise goes to the graveyard as a countered spell.
            if (isSpell && !top.isCopy) {
                const owner = getPlayer(state, top.ownerId);
                top.zone = "graveyard";
                owner.graveyard.push(top);
            }
            return top;
        }
    }

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
        // CR 707.9d — a trigger retained through a copy effect (Vesuvan
        // Doppelganger's upkeep re-copy) lives on the printed definition, not
        // the presented copy; `findTriggeredAbility` unions both.
        const ability = findTriggeredAbility(top, top.triggeredAbilityId);
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
                    // Combat-history / summoning-sickness flags must survive
                    // into the resolve-time intervening-if (CR 603.4d) so
                    // "if it [didn't] attack this turn"-style predicates
                    // (Clockwork Beast, Erg Raiders) read the real value
                    // rather than undefined.
                    isAttacking: sourceCard.isAttacking,
                    isBlocking: sourceCard.isBlocking,
                    hasAttackedThisTurn: sourceCard.hasAttackedThisTurn,
                    hasBlockedThisTurn: sourceCard.hasBlockedThisTurn,
                    dealtDamageToOpponentThisTurn:
                        sourceCard.dealtDamageToOpponentThisTurn,
                    startedTurnUntapped: sourceCard.startedTurnUntapped,
                    isSummoningSick: sourceCard.isSummoningSick,
                    // CR 700.2c — the cast-time modal choice must survive into
                    // the resolve-time intervening-if so modal-permanent state
                    // triggers (Jihad's chosen-colour self-sacrifice) read the
                    // chosen mode rather than undefined.
                    chosenModeId: (sourceCard as { chosenModeId?: string })
                        .chosenModeId,
                    isToken: (sourceCard as { isToken?: boolean }).isToken,
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
            // Stepped triggered-ability resolve (CR 608.2) — mirror of the
            // stepped spell/activated paths. `resolutionStep` is checkpointed so
            // a `requestChoice` suspension resumes the SAME step and earlier
            // steps never re-run. Lets a trigger commit an irreversible draw
            // (Sylvan Library's "draw two") in its own step, isolated from the
            // later pay-or-topdeck choices that suspend.
            if (ability.resolveSteps && ability.resolveSteps.length > 0) {
                const start = top.resolutionStep ?? 0;
                for (let i = start; i < ability.resolveSteps.length; i++) {
                    top.resolutionStep = i;
                    const ctx = buildSpellContext(state, top);
                    ability.resolveSteps[i](ctx);
                    if ((state.pendingChoices?.length ?? 0) > 0) {
                        return null; // suspended — wait for the choice submit
                    }
                }
                delete top.resolutionStep;
            } else if (ability.resolve) {
                const ctx = buildSpellContext(state, top);
                ability.resolve(ctx, top.triggerEvent);
                if ((state.pendingChoices?.length ?? 0) > 0) return null;
            }
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
        // --- Stepped activated-ability resolve (CR 608.2, 101.4) ---
        // Mirrors the stepped-spell path: peek-and-pop, advance `resolutionStep`
        // before each step so a `requestChoice` suspension resumes the SAME step
        // (and never re-runs completed steps). Lets "draw, then discard a chosen
        // card" abilities (Bazaar of Baghdad) draw exactly once.
        if (ability?.resolveSteps && ability.resolveSteps.length > 0) {
            const start = top.resolutionStep ?? 0;
            for (let i = start; i < ability.resolveSteps.length; i++) {
                top.resolutionStep = i;
                const ctx = buildSpellContext(state, top);
                ability.resolveSteps[i](ctx);
                if ((state.pendingChoices?.length ?? 0) > 0) {
                    return null; // suspended — wait for selectResolutionChoice
                }
            }
            delete top.resolutionStep;
        } else if (ability?.resolve) {
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
              tracksControlContinuity?: boolean;
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
                !isProtectedFromSource(host, item) &&
                // CR 303.4 — the host can't have become "can't be enchanted"
                // (Guardian Beast) between cast and resolution. Already-attached
                // Auras are unaffected; this gate only blocks new attachment.
                !isGuardedAgainst(state, host, "cantBeEnchanted");
            if (!isLegalHost || host === undefined) {
                item.zone = "graveyard";
                getPlayer(state, item.ownerId).graveyard.push(item);
                return;
            }
            item.attachedTo = host.id;
        }
        item.zone = "battlefield";
        item.isTapped = cardDef?.entersTapped === true;
        // CR 302.6 — creatures enter summoning-sick. Noncreature permanents
        // that gate activations on continuous control (Rocket Launcher) opt in
        // via `tracksControlContinuity`, reusing the same flag + untap-step
        // clear so the precondition is "controlled since my most recent turn".
        if (
            item.types.includes("Creature") ||
            cardDef?.tracksControlContinuity === true
        ) {
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
    // Arboria (CR 508.1c) — putting a NONTOKEN permanent onto the battlefield
    // is a qualifying action for its controller this turn (a token does not
    // count). Unlocks attacks against them on the opponent's following turn.
    if (!(card as { isToken?: boolean }).isToken) {
        const controller = state.players.find(
            (p) => p.id === card.controllerId
        );
        if (controller) controller.qualifyingActionThisTurn = true;
    }
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
                } else if (effect.kind === "triggered-grant" && cardId) {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    target.grantedTriggeredAbilities = [
                        ...(target.grantedTriggeredAbilities ?? []),
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
                } else if (effect.kind === "ability-loss") {
                    // CR 613.1f layer-6 ability removal (Titania's Song).
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const already = (
                        target.abilitiesSuppressedBy ?? []
                    ).includes(source.id);
                    if (already) continue;
                    // Strip every keyword into `removedKeywords` (source-keyed),
                    // reusing the keyword-remove restore path on unapply.
                    const removed = target.removedKeywords ?? [];
                    for (const kw of target.staticAbilities) {
                        removed.push({ keyword: kw, sourceId: source.id });
                    }
                    if (target.staticAbilities.length > 0) {
                        target.staticAbilities = [];
                    }
                    target.removedKeywords =
                        removed.length > 0 ? removed : undefined;
                    target.abilitiesSuppressedBy = [
                        ...(target.abilitiesSuppressedBy ?? []),
                        source.id,
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
            const triggered = target.grantedTriggeredAbilities;
            if (triggered && triggered.length > 0) {
                const keptT = triggered.filter((g) => g.auraId !== source.id);
                target.grantedTriggeredAbilities =
                    keptT.length > 0 ? keptT : undefined;
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
            // CR 613.1f — release this source's "loses all abilities" hold.
            // Keyword restoration is handled by the `removedKeywords` block
            // above (source-keyed); here we just drop the suppression marker so
            // activated/triggered/mana abilities function once no source holds.
            const suppressors = target.abilitiesSuppressedBy;
            if (suppressors && suppressors.length > 0) {
                const keptS = suppressors.filter((id) => id !== source.id);
                target.abilitiesSuppressedBy =
                    keptS.length > 0 ? keptS : undefined;
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
                } else if (effect.kind === "triggered-grant" && cardId) {
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    newPermanent.grantedTriggeredAbilities = [
                        ...(newPermanent.grantedTriggeredAbilities ?? []),
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
                } else if (effect.kind === "ability-loss") {
                    // CR 613.1f — a noncreature artifact entering under
                    // Titania's Song loses all its abilities too.
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    const already = (
                        newPermanent.abilitiesSuppressedBy ?? []
                    ).includes(source.id);
                    if (already) continue;
                    const removed = newPermanent.removedKeywords ?? [];
                    for (const kw of newPermanent.staticAbilities) {
                        removed.push({ keyword: kw, sourceId: source.id });
                    }
                    if (newPermanent.staticAbilities.length > 0) {
                        newPermanent.staticAbilities = [];
                    }
                    newPermanent.removedKeywords =
                        removed.length > 0 ? removed : undefined;
                    newPermanent.abilitiesSuppressedBy = [
                        ...(newPermanent.abilitiesSuppressedBy ?? []),
                        source.id,
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
    applyControlChange(state, hostId, aura.controllerId, aura.id);
}

/** Generic control-change primitive (CR 613.1b, layer 2) shared by aura
 *  attachment and activated/triggered control-gain (Aladdin, Old Man of the
 *  Sea, Ghazbán Ogre). Pushes an entry onto the host's `controlChanges`
 *  stack keyed by `sourceId`, flips `controllerId`, moves the host into the
 *  new controller's battlefield array so zone iteration stays consistent, and
 *  sets summoning sickness (CR 702.10c). To keep a re-applying source (Ghazbán
 *  re-firing each upkeep) from stacking duplicates, any prior entry from the
 *  same `sourceId` is reverted first. No-op if the host is missing or already
 *  under `newControllerId` after that revert. */
export function applyControlChange(
    state: GameState,
    hostId: string,
    newControllerId: string,
    sourceId: string,
    condition?: ControlChangeCondition
): void {
    // Collapse a prior change from the same source before re-applying.
    revertControlChange(state, hostId, sourceId);
    const found = findOnBattlefield(state, hostId);
    if (!found) return;
    // CR 613.1b — a continuous `permanent-guard` may bar control change
    // (Guardian Beast: "their control can't be changed" while it is untapped).
    // Read live so the lock tracks the guarding source's tap state.
    if (isGuardedAgainst(state, found.card, "controlCantChange")) return;
    if (found.card.controllerId === newControllerId) return;
    const stack = found.card.controlChanges ?? [];
    found.card.controlChanges = [
        ...stack,
        {
            auraId: sourceId,
            previousControllerId: found.card.controllerId,
            ...(condition ? { condition } : {}),
        },
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
    if (!aura.attachedTo) return;
    revertControlChange(state, aura.attachedTo, aura.id);
}

/** Generic reverse of `applyControlChange`, keyed by the source instance id.
 *  Removes the source's entry from the host's `controlChanges` stack: a top
 *  entry pops and restores `controllerId` (moving the host back); a middle
 *  entry is spliced with the chain re-patched (CR 108.3). No-op if the host
 *  or the source's entry is missing. */
export function revertControlChange(
    state: GameState,
    hostId: string,
    sourceId: string
): void {
    const found = findOnBattlefield(state, hostId);
    if (!found) return;
    const stack = found.card.controlChanges ?? [];
    const idx = stack.findIndex((e) => e.auraId === sourceId);
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

/** Records that the permanent `sourceInstanceId` dealt damage to player
 *  `targetPlayerId` this turn (CR 120.3). Sets a turn-scoped per-instance flag
 *  only when the damaged player is NOT the source's controller — i.e. the
 *  source hit an opponent. Read by end-step "if ~ dealt damage to an opponent
 *  this turn" triggers (Whirling Dervish, LEG). No-op if the source is not on
 *  the battlefield (last-known-information sources don't carry the flag). */
export function recordSourceDamagedOpponent(
    state: GameState,
    sourceInstanceId: string,
    targetPlayerId: string
): void {
    const found = findOnBattlefield(state, sourceInstanceId);
    if (!found) return;
    if (found.card.controllerId === targetPlayerId) return;
    found.card.dealtDamageToOpponentThisTurn = true;
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

/** Increments the per-turn ARTIFACT-source damage tally for `playerId`
 *  (CR 120.3, narrowed to artifact sources). Called by player-damage paths
 *  immediately after `bumpDamageDealtToPlayer`, but only when the source is an
 *  Artifact (`sourceTypes` includes "Artifact"). Read by Reverse Polarity's
 *  "twice the damage dealt to you so far this turn by artifacts" clause. */
export function bumpArtifactDamageToPlayer(
    state: GameState,
    playerId: string,
    amount: number,
    sourceTypes: ReadonlyArray<string>
): void {
    if (amount <= 0) return;
    if (!sourceTypes.includes("Artifact")) return;
    const tally = { ...(state.artifactDamageToPlayerThisTurn ?? {}) };
    tally[playerId] = (tally[playerId] ?? 0) + amount;
    state.artifactDamageToPlayerThisTurn = tally;
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
        sourceSubtypes: desc.subtypes,
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

/** Replacement-aware tap (CR 701.20a, 614). Runs the tap replacement loop
 *  before setting `isTapped` so a face-down permanent that would become tapped
 *  is turned face up first (CR 708.9, ADR 0013), then taps as its real self.
 *  No-op if the permanent is already tapped or a replacement cancels the tap.
 *  Every creature-tap site that a face-down permanent can hit (explicit tap
 *  effects, attacker declaration) routes through this. */
export function tapPermanent(state: GameState, card: CardInstanceState): void {
    if (card.isTapped) return;
    const ev = applyTapReplacements(state, {
        kind: "tap",
        cardInstanceId: card.id,
    });
    if (ev === null) return;
    card.isTapped = true;
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
    // CR 702.12 via a continuous `permanent-guard` (Guardian Beast — "your
    // noncreature artifacts have indestructible as long as ~ is untapped").
    // Read live so the grant tracks the source's current tap state.
    if (isGuardedAgainst(state, found.card, "indestructible")) return false;
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

/** Replacement-aware destroy wrapper (CR 614, ADR 0020). Runs the destroy
 *  replacement layer FIRST (permanent-bound `replacementEffects[]` with
 *  `eventKind: "destroy"` plus transient `destroyReplacementShields` — Pyramids
 *  mode 2). If a replacement intercepts the destruction, the permanent stays
 *  on the battlefield and this returns false. Otherwise it falls through to
 *  `regenerateOrDestroy` (CR 701.15 regeneration shield + the actual move),
 *  whose tested body is left untouched. Regeneration is deliberately NOT
 *  modelled as a "destroy" replacement — it stays a specialised shield inside
 *  `regenerateOrDestroy`.
 *
 *  Returns true only when the permanent actually left the battlefield. */
export function destroyWithReplacements(
    state: GameState,
    cardId: string,
    opts?: { cantBeRegenerated?: boolean }
): boolean {
    if (!findOnBattlefield(state, cardId)) return false;
    const replaced = applyDestroyReplacements(state, {
        kind: "destroy",
        targetInstanceId: cardId,
    });
    // null === the destruction was replaced (CR 614.6) — do not destroy.
    if (replaced === null) return false;
    return regenerateOrDestroy(state, cardId, opts);
}

/** Returns true if the permanent is shielded from all combat damage (to and
 *  by) this turn (CR 615, Ebony Horse). */
export function isCombatDamageImmune(
    state: GameState,
    instanceId: string
): boolean {
    return (
        state.combatDamageImmunity?.some((s) => s.instanceId === instanceId) ??
        false
    );
}

/** Last-known combat relationship (CR 603.10) for a creature about to leave
 *  the battlefield: every creature that, at this instant, is blocking it or is
 *  blocked by it. `blockerAssignments` maps blockerId → the attackers it
 *  blocks, so a creature `id`'s partners are (a) blockers whose assignment
 *  list contains `id` — i.e. creatures blocking `id` when `id` is an attacker —
 *  plus (b) the assignment list of `id` itself when `id` is a blocker — i.e.
 *  the attackers `id` is blocking. Abu Ja'far (ARN) reads this at death to
 *  destroy "all creatures blocking or blocked by it". Returns deduped ids.
 *  Empty when there is no combat or the creature was not in combat. */
export function combatPartnerIds(state: GameState, id: string): string[] {
    const ba = state.combat?.blockerAssignments;
    if (!ba) return [];
    const partners = new Set<string>();
    // (b) `id` is a blocker → the attackers it is blocking are blocked by it.
    for (const attackerId of ba[id] ?? []) partners.add(attackerId);
    // (a) some other creature is blocking `id` (i.e. `id` is an attacker).
    for (const [blockerId, attackerIds] of Object.entries(ba)) {
        if (attackerIds.includes(id)) partners.add(blockerId);
    }
    partners.delete(id);
    return [...partners];
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
    toZone: "graveyard" | "exile" | "hand" | "library",
    /** Why the permanent is leaving (CR 603.10). Pass `"sacrifice"` from
     *  sacrifice paths (CR 701.16) so leave-the-battlefield triggers can
     *  distinguish sacrifice from destruction / bounce (Urza's Miter). Any
     *  other departure leaves it undefined. */
    cause?: "sacrifice"
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
    // CR 603.10 — capture the moment-of-death combat relationship before the
    // card leaves play and combat is cleared, so a death trigger that resolves
    // after the creature is in the graveyard (Abu Ja'far) still knows which
    // creatures were blocking or blocked by it.
    const snapshotCombatPartners = wasCreature
        ? combatPartnerIds(state, cardId)
        : [];
    creature.zone = toZone;
    creature.attachedTo = undefined;
    // CR 704.5m — the world-rule timestamp is a battlefield-only property of
    // the permanent. A card leaving play (even to graveyard/exile) becomes a
    // new object on any re-entry (CR 400.7), so it must be re-stamped as a
    // fresh world permanent — clear the stale seq on every departure.
    delete creature.worldSeq;
    // CR 707.2 — a copy effect lasts only while the object is on the
    // battlefield. Restore the printed identity now (after LKI snapshots, so
    // death triggers still read the copied P/T) so the card re-casts and
    // exists in other zones as its true printed self.
    revertCopy(creature);
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
                combatPartnerIds: snapshotCombatPartners,
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
            ...(cause ? { cause } : {}),
        },
    ];
    // CR 702.26 — "until ~ leaves the battlefield" durations end here. Any
    // bundle phased out by this source (Oubliette) phases back in immediately,
    // before SBAs/triggers settle (the duration ending is a continuous effect,
    // not a stack trigger). Runs after the move so the source is already gone.
    phaseInBundlesForSource(state, cardId);
}

/** CR 702.26 — silently phase `permanentId` and everything attached to it out
 *  of existence. Pulls the host plus every Aura/Equipment attached to it off
 *  the battlefield into a `PhasedOutBundle`, with NO `PERMANENT_LEFT` event and
 *  NO zone change (phasing is not leaving, CR 702.26h) — so no triggers fire
 *  and the aura-attachment SBA never sees the detached auras. Counters and
 *  `attachedTo` links ride along untouched. Returns the bundle id, or null if
 *  the permanent isn't on the battlefield. */
export function phaseOutPermanent(
    state: GameState,
    permanentId: string,
    opts: { returnOn: PhaseReturnCondition; onPhaseIn?: { tap?: boolean } }
): string | null {
    const host = findOnBattlefield(state, permanentId);
    if (!host) return null;
    // CR 702.26d indirect phasing — collect every permanent attached to the
    // host (Auras and Equipment) across all battlefields. They phase as a unit.
    const attached: CardInstanceState[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id !== permanentId && card.attachedTo === permanentId) {
                attached.push(card);
            }
        }
    }
    // Remove host + attachments from their battlefield arrays. Splice by id so
    // we don't depend on stale indices as the arrays shrink.
    const removeById = (id: string): CardInstanceState | undefined => {
        for (const player of state.players) {
            const idx = player.battlefield.findIndex((c) => c.id === id);
            if (idx !== -1) return player.battlefield.splice(idx, 1)[0];
        }
        return undefined;
    };
    const cards: CardInstanceState[] = [];
    const hostCard = removeById(permanentId);
    if (hostCard) cards.push(hostCard);
    for (const a of attached) {
        const card = removeById(a.id);
        if (card) cards.push(card);
    }
    const bundle: PhasedOutBundle = {
        id: allocInstanceId(state),
        cards,
        returnOn: opts.returnOn,
        ...(opts.onPhaseIn ? { onPhaseIn: opts.onPhaseIn } : {}),
    };
    state.phasedOut = [...(state.phasedOut ?? []), bundle];
    return bundle.id;
}

/** CR 702.26 — silently phase a bundle back in: restore each permanent to its
 *  controller's battlefield (phasing never changes control, CR 702.26g). No
 *  events, so no enters triggers. The host taps if `onPhaseIn.tap` (Oubliette).
 *  Returns false if the bundle id is unknown. */
export function phaseInBundle(state: GameState, bundleId: string): boolean {
    const bundles = state.phasedOut ?? [];
    const idx = bundles.findIndex((b) => b.id === bundleId);
    if (idx === -1) return false;
    const [bundle] = bundles.splice(idx, 1);
    state.phasedOut = bundles.length > 0 ? bundles : undefined;
    for (const card of bundle.cards) {
        getPlayer(state, card.controllerId).battlefield.push(card);
    }
    if (bundle.onPhaseIn?.tap && bundle.cards[0]) {
        bundle.cards[0].isTapped = true;
    }
    return true;
}

/** Phases in every bundle whose `source-leaves` return condition names
 *  `sourceId`. Called from `removePermanentTo` when any permanent leaves. */
function phaseInBundlesForSource(state: GameState, sourceId: string): void {
    for (const bundle of [...(state.phasedOut ?? [])]) {
        if (
            bundle.returnOn.kind === "source-leaves" &&
            bundle.returnOn.sourceId === sourceId
        ) {
            phaseInBundle(state, bundle.id);
        }
    }
}

/** CR 603.7a / ADR 0028 — exile `targetId` and every permanent attached to it
 *  (Auras), noting the host's counters, and record an `ExileReturnBundle` keyed
 *  to `sourceId`. Unlike phasing, this is a real zone change: the attachments
 *  are exiled FIRST (so the orphan-aura SBA, CR 704.5n, never sees them once
 *  the host leaves), then the host — each via `removePermanentTo`, so
 *  leaves-the-battlefield triggers fire and the cards land in their owners'
 *  exile arrays. Returns the bundle id, or null if the target isn't on the
 *  battlefield. The return is driven later by `returnExiledForSource`. */
export function exileWithAttachments(
    state: GameState,
    targetId: string,
    opts: { sourceId: string; returnTapped: boolean }
): string | null {
    const found = findOnBattlefield(state, targetId);
    if (!found) return null;
    const host = found.card;
    const hostOwnerId = host.ownerId;
    // CR 122 — note the counters that were on the creature.
    const counters: Record<string, number> = { ...(host.counters ?? {}) };
    // Collect attachments (Auras) across all battlefields, in a stable order.
    const attached: { id: string; ownerId: string }[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.id !== targetId && card.attachedTo === targetId) {
                attached.push({ id: card.id, ownerId: card.ownerId });
            }
        }
    }
    // Exile attachments first, then the host (CR 701.18). Both fire
    // PERMANENT_LEFT — exile is a real zone change, unlike phasing.
    for (const a of attached) removePermanentTo(state, a.id, "exile");
    removePermanentTo(state, targetId, "exile");
    const bundle: ExileReturnBundle = {
        id: allocInstanceId(state),
        sourceId: opts.sourceId,
        hostId: targetId,
        hostOwnerId,
        attached,
        counters,
        returnTapped: opts.returnTapped,
    };
    state.exileHeld = [...(state.exileHeld ?? []), bundle];
    return bundle.id;
}

/** CR 603.7a / ADR 0028 — resolve the return half of every exile-and-return
 *  bundle held by `sourceId` (Tawnos's Coffin's "when this leaves the
 *  battlefield or becomes untapped" trigger). For each bundle: return the host
 *  from its owner's exile to the battlefield under its owner's control
 *  (a fresh object, ETB fires), tapped if `returnTapped`, carrying the noted
 *  counters; then return each exiled Aura attached to that host (CR 303.4). A
 *  host that has since left exile fizzles that bundle (its Auras stay exiled,
 *  matching "if you do … return the other exiled cards"). Bundles are removed
 *  whether or not they fully restored, so the return happens at most once. */
export function returnExiledForSource(
    state: GameState,
    sourceId: string
): void {
    const held = state.exileHeld ?? [];
    const mine = held.filter((b) => b.sourceId === sourceId);
    if (mine.length === 0) return;
    const remaining = held.filter((b) => b.sourceId !== sourceId);
    state.exileHeld = remaining.length > 0 ? remaining : undefined;

    for (const bundle of mine) {
        const ownerExile = getPlayer(state, bundle.hostOwnerId).exile;
        const idx = ownerExile.findIndex((c) => c.id === bundle.hostId);
        if (idx === -1) continue; // host left exile — the return fizzles
        const [hostCard] = ownerExile.splice(idx, 1);
        putReanimatedOnBattlefield(state, hostCard, bundle.hostOwnerId);
        if (bundle.returnTapped) hostCard.isTapped = true;
        // CR 122 — re-apply the noted counters to the new object.
        if (Object.keys(bundle.counters).length > 0) {
            hostCard.counters = { ...bundle.counters };
        }
        // CR 303.4 — the exiled Auras return attached to the restored host.
        for (const a of bundle.attached) {
            const auraExile = getPlayer(state, a.ownerId).exile;
            const ax = auraExile.findIndex((c) => c.id === a.id);
            if (ax === -1) continue;
            const [auraCard] = auraExile.splice(ax, 1);
            putReanimatedOnBattlefield(state, auraCard, a.ownerId);
            // Wire the attachment + (re)apply the aura's static grants to the
            // host, mirroring `reattachAura`.
            unapplySourceStaticEffects(state, auraCard);
            auraCard.attachedTo = bundle.hostId;
            applySourceStaticEffects(state, auraCard);
        }
    }
}

/** Emits a SPELL_CAST event for a freshly-pushed stack item (CR 601.2i).
 *  Reads the spell's card definition to derive types, subtypes, and colors
 *  so trigger predicates can filter without re-resolving the registry. */
export function emitSpellCastEvent(state: GameState, item: StackItem): void {
    const cardId = (item.card as { id?: string }).id;
    if (!cardId) return;
    // Arboria (CR 508.1c) — record that this player cast a spell this turn,
    // unlocking attacks against them on the opponent's following turn.
    const caster = state.players.find((p) => p.id === item.castById);
    if (caster) caster.qualifyingActionThisTurn = true;
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

/** Untaps `card` and, on a real tapped → untapped transition, emits a
 *  PERMANENT_UNTAPPED event (CR 701.20b "becomes untapped"). No-op (and no
 *  event) if the permanent was already untapped — a non-transition is not a
 *  "becomes untapped". Returns true if it transitioned. The single choke point
 *  for the untap step (CR 502.2) and untap effects (Twiddle) so "when ~ becomes
 *  untapped" triggers (Tawnos's Coffin, ADR 0028) fire from both. */
export function untapPermanent(
    state: GameState,
    card: CardInstanceState
): boolean {
    if (!card.isTapped) return false;
    card.isTapped = false;
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "PERMANENT_UNTAPPED",
            permanentId: card.id,
            controllerId: card.controllerId,
            permanentTypes: [...card.types],
            permanentSubtypes: [...card.subtypes],
        },
    ];
    return true;
}

/** Emits an ABILITY_ACTIVATED event for a non-mana activated ability that was
 *  just committed to the stack (CR 602.1). This is the non-{T} complement of
 *  `emitPermanentTapped`: callers gate on `!ability.cost.tap` so a {T} ability
 *  (which already emits PERMANENT_TAPPED) is not double-counted. Together the
 *  two events drive "whenever ~ is tapped or has a non-tap ability activated"
 *  triggers (Antiquities cluster B — Haunting Wind, Powerleech, Artifact
 *  Possession). Snapshots the source's controller/types/subtypes (CR 603.10
 *  last-known information) so triggers can filter after the source leaves. */
export function emitAbilityActivated(
    state: GameState,
    card: CardInstanceState,
    abilityId: string
): void {
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "ABILITY_ACTIVATED",
            permanentId: card.id,
            controllerId: card.controllerId,
            permanentTypes: [...card.types],
            permanentSubtypes: [...card.subtypes],
            abilityId,
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
    delete card.grantedTriggeredAbilities;
    delete card.removedKeywords;
    delete card.animation;
    delete card.chosenMana;
    delete card.manaCommitted;
    delete card.counters;
    delete card.temporaryPTMods;
    delete card.sourceTappedPTMods;
    delete card.untapLockedBy;
    delete card.exileOnDeath;
    delete card.colorOverride;
    delete card.cantBeBlockedThisTurn;
    // CR 603.6b — the chosen player is stored for the rest of the game while
    // this permanent is on the battlefield; a zone change makes a new object
    // (CR 400.7), so the choice does not carry over.
    delete card.chosenPlayerId;
    // CR 612.7 — a text-changing effect ends when the object changes zones
    // (it becomes a new object). Same lifecycle as colorOverride above.
    delete card.textChanges;
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
        // 9th segment (index 8): the printed-token Scryfall id, kept in place so
        // existing decoders that read `parts[8]` as the image print id are
        // unaffected.
        spec.imagePrintId ?? "",
        // 10th segment (index 9): CR 611 static-effect kinds present on the
        // token (Tetravite's "can't be enchanted" guard). A token carrying a
        // static effect is a distinct definition shape, so its presence must
        // feed the content hash — keyed by the effect kinds (the guard
        // predicates are closures and can't be serialized, but the kind set
        // uniquely distinguishes the token shapes in the current catalog).
        // Empty when the token has no continuous effects (back-compat: a 9-
        // segment id without this trailing segment decodes as "no effects").
        (spec.staticEffects ?? []).map((e) => e.kind).join(","),
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

        setChosenPlayer(playerId: string): void {
            // CR 603.6b / 614.12 — record a player chosen as this permanent
            // enters (or when an ability resolves), stored on the source
            // instance for the rest of the game. The source is the resolving
            // permanent: an ETB trigger's `triggerSourceId` points at the
            // permanent that just entered. No-op if it is no longer on the
            // battlefield.
            const src = findOnBattlefield(
                state,
                item.triggerSourceId ?? item.id
            );
            if (src) src.card.chosenPlayerId = playerId;
        },

        getChosenPlayer(): string | undefined {
            const src = findOnBattlefield(
                state,
                item.triggerSourceId ?? item.id
            );
            return src?.card.chosenPlayerId;
        },

        getChosenModeId(): string | undefined {
            const src = findOnBattlefield(
                state,
                item.triggerSourceId ?? item.id
            );
            return src?.card.chosenModeId;
        },

        hasRemovedKeyword(permanentId: string, keyword: string): boolean {
            const found = findOnBattlefield(state, permanentId);
            return (
                found?.card.removedKeywords?.some(
                    (r) => r.keyword === keyword
                ) ?? false
            );
        },

        becomeCopyOf(sourceCreatureId: string, opts?: CopyOptions): void {
            // CR 707.2 — apply a copy effect to the resolving permanent. The
            // recipient is the source of this resolution: for an ETB copy
            // choice (Clone, resolveSteps) it is the spell still on the stack
            // about to enter; for a triggered re-copy (Vesuvan upkeep) it is
            // the source permanent on the battlefield.
            const source = findOnBattlefield(state, sourceCreatureId)?.card;
            if (!source) return;
            const recipient =
                findOnBattlefield(state, item.triggerSourceId ?? item.id)
                    ?.card ?? item;
            applyCopy(recipient, source, opts);
        },

        setSelfBody(spec): void {
            // CR 614.12 — "as it enters, [it becomes] …" body selection, and
            // its on-battlefield re-choice (Shapeshifter upkeep). Recipient
            // resolution mirrors `becomeCopyOf`: during a permanent spell's
            // `resolveSteps` the recipient is the spell still on the stack
            // (`item`, about to enter); during a triggered re-choice it is the
            // source permanent on the battlefield (`triggerSourceId`).
            const recipient =
                findOnBattlefield(state, item.triggerSourceId ?? item.id)
                    ?.card ?? item;
            // Overwrite base P/T (set, not add) so the layer pipeline reads the
            // chosen value as the pre-layer base; an upkeep re-set replaces the
            // prior choice cleanly.
            if (spec.power !== undefined) recipient.power = spec.power;
            if (spec.toughness !== undefined) {
                recipient.toughness = spec.toughness;
            }
            // CR 205.3 / 702 — append subtypes / keyword abilities without
            // duplicating (an idempotent re-application leaves the array
            // unchanged).
            if (spec.addSubtypes?.length) {
                const next = [...recipient.subtypes];
                for (const s of spec.addSubtypes) {
                    if (!next.includes(s)) next.push(s);
                }
                recipient.subtypes = next;
            }
            if (spec.addKeywords?.length) {
                const next = [...recipient.staticAbilities];
                for (const k of spec.addKeywords) {
                    if (!next.includes(k)) next.push(k);
                }
                recipient.staticAbilities = next;
            }
        },

        forEachPlayer(fn: (playerId: string) => void) {
            for (const p of state.players) fn(p.id);
        },

        flipCoin(): boolean {
            // CR 705.2 — flip a coin. Routed through the game's seeded PRNG
            // (rngSeed/rngCounter) so the outcome is deterministic on replay,
            // exactly like seeded shuffles and random discard. randomInt(2)
            // returns 0 or 1; treat 1 as heads (the flipping player wins).
            return randomInt(state, 2) === 1;
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
                // CR 120.3 (artifact-narrowed) — Reverse Polarity tally.
                bumpArtifactDamageToPlayer(
                    state,
                    target.id,
                    reduced,
                    desc.types
                );
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
                    // CR 704.5g lethal → destroy replacement (CR 614, ADR
                    // 0020) then regen shield gets a chance to replace the
                    // destroy (CR 614.5, 701.15a).
                    destroyWithReplacements(state, target.id);
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
            let entry: DamageRedirection;
            switch (shield.kind) {
                case "prevent-from-source-gain-life":
                    entry = {
                        kind: "prevent-from-source-gain-life",
                        sourceInstanceId: shield.sourceInstanceId,
                        playerId: shield.playerId,
                        duration: resolved,
                    };
                    break;
                case "to-self-redirect-to-owner":
                    entry = {
                        kind: "to-self-redirect-to-owner",
                        targetInstanceId: shield.targetInstanceId,
                        remaining: shield.remaining,
                        duration: resolved,
                    };
                    break;
                case "from-source-to-permanent-redirect-to-player":
                    entry = {
                        kind: "from-source-to-permanent-redirect-to-player",
                        sourceInstanceId: shield.sourceInstanceId,
                        targetInstanceId: shield.targetInstanceId,
                        redirectToPlayerId: shield.redirectToPlayerId,
                        remaining: shield.remaining,
                        duration: resolved,
                    };
                    break;
                case "reflect-to-source-controller":
                    entry = {
                        kind: "reflect-to-source-controller",
                        sourceInstanceId: shield.sourceInstanceId,
                        playerId: shield.playerId,
                        remaining: shield.remaining,
                        duration: resolved,
                    };
                    break;
            }
            state.damageRedirections = [
                ...(state.damageRedirections ?? []),
                entry,
            ];
        },
        addDestroyReplacementShield(
            target: TargetSelection,
            duration: DurationSpec
        ): void {
            // CR 614 — Pyramids' "the next time target land would be destroyed
            // this turn" save. One-shot, target-keyed transient replacement.
            if (target.type !== "permanent") return;
            if (!findOnBattlefield(state, target.id)) return;
            state.destroyReplacementShields = [
                ...(state.destroyReplacementShields ?? []),
                {
                    targetInstanceId: target.id,
                    remaining: 1,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        preventAllCombatDamageToAndBy(
            target: TargetSelection,
            duration: DurationSpec
        ): void {
            // CR 615 — Ebony Horse: prevent all combat damage to and by the
            // target for the duration. Stored per-instance, consumed in the
            // combat damage step (both as source and as target).
            if (target.type !== "permanent") return;
            if (!findOnBattlefield(state, target.id)) return;
            state.combatDamageImmunity = [
                ...(state.combatDamageImmunity ?? []),
                {
                    instanceId: target.id,
                    duration: resolveDuration(duration, item.castById, state),
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
        // CR 611.2 (ATQ Ashnod's Battle Gear, Tawnos's Weaponry): a P/T
        // modification whose lifetime is tied to the source staying tapped,
        // not to a phase boundary. Stored on the target keyed by the source's
        // instance id; read live at layer 7d while the source is tapped and
        // pruned by the `checkSourceTappedEffects` SBA when it untaps/leaves.
        addSourceTappedPTBuff(
            target: TargetSelection,
            power: number,
            toughness: number
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const sourceId = item.triggerSourceId ?? item.id;
            found.card.sourceTappedPTMods = [
                ...(found.card.sourceTappedPTMods ?? []),
                { power, toughness, sourceId },
            ];
        },
        // CR 611.2 (ATQ Phyrexian Gremlins): untap-lock tied to the source
        // staying tapped. Recorded on the target; the untap step skips a
        // permanent with a non-empty `untapLockedBy`, and the SBA clears the
        // source id once it untaps/leaves.
        lockUntapWhileSourceTapped(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const sourceId = item.triggerSourceId ?? item.id;
            const existing = found.card.untapLockedBy ?? [];
            if (existing.includes(sourceId)) return;
            found.card.untapLockedBy = [...existing, sourceId];
        },
        setBasePT(
            target: TargetSelection,
            power: number | undefined,
            toughness: number | undefined,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            if (power === undefined && toughness === undefined) return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            // CR 613.4b / 613.7 — append; the latest entry per characteristic
            // wins at read time. Purged with temporaryPTMods at the boundary.
            const entry: {
                power?: number;
                toughness?: number;
                duration: Duration;
            } = { duration: resolveDuration(duration, item.castById, state) };
            if (power !== undefined) entry.power = power;
            if (toughness !== undefined) entry.toughness = toughness;
            found.card.temporaryPTSet = [
                ...(found.card.temporaryPTSet ?? []),
                entry,
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
            return destroyWithReplacements(state, target.id, opts);
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
        // CR 400.7 / ADR 0027 — library tutor → battlefield. Locate
        // `cardInstanceId` in `playerId`'s library, splice it out, and put it
        // onto `playerId`'s battlefield via the shared `putReanimatedOnBattle-
        // field` path (same ETB / grant application as reanimation, since both
        // are zone changes onto the battlefield). The search half is a separate
        // `requestChoice({ kind: "search-library" })`; this is only the move.
        // Returns false on silent fizzle when the id is not in the library at
        // resolution (CR 608.2b). Used by Transmute Artifact.
        putFromLibraryOntoBattlefield(
            playerId: string,
            cardInstanceId: string
        ): boolean {
            const player = getPlayer(state, playerId);
            const idx = player.library.findIndex(
                (c) => c.id === cardInstanceId
            );
            if (idx === -1) return false;
            const [card] = player.library.splice(idx, 1);
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
            // CR 708.9 / ADR 0013 — turn a face-down target up before tapping.
            tapPermanent(state, found.card);
        },
        // CR 701.20b: to untap a permanent is to rotate it back to upright.
        // Already-untapped permanents are unaffected. Silently no-ops if the
        // target has left the battlefield (CR 608.2b).
        untap(target: TargetSelection): void {
            if (target.type === "player")
                throw new Error("Cannot untap a player");
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            // CR 701.20b — emit "becomes untapped" on the transition so
            // untap-watching triggers (Tawnos's Coffin) fire (ADR 0028).
            untapPermanent(state, found.card);
        },
        // CR 613.1b (layer 2): gain control of a permanent. The control change
        // is sourced by the resolving permanent (`item.id`) so it reverts when
        // that source leaves or its `condition` lapses (Aladdin, Old Man of the
        // Sea). Ghazbán Ogre omits the condition for an indefinite reassign.
        gainControl(
            target: TargetSelection,
            newControllerId: string,
            condition?: ControlChangeCondition
        ): void {
            if (target.type !== "permanent") return;
            if (!findOnBattlefield(state, target.id)) return;
            applyControlChange(
                state,
                target.id,
                newControllerId,
                item.id,
                condition
            );
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
                // Each victim independently gets a chance to consume a destroy
                // replacement (CR 614, ADR 0020) or a regeneration shield
                // (CR 614.5, 701.15a) — unless the caller opts out via
                // `cantBeRegenerated` (CR 701.15c).
                destroyWithReplacements(state, id, opts);
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
        // CR 614 — arm a one-shot replacement for the next draw `playerId`
        // takes this turn (Aladdin's Lamp). Consumed by the draw step.
        // No-op for X ≤ 0 ("X can't be 0").
        armNextDraw(playerId: string, x: number): void {
            if (x <= 0) return;
            state.drawLookReplacements = state.drawLookReplacements ?? [];
            state.drawLookReplacements.push({ playerId, x });
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
        // CR 702.26 — phase a permanent (and its Auras/Equipment) out of
        // existence. See `phaseOutPermanent`.
        phaseOut(permanentId, opts) {
            return phaseOutPermanent(state, permanentId, opts);
        },
        // CR 702.26 — phase a bundle back in. See `phaseInBundle`.
        phaseIn(bundleId) {
            return phaseInBundle(state, bundleId);
        },
        // CR 603.7a / ADR 0028 — exile a creature + its Auras, noting counters,
        // and arm a return keyed to `sourceId`. See `exileWithAttachments`.
        exileWithAttachments(targetId, opts) {
            return exileWithAttachments(state, targetId, opts);
        },
        // CR 603.7a / ADR 0028 — return every bundle held by `sourceId`. See
        // `returnExiledForSource`.
        returnExiledForSource(sourceId) {
            returnExiledForSource(state, sourceId);
        },
        // CR 701.20: randomize a player's library. Uses the seeded PRNG so
        // replays reproduce the same ordering. ADR 0026: a shuffle is an
        // unwitnessed reordering — clear ALL persistent knowledge of every
        // card in the library (nobody, not even the shuffler, knows the new
        // order).
        shuffleLibrary(playerId: string): void {
            const library = getPlayer(state, playerId).library;
            seededShuffle(state, library);
            clearKnowledge(library, null);
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
        discardAtRandom(
            playerId: string,
            amount: number,
            requireType?: CardType
        ): void {
            discardCardsAtRandom(state, playerId, amount, requireType);
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
        addRestrictedMana(
            playerId: string,
            cost: CardManaCost,
            restriction: ManaRestriction
        ): void {
            const player = getPlayer(state, playerId);
            for (const [color, amount] of Object.entries(cost)) {
                if (color === "X" || typeof amount !== "number" || amount <= 0)
                    continue;
                addRestrictedManaToPool(player, color, amount, restriction);
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
        // CR 104.4a — the game ends in a draw. Neither player wins or loses;
        // `winnerId`/`loserId` are left empty and `isDraw` flags the outcome.
        // Used by Divine Intervention's "the game is a draw" trigger (LEG).
        drawGame(): void {
            if (state.gameOver) return;
            state.gameOver = {
                winnerId: "",
                loserId: "",
                reason: "draw",
                isDraw: true,
            };
        },
        getDamageDealtThisTurn(playerId: string): number {
            return state.damageDealtToPlayerThisTurn?.[playerId] ?? 0;
        },
        getArtifactDamageDealtThisTurn(playerId: string): number {
            return state.artifactDamageToPlayerThisTurn?.[playerId] ?? 0;
        },
        getMarkedDamage(target): number {
            if (target.type !== "permanent") return 0;
            const found = findOnBattlefield(state, target.id);
            return found?.card.damageMarked ?? 0;
        },
        // CR 111 / 707.1: token creation. The token enters as a brand-new
        // permanent under `controllerId`, owner = controller (CR 111.2 — token
        // owner is the player who created it). Tokens carry no card-registry
        // id; their colors are encoded as a synthetic mana cost so hasColor /
        // projection treat them like printed cards. Existing battlefield
        // sources' lord-style grants reach the new token via
        // `applyExistingGrantsTo` (CR 611). CR 704.5d cleanup is handled by
        // `checkTokenExistenceSBA` if the token ever leaves the battlefield.
        createToken(spec, controllerId, count = 1, createdBy): string[] {
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
                // CR 611 — register the token's continuous static effects on its
                // synthesized definition so def-keyed readers (isGuardedAgainst
                // for the Tetravite "can't be enchanted" guard) observe them.
                ...(spec.staticEffects && spec.staticEffects.length > 0
                    ? { staticEffects: [...spec.staticEffects] }
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
                    // CR 111 / 707.1 — token provenance link. Records the
                    // creating permanent so a source can later identify the
                    // tokens it made (Tetravus exiles its own Tetravites to
                    // recover +1/+1 counters).
                    ...(createdBy ? { createdBy } : {}),
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
        // CR 611.2c: grants a keyword with NO duration and NO aura link — it
        // persists for as long as the permanent stays on the battlefield (a
        // permanent "gains [keyword]" effect that is not dependent on a still-
        // present source, e.g. Cocoon's "that creature gains flying" after the
        // Aura is sacrificed). The entry is kept by both the duration tick and
        // the aura-unapply pass (both skip entries lacking duration/auraId), and
        // is cleared only when the permanent leaves play.
        grantStaticAbilityPermanent(
            target: TargetSelection,
            ability: string
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            if (found.card.staticAbilities.includes(ability)) return;
            found.card.staticAbilities = [
                ...found.card.staticAbilities,
                ability,
            ];
            found.card.grantedStaticAbilities = [
                ...(found.card.grantedStaticAbilities ?? []),
                { ability },
            ];
        },
        // CR 611.1b layer 6: removes every keyword matching `predicate` from
        // `staticAbilities` for the duration, recording each on
        // `temporaryRemovedKeywords` so the phase-boundary purge restores it on
        // expiry. The duration-scoped inverse of `grantStaticAbility`. Used by
        // Shelkin Brownie / Tolaria to strip banding and "bands with other"
        // abilities until end of turn.
        removeStaticAbilities(
            target: TargetSelection,
            predicate: (keyword: string) => boolean,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const resolved = resolveDuration(duration, item.castById, state);
            const kept: string[] = [];
            const removedNow: { keyword: string; duration: Duration }[] = [];
            for (const kw of found.card.staticAbilities) {
                if (predicate(kw)) {
                    removedNow.push({ keyword: kw, duration: resolved });
                } else {
                    kept.push(kw);
                }
            }
            if (removedNow.length === 0) return;
            found.card.staticAbilities = kept;
            found.card.temporaryRemovedKeywords = [
                ...(found.card.temporaryRemovedKeywords ?? []),
                ...removedNow,
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
            timing: "next-end-step" | "next-end-of-combat" | "next-draw-step",
            payload: Record<string, string>,
            targetPlayerId?: string
        ): void {
            state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
            const instance: DelayedTriggerInstance = {
                id: `delayed-${state.nextDelayedSeq}`,
                sourceCardId,
                triggerId,
                controller: item.castById,
                timing,
                payload,
                ...(targetPlayerId ? { targetPlayerId } : {}),
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

        isSummoningSick(target: TargetSelection): boolean {
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            return found?.card.isSummoningSick === true;
        },

        hasStaticAbility(target: TargetSelection, ability: string): boolean {
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            return found?.card.staticAbilities.includes(ability) === true;
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
                // Remove this blocker from the assignments. The attackers it
                // was blocking STAY blocked (CR 509.1h) — blocked status lives
                // in combat.blockedAttackerIds, not the live blocker count — so
                // they deal no combat damage to the defender without trample.
                const ba = state.combat.blockerAssignments;
                if (ba[target.id]) {
                    delete ba[target.id];
                }
            }
        },

        becomeUnblocked(attackerId: string): void {
            if (!state.combat) return;
            // CR 509.1h override (Ydwen Efreet): an attacker that became
            // blocked is made unblocked, so it deals its combat damage to the
            // defending player. Drop it from the blocked set and strip it from
            // every blocker's assignment so the live block graph agrees.
            if (state.combat.blockedAttackerIds) {
                state.combat.blockedAttackerIds =
                    state.combat.blockedAttackerIds.filter(
                        (id) => id !== attackerId
                    );
            }
            const ba = state.combat.blockerAssignments;
            for (const blockerId of Object.keys(ba)) {
                const filtered = ba[blockerId].filter(
                    (id) => id !== attackerId
                );
                if (filtered.length !== ba[blockerId].length) {
                    ba[blockerId] = filtered;
                }
            }
        },

        getBlockersByAttacker(): Record<string, string[]> {
            if (!state.combat) return {};
            return getEffectiveBlockGraph(state).blockersByAttacker;
        },

        setMustBlockAll(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.mustBlockAllThisTurn = true;
        },

        setCantBlockThisTurn(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.cantBlockThisTurn = true;
        },

        setCantBeBlockedThisTurn(target: TargetSelection): void {
            // CR 509.1b — flag an attacker as unblockable this turn (Tawnos's
            // Wand). Read on the attacker side by `validateBlockerEligibility`;
            // cleared at CLEANUP (CR 514.2). No-op off the battlefield.
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.cantBeBlockedThisTurn = true;
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

        addTextChange(target: TargetSelection, change: TextChange): void {
            // CR 612: the change rides the target instance, so it lasts
            // indefinitely and ends on a zone change (CR 612.7). Appended so
            // multiple changes stack in timestamp order (CR 612.6).
            if (target.type === "permanent") {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                found.card.textChanges = [
                    ...(found.card.textChanges ?? []),
                    change,
                ];
            } else if (target.type === "spell") {
                const si = state.stack.find((s) => s.id === target.id);
                if (!si) return;
                si.textChanges = [...(si.textChanges ?? []), change];
            }
        },

        getLandTypesPresent(target: TargetSelection): string[] {
            let instance: CardInstanceState | undefined;
            if (target.type === "permanent") {
                instance = findOnBattlefield(state, target.id)?.card;
            } else if (target.type === "spell") {
                instance = state.stack.find((s) => s.id === target.id);
            }
            return instance ? landTypesPresent(instance) : [];
        },

        getColorWordsPresent(target: TargetSelection): string[] {
            let instance: CardInstanceState | undefined;
            if (target.type === "permanent") {
                instance = findOnBattlefield(state, target.id)?.card;
            } else if (target.type === "spell") {
                instance = state.stack.find((s) => s.id === target.id);
            }
            if (!instance) return [];
            // Color words live in two places: stringly-typed staticAbilities
            // (read inside colorWordsPresent) and the structured colorFilter on
            // the object's color-targeted requirements (its card-level / modal
            // spell requirement and any activated-ability requirements — e.g. a
            // Circle of Protection's "<color> source of your choice").
            const cardId = (instance.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : undefined;
            const extraColorCodes: Color[] = [];
            const collect = (req: TargetRequirement | undefined): void => {
                if (req?.colorFilter) extraColorCodes.push(req.colorFilter);
            };
            collect(def?.targetRequirement);
            for (const mode of def?.modes ?? [])
                collect(mode.targetRequirement);
            for (const ability of def?.activatedAbilities ?? []) {
                collect(ability.targetRequirement);
            }
            return colorWordsPresent(instance, extraColorCodes);
        },

        setPileLabel(cardInstanceId: string, label: string): void {
            const found = findOnBattlefield(state, cardInstanceId);
            if (!found) return;
            found.card.pileLabel = label;
        },

        addCombatBlockRestriction(
            attackerId: string,
            allowedPileLabel: string
        ): void {
            const existing = (state.combatBlockRestrictions ?? []).filter(
                (r) => r.attackerId !== attackerId
            );
            state.combatBlockRestrictions = [
                ...existing,
                { attackerId, allowedPileLabel },
            ];
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
            if (req.allControllers) entry.allControllers = true;
            if (req.candidateIds) entry.candidateIds = req.candidateIds;
            if (req.candidatePlayerIds) {
                entry.candidatePlayerIds = req.candidatePlayerIds;
            }
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
        requestOptionChoice(req): string | undefined {
            // CR 614.12 / 701.x "as it enters, choose …" — pick exactly one
            // abstract option. Mirrors `requestChoice`'s suspend/replay
            // contract: first call enqueues an `option-pick` PendingChoice and
            // returns undefined (the step must return early to suspend); the
            // replay after `selectResolutionChoice` reads the stored option id.
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored[0];
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: req.playerId,
                kind: "option-pick",
                count: 1,
                options: req.options,
                prompt: req.prompt,
            };
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        requestCoinFlip(req): boolean | undefined {
            // CR 705.2 / ADR 0023 — engine-generated random reveal. Unlike the
            // player-answer primitives above, the OUTCOME is drawn here, not
            // submitted by a player. The drawn bit must be generated EXACTLY
            // ONCE and persisted, then read back on resume — a naive re-roll
            // on the replayed step would advance `rngCounter` and animate a
            // different result than the one applied (the determinism bug ADR
            // 0023 calls out).
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            // Resume: the persisted bit short-circuits the re-run, no re-roll.
            if (stored) return stored[0] === "heads";

            // First call: draw the bit ONCE via the seeded coin flip.
            const won = this.flipCoin();
            // Persist the realized bit into collectedChoices so the replayed
            // step reads it back instead of re-flipping (same contract as a
            // stored player answer). The ack mutation only removes the head
            // pending choice and resumes; it carries no data.
            item.collectedChoices = {
                ...(item.collectedChoices ?? {}),
                [key]: [won ? "heads" : "tails"],
            };
            const winning = won ? req.heads : req.tails;
            const realized: RealizedOutcome = {
                face: winning.face ?? (won ? "WIN" : "LOSE"),
                consequence: winning.consequence,
            };
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: req.playerId,
                kind: "random-reveal",
                count: 1,
                prompt: "Flip a coin",
                randomKind: "coin",
                sides: 2,
                // CR 705.2 — 1 = heads (the flipping player wins), 0 = tails.
                result: won ? 1 : 0,
                realized,
            };
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
            // CR 202.2 — populate effective colors so color-scoped filters
            // (Magnetic Mountain's "blue creatures") match on the battlefield.
            return bf
                .filter((c) =>
                    matchesPermanentFilter(
                        { ...c, colors: STATIC_EFFECT_CTX.getColors(c) },
                        filter
                    )
                )
                .map((c) => c.id);
        },
        getCardDefinitionId(cardInstanceId: string): string | undefined {
            const found = findOnBattlefield(state, cardInstanceId);
            return found ? (found.card.card as { id?: string }).id : undefined;
        },
        isPrintedInSet(cardInstanceId: string, setCode: string): boolean {
            const found = findOnBattlefield(state, cardInstanceId);
            const cardId = found
                ? (found.card.card as { id?: string }).id
                : undefined;
            return cardId ? isCardPrintedInSet(cardId, setCode) : false;
        },
        hasSubtype(target: TargetSelection, subtype: string): boolean {
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            return found?.card.subtypes.includes(subtype) ?? false;
        },
        getHandIds(playerId: string): string[] {
            return getPlayer(state, playerId).hand.map((c) => c.id);
        },
        getDrawnThisTurnIds(playerId: string): string[] {
            return [...(getPlayer(state, playerId).drawnThisTurn ?? [])];
        },
        moveHandCardToLibraryTop(
            playerId: string,
            cardInstanceId: string
        ): boolean {
            return putHandCardOnTopOfLibrary(
                getPlayer(state, playerId),
                cardInstanceId
            );
        },
        recallChoice(choiceId: string): string[] | undefined {
            // Scan the stack item's collected answers for any earlier step's
            // entry matching this choiceId (keys are `${step}:${choiceId}`).
            const cc = item.collectedChoices;
            if (!cc) return undefined;
            for (const key of Object.keys(cc)) {
                if (key.endsWith(`:${choiceId}`)) return cc[key];
            }
            return undefined;
        },
        // CR 701.16: to sacrifice a permanent is for its controller to put
        // it into its owner's graveyard. Indestructible does not prevent
        // sacrifice (CR 701.16a). No-op if the id is not on the battlefield.
        sacrifice(cardInstanceId: string): void {
            removePermanentTo(state, cardInstanceId, "graveyard", "sacrifice");
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
            // ADR 0026 / PRD #338 (slice 4), clear trigger #2: an owner-chosen
            // discard (Disrupting Scepter, Wheel of Fortune, Balance, cleanup)
            // is a change the OWNER chose-and-witnessed but a non-owner knower
            // did not. Conservatively revert the whole remaining hand to hidden
            // for every non-owner viewer — the knower can no longer trust their
            // identity→card mapping. `selectorId = playerId` keeps only the
            // owner's knowledge, but the owner never appears in their own hand
            // `knownTo`, so in practice this clears all non-owner knowers.
            clearKnowledge(player.hand, playerId);
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
            // CR 106.4: emptying the pool also clears restricted mana. The
            // drained record returned to callers (Drain Power) reflects only
            // fungible mana — restricted mana's spend restriction is dropped
            // rather than transferred (rare interaction, documented deviation).
            player.restrictedMana = undefined;
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
        // ADR 0026 / PRD #338 — stamp persistent knowledge on hidden-zone cards.
        markKnown(
            zoneOwnerId: string,
            cardInstanceIds: string[],
            knowerId: string
        ): void {
            grantKnowledge(state, zoneOwnerId, cardInstanceIds, knowerId);
        },
        // ADR 0026 / PRD #338 (slice 2) — reveal: stamp every player onto the
        // cards' knownTo so they are face-up to all until a shuffle clears them.
        markKnownToAll(zoneOwnerId: string, cardInstanceIds: string[]): void {
            grantKnowledgeToAll(state, zoneOwnerId, cardInstanceIds);
        },
        // ADR 0026 / PRD #338 (slice 6) — impulse-draw: exile a card face down
        // for `knowerId` alone to look at (CR 406.3). Reuses `knownTo` (NOT a
        // new face-down-exile field; `faceDownOf` stays scoped to battlefield
        // morphs). No-op if the card isn't in `from`.
        exileFaceDown(
            ownerId: string,
            cardInstanceId: string,
            from: "library" | "hand" | "graveyard",
            knowerId: string
        ): void {
            const player = getPlayer(state, ownerId);
            exileFaceDownCard(player, cardInstanceId, from, knowerId);
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
        getHandCards(playerId: string): Array<{
            id: string;
            types: CardType[];
            manaValue: number;
            colors: Color[];
        }> {
            return getPlayer(state, playerId).hand.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                return {
                    id: c.id,
                    types: def?.types ?? c.types,
                    manaValue: manaValue(def?.manaCost),
                    // CR 202.2 — mana-cost-derived colors of the hand card.
                    colors: getColorsFromCost(def?.manaCost),
                };
            });
        },
        // CR 108.1 — library card characteristics from the registry. Mirrors
        // `getHandCards`; used to precompute the `candidateIds` allow-list for a
        // filtered `search-library` choice (Transmute Artifact: artifact cards).
        getLibraryCards(
            playerId: string
        ): Array<{ id: string; types: CardType[]; manaValue: number }> {
            return getPlayer(state, playerId).library.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                return {
                    id: c.id,
                    types: def?.types ?? c.types,
                    manaValue: manaValue(def?.manaCost),
                };
            });
        },
        // CR 108.1 — graveyard card characteristics from the registry. Mirrors
        // `getHandCards`; used by effects that count graveyard cards by colour
        // (Nameless Race: "white cards in their graveyards").
        getGraveyardCards(playerId: string): Array<{
            id: string;
            types: CardType[];
            manaValue: number;
            colors: Color[];
        }> {
            return getPlayer(state, playerId).graveyard.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetCardById(cardId) : undefined;
                return {
                    id: c.id,
                    types: def?.types ?? c.types,
                    manaValue: manaValue(def?.manaCost),
                    colors: getColorsFromCost(def?.manaCost),
                };
            });
        },
        // CR 708.2 / 707 — Illusionary Mask. Move the chosen card hand → stack,
        // turn it face down (real id retained in `faceDownOf`), and push it as
        // a creature spell paying no mana cost. It resolves next into a
        // face-down 2/2 permanent via the normal creature-spell path.
        castFaceDown(cardInstanceId: string): void {
            const player = getPlayer(state, item.castById);
            const inHand = player.hand.some((c) => c.id === cardInstanceId);
            if (!inHand) return;
            const card = removeFromZone(player, cardInstanceId, "hand");
            turnFaceDown(card);
            const stackItem: StackItem = {
                ...card,
                zone: "stack",
                castById: item.castById,
            };
            // The currently-resolving item (`item`) is on top of the stack and
            // is popped by `resolveTopOfStack` once its resolve returns. Insert
            // the new spell directly BELOW it so it becomes the new top after
            // the pop — i.e. it resolves next (CR 608.2f). Mirrors
            // `copyStackItem`'s insert-below-the-resolver discipline.
            const idx = state.stack.findIndex((s) => s.id === item.id);
            if (idx === -1) state.stack.push(stackItem);
            else state.stack.splice(idx, 0, stackItem);
        },
    };
    return ctx;
}

/** ADR 0026 — zones in which a card's identity is universally known. Entering
 *  any of these clears the instance's persistent per-viewer `knownTo`. (Exile
 *  is treated as public here; face-down exile / impulse-draw — which keeps the
 *  card known to its controller — is a later slice and will gate this.) */
const PUBLIC_ZONES = new Set<Zone>(["battlefield", "graveyard", "exile"]);

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
    const drawn = moveCard(player, player.library[0].id, "library", "hand");
    // Track the most recent draw this turn (CR — "the last card you drew this
    // turn"). Reset at turn start in advanceTurn. Used by Jandor's Ring.
    player.lastDrawnCardId = drawn.id;
    // Full per-turn draw tally (CR 121.1) — Sylvan Library "cards drawn this
    // turn". Reset alongside lastDrawnCardId at turn start.
    player.drawnThisTurn = [...(player.drawnThisTurn ?? []), drawn.id];
    return drawn;
}

/** Moves a card between player zones (not stack). Returns the moved card.
 *  Card is appended to the destination zone (library push = bottom, since
 *  drawCard reads from index 0). */
/** Moves a card from a player's hand to the TOP of their library (CR 121.1 —
 *  top = index 0, where `drawCard` reads). Returns false if the card isn't in
 *  hand. Shared by the SpellContext primitive (Sylvan Library) and the discard
 *  replacement (Library of Leng). */
export function putHandCardOnTopOfLibrary(
    player: PlayerState,
    cardInstanceId: string
): boolean {
    const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
    if (idx === -1) return false;
    const [card] = player.hand.splice(idx, 1);
    card.zone = "library";
    player.library.unshift(card);
    return true;
}

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

    // ADR 0026 — entering a public zone makes identity universally known, so
    // persistent per-viewer knowledge is meaningless there; empty it so a
    // later return to a hidden zone is hidden again unless freshly re-granted.
    // Stale `knownTo` never resurrects.
    if (PUBLIC_ZONES.has(to)) delete card.knownTo;

    const targetZone = player[toField] as CardInstanceState[];
    targetZone.push(card);

    return card;
}

/** ADR 0026 / PRD #338 (slice 6) — exiles a card FACE DOWN for `knowerId` to
 *  look at (impulse-draw, e.g. "exile the top card; you may look at it"). The
 *  card moves to its owner's exile pile but, unlike a normal (face-up) exile,
 *  its identity stays secret to everyone except `knowerId`: it is the controller
 *  alone who is stamped into `knownTo`.
 *
 *  This deliberately does NOT route through `moveCard` (which treats exile as a
 *  public zone and strips `knownTo`, CR 406 — exile is normally an open zone).
 *  Face-down exile is the documented exception (CR 406.3): a card exiled face
 *  down is hidden from all players except those an effect lets look at it. The
 *  projection re-derives the per-viewer gate purely from `knownTo` — an exile
 *  card with a non-empty `knownTo` is a face-down exile, hidden from non-knowers
 *  and shown face-up only to the players in `knownTo`.
 *
 *  Reuses `knownTo` per ADR 0026 — NOT `faceDownOf`, which stays scoped to
 *  battlefield morphs (CR 708). The real `card.id` is retained in state (no
 *  vanilla-2/2 override); only the projection swaps it for a sentinel on the
 *  wire. No-op if the card isn't in `from`. */
export function exileFaceDownCard(
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack" | "battlefield">,
    knowerId: string
): CardInstanceState | null {
    const fromField = ZONE_TO_FIELD[from];
    const sourceZone = player[fromField] as CardInstanceState[];
    const cardIndex = sourceZone.findIndex((c) => c.id === cardInstanceId);
    if (cardIndex === -1) return null;

    const [card] = sourceZone.splice(cardIndex, 1);
    card.zone = "exile";
    // The whole point of a face-down exile: knowledge is granted, not stripped.
    card.knownTo = [knowerId];
    player.exile.push(card);
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
    // ADR 0026 — the stack is a public zone: putting a card on the stack makes
    // its identity universally known. Empty its persistent per-viewer knowledge
    // so that if it later returns to a hidden zone (e.g. a countered spell sent
    // to hand, or a bounce) it is hidden again unless freshly re-granted. Stale
    // `knownTo` never resurrects.
    delete card.knownTo;
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

/** True iff `player` can pay a "discard the last card you drew this turn"
 *  cost (Jandor's Ring) — they drew a card this turn and it is still in
 *  their hand (CR 118.3 — additional cost; CR 701.8 — discard). */
export function canPayDiscardLastDrawn(player: PlayerState): boolean {
    const id = player.lastDrawnCardId;
    if (!id) return false;
    return player.hand.some((c) => c.id === id);
}

/** Pays a "discard the last card you drew this turn" cost by discarding that
 *  exact card. Throws if the card is no longer in hand (callers must check
 *  `canPayDiscardLastDrawn` first). Clears the tracker so the same draw can't
 *  pay a second activation this turn. */
export function payDiscardLastDrawn(player: PlayerState): void {
    const id = player.lastDrawnCardId;
    if (!id || !player.hand.some((c) => c.id === id)) {
        throw new Error("No card drawn this turn left to discard");
    }
    moveCard(player, id, "hand", "graveyard");
    player.lastDrawnCardId = undefined;
}

/** Discards `amount` cards at random from `playerId`'s hand (CR 701.8), using
 *  the game's seeded PRNG so replays reproduce the same picks. Clamped to the
 *  hand size. Routes each discard through the discard-replacement layer
 *  (CR 614 — Library of Leng). Shared by `SpellContext.discardAtRandom` (an
 *  effect) and `payDiscardAtRandomCost` (an activation cost, CR 118.3). */
export function discardCardsAtRandom(
    state: GameState,
    playerId: string,
    amount: number,
    requireType?: CardType
): void {
    const player = getPlayer(state, playerId);
    // CR 701.8a — when a type is required (Rag Man: "a creature card at
    // random"), the random pick is drawn only from the matching subset.
    const candidateId = (): string | undefined => {
        if (requireType === undefined) {
            if (player.hand.length === 0) return undefined;
            return player.hand[randomInt(state, player.hand.length)].id;
        }
        const matching = player.hand.filter((c) => {
            const cardId = (c.card as { id?: string }).id;
            const def = cardId ? tryGetCardById(cardId) : undefined;
            return (def?.types ?? c.types).includes(requireType);
        });
        if (matching.length === 0) return undefined;
        return matching[randomInt(state, matching.length)].id;
    };
    const picks = Math.min(amount, player.hand.length);
    for (let i = 0; i < picks; i++) {
        const cardId = candidateId();
        if (cardId === undefined) break;
        // CR 614 — Library of Leng's "may put it on top of library instead"
        // intercepts each discard. If the replacement consumes the event the
        // card has already been routed elsewhere; skip the default discard.
        const repl = applyDiscardReplacements(state, {
            kind: "discard",
            playerId,
            cardInstanceId: cardId,
        });
        if (repl === null) continue;
        moveCard(player, repl.cardInstanceId, "hand", "graveyard");
    }
    // ADR 0026 / PRD #338 (slice 3), clear trigger #2: a random discard is an
    // event the knower did not choose-and-witness — a player who knew this hand
    // can no longer trust their identity→card mapping. Conservatively revert the
    // WHOLE remaining hand to hidden for every non-owner viewer (the owner never
    // appears in their own hand `knownTo`, so `null` leaves it untouched).
    clearKnowledge(player.hand, null);
}

/** Pays a "discard N cards at random" activation cost (CR 118.3 / 701.8 —
 *  Coral Helm). Caller must validate the player has at least one card in hand
 *  (the cost is illegal with an empty hand). Discards via the seeded PRNG. */
export function payDiscardAtRandomCost(
    state: GameState,
    playerId: string,
    count: number
): void {
    discardCardsAtRandom(state, playerId, count);
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

/** True if restricted mana with `restriction` may pay for a spell with the
 *  given card types (CR 106.6). Modelled restrictions:
 *  - `creature-spell` — spendable solely on creature spells (Metamorphosis).
 *  - `artifact-spell` — spendable solely on artifact spells (Mishra's
 *    Workshop). Exhaustive `switch` over the union: a new member must add a
 *    case here (and the compiler enforces it). */
export function restrictionAllowsSpell(
    restriction: ManaRestriction,
    spellTypes: readonly string[]
): boolean {
    switch (restriction) {
        case "creature-spell":
            return spellTypes.includes("Creature");
        case "artifact-spell":
            return spellTypes.includes("Artifact");
    }
}

/** Adds `amount` restricted mana of `color` to a player's pool, merging into
 *  an existing entry of the same color + restriction (CR 106.4 — mana of the
 *  same kind is fungible). */
export function addRestrictedManaToPool(
    player: PlayerState,
    color: string,
    amount: number,
    restriction: ManaRestriction
): void {
    if (amount <= 0) return;
    const list = player.restrictedMana ?? [];
    const existing = list.find(
        (r) => r.color === color && r.restriction === restriction
    );
    if (existing) existing.amount += amount;
    else list.push({ color, amount, restriction });
    player.restrictedMana = list;
}

/** Builds the spendable pool for casting a spell: the base `manaPool` plus any
 *  restricted mana whose restriction permits this spell (CR 106.6). Used for
 *  the affordability check at spell-cast sites — callers pass whether the
 *  spell being cast is a creature spell. */
export function spendablePoolForSpell(
    player: PlayerState,
    spellTypes: readonly string[]
): Record<string, number> {
    const pool = { ...player.manaPool };
    for (const r of player.restrictedMana ?? []) {
        if (restrictionAllowsSpell(r.restriction, spellTypes)) {
            pool[r.color] = (pool[r.color] ?? 0) + r.amount;
        }
    }
    return pool;
}

/** Pays a spell's mana cost drawing on permitted restricted mana FIRST, then
 *  the fungible pool (CR 106.6). Spending restricted mana first is a settlement
 *  policy — it maximises the flexible mana the caster keeps and can never make
 *  a payment illegal, since coverage was already confirmed against the merged
 *  pool. Reuses `payManaCost` semantics by paying a merged pool then
 *  reassigning who paid each color. Caller must pass the spell's card types
 *  (drives which restricted mana is eligible). */
export function payManaCostForSpell(
    player: PlayerState,
    cost: Record<string, number>,
    spellTypes: readonly string[],
    substitutions: ManaSubstitution[] = []
): void {
    const eligible = (player.restrictedMana ?? []).filter((r) =>
        restrictionAllowsSpell(r.restriction, spellTypes)
    );
    if (eligible.length === 0) {
        payManaCost(player.manaPool, cost, substitutions);
        return;
    }

    // Merge eligible restricted mana into a working copy of the pool, pay
    // against it, then settle the consumption restricted-first.
    const merged = { ...player.manaPool };
    const restrictedByColor: Record<string, number> = {};
    for (const r of eligible) {
        merged[r.color] = (merged[r.color] ?? 0) + r.amount;
        restrictedByColor[r.color] =
            (restrictedByColor[r.color] ?? 0) + r.amount;
    }
    const before = { ...merged };
    payManaCost(merged, cost, substitutions);

    for (const color of MANA_COLORS) {
        const consumed = (before[color] ?? 0) - (merged[color] ?? 0);
        if (consumed <= 0) continue;
        // Drain from restricted mana of this color first.
        let fromRestricted = Math.min(consumed, restrictedByColor[color] ?? 0);
        const fromReal = consumed - fromRestricted;
        for (const r of eligible) {
            if (fromRestricted <= 0) break;
            if (r.color !== color) continue;
            const take = Math.min(r.amount, fromRestricted);
            r.amount -= take;
            fromRestricted -= take;
        }
        player.manaPool[color] = (player.manaPool[color] ?? 0) - fromReal;
    }

    // Drop emptied entries; clear the field entirely when nothing remains.
    const remaining = (player.restrictedMana ?? []).filter((r) => r.amount > 0);
    player.restrictedMana = remaining.length > 0 ? remaining : undefined;
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

/** Accumulated cost modification for a spell/ability (CR 601.2f): generic and
 *  colored increases, generic-only reductions, and the highest declared
 *  total-mana floor among the matching reduction effects. */
export interface CostModifiers {
    increase: Record<string, number>;
    /** Generic-mana reduction (sum of matching `costReduction` generic). */
    reductionGeneric: number;
    /** Largest `minTotalMana` among matching reduction effects (CR 601.2f /
     *  118.7 — the cost can't drop below this many total mana). 0 = no floor. */
    minTotalMana: number;
}

/** Scan the battlefield for `cost-modifier` static effects that apply to the
 *  given spell or ability source and return the accumulated modifiers (CR
 *  601.2f). Each effect's own carrier permanent is passed to its `appliesTo*`
 *  predicate so an Aura can scope its modifier to its host (Power Artifact). */
export function getCostModifiers(
    state: GameState,
    card: PermanentView,
    kind: "spell" | "ability"
): CostModifiers {
    const increase: Record<string, number> = {};
    let reductionGeneric = 0;
    let minTotalMana = 0;
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
                if (!pred || !pred(card, STATIC_EFFECT_CTX, source)) continue;
                if (effect.costIncrease) {
                    const norm = normalizeManaCost(effect.costIncrease);
                    for (const [k, v] of Object.entries(norm)) {
                        increase[k] = (increase[k] ?? 0) + v;
                    }
                }
                if (effect.costReduction) {
                    // Only the generic portion is reducible (CR 601.2f — a
                    // generic-mana reduction can't remove colored pips).
                    const norm = normalizeManaCost(effect.costReduction);
                    reductionGeneric += norm.X ?? 0;
                    if (
                        effect.minTotalMana !== undefined &&
                        effect.minTotalMana > minTotalMana
                    ) {
                        minTotalMana = effect.minTotalMana;
                    }
                }
            }
        }
    }
    return { increase, reductionGeneric, minTotalMana };
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

/** Apply accumulated cost modifiers to a base normalized cost (mutates),
 *  CR 601.2f. Order: increases first, then generic reductions, then the
 *  total-mana floor. Only the generic portion (`X`) is reducible — colored
 *  pips are never removed by a generic reduction. The floor guarantees the
 *  post-reduction total mana (generic + every colored pip) is at least
 *  `minTotalMana`, so Power Artifact's "can't reduce below one mana" holds
 *  even when the colored pips alone already meet the floor (then generic
 *  drops all the way to 0) and when they don't (generic stops at the floor).
 *  A reduction never RAISES a cost: a cost already at or below the floor is
 *  left untouched (Strip Mine's {T}-only mana ability stays free). */
export function applyCostModifiers(
    baseCost: Record<string, number>,
    modifiers: CostModifiers
): void {
    for (const [k, v] of Object.entries(modifiers.increase)) {
        baseCost[k] = (baseCost[k] ?? 0) + v;
    }
    if (modifiers.reductionGeneric > 0) {
        const generic = baseCost.X ?? 0;
        let reduced = Math.max(0, generic - modifiers.reductionGeneric);
        // Total-mana floor (CR 601.2f / 118.7): colored pips are immovable, so
        // the generic portion can only be reduced to the point where the total
        // still meets the floor. The floor never raises the generic above its
        // original value — a cost already below the floor is simply unaffected.
        if (modifiers.minTotalMana > 0) {
            const colored = Object.entries(baseCost).reduce(
                (sum, [k, v]) => (k === "X" ? sum : sum + v),
                0
            );
            const minGeneric = Math.min(
                generic,
                Math.max(0, modifiers.minTotalMana - colored)
            );
            if (reduced < minGeneric) reduced = minGeneric;
        }
        if (reduced > 0) baseCost.X = reduced;
        else delete baseCost.X;
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
