import {
    type AnimateSpec,
    type CardDefinition,
    type CardSupertype,
    type CardType,
    type Color,
    type ControlChangeCondition,
    type CounterDestination,
    type DelayedTriggerInlineBody,
    type DelayedTriggerTiming,
    type DurationSpec,
    type EffectCardFilter,
    type EffectOp,
    type FlashbackCost,
    type GameEvent,
    type ManaCost as CardManaCost,
    type MayPayCost,
    type MovableZone,
    type PermanentFilter,
    type PermanentView,
    type SpellCastEvent,
    type SpellContext,
    type StaticEffect,
    type TargetRequirement,
    type TargetSelection,
    type TextChange,
    type TokenSpec,
    type TriggerFizzledEvent,
    countDomain,
} from "../cards/types";
import {
    registerTokenDefinition,
    tryGetDefinition,
    isPrintedInSet as isCardPrintedInSet,
} from "../cards";
import { turnFaceDown } from "./faceDown";
import { applyIndefiniteSupertypeMutation, liveSupertypesOf } from "./snow";
import {
    buildAutoTapSources,
    manaFromPlan,
    solveSmartAutoTap,
} from "./autoTap";
import { applyPlayLand, enqueueLandEntryChoice } from "./playLand";
import { checkStateBasedActions } from "./sba";
import { getExtraLandDrops, getLegalTargets } from "./rules";
import { resolveEntersTapped } from "../cards/entersTapped";
import { getAbilityEffectFn, getResolveFn } from "../cards/effectRegistry";
import { runDelayedTriggerBody } from "./effects/interpreter";
import { matchesPermanentFilter } from "../cards/filters";
import type { Phase, Zone, PhaseReturnCondition } from "./types";
import type { SacrificeSelection } from "./sacrificeChoice";
import {
    getActivatedManaColor,
    getBasicLandMana,
    isAura,
    isDamageablePermanent,
    isPlaneswalker,
    LAND_DROPS_PER_TURN,
    manaValue,
    MANA_COLORS,
    CASTABLE_PERMANENT_TYPES,
} from "./constants";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import {
    getMadnessCost,
    markMadnessExiled,
    openMadnessCastWindow,
} from "./madness";
import { isProtectedFromSource } from "./protection";
import { isGuardedAgainst } from "./permanentGuard";
import { getEffectiveBlockGraph } from "./banding";
import { validateBlockerEligibility } from "./combat";
import { colorWordsPresent, landTypesPresent } from "./textChanges";
import { randomInt, seededShuffle } from "./rng";
import {
    applyDamageReplacements,
    applyDestroyReplacements,
    applyDiscardReplacements,
    applyGraveyardRedirectCounters,
    applyLifeChangeReplacements,
    applyTapReplacements,
    applyTransientDamageRedirections,
    describeDamageSource,
    graveyardDestinationFor,
} from "./replacements";
import { collectTriggers, placeTriggersOnStack } from "./triggers";
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
    phase: "end-of-turn" | "end-of-combat" | "upkeep" | "untap";
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
              : duration.phase === "untap"
                ? "UNTAP"
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
     *  `{ id }` and rely on `getDefinition` to hydrate the rest from the
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
    /** Counters removed to pay the scaling part of a mana-choice cost
     *  (CR 122.6 / 605.1a — the Mana Batteries' "Remove any number of charge
     *  counters: Add 1 + N mana"). Snapshotted at tap commit so untapping the
     *  source before the produced mana is spent restores the removed counters.
     *  Cleared at untap / cleanup, like `chosenMana`. */
    manaCounterRemoval?: { type: string; count: number };
    /** Life the controller actually lost to this tap-for-mana's self-damage /
     *  life-cost riders (CR 605.1a — painlands' coloured-tap ping like Adarkar
     *  Wastes, Ancient Tomb's unconditional ping, Mana Confluence's "Pay 1
     *  life"). Snapshotted as the real life delta (after CR 614 replacement /
     *  CR 615 prevention), not the raw rider amount, so an untap-toggle that
     *  reverses the whole mana-ability activation before the mana is spent
     *  restores exactly what was paid — the life-side sibling of `chosenMana`.
     *  Unlike City of Brass (a becomes-tapped TRIGGER that goes on the stack
     *  and blocks untap via `tapTriggerCommitted`), these riders resolve inside
     *  the mana ability with no stack, so the tap stays reversible. Cleared at
     *  untap step / on refund, like `chosenMana`. */
    lifePaidThisTap?: number;
    /** CR 605.4 — extra mana a Wild-Growth-style triggered MANA ability (Wild
     *  Growth, Fertile Ground, a Gauntlet-of-Might rider) added to the pool when
     *  THIS source was tapped for mana. Snapshotted as the pool delta the bonus
     *  trigger produced so an untap-toggle / payment undo that reverses the whole
     *  tap refunds the bonus too — the sibling of `chosenMana`. Without it the
     *  untap-toggle refunds only the land's own base mana, leaving the bonus {G}
     *  floating: tap → +2, untap → −1, a net +1 per cycle = infinite mana.
     *  Cleared at untap step / on refund, like `chosenMana`. */
    tapBonusMana?: CardManaCost;
    /** Mode chosen at cast time for modal permanents (CR 700.2c). Survives
     *  from the stack to the battlefield so the layer system can read
     *  mode-specific static effects (e.g. Phantasmal Terrain). */
    chosenModeId?: string;
    /** Set when this land's mana has been consumed by a spell. Cannot be manually untapped. Resets at untap step. */
    manaCommitted?: boolean;
    /** Set when this source's most-recent tap-for-mana caused one or more
     *  triggered abilities to be put on the stack (CR 603.3 — e.g. City of
     *  Brass "becomes tapped: deal 1 damage to you", or a third-party
     *  Manabarbs). A resolved/pending triggered ability cannot be undone
     *  (CR 603.3 — there is no undo of a triggered ability), so the standalone
     *  untap-toggle is rejected while this is set: untapping would refund the
     *  mana and untap the source while leaving the trigger's effect (e.g. lost
     *  life) applied — an illegal state. Class-wide (any becomes-tapped
     *  trigger), not keyed to a specific card. Cleared when the source untaps
     *  at the untap step (CR 502/514) and when its mana is committed to a
     *  spell. Persisted (must survive the DB write between the tap mutation and
     *  the later untap attempt). */
    tapTriggerCommitted?: boolean;
    /** Set when a creature enters the battlefield. Cleared at untap step. Prevents attacking. */
    isSummoningSick?: boolean;
    /** CR 702.30a — Echo: true while this permanent still owes its echo cost,
     *  i.e. it came under its controller's control and has not yet had its
     *  first upkeep under that control. Set at ETB for permanents whose
     *  definition declares the `echo` keyword; read by the echo trigger's
     *  CR 603.4d intervening-if so it fires exactly once (on the controller's
     *  first upkeep) and cleared by `SpellContext.markEchoPaid()` when the
     *  echo cost is paid. Persisted (must survive the DB write between entry
     *  and the next upkeep). */
    echoPending?: boolean;
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
    /** Per-creature turn-history flag (CR 508.1 / 514.2): true when this
     *  creature attacked during its controller's MOST RECENT PRIOR turn.
     *  Snapshotted from `hasAttackedThisTurn` at the active player's CLEANUP
     *  (in `finalizeCleanup`, before that flag is cleared) so it survives into
     *  the controller's next turn. Read by the self attack-restriction
     *  predicate for "can't attack if it attacked during your last turn"
     *  (Giant Turtle, LEG). Updated only at the controller's own cleanup, so
     *  it always reflects the controller's previous turn, never the current
     *  one. */
    attackedDuringLastTurn?: boolean;
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
    /** Activated abilities granted to this permanent by another source
     *  (CR 113.1, 611). Each entry references an ability template on another
     *  card def — the template is looked up at activation time on
     *  `getDefinition(sourceCardId).grantTemplates`.
     *
     *  Two flavours, exactly one keyed field set per entry:
     *  - `auraId` (the granting source's instance id) for continuous
     *    lord-style static-effect grants, spliced out when the source leaves
     *    play (Zombie Master: "Other Zombies have '{B}: Regenerate this
     *    creature.'").
     *  - `duration` for one-shot until-end-of-turn grants (CR 611.1b), spliced
     *    out by the phase-boundary purge when the duration expires (Touch of
     *    Vitae: "gains '{0}: Untap this creature. Activate only once.'"). */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: Duration;
    }[];
    /** Triggered abilities granted to this permanent by an anthem-style static
     *  effect (CR 113.1, 611). Each entry references a triggered-ability
     *  template (`triggeredGrantTemplates`) on another card def — the template
     *  is unioned into the permanent's effective triggers by
     *  `effectiveTriggeredAbilities`, so the trigger collector scans and
     *  resolves it as if it were printed on this permanent.
     *
     *  Two flavours, exactly one keyed field set per entry:
     *  - `auraId` (the granting source's instance id) for continuous
     *    static-effect grants, spliced out when the source leaves play (Energy
     *    Flux: "All artifacts have 'At the beginning of your upkeep, sacrifice
     *    this artifact unless you pay {2}.'").
     *  - `duration` for one-shot until-end-of-turn grants (CR 611.1b), spliced
     *    out by the phase-boundary purge when the duration expires (Rapid Fire:
     *    "that creature gains rampage 2 until end of turn"). */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: Duration;
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
    /** CR 606.3 — set true when a loyalty ability of this planeswalker has been
     *  activated this turn. Blocks any further loyalty ability of the SAME
     *  permanent for the rest of the turn (one loyalty ability per permanent per
     *  turn, across all of its loyalty abilities). Set at activation commit
     *  (`payLoyaltyCost`, `game.ts`); reset for every permanent at the start of
     *  each turn (`phases.ts` untap-step turn reset). */
    loyaltyActivatedThisTurn?: boolean;
    /** CR 702.2b / 704.5h — set true when this creature has been dealt nonzero
     *  damage by a source with deathtouch this turn. `checkDeathtouchDestroySBA`
     *  destroys any creature so marked as a state-based action (respecting
     *  indestructible/regeneration via `destroyWithReplacements`). Marked by
     *  `markDeathtouchDamage` at every damage sink (combat and non-combat) off
     *  the source's EFFECTIVE static-ability set. Removed at CLEANUP (CR 514.2). */
    dealtDeathtouchDamage?: boolean;
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
        /** Optional "until end of turn" duration (CR 611.2b, issue #730 —
         *  Ray of Command / Magus of the Unseen). When present, the phase-
         *  boundary purge (`tickAllDurations`) reverts this entry at its
         *  boundary — a distinct mechanism from the `condition`-based
         *  conditional-control SBA. Mutually exclusive with `condition` in
         *  practice (a gain-control effect is either "for as long as" or
         *  "until end of turn", never both). */
        duration?: Duration;
        /** "When you lose control of the permanent, tap it" rider (CR 701.20a —
         *  Ray of Command / Magus of the Unseen). When true, the permanent is
         *  tapped the instant this duration-scoped control change reverts. */
        tapOnLoss?: boolean;
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
        /** Additional card types (beyond "Creature") that the animation added
         *  to `types` — e.g. ["Artifact"] for Mishra's Factory's "2/2
         *  Assembly-Worker artifact creature". Only types not already present
         *  are recorded, and exactly these are spliced out on expiry. */
        addedTypes?: CardType[];
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
    /** Layer 7b set-P/T effects (CR 613.4b, ADR 0017). Each entry SETS power
     *  and/or toughness to a fixed value (independently optional). The latest
     *  entry per characteristic wins at read time (array order = timestamp,
     *  CR 613.7). A phase-scoped `duration` is spliced out by `tickAllDurations`
     *  when it expires, exactly like `temporaryPTMods` (Singing Tree, Halfdane
     *  "until your next upkeep"). When `duration` is undefined the set is
     *  INDEFINITE — it lasts until the source leaves or another set overrides
     *  it (CR 613.4b; Wall of Tombstones "change ... base toughness ...
     *  indefinitely"). Pushed by `setBasePT`. */
    temporaryPTSet?: {
        power?: number;
        toughness?: number;
        duration?: Duration;
    }[];
    /** Timed subtype change (CR 305.7 / 611.2 — "becomes a Swamp until its
     *  controller's next untap step", Orcish Farmer). While present, the
     *  permanent's `subtypes` are overwritten with `subtypes` (so subtype-driven
     *  reads — intrinsic mana, landwalk — observe the change); `restoreSubtypes`
     *  captures the value to splice back when the `duration` expires. The
     *  phase-boundary purge (`tickAllDurations`) reverts it. Distinct from the
     *  indefinite `setSubtypes` (one-shot, no duration) and from the layer-4
     *  `grantedSubtypes` static effect (source-bound). Pushed by
     *  `SpellContext.setSubtypesUntil`. */
    temporarySubtypeChange?: {
        subtypes: string[];
        restoreSubtypes: string[];
        duration: Duration;
    };
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
    /** When set, this permanent doesn't untap during its controller's NEXT
     *  untap step, after which the flag clears itself (CR 302.6 / 502.1 — a
     *  one-shot untap-prevention with a fixed, single-step duration). Distinct
     *  from `untapLockedBy` (which holds while a still-tapped source keeps the
     *  lock) and from the `does-not-untap` keyword (permanent). The untap step
     *  skips this permanent exactly once, then deletes the flag so the
     *  following untap step proceeds normally. Set by
     *  `SpellContext.skipNextUntap` (Barl's Cage, The Dark). */
    skipNextUntap?: boolean;
    /** When true, this permanent may attack this turn as though it didn't have
     *  defender (CR 508.1a override — FEM Vodalian War Machine). Set by
     *  `SpellContext.allowAttackDespiteDefender`; cleared at CLEANUP (until end
     *  of turn). Read by the defender attack-restriction rule
     *  (`combatRegistry.ts`). */
    canAttackDespiteDefenderThisTurn?: boolean;
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
    /** When set, this permanent is exiled instead of going to any other zone if
     *  it would leave the battlefield (CR 614.1c — Dreams of the Dead). Read by
     *  `removePermanentTo` for EVERY departure path (dies, sacrifice, bounce,
     *  destroy), redirecting the destination to exile. PERSISTENT — unlike
     *  `exileOnDeath` it is not cleared at CLEANUP and survives across turns;
     *  it vanishes only when the permanent actually leaves play (the instance
     *  is gone). Set by `setExileOnLeave`. */
    exileOnLeave?: boolean;
    /** When set, this permanent can't be regenerated for the rest of the turn
     *  (CR 701.15c). Suppresses BOTH regeneration shields and the continuous
     *  auto-regeneration replacement granted by the `"auto-regenerate"` static
     *  ability (Clergy of the Holy Nimbus — "{1}: This creature can't be
     *  regenerated this turn"). Read by `regenerateOrDestroy` as an additional
     *  `cantBeRegenerated` source. Transient — cleared at CLEANUP (CR 514.2). */
    cantBeRegeneratedThisTurn?: boolean;
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
    /** Tracks subtypes ADDED by `StaticSubtypeAdd` effects (layer 4 additive
     *  surrogate — see `cards/types.ts` for the model's limits), mirroring
     *  `grantedTypes` one-for-one: one entry per `(auraId, subtype)` pair so
     *  concurrent sources don't double-add and unapplying one source only
     *  removes the subtype when no other source still grants it. The
     *  `subtype` itself is also pushed into `subtypes[]` at apply time.
     *  Unlike `grantedSubtypes` (subtype-SET, a destructive replace), this
     *  never touches `printedSubtypes` — nothing is ever hidden. */
    grantedSubtypesAdd?: { subtype: string; auraId: string }[];
    /** Layer 5 color grants (CR 305.7). Each entry records one source's
     *  granted colors. Used by Kormus Bell ("black creatures"). */
    grantedColors?: { color: string; sourceId: string }[];
    /** Supertypes added by a `supertype-set` static effect or an indefinite
     *  `setSupertype` mutation (CR 205.4a). Source-keyed (`"indefinite"` for
     *  non-source-bound mutations). Read by `hasSnowSupertype` / the
     *  `STATIC_EFFECT_CTX.hasSupertype` helper so live snow status is observed
     *  (Arcum's Weathervane "becomes snow"). */
    grantedSupertypes?: { supertype: string; sourceId: string }[];
    /** Supertypes removed by a `supertype-set` static effect or an indefinite
     *  `setSupertype` mutation (Melting / Arcum's Weathervane "no longer
     *  snow" — CR 205.4a). Source-keyed like `grantedSupertypes`; unapply
     *  restores the printed supertype when the last source leaves. */
    removedSupertypes?: { supertype: string; sourceId: string }[];
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
    /** Transient flag: this creature can't attack this turn (CR 508.1a,
     *  ADR 0053 pile division). The attack-side twin of `cantBlockThisTurn`.
     *  Set on the unchosen pile by Fight or Flight; enforced in
     *  `validateAttackerEligibility`. Cleared at CLEANUP. */
    cantAttackThisTurn?: boolean;
    /** Transient flag: this creature can't be blocked this turn (CR 509.1b).
     *  Set on an attacker by Tawnos's Wand ("target creature with power 2 or
     *  less can't be blocked this turn"). Read by `validateBlockerEligibility`
     *  on the attacker side so every would-be blocker is rejected. Cleared at
     *  CLEANUP (CR 514.2). */
    cantBeBlockedThisTurn?: boolean;
    /** Transient flag: this creature (an attacker) can't be blocked this turn by
     *  creatures whose subtypes include any listed here (CR 509.1b). Set on an
     *  attacker by Tower of Coireall ("can't be blocked by Walls this turn").
     *  Read by `validateBlockerEligibility` on the attacker side so a would-be
     *  blocker carrying a listed subtype is rejected. Cleared at CLEANUP
     *  (CR 514.2). */
    cantBeBlockedBySubtypesThisTurn?: string[];
    /** A player chosen as this permanent enters the battlefield and stored for
     *  the rest of the game (CR 603.6b / 614.12 — "as ~ enters, choose an
     *  opponent"). Set via `SpellContext.setChosenPlayer` from an ETB trigger;
     *  read by static / triggered abilities that act on the chosen player
     *  (Cursed Rack — chosen opponent's max hand size is four; The Rack —
     *  damage at the chosen player's upkeep). Cleared when the permanent leaves
     *  the battlefield (a new object, CR 400.7). */
    chosenPlayerId?: string;
    /** An ordered pair of basic land types chosen as this permanent enters and
     *  stored for the rest of the game (CR 603.6b / 614.12 — Illusionary
     *  Terrain "as this enchantment enters, choose two basic land types").
     *  `[first, second]`. Set via `SpellContext.setChosenSubtypes` from an ETB
     *  trigger; read by a `subtype-set` static's `subtypesFor` callback to
     *  drive a computed layer-4 subtype swap (ADR 0050). Cleared when the
     *  permanent leaves the battlefield (a new object, CR 400.7). */
    chosenSubtypes?: string[];
    /** Layer 5 color override (CR 305.7, 613.1d). When set, getColors()
     *  returns this array instead of mana-cost-derived + grantedColors.
     *  Set by lace instants ("target spell or permanent becomes [color]"). */
    colorOverride?: Color[];
    /** Timed color override (CR 305.7 / 613.1d — "becomes the color of your
     *  choice until end of turn", Kavu Chameleon, issue #1065). While
     *  present, `colorOverride` above has been overwritten with `colors`;
     *  `restoreColorOverride` captures the prior override (undefined if there
     *  wasn't one) so the phase-boundary purge (`tickAllDurations`) can splice
     *  it back — or clear `colorOverride` entirely — when `duration` expires.
     *  Distinct from the indefinite `setColorOverride` call (no duration,
     *  Dream Coat / Shyft's "lasts indefinitely"). Pushed by
     *  `SpellContext.setColorOverride`'s optional `duration` parameter. */
    temporaryColorOverride?: {
        colors: Color[];
        restoreColorOverride?: Color[];
        duration: Duration;
    };
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
    /** Copy-token leave-linkage anchor (CR 603.10). Instance id of the token
     *  this permanent is bound to in BOTH directions — Dance of Many stores the
     *  id of the copy-token it created so its own "when this leaves the
     *  battlefield, exile the token" and "when the token leaves the
     *  battlefield, sacrifice this" triggers can identify the exact token by id
     *  (the `PermanentLeftEvent` does not carry `createdBy`, and the token is
     *  already gone from the battlefield by trigger-resolve time). Persisted so
     *  the link survives a DB round-trip. */
    linkedTokenId?: string;
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
    /** Noted-mana battery (CR 106.10 — Jeweled Amulet, Ice Cauldron). The type
     *  and amount of mana the artifact most recently noted ("note the type [and
     *  amount] of mana spent to pay this activation cost"). `mana` is a
     *  per-colour count (a single colour for Jeweled Amulet's {1}; possibly
     *  several for Ice Cauldron's {X}). Read by the second ability ("add this
     *  artifact's last noted ... mana"). `castableCardId` (Ice Cauldron)
     *  restricts the replayed mana to casting that one exiled card; absent for
     *  Jeweled Amulet (the mana is unrestricted). Overwritten on each note
     *  ("LAST noted"). Battlefield-only; persisted across a DB round-trip. */
    notedMana?: { mana: Record<string, number>; castableCardId?: string };
    /** Cast-from-exile permission (CR 601.3e — Ice Cauldron: "You may cast that
     *  card for as long as it remains exiled"). When set on a card in the exile
     *  zone, the named player may PLAY it from exile as if it were in their hand
     *  — cast it if it's a spell, or play it as a land if it's a land (CR
     *  305.2). Cleared when the card leaves exile. Persisted so the permission
     *  survives a DB round-trip. */
    castableFromExileBy?: string;
    /** Turn-scoped expiry marker for {@link castableFromExileBy} (CR 514.2 /
     *  608.2g). When set, the play permission is an "until end of turn" impulse
     *  window (Headliner Scarlett, Expressive Iteration — "play that card this
     *  turn") and is revoked at the CLEANUP step of a turn whose number is `>=`
     *  this value, while the card stays exiled. ABSENT means an open-ended /
     *  persisted grant ("as long as it remains exiled" — Ice Cauldron;
     *  while-source-lives — Robber of the Rich) that the cleanup expiry never
     *  touches. Stores the turn number rather than a bare flag so the primitive
     *  can also express "until end of your next turn" (grant with a later turn
     *  number) without a schema change. */
    castableFromExileUntilTurn?: number;
    /** CR 702.34 — a Flashback cost granted to this card at the instance level
     *  (Snapcaster Mage: "target instant or sorcery card in your graveyard
     *  gains flashback until end of turn"). When set on a card in a graveyard,
     *  the card becomes castable from that graveyard for this cost, overriding
     *  any printed `CardDefinition.flashback`. Cleared at the CLEANUP step
     *  (CR 514.2 — "until end of turn"). Persisted so the grant survives a DB
     *  round-trip. Normally a bare mana cost (Snapcaster's grant equals the
     *  card's mana cost), but may carry a full {@link FlashbackCost} shape when
     *  the granted flashback also has a non-mana component (CR 702.34a). */
    grantedFlashback?: CardManaCost | FlashbackCost;
    /** CR 702.138e — true iff this permanent ESCAPED, i.e. it was cast from a
     *  graveyard via Escape. Set on the stack item at the escape cast and rides
     *  onto the resulting battlefield permanent (a stack item IS its
     *  CardInstanceState). Read by "sacrifice it unless it escaped" (Uro,
     *  Phlage) and "as long as ~ escaped" clauses (Nethergoyf) via
     *  `SpellContext.isEscaped`. Unlike Flashback, an escape cast does NOT set
     *  `exileOnResolve` — the card resolves to its normal destination. */
    escaped?: boolean;
    /** CR 702.35c — true iff this card was discarded via Madness and exiled
     *  instead of going to the graveyard. Set on the exiled instance by
     *  `discardToGraveyard` (via `markMadnessExiled`); it rides alongside
     *  `castableFromExileBy` and distinguishes a madness exile (castable for the
     *  MADNESS cost, CR 702.35d) from an Ice-Cauldron-style exile cast (normal
     *  cost). Cleared when the card is cast to the stack (`removeFromZone`) or
     *  binned on decline (`declineMadness`). Persisted so it survives a DB
     *  round-trip. */
    madnessExiled?: boolean;
    /** CR 702.35d — true while a madness-exiled card is still awaiting its
     *  reflexive cast-trigger. Set alongside `madnessExiled` by `markMadnessExiled`
     *  at discard→exile; consumed by `collectTriggers` when it builds the
     *  reflexive trigger StackItem (so the trigger is created exactly once), and
     *  cleared by `openMadnessCastWindow` when that trigger resolves. Absent once
     *  the card is castable (window open) or has been binned. Persisted. */
    madnessTriggerPending?: boolean;
    /** CR 702.74a — true iff this permanent was cast for its Evoke cost. Set
     *  on the stack item at cast commit (`convex/game.ts`, when the chosen
     *  alternative cost === `CardDefinition.evoke`) and rides onto the
     *  resulting battlefield permanent for free (a stack item IS its
     *  CardInstanceState, the `escaped` precedent). Read by the
     *  `evokeTrigger` template's `condition` (`convex/cards/abilities/evoke.ts`)
     *  to decide whether the "sacrifice this when it enters" half of Evoke
     *  fires. See {@link PermanentView.evoked} for the full doc. */
    evoked?: boolean;
    /** CR 106.4 / 202.3 — per-colour mana spent to CAST this permanent,
     *  captured once at ETB (`resolveTopOfStack`) from the originating stack
     *  item's `notedManaSpent`. See {@link PermanentView.notedManaSpentOnCast}
     *  for the full doc — this is the persistent post-ETB twin of the
     *  ephemeral `StackItem.notedManaSpent`. */
    notedManaSpentOnCast?: Record<string, number>;
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
    /** Optional readback tag (CR 615.1). When set, every point this shield
     *  actually absorbs is accumulated into `state.preventionTallies[tallyId]`
     *  so a follow-up effect can read "the amount of damage prevented this way"
     *  (Sacred Boon — put a +0/+1 counter per 1 damage prevented). */
    tallyId?: string;
};

/** A per-player damage-prevention shield with a source match and a reduction
 *  mode (CR 615.1). Generalizes the "prevent damage from a chosen source / a
 *  class of sources, to a player" shape that several DRK cards use:
 *    - Dark Sphere — match a chosen source, prevent HALF rounded down, once.
 *    - Scarecrow — match any source with a given keyword (flying), prevent ALL,
 *      for the rest of the turn.
 *  `match.sourceInstanceId` (when set) scopes the shield to one source; when
 *  unset, `match.sourceStaticAbility` (when set) scopes it to sources whose
 *  damage event carries that keyword among `sourceStaticAbilities`. A shield
 *  with neither is unconditional. `mode` is the residual computation; `remaining`
 *  counts consumptions before the shield is purged (1 = one-shot). The
 *  unconsumed shield wears off when `duration` expires (CR 514.2). */
export type PlayerDamagePreventionShield = {
    playerId: string;
    match: {
        sourceInstanceId?: string;
        sourceStaticAbility?: string;
    };
    mode: "all" | "half-down";
    remaining: number;
    duration: Duration;
};

/** A reference to an activated ability template granted to a player by
 *  another card's effect (CR 113.1). Stores only ids — the actual ability
 *  is resolved at activation time via `getDefinition(sourceCardId)`. */
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
    /** Poison counters on this player (CR 122 — counters can sit on players,
     *  not only objects). Absent means zero; no cap — it can exceed ten. A
     *  player with ten or more loses the game (CR 704.5c), checked as an SBA
     *  in `checkGameOverSBA`. Mutated via `SpellContext.addPoisonCounters`.
     *  Kept as a dedicated scalar rather than an entry in the object
     *  `counters[type]` map (ADR 0032). */
    poisonCounters?: number;
    /** Energy counters on this player (CR 122.1 — energy is a player-owned
     *  resource, a counter kind that sits on players, not objects). Absent means
     *  zero; no cap and no loss condition (unlike poison). A player "gets {E}"
     *  to add energy (`SpellContext.addEnergy`) and "pays {E}" to spend it
     *  (`SpellContext.payEnergy`, all-or-nothing). Kept as a dedicated scalar
     *  rather than an entry in the object `counters[type]` map, mirroring
     *  `poisonCounters` (ADR 0032). */
    energyCounters?: number;
    /** Revolt (CR 702.RV): true when a permanent this player controlled left
     *  the battlefield this turn. Set by `removePermanentTo` whenever a
     *  permanent leaves the battlefield (destroy / exile / sacrifice / bounce).
     *  Reset to false at the start of each turn (`advanceTurn`). Read by
     *  cards with the Revolt ability word (Fatal Push). */
    permanentYouControlledLeftThisTurn?: boolean;
};

export type StackItem = CardInstanceState & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). */
    targets?: TargetSelection[];
    /** Value chosen for X at cast-time for spells with X in their cost
     *  (CR 107.3, 601.2b). Undefined for spells without X. Read on
     *  resolution by SpellContext.getX(). */
    chosenX?: number;
    /** CR 702.33 — how many times this spell's Kicker cost was paid as it was
     *  cast (0/absent = not kicked; 1 for a single kicker; N for a paid-N-times
     *  Multikicker, CR 702.33e). Snapshotted at cast commit from
     *  `PendingCast.kickerCount`; read at resolution by
     *  SpellContext.getKickerCount() (and by `entersWith.counters` count
     *  `"kicker"`). Undefined for spells without a Kicker cost / cast unkicked. */
    kickerCount?: number;
    /** Divide-as-you-choose split (CR 601.2d / 120.4). Maps a target key
     *  (`${type}:${id}`) to the amount of damage / counters the caster assigned
     *  to that target at announcement, each ≥ 1, summing to the spell's total.
     *  Read at resolve by `dealDamageDividedAsChosen` /
     *  `distributeCountersAsChosen`. Undefined when the caster did not record an
     *  explicit split (the resolver then auto-divides ≥1-each). Used by Fire
     *  Covenant, Fiery Justice, Meteor Shower, Spoils of War. */
    targetAmounts?: Record<string, number>;
    /** Mode id chosen at announcement for modal spells (CR 700.2). On
     *  resolution, dispatch lookups the matching entry in
     *  `card.modes` and runs `mode.resolve` instead of `card.resolve`. */
    chosenModeId?: string;
    /** Snapshot of the permanent sacrificed OR exiled as an additional cost at
     *  announcement (CR 117.9 / 601.2f). Captured at commit and read at
     *  resolve via `SpellContext.getAdditionalSacrificeMv` (mana value) and
     *  `SpellContext.getAdditionalCostSubtypes` (subtypes — e.g. Soul
     *  Exchange's "if the exiled creature was a Thrull"). */
    additionalSacrificeSnapshot?: {
        cardInstanceId: string;
        mv: number;
        subtypes?: string[];
        /** Effective POWER of the permanent at the moment it was sacrificed
         *  (CR 613 layer 7c, last-known-information CR 608.2h). Captured at cost
         *  commit because the permanent is gone by resolution. Read at resolve
         *  via `SpellContext.getAdditionalSacrificePower` for "deal damage equal
         *  to the sacrificed creature's power" effects (Freyalise Supplicant).
         *  Mana value alone (`mv`) cannot express this — power can diverge from
         *  mana value (pumps, X/1 creatures, etc.). Omitted for sacrificed
         *  permanents without a power characteristic. */
        power?: number;
    };
    /** Type and amount of mana spent to pay THIS activation's cost (CR 106.10).
     *  Captured at activation commit (the manaPool delta) when the ability sets
     *  `noteManaSpent: true`, so the resolve step can read which colours were
     *  spent (`SpellContext.getNotedManaSpent`) and store them on the source —
     *  Jeweled Amulet ("note the type of mana spent"), Ice Cauldron ("note the
     *  type and amount of mana spent"). Per-colour counts. Undefined for the
     *  overwhelming majority of activations that don't note their mana. */
    notedManaSpent?: Record<string, number>;
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
    /** CR 702.35d — set on the synthetic reflexive triggered ability that a
     *  discarded madness card puts on the stack (`buildMadnessReflexiveTrigger`,
     *  triggers.ts). Holds the id of the exiled card. On resolution
     *  (`resolveTopOfStack`) `openMadnessCastWindow` opens the owner's single
     *  cast window on that card. Distinct from `triggeredAbilityId` (no card-def
     *  ability lookup — the reflexive ability is engine-owned). */
    madnessTrigger?: string;
    /** Storm (CR 702.40, ADR 0052) — present ONLY on the synthesized storm
     *  cast-trigger's own stack item (`triggeredAbilityId === "storm"`). A
     *  detached snapshot of the spell being copied, captured at cast time —
     *  NOT a live stack reference — so `resolveStormTrigger` still creates
     *  copies from it even if the original spell has since left the stack
     *  (countered). See `collectCastTriggers`. */
    stormSnapshot?: StackItem;
    /** Storm — copies still to create as this trigger resolves. Initialized
     *  to `priorSpellCount` (CR 702.40a) at cast time; decremented by one per
     *  copy created. The trigger stays on the stack (peek-and-pop) while this
     *  is > 0 so a suspended per-copy retarget prompt resumes the loop for
     *  the next copy rather than losing progress. */
    stormCopiesRemaining?: number;
    /** If set, this stack item is a delayed triggered ability (CR 603.7a)
     *  queued by an earlier spell's resolution. The resolve function lives on
     *  `cardDef.delayedTriggers[triggerId]` and receives `delayedPayload` —
     *  unless `delayedEffects` is set (the inline-body path, ADR 0048). */
    delayedTriggerId?: string;
    /** Serializable payload captured when the delayed trigger was scheduled.
     *  Holds instance / player ids so the trigger can look up live targets at
     *  fire time (CR 603.7a). A value is a single id (ADR 0048) or a frozen
     *  `string[]` list (ADR 0049, issue #866 — a list-valued capture). On the
     *  inline-body path (ADR 0048) it is re-bound as the body's initial binding
     *  environment (a list value becomes a `forEach`-iterable list binding). */
    delayedPayload?: Record<string, string | string[]>;
    /** ADR 0048 — the INLINE Effect Script body of a fired delayed trigger
     *  (CR 603.7a). When set, `resolveTopOfStack` seeds the binding
     *  environment from `delayedPayload` and runs this Op list through the
     *  interpreter directly — no card-def lookup. Pure JSON (ADR 0046), so
     *  it survives the DB round-trip on a mid-suspension save. */
    delayedEffects?: EffectOp[];
    /** Resume checkpoint for a multi-step resolve (CR 608.3). Index into
     *  `CardDefinition.resolveSteps`. Advanced by the engine after a step
     *  completes without enqueueing pending choices. Undefined = start from
     *  step 0. */
    resolutionStep?: number;
    /** Player choices already collected during this resolution. Keyed by
     *  `${step}:${choiceId}` (e.g. "0:p1"). Read by `requestChoice` at resume
     *  to return prior selections without re-enqueueing them. */
    collectedChoices?: Record<string, string[]>;
    /** Scratch list of player ids carried between resolve steps for a
     *  per-permanent "pay-or-penalty" rider over a mass effect (CR 608.2 /
     *  608.3 — Stench of Evil: "Destroy all Plains. For each land destroyed
     *  this way, that land's controller takes 1 damage unless they pay {2}").
     *  Step 0 destroys the permanents and records the controller of each one
     *  actually destroyed here (one entry per destroyed permanent, so a player
     *  controlling N destroyed lands appears N times); the irreversible destroy
     *  is gone from the board by step 1, so the billing list must persist. Step
     *  1 walks this list issuing one may-pay per entry. Read via
     *  `SpellContext.noteMassRiderTargets` / `getMassRiderTargets`. Persisted so
     *  a mid-resolution save (suspended on a may-pay choice) survives a DB
     *  round-trip. */
    massRiderTargets?: string[];
    /** True iff this stack item is a COPY of a spell (CR 707.10, Fork). A
     *  copy is not a real card: when it finishes resolving it ceases to exist
     *  rather than moving to a graveyard (CR 707.10/112.5), and it can never
     *  return to a hand/library. Set by `SpellContext.copyStackItem`. */
    isCopy?: boolean;
    /** True iff the resolving spell instructs itself to be exiled as the last
     *  thing it does (CR 608.2 — "Exile <this spell>", e.g. Recall). When set,
     *  `finalizeSpellResolution` routes the non-permanent card to its owner's
     *  exile zone instead of the graveyard. Set via
     *  `SpellContext.exileSelf()`. */
    exileOnResolve?: boolean;
    /** True iff the resolving spell instructs itself to be shuffled into its
     *  owner's library as the last thing it does (CR 608.2 / 701.24 — "Shuffle
     *  <this spell> into its owner's library", e.g. Green Sun's Zenith, issue
     *  #898). When set, `finalizeSpellResolution` routes the non-permanent card
     *  to its owner's (shuffled) library instead of the graveyard. Set via
     *  `SpellContext.shuffleSelfIntoLibrary()`. Mutually exclusive with
     *  `exileOnResolve` in practice (a spell redirects its own resolution
     *  destination once), but not enforced — the finalization path checks
     *  this flag first. */
    shuffleIntoLibraryOnResolve?: boolean;
    /** CR 702.34 — true iff this spell was cast from a graveyard via Flashback.
     *  Read by resolution effects with an "if this spell was cast from a
     *  graveyard" clause (Sevinne's Reclamation). The cast site also sets
     *  `exileOnResolve` so the flashback card is exiled as it leaves the stack. */
    castFromGraveyard?: boolean;
    /** Acting Player (ADR 0037): the player who answers this item's resolution
     *  choices, split off from the controller (`castById`) for a controlled
     *  cast (Word of Command — the controller of WoC decides for the opponent
     *  whose card was put on the stack). Defaults to `castById` when absent —
     *  read via `getActingPlayer`. Equal to `castById` for all normal play, so
     *  every existing cast is unaffected. Cleared when the item leaves the
     *  stack ("you control the player while that spell is resolving"). */
    actingPlayerId?: string;
};

/** Acting Player (ADR 0037 / CR 608): the player who answers a stack item's
 *  resolution choices. Splits the controller role (`castById` — whose
 *  object/resources it is) from the "who is prompted" role for controlled
 *  casts (Word of Command). Defaults to `castById` so every normal cast routes
 *  prompts to its controller exactly as before. */
export function getActingPlayer(item: {
    castById: string;
    actingPlayerId?: string;
}): string {
    return item.actingPlayerId ?? item.castById;
}

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
    timing: DelayedTriggerTiming;
    /** Payload carried over from the scheduling spell's resolution. A value is
     *  a single id (ADR 0048) or a frozen `string[]` list (ADR 0049, issue
     *  #866 — a list-valued capture read as a list binding by an inline body's
     *  forEach). */
    payload: Record<string, string | string[]>;
    /** ADR 0048 — INLINE body of an Effect-Script-scheduled trigger (CR
     *  603.7a): the pure-JSON Op list the interpreter runs directly at fire
     *  time, with `payload` re-bound as the body's initial binding
     *  environment. Undefined for template-path triggers (which look up
     *  `cardDef.delayedTriggers[triggerId]` instead). */
    effects?: EffectOp[];
    /** Oracle text shown when an inline trigger fires (ADR 0048). */
    oracleText?: string;
    /** For `next-draw-step` and `next-main-phase`: the player whose
     *  draw/main phase fires this trigger (CR 504 / CR 505). Undefined for the
     *  global-boundary timings. */
    targetPlayerId?: string;
    /** For the `leaves-battlefield` timing (CR 603.7a / 603.10): the specific
     *  instance whose `PERMANENT_LEFT` event fires this delayed trigger ("when
     *  THAT creature leaves the battlefield this turn, …"). Undefined for every
     *  phase-boundary timing. A pending leave-watch expires unfired at CLEANUP
     *  (the "this turn" bound, CR 514.2). */
    watchInstanceId?: string;
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
    /** CR 702.33 — how many times the caster chose to pay this spell's Kicker
     *  cost at announcement (0/absent = not kicked; ≥ 1 kicked; > 1 only for a
     *  Multikicker, CR 702.33e). The kicker mana is folded into `manaCost`;
     *  this count is propagated to the stack item at commit so resolution reads
     *  `SpellContext.getKickerCount()`. */
    kickerCount?: number;
    /** Divide-as-you-choose split assigned at target selection (CR 601.2d).
     *  Carried through the deferred-payment commit (`commitSpellCast`) onto the
     *  stack item's `targetAmounts`. Keyed by `${type}:${id}`. Undefined for
     *  non-divide spells. */
    targetAmounts?: Record<string, number>;
    /** "Pay X life" additional cost still owed at commit (CR 601.2b / 118.4,
     *  Fire Covenant). Carried through the deferred-payment commit so the life
     *  is paid the instant the spell moves hand → stack. Undefined / 0 when no
     *  life cost applies. */
    payLife?: number;
    /** Mode id chosen at announcement for modal spells (CR 700.2 / 700.2c).
     *  Undefined for non-modal spells. Propagated to the stack item. */
    chosenModeId?: string;
    /** Acting Player (ADR 0037): the player who answers every resolution choice
     *  for this cast, split off from the controller (`playerId`) for a
     *  controlled cast (Word of Command). Defaults to `playerId` when absent —
     *  read via `getActingPlayer`. Propagated onto the resulting StackItem so
     *  the spell's resolution choices also route to the acting player. */
    actingPlayerId?: string;
    /** In-progress additional cost picker (CR 117.9 / 601.2f). Set when the
     *  card has `additionalCosts.sacrificeFilter` (`kind: "sacrifice"`) or
     *  `additionalCosts.exileFilter` (`kind: "exile"`, FEM Soul Exchange).
     *  `pickedId` is undefined until the player calls `selectAdditionalCost`;
     *  commit is blocked while it is undefined regardless of mana coverage. On
     *  commit the picked permanent is sacrificed/exiled and its mana value +
     *  subtypes are snapshotted on the resulting stack item. */
    additionalCost?: {
        kind: "sacrifice" | "exile";
        filter: PermanentFilter;
        pickedId?: string;
    };
    /** Unified filtered-sacrifice choice for this cast (CR 701.21a): the card's
     *  own additional sacrifice cost AND any board-wide static additional
     *  sacrifice (Drought), folded into one selection. `additionalCost` remains
     *  for the exile branch only. */
    sacrificeSelection?: SacrificeSelection;
    /** In-progress "exile X cards from your own graveyard" FLASHBACK cost
     *  picker (CR 702.34a / 118.5 — Flash of Insight). Set when a flashback
     *  cast has `additionalCosts.flashbackExileFromGraveyard`. `count` equals
     *  the announced X; `color` mirrors the cost's colour filter (CR 105.2);
     *  `excludeInstanceId` is the flashback card itself (it can't pay for its
     *  own cost, CR 702.34e). `pickedCardIds` is undefined until the player
     *  calls `selectCastExileCost`, and commit is blocked while it is unset
     *  regardless of mana coverage. On commit the chosen cards move graveyard →
     *  exile. Mirrors the activation-path `exileFromGraveyardChoice`.
     *
     *  `zone` selects which of the caster's OWN zones the picked cards come from:
     *  `"graveyard"` (default, Flash of Insight) or `"hand"` — the flashback-only
     *  "Exile a <colour> card from your hand" cost (CR 702.34a / 118.5). The
     *  record/commit/affordability/UI paths read this zone uniformly, so the
     *  hand variant rides the exact same picker as the graveyard one. */
    exileFromGraveyardChoice?: {
        count: number;
        color?: Color;
        excludeInstanceId: string;
        zone?: "graveyard" | "hand";
        pickedCardIds?: string[];
        /** CR 702.138a (Nethergoyf) — the ESCAPE variable exile cost "exile any
         *  number of other cards from your graveyard with N or more card types
         *  among them". When set, the picker accepts ANY number (≥1) of cards
         *  whose combined DISTINCT card types number ≥ `minCardTypes`, and
         *  `count` is ignored (it is a nominal 1). Undefined for the ordinary
         *  fixed-`count` exile cost (Flashback, and the fixed escape costs of
         *  Uro / Phlage / Underworld Breach). */
        minCardTypes?: number;
    };
    /** In-progress "exile / discard N cards from your HAND" ALTERNATIVE-cost
     *  picker (CR 118.9 — Force of Will's "exile a blue card", Foil's "discard
     *  an Island card and another card"). Set when the chosen alternative cost
     *  carries a `handCost` leg and the choice is real (more matching hand cards
     *  than required). `requirements` mirror the alt cost's hand requirements
     *  (distinct filter × count); `pickedCardIds` is undefined until the player
     *  calls `selectCastAlternativeHandCost` (or auto-filled when the choice is
     *  forced), and commit is blocked while it is unset regardless of mana. On
     *  commit the chosen cards move hand → exile / graveyard. Mirrors the
     *  flashback `exileFromGraveyardChoice`. */
    alternativeCostHandChoice?: {
        action: "exile" | "discard";
        requirements: { filter: EffectCardFilter; count: number }[];
        excludeInstanceId: string;
        pickedCardIds?: string[];
    };
    /** CR 702.74a — true iff the alternative cost chosen for this cast is the
     *  card's Evoke cost (`chosenAltCost === cardDef.evoke` at announcement).
     *  Carried through a parked pick (real hand-cost choice) so the deferred
     *  commit (`tryAutoCommitPendingCast`) can still tag the resulting stack
     *  item `evoked: true` once the picker resolves. */
    evoked?: boolean;
};

/** Tracks an in-progress activated-ability payment (CR 602.1, 602.2b).
 *  Mirrors PendingCast but for a battlefield source. The ability's tap /
 *  sacrifice costs are DEFERRED to commit time so cancellation reverts
 *  cleanly. Mana is paid incrementally by tapping lands, and commit pushes
 *  the ability on the stack (or resolves it for useStack: false). */
export type PendingActivation = {
    playerId: string;
    /** Source permanent on the battlefield (or, when `fromGraveyard`, the
     *  source card in a graveyard). */
    cardInstanceId: string;
    /** CR 113.6 / 602.5b — the source is in a graveyard, not on the
     *  battlefield (Ashen Ghoul's `activateFromGraveyard` ability). Gates the
     *  deferred-commit source lookup to also search graveyards. */
    fromGraveyard?: boolean;
    /** CR 113.6 / 702.29a — the source is in the activator's HAND, not on the
     *  battlefield (Cycling's `activateFromHand` ability). Gates the
     *  deferred-commit source lookup to also search hands. */
    fromHand?: boolean;
    /** Ability id on the source's card definition. */
    abilityId: string;
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
    /** True iff the ability has a {T} cost — applied at commit. */
    tapSource: boolean;
    /** True iff the ability has a sacrifice cost — applied at commit. */
    sacrificeSource: boolean;
    /** Unified filtered-sacrifice choice for this activation (CR 602.1 / 118.5 /
     *  701.21a): the ability's own "sacrifice a permanent matching <filter>"
     *  cost AND any board-wide static additional sacrifice (Drought), folded
     *  into one selection. Commit is blocked while it is incomplete regardless
     *  of mana coverage; on commit the picked permanents are sacrificed and the
     *  snapshot-flagged victim's mv/subtypes/power ride on the stack item (read
     *  at resolve via getAdditionalSacrificeMv/Power — Priest of Yawgmoth,
     *  Freyalise Supplicant). */
    sacrificeSelection?: SacrificeSelection;
    /** In-progress "exile N cards from a single graveyard" cost picker
     *  (CR 602.1, 118.5, 406 — Night Soil). Set when the ability has
     *  `cost.exileFromGraveyard`. `count`/`cardType` mirror the cost; both
     *  `pickedGraveyardOwnerId` and `pickedCardIds` are undefined until the
     *  player calls `selectActivationCost`, and commit is blocked while they
     *  are unset regardless of mana coverage. On commit the chosen cards move
     *  from that graveyard to its owner's exile zone. Mirrors
     *  `sacrificeSelection`. */
    exileFromGraveyardChoice?: {
        count: number;
        cardType?: CardType;
        /** When "you", only the activating player's own graveyard is an
         *  eligible source (CR 118.5 — Grim Lavamancer "your graveyard").
         *  Absent = any player's graveyard is eligible (Night Soil). */
        owner?: "you";
        pickedGraveyardOwnerId?: string;
        pickedCardIds?: string[];
    };
    /** In-progress "tap N untapped permanents matching <filter> you control"
     *  cost picker (CR 602.1, 118.8 — Hand of Justice "Tap three untapped white
     *  creatures you control"). Set when the ability has `cost.tapOtherFilter`.
     *  `pickedIds` accumulates the player's choices via `selectActivationCost`;
     *  commit is blocked until `pickedIds.length === count` regardless of mana
     *  coverage. On commit each picked permanent is tapped (distinct from the
     *  source's own {T}). The source is never a legal pick. */
    tapOtherChoice?: {
        filter: PermanentFilter;
        count: number;
        pickedIds: string[];
    };
    /** Counter-removal cost (CR 122.6 — "Remove a [type] counter from this
     *  creature"). Applied at commit. */
    removeCounterCost?: { type: string; count: number };
    /** Life-payment cost (CR 118.4 — "Pay N life"). Validated up-front at
     *  announcement (activateAbility); the life is deducted at commit so a
     *  cancelled/dropped payment leaves the total untouched. */
    lifeCost?: number;
    /** True iff the ability has a "discard the last card you drew this turn"
     *  cost (Jandor's Ring). The card is discarded at commit. */
    discardLastDrawnSource?: boolean;
    /** CR 702.29a / 118.3 — the Cycling "Discard this card" cost. When set, the
     *  SOURCE card is discarded from its owner's hand at commit (routed through
     *  `discardToGraveyard` so CARD_DISCARDED fires — Marauding Mako). Deferred
     *  to commit so a cancelled payment leaves the card in hand. */
    discardThisSource?: boolean;
    /** "Discard N cards at random" cost (CR 118.3 — Coral Helm). The cards are
     *  discarded at commit via the seeded PRNG. */
    discardAtRandomCount?: number;
    /** In-progress "discard a card matching <filter>" cost picker (CR 602.1 /
     *  118.3 — Survival of the Fittest "Discard a creature card"). Set when
     *  the ability has `cost.discardFilter`. `pickedCardIds` is undefined
     *  until the player calls `selectActivationDiscardCost`, and commit is
     *  blocked while it is unset regardless of mana coverage. On commit the
     *  chosen cards move hand → graveyard through the shared discard choke
     *  point (`discardToGraveyard`, CR 614 / 701.8). Mirrors
     *  `exileFromGraveyardChoice`. */
    discardFilterChoice?: {
        filter: EffectCardFilter;
        count: number;
        pickedCardIds?: string[];
    };
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
    /** Noted-mana battery (CR 106.10 — Jeweled Amulet / Ice Cauldron). Set when
     *  the ability declares `noteManaSpent: true`. At commit the engine captures
     *  the manaPool delta (which colours paid the cost) and writes it onto the
     *  resulting stack item as `notedManaSpent`. */
    noteManaSpent?: boolean;
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
    LandEntryChoiceKind,
    OrderChoiceKind,
    OptionChoiceKind,
    NameCardChoiceKind,
    RandomRevealKind,
    DividePilesKind,
    RandomKind,
    RealizedOutcome,
    PendingChoiceKind,
    ManaRestriction,
    LibraryDestination,
} from "./types";
export type {
    ZonePickKind,
    YesNoChoiceKind,
    LandEntryChoiceKind,
    OrderChoiceKind,
    OptionChoiceKind,
    NameCardChoiceKind,
    RandomRevealKind,
    DividePilesKind,
    RandomKind,
    RealizedOutcome,
    PendingChoiceKind,
    ManaRestriction,
    LibraryDestination,
};

/** Default prompts for an `order-top` choice keyed by destination — used when a
 *  caller of `SpellContext.orderTop` doesn't supply its own. */
const DEFAULT_ORDER_TOP_PROMPT: Record<LibraryDestination, string> = {
    "library-bottom":
        "Scry — drag cards to keep on top or send to the bottom, then order the top.",
    graveyard:
        "Surveil — drag cards to keep on top or put into your graveyard, then order the top.",
    none: "Put these cards back on top of your library in any order.",
};

/** A unit of restricted mana floating in a player's pool (CR 106.6). Produced
 *  by effects like Metamorphosis ("Add X mana of any one color … Spend this
 *  mana only to cast creature spells"). Kept separate from the fungible
 *  `manaPool` so the spend restriction can be enforced at payment time; emptied
 *  alongside `manaPool` at end of step/phase (CR 500.4).
 *
 *  A unit carries EITHER a type-keyed `restriction` (Metamorphosis / Mishra's
 *  Workshop / cumulative-upkeep) OR an instance-keyed `castableCardId` (Ice
 *  Cauldron — "Spend this mana only to cast the last card exiled with this
 *  artifact"). The two are mutually exclusive: type-keyed mana is eligible for
 *  any spell whose card types match; instance-keyed mana is eligible only for
 *  the one specific card instance. `restriction` is therefore optional. */
export type RestrictedMana = {
    color: string;
    amount: number;
    restriction?: ManaRestriction;
    /** Ice Cauldron (CR 106.6) — instance id of the single card this mana may
     *  pay for. When set, the unit is eligible only when the spell being cast
     *  is that exact instance, regardless of card type. Mutually exclusive with
     *  `restriction`. */
    castableCardId?: string;
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
    /** Acting Player (ADR 0037): set when the player prompted (`playerId`) is
     *  acting on behalf of / in control of another player's decision (Word of
     *  Command — the acting player picks a card from the controlled opponent's
     *  hand). Equals `playerId` for all normal choices and is omitted then;
     *  carried for parity with the cast state and so a controlled cast's
     *  resolution choices can be audited. Defaults to `playerId` when absent. */
    actingPlayerId?: string;
    /** Zone of the choosable items — restricts the set offered to the chooser.
     *  Undefined for choice kinds that don't pick from a zone (`may-pay`).
     *  `graveyard` picks (Recall) always carry a `candidateIds` allow-list — a
     *  graveyard is a public zone, so the submit-validator gates eligibility on
     *  `candidateIds` rather than a hidden-zone snapshot. */
    zone?: "battlefield" | "hand" | "library" | "graveyard";
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
    /** For `kind: "may-pay"`, the cost paid on accept (CR 117.3a / 118.4 /
     *  702.24). A bare `ManaCost` (mana-only, historical shape) OR the
     *  `{ mana?, life?, sacrifice? }` union (cumulative upkeep — ADR 0042).
     *  Undefined for cost-less yes/no choices ("may draw a card"). The submit
     *  path (`applyMayPaySubmit`) normalizes either shape. */
    cost?: MayPayCost;
    /** For `kind: "land-entry-tapped"` only (CR 614.12, ADR 0051) — the
     *  instance id of the land currently entering, which is still in the
     *  chooser's hand while this choice is pending (the entry suspends BEFORE
     *  the zone move). `finalizeLandEntry` reads it to complete the entry on
     *  submit. */
    landInstanceId?: string;
    /** For `kind: "madness-cast"` only (CR 702.35d) — the instance id of the
     *  discarded-and-exiled card this choice decides. The client's "Cast" button
     *  fires `announceCast` on it (which consumes the choice); the DECLINE routes
     *  through `submitMadnessDecline`, which reads it to bin the card. */
    cardInstanceId?: string;
    /** For `kind: "choose-aura-host"` only (CR 303.4f) — the instance id of the
     *  Aura currently entering, held off every zone in
     *  `GameState.stagedAuraEntries` while this choice is pending.
     *  `finalizeAuraHost` reads it to match the choice to its staged Aura and
     *  complete the attachment + entry on submit. */
    auraInstanceId?: string;
    /** The card definition id of the subject this choice is ABOUT, when that
     *  subject is not reachable in any projected zone (e.g. a `choose-aura-host`
     *  Aura held in `stagedAuraEntries`, off every zone). The client renders it
     *  as a card image inside the choice dialog so the chooser sees WHICH card
     *  the prompt refers to. Carried verbatim through the wire projection. */
    subjectCardId?: string;
    /** For `kind: "may-pay"` only — a spend restriction the mana leg may draw
     *  on in addition to the fungible pool (CR 106.6, ADR 0022 / 0042). Set to
     *  `"cumulative-upkeep"` by the cumulative-upkeep trigger so Adarkar Unicorn
     *  / Snowfall restricted mana pays the upkeep; the affordability gate and
     *  the pay path both honor it. Undefined = fungible pool only. */
    manaRestriction?: ManaRestriction;
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
    /** For `kind: "order-top"` only — the second zone the un-kept looked-at
     *  cards are sent to (`library-bottom` scry / `graveyard` surveil / `none`
     *  order-only Ponder). Set when the choice is raised; read by the resolve
     *  step (`SpellContext.orderTop`) to apply the split. See
     *  {@link LibraryDestination}. */
    destination?: LibraryDestination;
    /** Client-routing hint for a `choose-hand-card` pick that puts the chosen
     *  cards on TOP of the chooser's library in chosen order (Brainstorm's
     *  `putBack` Op, CR 401.4). Purely a UI discriminator: the submit path and
     *  GRE semantics are the ordinary `choose-hand-card` (the ordered
     *  `cardInstanceIds` ARE the resulting top order). When set, the client
     *  mounts the ordered HAND→TOP drag picker (`PutBackPicker`) instead of the
     *  in-hand toggle. Carried verbatim through the wire projection. */
    putOnTop?: boolean;
    /** For `kind: "name-card"` only — the chosen card name once the chooser has
     *  submitted it (CR 202.3 / 701.x "chooses a card name"). The candidate set
     *  is the whole card registry (no zone, no `options` allow-list); the
     *  submission carries the name string, validated server-side. Echoed here so
     *  it survives the pending-choice projection (a head whose name has been
     *  committed but whose resolve hasn't replayed yet), though in practice the
     *  head is consumed on submit. Undefined until the chooser submits. */
    chosenName?: string;

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

    // --- pile-division divide-then-choose family (ADR 0053) ---
    /** For `kind: "pick-pile"` only — the two completed piles the chooser
     *  picks between, echoed here (rather than left implicit) so the
     *  chooser's client can render pile contents BEFORE deciding — the
     *  divider's `divide-piles` submission is already locked in by the time
     *  this choice is raised. `pileA`/`pileB` partition the preceding
     *  `divide-piles` choice's `candidateIds` exactly. The submission is the
     *  literal string `"A"` or `"B"` (not a zone member id), validated
     *  against these two labels. */
    pileA?: string[];
    pileB?: string[];
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
/** Stable key for a `TargetSelection` used to index a divide-as-you-choose
 *  split (`StackItem.targetAmounts` / `PendingTarget.divideAmounts`). The
 *  `${type}:${id}` shape is unambiguous because a divide-as-you-choose spell
 *  never targets the same object twice (CR 601.2c — each target must be
 *  distinct). */
export function targetKey(target: TargetSelection): string {
    return `${target.type}:${target.id}`;
}

/** Resolves the per-target division for a divide-as-you-choose spell
 *  (CR 601.2d / 120.4). When the caster recorded an explicit split at
 *  announcement (`targetAmounts`), it is used verbatim. Otherwise the engine
 *  falls back to a deterministic "≥1 each, remainder front-loaded" division so
 *  GRE-driven callers that pre-set `targets` without amounts still get a legal
 *  ≥1-each split summing to `totalAmount`. The result maps each target's
 *  `targetKey` to its amount. */
export function resolveChosenDivision(
    targetAmounts: Record<string, number> | undefined,
    targets: TargetSelection[],
    totalAmount: number
): Map<string, number> {
    const result = new Map<string, number>();
    if (targetAmounts) {
        for (const target of targets) {
            const key = targetKey(target);
            result.set(key, targetAmounts[key] ?? 0);
        }
        return result;
    }
    // Fallback: each target gets at least 1; the remainder is front-loaded
    // onto the earliest targets (a deterministic legal split, CR 601.2d).
    const n = targets.length;
    const base = Math.floor(totalAmount / n);
    let remainder = totalAmount - base * n;
    for (const target of targets) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        result.set(targetKey(target), base + extra);
    }
    return result;
}

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
    /** If set, restricts legal targets to sources that are at least one of the
     *  listed colors (CR 202.2 — OR semantics). Propagated from
     *  TargetRequirement.colorFilterAny. Used by "a black or red source of your
     *  choice" (Greater Realm of Preservation). */
    colorFilterAny?: ReadonlyArray<string>;
    /** If set, restricts legal permanent targets by subtype (CR 205.3).
     *  Propagated from TargetRequirement.subtypeFilter. Match if the
     *  permanent's subtypes include at least one of these. */
    subtypeFilter?: string[];
    /** If set, restricts legal permanent targets by LIVE supertype (CR 205.4a).
     *  Propagated from TargetRequirement.supertypeFilter. Match if the
     *  permanent currently has ALL of these (snow-aware — Avalanche). */
    supertypeFilter?: string[];
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
    /** If set, EXCLUDES legal permanent targets that have ANY of these LIVE
     *  supertypes (CR 205.4a). Propagated from
     *  TargetRequirement.excludeSupertypes — the negative of supertypeFilter
     *  above. Used by "target nonbasic land" (Wasteland). */
    excludeSupertypes?: string[];
    /** Mana value range (CR 202.3). Propagated from TargetRequirement.mvFilter
     *  after resolving any `"X"` placeholders against the announced chosenX.
     *  Used by Spell Blast ("counter target spell with mana value X"). */
    mvFilter?: { min?: number; max?: number; equals?: number };
    /** Restricts legal SPELL targets by card type (CR 114.1). Propagated from
     *  TargetRequirement.spellTypeFilter. Used by Fork ("target instant or
     *  sorcery spell"). Ignored for non-spell target types. */
    spellTypeFilter?: CardType[];
    /** Restricts legal SPELL targets to spells whose card type does NOT
     *  include any of these (CR 114.1). Propagated from
     *  TargetRequirement.spellExcludeTypeFilter. Used by Spell Pierce
     *  ("target noncreature spell"). Ignored for non-spell target types. */
    spellExcludeTypeFilter?: CardType[];
    /** Restricts legal SPELL targets to CREATURE spells whose power or
     *  toughness is at most this number (CR 114.1 + 208.2). Propagated from
     *  TargetRequirement.spellCreaturePtFilter. Used by Stern Scolding
     *  ("counter target creature spell with power or toughness 2 or less").
     *  Ignored for non-spell target types. */
    spellCreaturePtFilter?: { maxPowerOrToughness: number };
    /** Restricts legal SPELL targets to single-target spells whose only target
     *  is the activating player (CR 114.6 / 115.10). Propagated from
     *  TargetRequirement.spellSingleTargetingController. Used by Reflecting
     *  Mirror. Ignored for non-spell target types. */
    spellSingleTargetingController?: boolean;
    /** Restricts legal SPELL targets to spells that would destroy a land the
     *  activating player controls (CR 114.1 + 701.7). Propagated from
     *  TargetRequirement.spellWouldDestroyLandYouControl. Used by Equinox's
     *  granted counter ability. Ignored for non-spell target types. */
    spellWouldDestroyLandYouControl?: boolean;
    /** Restricts a stack-object target by object kind (CR 113 / 114.1).
     *  Propagated from TargetRequirement.spellStackKind. Used by Brown Ouphe
     *  ("counter target activated ability ...") and Stifle ("... activated or
     *  triggered ability", `"ability"`). Ignored for non-spell types. */
    spellStackKind?: "spell" | "activated-ability" | "ability";
    /** Restricts a stack-object target to objects whose source card types
     *  include at least one of these (CR 113.7a). Propagated from
     *  TargetRequirement.stackSourceTypeFilter. Used by Brown Ouphe
     *  ("...from an artifact source"). Ignored for non-spell types. */
    stackSourceTypeFilter?: CardType[];
    /** Restricts a stack SPELL target to spells that target at least one of
     *  these permanent instance ids (CR 114.1). Propagated from
     *  TargetRequirement.spellTargetsInstanceIds. Used by Mistfolk ("counter
     *  target spell that targets this creature"). Ignored for non-spell types. */
    spellTargetsInstanceIds?: string[];
    /** Restricts legal PLAYER targets to players who attacked this turn
     *  (CR 506.2). Propagated from TargetRequirement.playerAttackedThisTurn.
     *  Used by Fire and Brimstone. Ignored for non-player target types. */
    playerAttackedThisTurn?: boolean;
    /** Zone the target lives in (CR 109.2). Default "battlefield" — set to
     *  "graveyard" for reanimation/recursion spells like Regrowth. Propagated
     *  from TargetRequirement.zone. */
    zone?: "battlefield" | "graveyard";
    /** Restricts targets by relationship to the chooser. Propagated from
     *  TargetRequirement.controller. Honored only when zone is non-default.
     *  `"active"` restricts to the active player's permanents (Arcum's
     *  Whistle). */
    controller?: "you" | "opponent" | "any" | "active";
    /** Targets already selected. */
    selected: TargetSelection[];
    /** Divide-as-you-choose budget (CR 601.2d / 120.4). When set, this spell
     *  divides this total of damage / counters among the chosen targets, each
     *  target receiving at least 1. Propagated from the card's resolved total
     *  (Fire Covenant = chosen X, Meteor Shower = X+1, Fiery Justice = 5,
     *  Spoils of War = derived X). Drives the cap on target count (a player
     *  can't choose more targets than the total) and the per-target amount UI. */
    divideTotal?: number;
    /** Per-target amounts assigned during divide-as-you-choose selection,
     *  keyed by `${type}:${id}` (parallels `selected`). Each entry is ≥ 1.
     *  Written to the stack item as `targetAmounts` at finalization. Undefined
     *  until the caster assigns amounts; an all-1s default is filled in at
     *  finalize when the totals leave no real choice. */
    divideAmounts?: Record<string, number>;
    /** Mirrors PendingCast.keepPriority — propagated when the pending cast is created. */
    keepPriority?: boolean;
    /** Propagated from announceCast when the spell has X in its mana cost. */
    chosenX?: number;
    /** CR 702.33 — how many times the caster chose to pay this spell's Kicker
     *  cost at announcement (0/absent = not kicked). Propagated from
     *  announceCast through `finalizeTargetSelection` → pendingCast → stack item
     *  so the kicked target set (`kickedTargetRequirement`) governs this
     *  selection and the tally reaches resolution. */
    kickerCount?: number;
    /** CR 107.4f — how many of this cast's Phyrexian pips ({C/P}) the caster
     *  chose to pay with LIFE (2 each), propagated from announceCast so the
     *  mana-vs-life split is applied at cast commit
     *  (`finalizeTargetSelection` → `resolvePhyrexianCastPayment`). Absent =
     *  auto-resolve to the most-life affordable split. Used by targeted
     *  Phyrexian spells (Dismember, Gitaxian Probe). */
    phyrexianLifePips?: number;
    /** Mode id chosen at announcement for modal spells (CR 700.2 / 700.2c).
     *  Propagated through pendingCast → stack item. Determines which mode's
     *  `targetRequirement` governs this selection. */
    chosenModeId?: string;
    /** CR 118.9 — id of a chosen ALTERNATIVE casting cost
     *  (`CardDefinition.alternativeCosts`), propagated from announcement so it
     *  is paid at cast commit (`finalizeTargetSelection`) instead of the mana
     *  cost. Used by targeted alt-cost spells (Thwart, Fireblast). */
    alternativeCostId?: string;
    /** Distinguishes a spell cast (default) from an activated ability that
     *  requires targets (CR 602.2b). When "ability", `abilityId` is set and
     *  costs are paid at finalization instead of at announcement. When
     *  "copy-retarget", target selection re-points the targets of a spell
     *  COPY already on the stack (CR 707.10b — Fork's "you may choose new
     *  targets for the copy"); `cardInstanceId` holds the copy's stack id and
     *  finalization writes the chosen targets onto that stack item instead of
     *  casting anything. When "retarget", target selection re-points the targets
     *  of the ORIGINAL spell already on the stack (CR 114.6 — Reflecting Mirror's
     *  "change the target of target spell"); `cardInstanceId` holds the original
     *  spell's stack id and finalization writes the chosen targets onto it. */
    kind?: "cast" | "ability" | "copy-retarget" | "retarget";
    /** For `kind: "ability"` only — id of the activated ability template on
     *  the source card definition. */
    abilityId?: string;
    /** For `kind: "ability"` only — set when the activated ability was granted
     *  to the source by another card (CR 113.1, e.g. Zombie Master granting
     *  "{B}: Regenerate ~" to other Zombies). The template is looked up via
     *  this card def id; the ability resolves with the source permanent as
     *  `ctx.sourceInstanceId`. Undefined for native activated abilities. */
    grantedSourceCardId?: string;
    /** Acting Player (ADR 0037): the player who answers cast-time choices when
     *  split off from the controller (`playerId`) for a controlled cast.
     *  Defaults to `playerId` when absent — read via `getActingPlayer`. */
    actingPlayerId?: string;
    /** Additional INDEPENDENT target groups still to be chosen after the
     *  current one (CR 601.2c — Fumarole's "target creature and target land").
     *  A FIFO queue of `TargetRequirement`s from the card's
     *  `additionalTargetRequirements`; when the current group's selection
     *  completes and this queue is non-empty, the engine loads the next
     *  requirement into this same `pendingTarget` (moving the current group's
     *  picks into `priorSelected`) instead of finalizing. Undefined/empty for
     *  single-group spells. */
    remainingRequirements?: TargetRequirement[];
    /** Targets already locked in from EARLIER target groups of a multi-group
     *  spell (CR 601.2c), in declaration order. `selected` tracks only the
     *  CURRENT group; on group completion its picks are appended here and
     *  `selected` is reset for the next group. Finalization writes
     *  `[...priorSelected, ...selected]` onto the stack item, so an Effect
     *  Script indexes the groups positionally (`{ target: 0 }`, `{ target: 1 }`,
     *  …). Undefined for single-group spells. */
    priorSelected?: TargetSelection[];
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

/** A one-shot "these cards were just revealed to you" notification (Reveal
 *  dialog). `kind` distinguishes a private look (`look` — Mishra's Bauble,
 *  Gitaxian Probe) from a public reveal (`reveal`); the UI title/wording keys
 *  off it. `cards` is a self-contained snapshot (instance id + card def id) so
 *  the dialog renders even after the cards move. `id` is deterministic
 *  (resolution-derived, never wall-clock) so the client can dedup and the
 *  engine stays replay-stable. */
export type RevealNotification = {
    id: string;
    /** Player ids that see the dialog: the looker for a private look, every
     *  player for a public reveal. */
    audience: string[];
    /** Source card def id (art / title). */
    source: string;
    kind: "look" | "reveal";
    cards: { instanceId: string; cardId: string }[];
};

/** CR 508.1c/1g — a parked per-attacker MANA attack tax awaiting the attacking
 *  player's payment (Propaganda / Ghostly Prison / Windborn Muse / Collective
 *  Restraint). Set at declare-attackers confirmation once the aggregated tax is
 *  non-zero; the declaration suspends here until the payer covers `cost` (via
 *  auto-tap or manual land taps, mirroring a cast payment) or cancels the whole
 *  declaration. Unlike a cast/activation payment this is NOT a priority window —
 *  it is a turn-based action (its own `attack-mana-tax` Expected Input), so only
 *  the dedicated tax mutations make progress. `tappedLandIds` records sources
 *  tapped so far for the cost so an un-tap / cancel can refund them. */
export interface AttackManaTaxPayment {
    /** The payer — the attacking (active) player whose creatures are taxed. */
    playerId: string;
    /** The aggregated mana still owed for the whole declaration (summed across
     *  every taxed attacker and every taxing source, normalized so a variable
     *  `{X}` is already folded into generic). */
    cost: ManaCost;
    /** Oracle text of the taxing effect, shown on the payment banner. */
    reason: string;
    /** Ids of mana sources tapped toward this cost so far (CR 601.2g), so
     *  un-tap / cancel can untap them and refund their mana. */
    tappedLandIds: string[];
}

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
    /** CR 702.35d — the currently-open Madness cast window. Set when a reflexive
     *  madness trigger resolves (`openMadnessCastWindow`): the owner may cast the
     *  named exiled card for its madness cost while they hold priority; passing
     *  priority instead bins it (`declineMadness`). Cleared on cast or decline.
     *  Persisted so an owner who saves mid-decision resumes with the window open.
     *  At most one is open at a time (reflexive triggers resolve one by one). */
    madnessCastWindow?: { cardId: string; ownerId: string };
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
    /** CR 603.3b / ADR 0058 — simultaneous triggered abilities collected but not
     *  yet placed on the stack, held off-stack while their controllers order
     *  them. Non-empty ONLY while at least one `trigger-order` PendingChoice is
     *  active (itself a stable save point, so it must survive a DB round-trip).
     *  Stored bottom-first, APNAP-grouped (active player's slice first) exactly
     *  as `collectTriggers` produced it; when the last ordering clears, the whole
     *  batch is pushed onto the stack in one shot and the field is cleared.
     *  Undefined at every fully-resolved point. */
    pendingTriggerBatch?: StackItem[];
    /** ADR 0026 (Reveal dialog) — one-shot notifications produced when a pure
     *  look/peek/reveal effect resolves (Mishra's Bauble, Gitaxian Probe, …).
     *  Each entry drives a transient client dialog that shows the revealed
     *  cards to the players in `audience`; persistent visibility afterward is
     *  the separate per-card `knownTo` mechanism. Populated during a resolution
     *  via `SpellContext.notifyReveal` and cleared at the top of the next
     *  `resolveTopOfStack`, so it rides exactly one stable snapshot to the
     *  client (which dedups by `id` and auto-dismisses). NOT emitted by the
     *  `reveal` Op automatically — it is an explicit opt-in, so a reveal tied to
     *  a choice (Thoughtseize) shows its picker, not a redundant timed dialog. */
    pendingReveals?: RevealNotification[];
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
        /** CR 508.1a — per-attacker attack target. Each attacker chooses either
         *  the defending player (the default: absence of an entry) OR a
         *  planeswalker that player controls. Maps attackerId → planeswalkerId.
         *  An attacker with an entry here deals its combat damage to that
         *  planeswalker's loyalty instead of to the defending player (CR 120.3c /
         *  509.1h, issue #1220). Distinct from `combatDamageRedirectToPermanent`
         *  (Kjeldoran Royal Guard), which is a post-declaration redirect, not the
         *  declare-time target chosen here. Cleared at END_OF_COMBAT with the
         *  rest of `combat`. */
        attackTargets?: Record<string, string>;
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
        /** Parked land-sacrifice attack tax awaiting the attacking player's
         *  choice (CR 508.1c/1g, 701.21a — Flooded Woodlands, Reclamation).
         *  Present only while the tax is non-fungible; confirmAttackers
         *  finalizes once complete. */
        pendingAttackSacrifice?: SacrificeSelection;
        /** Parked mana attack tax awaiting the attacking player's payment
         *  (CR 508.1c/1g — Propaganda, Ghostly Prison, Collective Restraint).
         *  Present only while the aggregated tax is unpaid; confirmAttackers
         *  (via the tax mutations) resumes the declaration once it clears. */
        pendingAttackManaTax?: AttackManaTaxPayment;
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
        /** "alternate-win" (issue #1066, CR 104.2a) — a spell/ability
         *  DESIGNATES the winner directly (Coalition Victory), rather than the
         *  loser meeting a CR 704.5 loss condition — the only reason with no
         *  natural "why the loser lost" story, since there is none. */
        reason:
            | "life"
            | "decked"
            | "concede"
            | "draw"
            | "poison"
            | "alternate-win";
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
    /** Per-player damage-prevention shields with a source match + reduction
     *  mode (CR 615.1). Dark Sphere (prevent half from a chosen source, once)
     *  and Scarecrow (prevent all flying-source damage this turn) register
     *  these; consumed/reduced by `applyPlayerDamagePrevention` on every
     *  player-damage event. Cleared at CLEANUP for end-of-turn shields. */
    playerDamagePrevention?: PlayerDamagePreventionShield[];
    /** Running tallies of damage actually prevented by tagged
     *  `targetPreventionShields` (CR 615.1), keyed by the shield's `tallyId`.
     *  A follow-up effect reads "the amount of damage prevented this way"
     *  here (Sacred Boon's next-end-step +0/+1 counters) and clears the entry
     *  via `consumePreventionTally`. Cleared at CLEANUP with its shield. */
    preventionTallies?: Record<string, number>;
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
    /** Storm (CR 702.40a) — count of spells cast by ANY player this turn.
     *  Incremented inside `emitSpellCastEvent`; reset at the start of each
     *  turn (`advanceTurn`, ADR 0052). A spell COPY (`cloneSpellOntoStack`)
     *  is put onto the stack, not cast (CR 707.10), so it never passes
     *  through `emitSpellCastEvent` and never increments this. A general
     *  primitive — future "spells cast this turn" mechanics (prowess,
     *  magecraft, Aetherflux) reuse it rather than reinventing their own
     *  counter. */
    spellsCastThisTurn?: number;
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
    /** Combat-scoped flag set by Camouflage (CR 509 variant — the random twin
     *  of Raging River, ADR 0012). When true, the defending player's
     *  declare-blockers step is REPLACED for this combat: the engine has
     *  already locked the forced pile blocks into `combat.blockerAssignments`
     *  at the spell's resolution, so the DECLARE_BLOCKERS step grants no
     *  blocking priority and auto-confirms (see `phases.ts`). Combat-scoped:
     *  cleared at end of combat. Persisted so a mid-combat stable-point save
     *  preserves the "blockers already declared" state. */
    camouflageCombat?: boolean;
    /** Combat-scoped flag set by Melee (CR 509.1 variant — attacker-driven
     *  block override, #669). When true, the ATTACKING (active) player declares
     *  this combat's blocks instead of the defending player: the block-selection
     *  mutations (`selectBlocker` / `assignBlockerTarget` / `confirmBlockers`)
     *  route to the active player, while the same `validateBlockerEligibility`
     *  legality still gates every assignment (the attacker can only force LEGAL
     *  blocks — flying, protection, etc. are honoured). Melee's rider — "Whenever
     *  a creature attacks and isn't blocked this combat, untap it and remove it
     *  from combat" — fires at blocker confirmation against every attacker not in
     *  `combat.blockedAttackerIds`. Combat-scoped: cleared at end of combat
     *  alongside the other combat-scoped state. Persisted so a mid-combat
     *  stable-point save preserves the "attacker chooses blocks" routing. */
    meleeCombat?: boolean;
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
    /** Player ids whose lands' mana output is replaced with {U} until end of
     *  turn (CR 614 — Deep Water: "if you tap a land you control for mana, it
     *  produces {U} instead of any other type"). Each Deep Water activation adds
     *  the controller's id (idempotent — a single entry suffices, the
     *  replacement is all-or-nothing). When such a player taps a LAND for mana,
     *  the produced colours are rewritten to the same TOTAL quantity of {U}
     *  before they reach the pool. Cleared at CLEANUP (until end of turn). */
    landManaReplacedToBlueThisTurn?: string[];
    /** Player ids who have an active FEM High Tide this turn (CR 614-style
     *  additive rider): "Until end of turn, whenever a player taps an Island
     *  for mana, that player adds an additional {U}." Each High Tide resolution
     *  adds the casting player's id (one entry per cast — repeated High Tides
     *  stack additively, so duplicate ids are intentional and each contributes
     *  one extra {U} per Island tap). Read by the single `applyLandManaReplacement`
     *  mana funnel. Cleared at CLEANUP (until end of turn). */
    highTideThisTurn?: string[];
    /** Turn-scoped, parametrized land-mana riders (CR 614 / 514.2 — "until end
     *  of turn" mana replacements set by an upkeep trigger). Generalizes the
     *  blue-only High Tide / Deep Water shape to any basic land subtype and
     *  either mode (Chaos Moon's parity rider): when a player taps a land of the
     *  named `subtype` for mana,
     *  - `mode: "additional"` adds an extra `color` mana on top of the land's
     *    normal output (Chaos Moon odd — "adds an additional {R}"); stacks.
     *  - `mode: "override"` rewrites the land's whole output to that TOTAL
     *    quantity of `color` (Chaos Moon even — "produces colorless instead of
     *    any other type", `color: "C"`).
     *  Each entry applies to every player's taps (the printed riders are global).
     *  Read by the single `applyLandManaReplacement` mana funnel; cleared at
     *  CLEANUP. */
    landManaRidersThisTurn?: Array<{
        subtype: string;
        color: Color;
        mode: "additional" | "override";
    }>;
    /** When true, no player may play a land and lands can't enter the
     *  battlefield (Worms of the Earth). Unlike the turn-scoped flags below,
     *  this is NOT cleared at CLEANUP — it is a cache of a battlefield-derived
     *  condition, recomputed at every SBA pass (`refreshLandPlayLock`) from any
     *  permanent whose CardDefinition declares `preventsLandPlayAndETB`. The
     *  cache exists for serialization/observability; the land-play
     *  (`getLegalActions`) and land-ETB (`canLandEnterBattlefield`) consumers
     *  read the live derivation `landPlayLockActive(state)` directly, so the
     *  lock lifts the instant Worms leaves play with no stale-flag risk. */
    landPlayLocked?: boolean;
    /** When true, all combat damage is prevented this turn (CR 615, Fog).
     *  Checked at the top of `applyAllCombatDamage`; cleared at CLEANUP. */
    preventAllCombatDamageThisTurn?: boolean;
    /** Instance ids of permanents that "assign no combat damage this turn"
     *  (CR 510.1c, 702.x — Farrel's Mantle, Farrel's Zealot). A source in this
     *  set deals no combat damage in any damage step this turn; checked on the
     *  source side at the top of `applyOneCombatDamage`. Distinct from a
     *  prevention shield: the creature simply assigns 0 (its combat-damage
     *  assignment is skipped, so it can't be lethal to a blocker either).
     *  Cleared at CLEANUP. */
    assignsNoCombatDamageThisTurn?: string[];
    /** CR 601.3a / 514.2 — players under a turn-scoped "can't cast spells this
     *  turn" restriction (Xantid Swarm's attack trigger locks the defending
     *  player; Abeyance narrows it to instant/sorcery only via `cardTypes`).
     *  Enforced by the shared cast gate `castProhibitionReason` (read by both
     *  the GRE `getLegalActions` and the client). Distinct from the
     *  permanent-sourced `cast-restriction` statics in `castRestrictions.ts`:
     *  this is a per-player turn flag set by an effect, so it does NOT revert
     *  when a source leaves play — it is cleared unconditionally at CLEANUP.
     *  An omitted/empty `cardTypes` forbids ALL spells (the original Xantid
     *  Swarm shape); a non-empty list narrows the lock to those card types. */
    cannotCastSpellsThisTurn?: { playerId: string; cardTypes?: CardType[] }[];
    /** CR 602.1 / 605.1a / 514.2 — player ids under a turn-scoped "can't
     *  activate abilities that aren't mana abilities" restriction (Abeyance).
     *  Mana abilities (`useStack: false`) are structurally exempt: they never
     *  go through the `activateAbility` mutation this flag gates (they use
     *  `tapUntap` instead), so the restriction only ever needs to check
     *  non-mana (`useStack: true`) activation, with no separate mana-ability
     *  branch to special-case. Cleared unconditionally at CLEANUP. */
    cannotActivateAbilitiesThisTurn?: string[];
    /** Turn-scoped all-unblocked combat-damage redirects (CR 614.6 — Kjeldoran
     *  Royal Guard). Each entry redirects ALL combat damage that unblocked
     *  attackers would deal to `playerId` onto the permanent `toPermanentId`
     *  instead, for the rest of the turn. Applied at the unblocked-attacker
     *  branch of `applyAllCombatDamage` (source is unblocked → hits the
     *  defending player); trample-through damage from a blocked creature is NOT
     *  redirected. Cleared at CLEANUP. */
    combatDamageRedirectToPermanent?: {
        playerId: string;
        toPermanentId: string;
    }[];
    /** Controllers with an active Gaze of Pain rider this turn (ICE, CR 603.7a
     *  turn-scoped floating trigger). While a controller id is in this list,
     *  its Gaze of Pain card's graveyard-zone triggered ability fires on each
     *  `ATTACKER_UNBLOCKED` by a creature that controller controls. Cleared at
     *  CLEANUP so the rider expires "until end of turn". */
    gazeOfPainActiveThisTurn?: string[];
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
    /** CR 614 (issue #1145) — turn-scoped "if a card would be put into your
     *  graveyard from anywhere this turn, exile it instead" grants
     *  (Yawgmoth's Will). Distinct from a permanent-bound
     *  `replacementEffects[]` entry with `eventKind: "graveyard-bound"`
     *  (Dauthi Voidwalker), which lasts only as long as its source stays on
     *  the battlefield — a one-shot SORCERY has no battlefield presence to
     *  carry a continuous effect, so its "until end of turn" redirect rides
     *  this transient list instead, consulted by
     *  `applyGraveyardBoundReplacements` after the permanent-bound loop
     *  (mirrors `destroyReplacementShields`). Cleared unconditionally at
     *  CLEANUP (CR 514.2), same boundary as `cannotCastSpellsThisTurn`. */
    graveyardBoundRedirectThisTurn?: GraveyardBoundRedirectGrant[];
    /** Per-instance "prevent all combat damage to and by this permanent"
     *  shields (CR 615, Ebony Horse). Consumed in the combat damage step;
     *  unconsumed remainder purged at `duration` expiry. */
    combatDamageImmunity?: CombatDamageImmunity[];
    /** CR 603.7 / 119 — turn-scoped delayed lifegain effects keyed to a
     *  watched permanent (Glyph of Life). When the watched permanent is dealt
     *  combat damage by an attacker, the effect's controller gains that much
     *  life. Scanned in `applyAllCombatDamage`; unconsumed entries wear off at
     *  CLEANUP via `duration` (CR 514.2). */
    damageTriggeredLifegain?: DamageTriggeredLifegain[];
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
    /** CR 303.4f — Auras that have left their origin zone but have NOT yet
     *  entered the battlefield because their controller still owes a "choose
     *  what to enchant" pick (a `choose-aura-host` PendingChoice is queued for
     *  each). Held here — off every zone — so no SBA (704.5m unattached-Aura
     *  sweep) or wire projection ever observes an unattached Aura on the
     *  battlefield mid-choice. `finalizeAuraHost` pulls the entry, attaches the
     *  Aura to the chosen host, and runs the deferred entry. Only ever populated
     *  transiently while a matching choice is pending; empty (undefined) at a
     *  fully-resolved stable point. */
    stagedAuraEntries?: StagedAuraEntry[];
    /** Authoritative Expected Input (ADR 0047) — the single answer to "what is
     *  the game waiting for, from whom?". Maintained by the engine at every
     *  stable point via {@link refreshExpectedInput} (persistence seam +
     *  shared test fixtures), NOT derived on read. Optional because it is
     *  materialized lazily: `undefined` means "not yet computed on this state"
     *  (e.g. an intermediate state a test built by hand) or "the game is over
     *  and waits for nothing". Every public game mutation is gated through this
     *  contract by `assertExpectedInput` (#799) before its action-specific
     *  validation. See {@link ExpectedInput}. */
    expectedInput?: ExpectedInput;
};

/** Authoritative discriminated union describing what input the game is
 *  currently waiting for, and from which player (ADR 0047). Maintained by the
 *  engine at every stable point — set/recomputed when a choice is
 *  enqueued/dequeued, a target wait begins/ends, blockers are declared, or
 *  priority is handed off — never derived on read.
 *
 *  Precedence when several waiting sources are simultaneously present
 *  (see `computeExpectedInput`): `choice` > `target` > `blockers` >
 *  `priority`. A mid-resolution suspension (PendingChoice) outranks
 *  everything; an in-progress spell/ability payment
 *  (pendingCast / pendingActivation) is a priority-holder state and maps to
 *  `priority` (the payer still holds priority — CR 117). The coherence
 *  invariant (`assertExpectedInputCoherent`) asserts the scattered pending*
 *  fields + priority agree with this field. */
export type ExpectedInput =
    | {
          /** CR 608.2 / 101.4 — the head PendingChoice (FIFO front) awaits
           *  input from `playerId`. */
          kind: "choice";
          playerId: string;
          /** Head PendingChoice identity, so consumers/gate can key on it. */
          stackItemId: string;
          choiceId: string;
          choiceKind: PendingChoiceKind;
      }
    | {
          /** CR 601.2c — target selection for a spell/ability awaits input
           *  from `playerId`. */
          kind: "target";
          playerId: string;
          cardInstanceId: string;
          targetType: TargetRequirement["type"];
      }
    | {
          /** CR 509.1 — the declaring player is choosing blockers this combat
           *  (the defending player, or the attacking player under Melee). */
          kind: "blockers";
          playerId: string;
      }
    | {
          /** CR 508.1c/1g / 701.21a — the attacking player is choosing which
           *  land(s) to sacrifice for the attack-declaration tax (Flooded
           *  Woodlands, Reclamation). Parked mid declare-attackers on
           *  `combat.pendingAttackSacrifice`; unlike a cast/activation payment
           *  this is NOT a priority window (CR 508.1 is a turn-based action),
           *  so it gets its own waiting state and only `selectSacrifice` makes
           *  progress — endTurn / passPriority / casting must NOT bypass it. */
          kind: "sacrifice";
          playerId: string;
      }
    | {
          /** CR 508.1c/1g — the attacking player is paying the per-attacker
           *  MANA attack tax (Propaganda, Ghostly Prison, Collective Restraint)
           *  parked mid declare-attackers on `combat.pendingAttackManaTax`. Like
           *  the land-sacrifice tax this is a turn-based action, NOT a priority
           *  window, so it gets its own waiting state: only the attack-tax
           *  payment mutations make progress, and endTurn / passPriority /
           *  casting must NOT bypass it. */
          kind: "attack-mana-tax";
          playerId: string;
      }
    | {
          /** CR 117 — `playerId` holds priority. The default waiting state,
           *  and also the state during an in-progress cast/activation payment
           *  (pendingCast / pendingActivation), where the payer holds
           *  priority. */
          kind: "priority";
          playerId: string;
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
/** A turn-scoped grant redirecting a card entering `ownerId`'s OWN graveyard
 *  to exile instead (CR 614, issue #1145 — Yawgmoth's Will's shape). Applied
 *  by `applyGraveyardBoundReplacements` as a transient layer on top of the
 *  permanent-bound `replacementEffects[]` loop; armed via
 *  `SpellContext.armGraveyardRedirectThisTurn` and cleared at CLEANUP. */
export interface GraveyardBoundRedirectGrant {
    /** The player whose own graveyard-bound cards this redirects (CR 400.7
     *  — a card always goes to ITS OWNER's graveyard). */
    ownerId: string;
    /** Counters to stamp on the redirected card, for parity with the
     *  permanent-bound shape's `tagCounters` (unused by Yawgmoth's Will). */
    tagCounters?: Record<string, number>;
}

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

/** CR 603.7 / 119 — a turn-scoped delayed triggered effect: "whenever
 *  [instanceId] is dealt damage by an attacking creature this turn, you gain
 *  that much life". Registered at a spell's resolution (Glyph of Life) and
 *  scanned in the combat damage step: when the watched permanent is dealt
 *  combat damage by a source that is currently an attacker (CR 506.2 — the
 *  source's id is in `combat.attackerIds`), `controllerId` gains that much
 *  life. Source-filtered to attackers only — damage from a blocker or any
 *  non-combat source does NOT trigger it. Cleared at CLEANUP via `duration`
 *  (CR 514.2). */
export type DamageTriggeredLifegain = {
    /** Permanent being watched for incoming attacker damage. */
    instanceId: string;
    /** Player who gains the life (the effect's controller, CR 113.7). */
    controllerId: string;
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
    /** CR 702.26f — `GameState.turn` on which this permanent phased out. An
     *  `untap-cycle` bundle does NOT phase in during the untap step of THIS
     *  turn; it waits for the controller's NEXT untap step. The untap-step
     *  phase-in (`phaseInUntapCycleBundles`) skips a bundle whose
     *  `phasedOutTurn` equals the current turn. `undefined` on a `source-leaves`
     *  bundle (whose return is not untap-driven). */
    phasedOutTurn?: number;
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

/** CR 303.4f — an Aura removed from its origin zone and awaiting its
 *  controller's "choose what to enchant" pick before it enters the
 *  battlefield. Carries the fat Aura object itself (it lives in no zone while
 *  staged) plus the controller under whom it will enter. Matched to its
 *  `choose-aura-host` PendingChoice by the Aura's instance id. See
 *  {@link GameState.stagedAuraEntries}. */
export interface StagedAuraEntry {
    /** The Aura card, off every zone until the host is chosen. */
    aura: CardInstanceState;
    /** Player under whose control the Aura enters (the reanimator's controller,
     *  or the returning effect's controller). */
    controllerId: string;
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
        // CR 615.1 readback — record how much this tagged shield prevented so
        // a follow-up effect ("+0/+1 counter per 1 damage prevented this way",
        // Sacred Boon) can read the total even after the shield is spent.
        if (s.tallyId !== undefined && absorbed > 0) {
            const tallies = state.preventionTallies ?? {};
            tallies[s.tallyId] = (tallies[s.tallyId] ?? 0) + absorbed;
            state.preventionTallies = tallies;
        }
    }
    state.targetPreventionShields = shields.filter((s) => s.remaining > 0);
    if (state.targetPreventionShields.length === 0) {
        state.targetPreventionShields = undefined;
    }
    return remaining;
}

/** Applies any matching `playerDamagePrevention` shields to damage headed at a
 *  player (CR 615.1). Walks the shields in declaration order; for each shield
 *  whose match (specific source, or a source keyword among
 *  `sourceStaticAbilities`, or unconditional) fits this event, reduces the
 *  amount per its `mode` ("all" → 0; "half-down" → drop `floor(amount/2)`),
 *  decrements `remaining`, and continues with the reduced amount. Returns the
 *  residual the caller should actually apply. Spent shields (remaining 0) are
 *  spliced out; the field is cleared when empty. Used by Dark Sphere and
 *  Scarecrow (The Dark). */
export function applyPlayerDamagePrevention(
    state: GameState,
    playerId: string,
    sourceInstanceId: string,
    sourceStaticAbilities: ReadonlyArray<string> | undefined,
    amount: number
): number {
    const shields = state.playerDamagePrevention;
    if (!shields || shields.length === 0) return amount;
    let remaining = amount;
    for (const s of shields) {
        if (remaining <= 0) break;
        if (s.remaining <= 0) continue;
        if (s.playerId !== playerId) continue;
        if (
            s.match.sourceInstanceId !== undefined &&
            s.match.sourceInstanceId !== sourceInstanceId
        ) {
            continue;
        }
        if (
            s.match.sourceStaticAbility !== undefined &&
            !(sourceStaticAbilities ?? []).includes(s.match.sourceStaticAbility)
        ) {
            continue;
        }
        if (s.mode === "all") {
            remaining = 0;
        } else {
            // "prevent half that damage, rounded down" (CR 615.1, Dark Sphere).
            remaining -= Math.floor(remaining / 2);
        }
        s.remaining -= 1;
    }
    state.playerDamagePrevention = shields.filter((s) => s.remaining > 0);
    if (state.playerDamagePrevention.length === 0) {
        state.playerDamagePrevention = undefined;
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

/** True when this trigger StackItem is a triggered MANA ability (CR 605.1b):
 *  its ability declares `manaAbility`. Such an ability does not use the stack
 *  (CR 605.4) — the caller resolves it immediately instead of pushing it. */
function isManaAbilityTriggerItem(item: StackItem): boolean {
    if (!item.triggeredAbilityId) return false;
    const ability = findTriggeredAbility(item, item.triggeredAbilityId);
    return ability?.manaAbility === true;
}

/** CR 605.4 — resolve a triggered mana ability in place, in the same game
 *  action that fired it, WITHOUT granting priority. The item is pushed only
 *  transiently so the standard resolution path (`resolveTopOfStack`) can run
 *  it; on success it pops itself and the mana is in the pool. If resolution
 *  suspends on a player choice made as it resolves (CR 605.4b — Fertile
 *  Ground's colour pick), the item stays on the stack with a pending choice
 *  and finishes once that choice is submitted; a triggered mana ability still
 *  never hands priority to the non-active player to respond. */
function resolveManaAbilityTriggerImmediately(
    state: GameState,
    item: StackItem
): void {
    state.stack.push(item);
    resolveTopOfStack(state);
}

/** Drains `state.pendingEvents`, scans for matching triggered abilities, and
 *  pushes them onto the stack (CR 603.2). Hands priority back to the active
 *  player (CR 117.3c) when at least one trigger lands on the stack. Safe to
 *  call repeatedly — a no-op when the queue is empty.
 *
 *  CR 605.1b / 605.4 — triggered MANA abilities (Wild Growth, Mana Flare,
 *  Gauntlet of Might, Snowfall) are the exception: they do not use the stack.
 *  Each is resolved immediately, before any player receives priority, so the
 *  extra mana is available within the very cost payment / cumulative-upkeep
 *  step that tapped the land — no intervening priority pass, and the player is
 *  never forced to commit "pay"/"skip" before the bonus mana arrives. */
export function processPendingActionTriggers(state: GameState): void {
    const events = flushPendingEvents(state);
    if (events.length === 0) return;
    const triggers = collectTriggers(state, events);
    if (triggers.length === 0) return;
    const stackTriggers: StackItem[] = [];
    for (const trigger of triggers) {
        if (isManaAbilityTriggerItem(trigger)) {
            // CR 605.4 — the cost-payment tap path may have already resolved
            // this tap's mana bonus off-stack (`realizeManaAbilityTapBonus`),
            // flagging the triggering event. Re-resolving it here would add the
            // bonus a second time (double mana). Its NON-mana siblings on the
            // same event are still collected and stacked below, so nothing is
            // lost by skipping only the already-realized mana ability.
            const ev = trigger.triggerEvent;
            if (
                ev?.type === "PERMANENT_TAPPED" &&
                ev.manaTriggersResolved === true
            ) {
                continue;
            }
            resolveManaAbilityTriggerImmediately(state, trigger);
        } else {
            stackTriggers.push(trigger);
        }
    }
    if (stackTriggers.length === 0) return;
    // CR 603.3b (ADR 0058) — route through the shared placement helper so each
    // controller can order their own simultaneous triggers. LANDED → grant
    // priority to the active player as before; SUSPENDED → the helper already
    // parked priority on the first chooser and stashed the batch off-stack.
    if (placeTriggersOnStack(state, stackTriggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** CR 605.4 — resolve ONLY the triggered MANA abilities (Wild Growth, Mana
 *  Flare, Gauntlet of Might) waiting in `pendingEvents` for a for-mana tap,
 *  immediately and off-stack, so their extra mana is in the pool RIGHT NOW —
 *  the cost-payment path calls this after each land tap so the bonus is
 *  available for the affordability check that decides whether the spell can be
 *  committed.
 *
 *  Unlike `processPendingActionTriggers`, this does NOT stack the tap's
 *  NON-mana triggers (City of Brass's ping, Manabarbs): a spell being cast is
 *  not yet on the stack, so those must wait until the cast commits (CR 601.2i)
 *  — the normal commit-time flush handles them. To make that possible the
 *  triggering events are drained, their mana bonuses resolved, then the events
 *  are RESTORED to `pendingEvents` (flagged `manaTriggersResolved`) so the
 *  commit-time flush still fires the non-mana triggers and an undo can still
 *  discard the event. The flag keeps the commit-time flush from re-resolving
 *  the mana bonus (see `processPendingActionTriggers`).
 *
 *  Returns nothing; the caller measures the pool delta to attribute the bonus
 *  to the just-tapped source (`CardInstanceState.tapBonusMana`). Idempotent:
 *  events already flagged are skipped, so calling it once per tap resolves only
 *  that tap's newly-emitted event. */
export function realizeManaAbilityTapBonus(state: GameState): void {
    const events = flushPendingEvents(state);
    if (events.length === 0) return;
    const triggers = collectTriggers(state, events);
    for (const trigger of triggers) {
        if (!isManaAbilityTriggerItem(trigger)) continue;
        const ev = trigger.triggerEvent;
        if (ev?.type !== "PERMANENT_TAPPED") continue;
        if (ev.manaTriggersResolved === true) continue;
        // Resolve off-stack. `pendingEvents` is currently empty (drained
        // above), so the nested trigger flush inside `resolveTopOfStack` sees
        // no events and cannot stack the deferred non-mana triggers early.
        resolveManaAbilityTriggerImmediately(state, trigger);
        ev.manaTriggersResolved = true;
    }
    // Restore the (now-flagged) events so the tap's non-mana triggers still
    // fire at cast commit and an undo can still discard them. Any new events the
    // bonus resolution emitted go first (preserve their arrival order).
    state.pendingEvents = [...(state.pendingEvents ?? []), ...events];
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

/** CR 614.12 / ADR 0051 — true when the current resolution must suspend for a
 *  mid-resolution player choice. Every stack-coupled choice (search-library,
 *  may-pay, `requestChoice`) belongs to the resolving item and suspends it. The
 *  ONE exception is a stackless `land-entry-tapped` pay-choice (a shock land put
 *  onto the battlefield by THIS effect, `stackItemId === ""`): it is answered in
 *  the active player's priority window AFTER the resolution completes, exactly
 *  like the play-land path, so it must NOT suspend/replay the resolution (which
 *  would re-run the search/move that already committed the entry). */
function resolutionSuspendedOnChoice(state: GameState): boolean {
    return (state.pendingChoices ?? []).some(
        (c) => !(c.kind === "land-entry-tapped" && c.stackItemId === "")
    );
}

function resolveTopOfStackInner(state: GameState): StackItem | null {
    if (state.stack.length === 0) throw new Error("Stack is empty");

    // Reveal dialog (one-shot): a prior resolution's reveal notifications have
    // already ridden a stable snapshot to the client (which dedups + auto-
    // dismisses), so clear them before this resolution so `notifyReveal` starts
    // a fresh batch. Safe because `notifyReveal` is opt-in on pure look/reveal
    // cards that resolve in a single pass (never mid-choice), so a resumed
    // resolution never loses a reveal produced before a suspension.
    state.pendingReveals = undefined;

    const top = state.stack[state.stack.length - 1];

    // CR 702.35d — the reflexive Madness cast-trigger. Engine-owned (no card-def
    // ability), so it is handled here before the spell/ability dispatch: open the
    // owner's single cast window on the still-exiled card, then leave the stack.
    // If the card is no longer in the owner's exile (an intervening effect moved
    // it), the trigger simply does nothing (CR 603.10 last-known-information).
    if (top.madnessTrigger) {
        const owner = getPlayer(state, top.ownerId);
        const card = owner.exile.find((c) => c.id === top.madnessTrigger);
        if (card && card.madnessExiled) {
            openMadnessCastWindow(state, card, top.ownerId);
        }
        state.stack.pop();
        return top;
    }

    const cardId = (top.card as { id?: string }).id;
    // Unknown ids (e.g. synthetic test fixtures) collapse to the vanilla
    // ETB-or-graveyard path. Production stack items always carry registry
    // ids, but tryGetDefinition keeps the resolver robust either way.
    const cardDef = cardId
        ? (tryGetDefinition(cardId) ?? undefined)
        : undefined;
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
                sendStackItemToGraveyard(state, top);
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
            if (resolutionSuspendedOnChoice(state)) {
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

    // Storm cast-trigger resolution (CR 702.40, ADR 0052) — engine code, not
    // a per-card `resolve()`. MUST be checked before the generic triggered-
    // ability branch below: that branch looks up `cardDef.triggeredAbilities`
    // for an ability matching `triggeredAbilityId`, and the storm trigger's
    // card (the storm SPELL itself, e.g. Grapeshot) has no such entry — the
    // generic branch would silently find nothing and pop the trigger with
    // zero copies. Marked by `stormSnapshot`, unique to storm-produced stack
    // items (`collectCastTriggers`).
    if (top.triggeredAbilityId === STORM_TRIGGER_ID && top.stormSnapshot) {
        return resolveStormTrigger(state, top);
    }

    // Inline delayed triggered ability resolution (CR 603.7a, ADR 0048) —
    // the Effect Script path: the body Op list rides ON the stack item (no
    // card-def lookup), and the captured payload is re-bound as the body's
    // initial binding environment before the interpreter runs it. Checked
    // BEFORE the template path so an inline trigger never falls into the
    // def-lookup branch.
    if (top.delayedTriggerId && top.delayedEffects) {
        const ctx = buildSpellContext(state, top);
        runDelayedTriggerBody(
            ctx,
            top.delayedEffects,
            top.delayedPayload ?? {}
        );
        if (resolutionSuspendedOnChoice(state)) return null;
        delete top.collectedChoices;
        state.stack.pop();
        return top;
    }

    // Delayed triggered ability resolution (CR 603.7a). Resolver is looked
    // up on the scheduling card's def; payload carries ids captured at
    // scheduling time.
    if (top.delayedTriggerId && cardDef) {
        const trigger = cardDef.delayedTriggers?.find(
            (t) => t.id === top.delayedTriggerId
        );
        if (trigger) {
            const ctx = buildSpellContext(state, top);
            // The template path (legacy `resolve()` cards) only ever schedules
            // scalar payloads — list-valued captures (ADR 0049, issue #866) are
            // an inline-body-only feature that takes the branch above. The cast
            // reflects that invariant: a template trigger never sees a string[].
            trigger.resolve(
                ctx,
                (top.delayedPayload ?? {}) as Record<string, string>
            );
            if (resolutionSuspendedOnChoice(state)) return null;
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
                    // CR 702.30a — echo's "came under your control since your
                    // last upkeep" flag must survive into the resolve-time
                    // intervening-if so the trigger fires exactly once.
                    echoPending: sourceCard.echoPending,
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
                    if (resolutionSuspendedOnChoice(state)) {
                        return null; // suspended — wait for the choice submit
                    }
                }
                delete top.resolutionStep;
            } else {
                // ADR 0045 (issue #803) — an Effect Script resolves through the
                // SAME interpreter seam as a spell-site script; otherwise fall
                // back to the imperative `resolve`. `getAbilityEffectFn` throws
                // if both are declared (mutual exclusivity).
                const scriptFn = getAbilityEffectFn(ability);
                if (scriptFn) {
                    const ctx = buildSpellContext(state, top);
                    scriptFn(ctx);
                    if (resolutionSuspendedOnChoice(state)) return null;
                } else if (ability.resolve) {
                    const ctx = buildSpellContext(state, top);
                    ability.resolve(ctx, top.triggerEvent);
                    if (resolutionSuspendedOnChoice(state)) return null;
                }
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
            const grantingDef = tryGetDefinition(top.grantedSourceCardId);
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
                if (resolutionSuspendedOnChoice(state)) {
                    return null; // suspended — wait for selectResolutionChoice
                }
            }
            delete top.resolutionStep;
        } else if (ability) {
            // ADR 0045 (issue #803) — Effect Script through the shared
            // interpreter seam, else the imperative `resolve`.
            const scriptFn = getAbilityEffectFn(ability);
            if (scriptFn) {
                const ctx = buildSpellContext(state, top);
                scriptFn(ctx);
                if (resolutionSuspendedOnChoice(state)) return null;
            } else if (ability.resolve) {
                const ctx = buildSpellContext(state, top);
                ability.resolve(ctx);
                if (resolutionSuspendedOnChoice(state)) return null;
            }
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
                if (resolutionSuspendedOnChoice(state)) return null;
            }
        } else {
            const resolveFn = getResolveFn(cardDef);
            if (resolveFn) {
                const ctx = buildSpellContext(state, top);
                resolveFn(ctx);
                if (resolutionSuspendedOnChoice(state)) return null;
            }
        }
    }
    delete top.collectedChoices;
    state.stack.pop();
    finalizeSpellResolution(state, top, cardDef);
    return top;
}

/** CR 614.1c + 110.5b — returns true when `entering` enters the battlefield
 *  tapped, folding together every source: the card's own `entersTapped: true`
 *  / `entersTappedUnless` predicate, AND a battlefield-scanned player-scoped
 *  opponent-forced replacement (Kismet). The permanent's `controllerId` must
 *  already be set to its prospective controller. Card-agnostic beyond the
 *  card's own declared fields — Kismet's `forcesTapped` predicate owns the
 *  opponent + type filter, so no card is hardcoded here. Called at every ETB
 *  site that places a permanent onto the battlefield (played land, resolved
 *  spell, reanimation, token creation) via the shared `resolveEntersTapped`
 *  oracle, so the four sites can never drift out of sync again. */
export function shouldEnterTapped(
    state: GameState,
    entering: CardInstanceState
): boolean {
    const cardId = (entering.card as { id?: string } | undefined)?.id;
    const def = cardId ? (tryGetDefinition(cardId) ?? undefined) : undefined;
    return resolveEntersTapped(
        def,
        entering as unknown as PermanentView,
        state as never
    );
}

/** Moves a stack item (a spell that failed to resolve/finished resolving as
 *  a non-permanent/was countered) into its owner's graveyard — CR 614
 *  (issue #1145) consulted first so a graveyard-bound replacement
 *  (Yawgmoth's Will / Dauthi Voidwalker) can redirect it to exile instead.
 *  Single chokepoint shared by the target-legality fizzle path, the
 *  land-can't-enter / illegal-aura-host paths, the plain spell-resolves
 *  path, and `SpellContext.counter`'s default destination. */
function sendStackItemToGraveyard(state: GameState, item: StackItem): void {
    const owner = getPlayer(state, item.ownerId);
    const { destination, tagCounters } = graveyardDestinationFor(
        state,
        item.id,
        item.ownerId,
        "stack"
    );
    item.zone = destination;
    (owner[destination] as CardInstanceState[]).push(item);
    if (destination !== "graveyard") {
        applyGraveyardRedirectCounters(item, tagCounters);
    }
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
              staticAbilities?: string[];
              entersWith?: {
                  counters?: {
                      type: string;
                      count: number | "X" | "kicker";
                  }[];
              };
              /** CR 306.5b — planeswalker starting loyalty, placed as
               *  `counters["loyalty"]` on ETB (issue #700). */
              loyalty?: number;
          }
        | undefined
): void {
    const isPermanent = item.types.some((t) =>
        CASTABLE_PERMANENT_TYPES.includes(
            t as (typeof CASTABLE_PERMANENT_TYPES)[number]
        )
    );
    const controller = getPlayer(state, item.castById);

    if (isPermanent) {
        // Worms of the Earth (CR 614) — "Lands can't enter the battlefield."
        // A resolving land permanent that is prevented from entering is put
        // into its owner's graveyard instead (CR 608.3: the permanent never
        // enters; the card has nowhere to go but the graveyard). Lands can't be
        // played while the lock is active (rules.ts gate), but a land could
        // still try to enter via a spell/ability that puts it onto the
        // battlefield — this is the catch-all for that path.
        if (!canLandEnterBattlefield(state, item.types)) {
            sendStackItemToGraveyard(state, item);
            return;
        }
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
                host !== undefined && isFullyLegalAuraHost(state, host, item);
            if (!isLegalHost || host === undefined) {
                sendStackItemToGraveyard(state, item);
                return;
            }
            item.attachedTo = host.id;
        }
        item.zone = "battlefield";
        // CR 614.1c + 110.5b — a permanent enters tapped if its own card flag
        // says so OR a battlefield-scanned replacement (Kismet — "Artifacts,
        // creatures, and lands your opponents control enter tapped") forces it.
        item.isTapped =
            cardDef?.entersTapped === true || shouldEnterTapped(state, item);
        // CR 302.6 — every permanent begins tracking control continuity when
        // it enters: the `isSummoningSick` flag is set on entry and cleared at
        // the controller's untap step (see `untapStep`). For creatures this is
        // ordinary summoning sickness; for noncreature permanents (lands,
        // artifacts) the flag is inert in combat/{T}-checks (gated by
        // `isCreature`) but becomes meaningful the instant the permanent BECOMES
        // a creature — a manland animated the turn it entered reads sick, while
        // one controlled since a prior turn (flag already cleared) does not.
        markEnteredThisTurn(item);
        // CR 702.30a — Echo: a permanent that declares the `echo` keyword owes
        // its echo cost on its controller's first upkeep after it comes under
        // control. Flag it here (its entry into play); the echo trigger reads
        // the flag via its intervening-if and `markEchoPaid()` clears it on
        // payment. (Set only on the spell-resolution ETB path — the sole route
        // any built echo card enters today.)
        if (cardDef?.staticAbilities?.includes("echo")) {
            item.echoPending = true;
        }
        // CR 106.4 / 202.3 — spent-mana-color tracking (issue #900): snapshot
        // the ephemeral cast-commit `notedManaSpent` (present only when
        // `CardDefinition.noteManaSpent` is set) onto a PERSISTENT permanent
        // field the instant this stack item becomes a battlefield permanent,
        // so a later triggered ability's check-time `condition` can read
        // "which colour(s) were spent to cast this" (Vibrance/Deceit/
        // Wistfulness-style "if {R}{R} was spent" ETB clauses — see
        // `PermanentView.notedManaSpentOnCast`).
        if (item.notedManaSpent) {
            item.notedManaSpentOnCast = { ...item.notedManaSpent };
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
                        : // CR 702.33e — "a charge counter for each time it was
                          // kicked" (Everflowing Chalice) reads the Multikicker
                          // tally snapshotted on the resolving stack item.
                          entry.count === "kicker"
                          ? Math.max(0, item.kickerCount ?? 0)
                          : entry.count;
                if (n <= 0) continue;
                counters[entry.type] = (counters[entry.type] ?? 0) + n;
            }
            if (Object.keys(counters).length > 0) item.counters = counters;
        }
        // CR 306.5b — a planeswalker enters with a number of loyalty counters
        // equal to its printed starting loyalty (`CardDefinition.loyalty`).
        // Loyalty counters reuse the generic `counters` map (same shape as the
        // ETB counters above), so damage → loyalty removal (CR 120.3 / 704.5i)
        // and the `-N` loyalty-ability cost operate on one uniform field.
        if (cardDef?.loyalty !== undefined && cardDef.loyalty > 0) {
            item.counters = {
                ...(item.counters ?? {}),
                loyalty: (item.counters?.loyalty ?? 0) + cardDef.loyalty,
            };
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
        // CR 608.2 / 701.24 (issue #898) — a spell that instructs "Shuffle
        // <this spell> into its owner's library" as part of its own
        // resolution goes to the (shuffled) library instead of the graveyard
        // (Green Sun's Zenith). The flag is set by
        // `SpellContext.shuffleSelfIntoLibrary()` during the resolve. Checked
        // before `exileOnResolve` — the two redirects are mutually exclusive
        // in practice.
        if (item.shuffleIntoLibraryOnResolve) {
            item.zone = "library";
            owner.library.push(item);
            // ADR 0026 — a shuffle is an unwitnessed reordering; reuse the
            // exact primitive `shuffleLibrary` calls so this redirect behaves
            // identically to a normal post-search shuffle.
            seededShuffle(state, owner.library);
            clearKnowledge(owner.library, null);
            return;
        }
        // CR 608.2 — a spell that instructs "Exile <this spell>" as part of its
        // own resolution goes to exile instead of the graveyard (Recall). The
        // flag is set by `SpellContext.exileSelf()` during the resolve.
        if (item.exileOnResolve) {
            item.zone = "exile";
            owner.exile.push(item);
            return;
        }
        sendStackItemToGraveyard(state, item);
    }
}

/** Live derivation (CR 614 prohibition): true while ANY permanent on the
 *  battlefield has a CardDefinition declaring `preventsLandPlayAndETB` (Worms
 *  of the Earth). Scanned per call, mirroring the layer/replacement
 *  "battlefield-derived continuous effect" idiom — so the lock disappears the
 *  instant the source leaves play, with no LTB cleanup. `refreshLandPlayLock`
 *  mirrors this into the serializable `state.landPlayLocked` cache. */
export function landPlayLockActive(state: GameState): boolean {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetDefinition(cardId);
            if (def?.preventsLandPlayAndETB) return true;
        }
    }
    return false;
}

/** Mirrors the live `landPlayLockActive` derivation into the serializable
 *  `state.landPlayLocked` cache. Called from `checkStateBasedActions` so the
 *  flag tracks the battlefield at every stable point; the flag is dropped when
 *  the condition is false so it never lingers across DB writes. */
export function refreshLandPlayLock(state: GameState): void {
    if (landPlayLockActive(state)) {
        state.landPlayLocked = true;
    } else {
        delete state.landPlayLocked;
    }
}

/** CR 614 (Worms of the Earth) — a land may NOT enter the battlefield while the
 *  land-play lock is active. Checked at every battlefield-entry site that can
 *  move a land into play (spell resolution, reanimation, search-to-battlefield,
 *  token creation). Returns false to PREVENT the entry. Non-land permanents are
 *  always allowed. */
export function canLandEnterBattlefield(
    state: GameState,
    types: readonly CardType[]
): boolean {
    if (!types.includes("Land")) return true;
    return !landPlayLockActive(state);
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
/** Applies one source-bound `supertype-set` grant to `target` (CR 205.4a),
 *  recording source-keyed markers in `grantedSupertypes` / `removedSupertypes`
 *  so `unapplySupertypeSetGrant` can splice exactly this source's contribution
 *  back out. Idempotent per `(sourceId, supertype, direction)`. */
function applySupertypeSetGrant(
    target: CardInstanceState,
    sourceId: string,
    effect: { add?: readonly string[]; remove?: readonly string[] }
): void {
    if (effect.remove?.length) {
        const removed = target.removedSupertypes ?? [];
        for (const supertype of effect.remove) {
            if (
                !removed.some(
                    (r) => r.sourceId === sourceId && r.supertype === supertype
                )
            ) {
                removed.push({ supertype, sourceId });
            }
        }
        target.removedSupertypes = removed.length > 0 ? removed : undefined;
    }
    if (effect.add?.length) {
        const granted = target.grantedSupertypes ?? [];
        for (const supertype of effect.add) {
            if (
                !granted.some(
                    (g) => g.sourceId === sourceId && g.supertype === supertype
                )
            ) {
                granted.push({ supertype, sourceId });
            }
        }
        target.grantedSupertypes = granted.length > 0 ? granted : undefined;
    }
}

/** Reverse of `applySupertypeSetGrant`: drops every supertype marker keyed to
 *  `sourceId` from `target` (CR 611.2 — the continuous effect ends when the
 *  source leaves play). Indefinite mutations (sentinel `"indefinite"`) are
 *  left untouched. */
function unapplySupertypeSetGrant(
    target: CardInstanceState,
    sourceId: string
): void {
    if (target.grantedSupertypes?.length) {
        const kept = target.grantedSupertypes.filter(
            (g) => g.sourceId !== sourceId
        );
        target.grantedSupertypes = kept.length > 0 ? kept : undefined;
    }
    if (target.removedSupertypes?.length) {
        const kept = target.removedSupertypes.filter(
            (r) => r.sourceId !== sourceId
        );
        target.removedSupertypes = kept.length > 0 ? kept : undefined;
    }
}

export function applySourceStaticEffects(
    state: GameState,
    source: CardInstanceState
): void {
    const cardId = (source.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : null;
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
                    // CR 302.6 — becoming a creature via a type-grant does NOT
                    // reset summoning sickness: every permanent already tracks
                    // control continuity from entry (`markEnteredThisTurn`), so
                    // `isSummoningSick` already reflects whether it has been
                    // controlled since the start of its controller's most recent
                    // turn. (Setting it on `=== undefined` here was a bug — it
                    // re-sickened permanents controlled since a prior turn.)
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
                    // Two forms (ADR 0050): the fixed-output form (Blood Moon)
                    // gates with `applies` and replaces with the literal
                    // `subtypes`; the computed-output form (Illusionary Terrain)
                    // asks `subtypesFor` for the replacement, reading per-source
                    // stored state (`source.chosenSubtypes`) and returning null
                    // to leave the target untouched. `target.subtypes` is read
                    // mid-layer-4, so the computed form sees earlier-timestamp
                    // effects (CR 613 composition).
                    let newSubtypes: string[] | null;
                    if (effect.subtypesFor) {
                        newSubtypes = effect.subtypesFor(
                            target,
                            source,
                            STATIC_EFFECT_CTX
                        );
                    } else {
                        newSubtypes = effect.applies!(
                            target,
                            source,
                            STATIC_EFFECT_CTX
                        )
                            ? effect.subtypes!
                            : null;
                    }
                    if (newSubtypes === null) {
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
                            subtypes: newSubtypes,
                            sourceId: source.id,
                        });
                    }
                    target.grantedSubtypes =
                        grants.length > 0 ? grants : undefined;
                    target.subtypes = [...newSubtypes];
                } else if (effect.kind === "subtype-add") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const origins = target.grantedSubtypesAdd ?? [];
                    for (const subtype of effect.subtypes) {
                        const already = origins.some(
                            (o) =>
                                o.auraId === source.id && o.subtype === subtype
                        );
                        if (already) continue;
                        origins.push({ subtype, auraId: source.id });
                        if (!target.subtypes.includes(subtype)) {
                            target.subtypes = [...target.subtypes, subtype];
                        }
                    }
                    target.grantedSubtypesAdd =
                        origins.length > 0 ? origins : undefined;
                } else if (effect.kind === "supertype-set") {
                    // CR 205.4a — continuous supertype mutation (Melting).
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    applySupertypeSetGrant(target, source.id, effect);
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
                        ? tryGetDefinition(targetCardId)
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
            const subtypeAddGrants = target.grantedSubtypesAdd;
            if (subtypeAddGrants && subtypeAddGrants.length > 0) {
                const removed = subtypeAddGrants.filter(
                    (g) => g.auraId === source.id
                );
                const kept = subtypeAddGrants.filter(
                    (g) => g.auraId !== source.id
                );
                target.grantedSubtypesAdd = kept.length > 0 ? kept : undefined;
                if (removed.length > 0) {
                    // Strip each removed subtype from `subtypes[]` only if no
                    // remaining origin still grants it AND it wasn't printed —
                    // the `grantedTypes` unapply shape, mirrored for subtypes
                    // (CR 305.7 — Urborg/Yavimaya leaving play).
                    const targetCardId = (target.card as { id?: string }).id;
                    const def = targetCardId
                        ? tryGetDefinition(targetCardId)
                        : undefined;
                    const printedSubtypes = def?.subtypes ?? [];
                    for (const r of removed) {
                        const stillGranted = kept.some(
                            (g) => g.subtype === r.subtype
                        );
                        if (stillGranted) continue;
                        if (printedSubtypes.includes(r.subtype)) continue;
                        target.subtypes = target.subtypes.filter(
                            (s) => s !== r.subtype
                        );
                    }
                }
            }
            const colorGrants = target.grantedColors;
            if (colorGrants && colorGrants.length > 0) {
                const kept = colorGrants.filter(
                    (g) => g.sourceId !== source.id
                );
                target.grantedColors = kept.length > 0 ? kept : undefined;
            }
            // CR 205.4a — release this source's supertype-set contribution
            // (Melting leaving play restores lands' printed Snow supertype).
            unapplySupertypeSetGrant(target, source.id);
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
    newPermanent: CardInstanceState,
    // CR 400.7 / 614-batch (issue #1094): source ids to SKIP. In a
    // simultaneous batch reanimation, batch members are excluded here because
    // their push direction is applied ONCE via `applySourceStaticEffects` on
    // each member — pulling them in a second time here would double-apply
    // every batch→batch cross-grant (grantedActivated/grantedTriggered have
    // no dedup guard, so a granted trigger would fire twice). Only PRE-EXISTING
    // (non-batch) sources are pulled through this call in the batch path.
    excludeSourceIds?: ReadonlySet<string>
): void {
    for (const player of state.players) {
        for (const source of player.battlefield) {
            if (source.id === newPermanent.id) continue;
            if (excludeSourceIds?.has(source.id)) continue;
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
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
                    // CR 302.6 — see the parallel `type-add` branch above:
                    // control continuity is tracked from entry, so becoming a
                    // creature here does not reset summoning sickness.
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
                    // Mirror of the apply-time branching (ADR 0050): a land
                    // entering while a computed-output subtype swap (Illusionary
                    // Terrain) is in play must swap immediately, same as a
                    // pre-existing land.
                    let newSubtypes: string[] | null;
                    if (effect.subtypesFor) {
                        newSubtypes = effect.subtypesFor(
                            newPermanent,
                            source,
                            STATIC_EFFECT_CTX
                        );
                    } else {
                        newSubtypes = effect.applies!(
                            newPermanent,
                            source,
                            STATIC_EFFECT_CTX
                        )
                            ? effect.subtypes!
                            : null;
                    }
                    if (newSubtypes === null) {
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
                            subtypes: newSubtypes,
                            sourceId: source.id,
                        });
                    }
                    newPermanent.grantedSubtypes =
                        grants.length > 0 ? grants : undefined;
                    newPermanent.subtypes = [...newSubtypes];
                } else if (effect.kind === "subtype-add") {
                    // CR 305.7 — a land entering while Urborg / Yavimaya-style
                    // "each land is a [type] in addition" is in play gains the
                    // added subtype immediately, same as a pre-existing land.
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    const origins = newPermanent.grantedSubtypesAdd ?? [];
                    for (const subtype of effect.subtypes) {
                        const already = origins.some(
                            (o) =>
                                o.auraId === source.id && o.subtype === subtype
                        );
                        if (already) continue;
                        origins.push({ subtype, auraId: source.id });
                        if (!newPermanent.subtypes.includes(subtype)) {
                            newPermanent.subtypes = [
                                ...newPermanent.subtypes,
                                subtype,
                            ];
                        }
                    }
                    newPermanent.grantedSubtypesAdd =
                        origins.length > 0 ? origins : undefined;
                } else if (effect.kind === "supertype-set") {
                    // CR 205.4a — a snow land entering while Melting is in
                    // play immediately loses its Snow supertype.
                    if (
                        !effect.applies(newPermanent, source, STATIC_EFFECT_CTX)
                    ) {
                        continue;
                    }
                    applySupertypeSetGrant(newPermanent, source.id, effect);
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
    const def = cardId ? tryGetDefinition(cardId) : null;
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

/** CR 303.4 / 702.16b — the FULL host-legality predicate: `host` satisfies
 *  `aura`'s enchant restriction (`isLegalAuraHost`), is not protected from the
 *  Aura's color (CR 702.16b), and hasn't become "can't be enchanted" (Guardian
 *  Beast, CR 303.4). This is the same three-part gate the cast path applies at
 *  resolution (CR 608.2b) — factored out so the non-cast entry paths
 *  (`findAllLegalAuraHosts`, reanimation) enforce it identically instead of the
 *  type-only `isLegalAuraHost`. `aura` may be a resolving StackItem or a
 *  reanimated CardInstanceState (both carry `.card` + `types`). */
function isFullyLegalAuraHost(
    state: GameState,
    host: CardInstanceState,
    aura: CardInstanceState
): boolean {
    return (
        isLegalAuraHost(host, aura) &&
        !isProtectedFromSource(host, aura) &&
        !isGuardedAgainst(state, host, "cantBeEnchanted")
    );
}

/** CR 303.4f — every permanent on the battlefield (any controller) that is a
 *  fully-legal host for `aura`, in deterministic player/battlefield scan order.
 *  The candidate set offered when an Aura enters NOT as a cast spell and the
 *  effect doesn't name what it enchants. An Aura with an "enchant player"
 *  restriction has no permanent host and yields `[]` (CR 303.4g handles it).
 *  `excludeId` drops one permanent from consideration (an Aura can't enchant
 *  itself / a sibling Aura's own object). */
function findAllLegalAuraHosts(
    state: GameState,
    aura: CardInstanceState,
    excludeId?: string
): CardInstanceState[] {
    const hosts: CardInstanceState[] = [];
    for (const player of state.players) {
        for (const host of player.battlefield) {
            if (host.id === excludeId) continue;
            if (isFullyLegalAuraHost(state, host, aura)) hosts.push(host);
        }
    }
    return hosts;
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
    const def = cardId ? tryGetDefinition(cardId) : null;
    const effects = def?.staticEffects ?? [];
    const applies = effects.some(
        (e) =>
            e.kind === "control-change" &&
            e.applies(found.card, aura, STATIC_EFFECT_CTX)
    );
    if (!applies) return;
    applyControlChange(state, hostId, aura.controllerId, aura.id);
}

/** CR 506.4c — remove a permanent from combat. CR 506.4 lists control change
 *  as one of the events that removes a creature from combat the instant it
 *  happens; Goblin Cadets ("target opponent gains control of it. (This removes
 *  this creature from combat.)") is the canonical control-donation case. Strips
 *  the permanent from the combat bookkeeping in BOTH directions so it neither
 *  deals nor takes further combat damage this step:
 *   - as an attacker: dropped from `attackerIds` and `blockedAttackerIds`, and
 *     removed as a target from every blocker's assignment (the blockers that
 *     were blocking it stop doing so — the pair dissolves, CR 509.1b);
 *   - as a blocker: its `blockerAssignments` key is deleted (the attackers it
 *     was blocking STAY blocked per CR 509.1h — blocked status lives in
 *     `blockedAttackerIds`, not the live blocker count, so they still deal no
 *     combat damage to the defender without trample).
 *  Mirrors the `SpellContext.removeFromCombat` / regeneration-rider convention
 *  (CR 506.4d's cascading un-block of a removed attacker's blockers is rare and
 *  out of scope). No-op when there is no combat or the permanent is gone. */
export function removePermanentFromCombat(
    state: GameState,
    cardId: string
): void {
    if (!state.combat) return;
    const found = findOnBattlefield(state, cardId);
    if (found?.card.isAttacking) found.card.isAttacking = undefined;
    if (found?.card.isBlocking) found.card.isBlocking = undefined;
    const combat = state.combat;
    combat.attackerIds = combat.attackerIds.filter((id) => id !== cardId);
    if (combat.blockedAttackerIds) {
        combat.blockedAttackerIds = combat.blockedAttackerIds.filter(
            (id) => id !== cardId
        );
    }
    delete combat.blockerAssignments[cardId];
    for (const blockerId of Object.keys(combat.blockerAssignments)) {
        combat.blockerAssignments[blockerId] = combat.blockerAssignments[
            blockerId
        ].filter((id) => id !== cardId);
    }
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
    condition?: ControlChangeCondition,
    /** "Until end of turn" duration + tap-on-loss rider (CR 611.2b / 701.20a,
     *  issue #730 — Ray of Command / Magus of the Unseen). The duration is
     *  ticked out by `tickAllDurations`, which reverts the entry and taps the
     *  permanent when `tapOnLoss` is set. */
    opts?: { duration?: Duration; tapOnLoss?: boolean }
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
            ...(opts?.duration ? { duration: opts.duration } : {}),
            ...(opts?.tapOnLoss ? { tapOnLoss: true } : {}),
        },
    ];
    found.card.controllerId = newControllerId;
    if (found.card.types.includes("Creature")) {
        found.card.isSummoningSick = true;
    }
    found.player.battlefield.splice(found.idx, 1);
    getPlayer(state, newControllerId).battlefield.push(found.card);
    // CR 506.4c — a control change removes the permanent from combat the
    // instant it happens (Goblin Cadets' "This removes this creature from
    // combat" reminder is this rule made explicit). No-op outside combat.
    removePermanentFromCombat(state, hostId);
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

/** Deals `amount` damage from an explicit battlefield-permanent source to a
 *  player (CR 120), routing through the same CR 614 replacement → CR 615
 *  prevention pipeline that `SpellContext.dealDamage` uses, but sourced from an
 *  arbitrary permanent rather than the resolving stack item. This is the pure
 *  building block for "this permanent deals N damage to its controller/a
 *  player" effects that fire OUTSIDE a stack resolution — e.g. the painland
 *  coloured-tap self-damage rider (Adarkar Wastes et al., CR 605.1a), where the
 *  damage is part of a mana ability resolving immediately in `tapUntap` and so
 *  has no `SpellContext`. A replacement may redirect the damage to a different
 *  player, which is applied to the redirected player. No-op when `amount <= 0`,
 *  the source has left the battlefield, or a replacement cancels the damage. */
export function dealDamageFromPermanentToPlayer(
    state: GameState,
    source: CardInstanceState,
    sourceControllerId: string,
    playerId: string,
    amount: number
): void {
    if (amount <= 0) return;
    // CR 614 — replacement effects (redirects/cancels) run first, keyed on the
    // permanent source's identity (colors/types).
    const replaced = runDamageReplacement(
        state,
        source.id,
        sourceControllerId,
        { type: "player", id: playerId },
        amount,
        false
    );
    if (replaced === null) return;
    const finalTarget = replaced.target;
    const finalAmount = replaced.amount;
    if (finalAmount <= 0) return;
    if (finalTarget.type !== "player") {
        // A replacement redirected the damage to a permanent (rare for self-
        // damage). Route it through the permanent-source marker so protection/
        // prevention still apply; lethal SBA is handled by the engine's SBA pass.
        markDamageFromPermanentSource(
            state,
            source,
            sourceControllerId,
            finalTarget.id,
            finalAmount
        );
        return;
    }
    // CR 615.1 — prevention shields (source-matched, then target-keyed).
    if (consumePreventionIfAny(state, source.id, finalTarget.id)) return;
    const desc = describeDamageSource(state, source.id);
    let reduced = applyPlayerDamagePrevention(
        state,
        finalTarget.id,
        source.id,
        desc.staticAbilities,
        finalAmount
    );
    if (reduced <= 0) return;
    reduced = applyTargetPrevention(state, "player", finalTarget.id, reduced);
    if (reduced <= 0) return;
    getPlayer(state, finalTarget.id).life -= reduced;
    // CR 119.3 — damage dealt to a player causes that player to lose life.
    emitLifeLost(state, finalTarget.id, reduced, true);
    bumpDamageDealtToPlayer(state, finalTarget.id, reduced);
    recordSourceDamagedOpponent(state, source.id, finalTarget.id);
    bumpArtifactDamageToPlayer(state, finalTarget.id, reduced, desc.types);
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "DAMAGE_DEALT",
            sourceInstanceId: source.id,
            sourceControllerId,
            target: finalTarget,
            amount: reduced,
            isCombat: false,
            sourceColors: desc.colors,
            sourceTypes: desc.types,
            sourceSubtypes: desc.subtypes,
            sourceStaticAbilities: desc.staticAbilities,
        },
    ];
    // CR 702.15b — lifelink: the source's controller gains life equal to the
    // damage just dealt, simultaneously with it (CR 119.3).
    applyLifelinkLifeGain(
        state,
        sourceControllerId,
        desc.staticAbilities,
        reduced
    );
}

/** CR 120.3 / 704.5i — applies `amount` damage to a planeswalker by removing
 *  that many loyalty counters (floored at 0; the 0-loyalty death is the
 *  `checkZeroLoyaltySBA` state-based action, not a job for this helper). Shared
 *  by every non-combat damage sink so damage → loyalty is handled uniformly. */
export function removeLoyaltyForDamage(
    card: CardInstanceState,
    amount: number
): void {
    const current = card.counters?.loyalty ?? 0;
    card.counters = {
        ...(card.counters ?? {}),
        loyalty: Math.max(0, current - amount),
    };
}

/** Marks fight/redirect damage on a target permanent from an explicit
 *  battlefield-permanent source (CR 120). Unlike `SpellContext.dealDamage`
 *  (whose source is always the resolving stack item, `item.id`), this routes
 *  damage through the same CR 614 replacement → CR 702.16e protection →
 *  CR 615 prevention pipeline but uses an arbitrary creature as the source —
 *  the building block a "fight" needs, where each creature is the source of
 *  the damage it deals. Damage is *marked only* here (CR 120.3); lethal /
 *  destroy (CR 704.5g) is deliberately deferred to the caller so two halves
 *  of a fight can both be marked before either creature is destroyed
 *  (CR 701.12 — the damage is dealt simultaneously). Returns the target id if
 *  it now has lethal marked damage, else null. No-op (returns null) if the
 *  source or target has left the battlefield or the target isn't damageable. */
function markDamageFromPermanentSource(
    state: GameState,
    source: CardInstanceState,
    sourceControllerId: string,
    targetId: string,
    amount: number
): string | null {
    if (amount <= 0) return null;
    // CR 614: replacement effects (redirects/cancels) run first, keyed on the
    // creature source's identity (colors/types) — not the ability's.
    const replaced = runDamageReplacement(
        state,
        source.id,
        sourceControllerId,
        { type: "permanent", id: targetId },
        amount,
        false
    );
    if (replaced === null) return null;
    const finalTarget = replaced.target;
    const finalAmount = replaced.amount;
    if (finalAmount <= 0) return null;
    if (finalTarget.type !== "permanent") {
        // A replacement redirected the damage to a player (e.g. Personal
        // Incarnation). Apply it through the same player-damage shaping the
        // combat/spell paths use, then return (no permanent lethal check).
        const desc = describeDamageSource(state, source.id);
        if (consumePreventionIfAny(state, source.id, finalTarget.id))
            return null;
        let reduced = applyPlayerDamagePrevention(
            state,
            finalTarget.id,
            source.id,
            desc.staticAbilities,
            finalAmount
        );
        if (reduced <= 0) return null;
        reduced = applyTargetPrevention(
            state,
            "player",
            finalTarget.id,
            reduced
        );
        if (reduced <= 0) return null;
        getPlayer(state, finalTarget.id).life -= reduced;
        // CR 119.3 — damage dealt to a player causes that player to lose life.
        emitLifeLost(state, finalTarget.id, reduced, true);
        bumpDamageDealtToPlayer(state, finalTarget.id, reduced);
        recordSourceDamagedOpponent(state, source.id, finalTarget.id);
        bumpArtifactDamageToPlayer(state, finalTarget.id, reduced, desc.types);
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: source.id,
                sourceControllerId,
                target: finalTarget,
                amount: reduced,
                isCombat: false,
                sourceColors: desc.colors,
                sourceTypes: desc.types,
                sourceSubtypes: desc.subtypes,
                sourceStaticAbilities: desc.staticAbilities,
            },
        ];
        // CR 702.15b — lifelink on the source (damage was redirected to a
        // player, but the source's lifelink still triggers on damage dealt).
        applyLifelinkLifeGain(
            state,
            sourceControllerId,
            desc.staticAbilities,
            reduced
        );
        return null;
    }
    const found = findOnBattlefield(state, finalTarget.id);
    if (!found) return null;
    if (!isDamageablePermanent(found.card)) return null;
    // CR 702.16e: damage from a source with the named quality to a permanent
    // with protection is prevented.
    if (isProtectedFromSource(found.card, source)) return null;
    const reduced = applyTargetPrevention(
        state,
        "permanent",
        finalTarget.id,
        finalAmount
    );
    if (reduced <= 0) return null;
    // CR 120.3 / 704.5i — damage dealt to a planeswalker removes that many
    // loyalty counters instead of being marked (a planeswalker has no
    // toughness). The 0-loyalty death is a separate SBA (`checkZeroLoyaltySBA`),
    // never a lethal-damage return here.
    const pw = isPlaneswalker(found.card);
    if (pw) {
        removeLoyaltyForDamage(found.card, reduced);
    } else {
        found.card.damageMarked = (found.card.damageMarked ?? 0) + reduced;
    }
    found.card.damagedBySources = [
        ...(found.card.damagedBySources ?? []),
        source.id,
    ];
    const desc = describeDamageSource(state, source.id);
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "DAMAGE_DEALT",
            sourceInstanceId: source.id,
            sourceControllerId,
            target: { type: "permanent", id: finalTarget.id },
            amount: reduced,
            isCombat: false,
            sourceColors: desc.colors,
            sourceTypes: desc.types,
            sourceSubtypes: desc.subtypes,
            sourceStaticAbilities: desc.staticAbilities,
        },
    ];
    // CR 702.15b — lifelink: the source's controller gains life equal to the
    // damage marked on the permanent (CR 119.3, simultaneously with it).
    applyLifelinkLifeGain(
        state,
        sourceControllerId,
        desc.staticAbilities,
        reduced
    );
    if (pw) return null;
    // CR 702.2b — deathtouch: nonzero damage from a deathtouch source marks the
    // creature for destruction as an SBA (CR 704.5h).
    markDeathtouchDamage(found.card, desc.staticAbilities, reduced);
    return (found.card.damageMarked ?? 0) >=
        getEffectiveToughness(state, found.card)
        ? finalTarget.id
        : null;
}

/** Generic Fight primitive (CR 701.12-style mutual damage). Two creatures
 *  each deal damage equal to their power to the other *simultaneously*. Used
 *  by Tracker (pre-"fight" template) and reusable by any future fight card.
 *
 *  Decomposition (per the primitive-reuse rule): a fight is two ordinary
 *  damage events whose sources are the two creatures themselves. The only gap
 *  in the existing toolkit was that `dealDamage` always sources damage from
 *  the resolving stack item, so this composes `markDamageFromPermanentSource`
 *  (the new arbitrary-source damage helper) twice. Both powers are snapshotted
 *  BEFORE any damage is marked, and lethal/destroy is run only AFTER both
 *  halves are marked — so a creature that dies to the fight still deals its
 *  full damage (CR 701.12, 510.4-style simultaneity; CR 704.5g lethal).
 *
 *  No-op for any half whose creature has left the battlefield (CR 608.2b
 *  last-known... is intentionally not modeled here — Tracker's ruling: if the
 *  target leaves before resolution the ability is countered upstream by the
 *  target check, CR 608.2b). */
export function resolveFight(
    state: GameState,
    creatureAId: string,
    creatureBId: string
): void {
    const a = findOnBattlefield(state, creatureAId);
    const b = findOnBattlefield(state, creatureBId);
    if (!a || !b) return;
    // CR 701.12 — snapshot both powers up front; the damage is simultaneous,
    // so neither power is affected by the other's damage.
    const powerA = getEffectivePower(state, a.card);
    const powerB = getEffectivePower(state, b.card);
    // Mark both halves before any lethal SBA so simultaneity holds.
    const lethalB = markDamageFromPermanentSource(
        state,
        a.card,
        a.card.controllerId,
        creatureBId,
        powerA
    );
    const lethalA = markDamageFromPermanentSource(
        state,
        b.card,
        b.card.controllerId,
        creatureAId,
        powerB
    );
    // CR 704.5g — now resolve lethal for whichever creature(s) took lethal
    // damage, through the destroy replacement (regeneration, ADR 0020).
    if (lethalB !== null) destroyWithReplacements(state, lethalB);
    if (lethalA !== null) destroyWithReplacements(state, lethalA);
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
    opts?: {
        cantBeRegenerated?: boolean;
        /** Controller of the resolving spell/ability that caused this destroy
         *  (issue #1054), threaded onto the emitted `PERMANENT_LEFT` event.
         *  Undefined for SBA-driven destroys with no resolving causer. */
        causerControllerId?: string;
    }
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
    // CR 701.15c — "can't be regenerated this turn" (Clergy's own {1} ability,
    // Wrath of God, etc.) suppresses every regeneration source for this
    // permanent: shields AND the continuous auto-regen replacement.
    const cantRegen =
        opts?.cantBeRegenerated ||
        exileOnDeath ||
        found.card.cantBeRegeneratedThisTurn === true;
    // CR 614.5 — a continuous "if this would be destroyed, regenerate it"
    // replacement (the `"auto-regenerate"` static ability — Clergy of the Holy
    // Nimbus). Unlike a shield it is NOT consumed: it regenerates the permanent
    // every time it would be destroyed, for as long as the ability is present
    // (layer-6 grant/loss aware, since it reads the live `staticAbilities`).
    // Shields are spent first so the perpetual replacement leaves them intact.
    const hasAutoRegen = found.card.staticAbilities.includes("auto-regenerate");
    const shields = found.card.regenerationShields ?? 0;
    if ((shields > 0 || hasAutoRegen) && !cantRegen) {
        if (shields > 0) {
            const next = shields - 1;
            if (next === 0) delete found.card.regenerationShields;
            else found.card.regenerationShields = next;
        }
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
    // CR 701.8 / issue #1054 — every path through `regenerateOrDestroy` (the
    // shield-consuming path above already returned) is a destroy, whichever
    // zone it lands in; stamp `cause: "destroy"` + the causer so "destroyed by
    // an opponent's spell/ability"-style triggers (Karmic Justice) can gate on
    // it precisely (never confused with a sacrifice or a bare bounce).
    removePermanentTo(
        state,
        cardId,
        exileOnDeath ? "exile" : "graveyard",
        "destroy",
        opts?.causerControllerId
    );
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
    opts?: {
        cantBeRegenerated?: boolean;
        /** Controller of the resolving spell/ability that caused this destroy
         *  (issue #1054). Threaded straight through to `regenerateOrDestroy`
         *  and onto the emitted `PERMANENT_LEFT` event. */
        causerControllerId?: string;
    }
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
     *  sacrifice paths (CR 701.16) or `"destroy"` from the replacement-aware
     *  destroy path (CR 701.8, issue #1054) so leave-the-battlefield triggers
     *  can distinguish sacrifice/destruction from bounce (Urza's Miter). Any
     *  other departure leaves it undefined. */
    cause?: "sacrifice" | "destroy",
    /** Controller of the spell/ability that directly caused this departure
     *  (issue #1054), when the removal is driven by a resolving spell/ability
     *  (`SpellContext.destroy` / `destroyAll` / `sacrifice`). Undefined for
     *  automatic SBA sweeps and other non-spell/ability departures. Read by
     *  "caused by an opponent"-style leftTrigger conditions. */
    causerControllerId?: string
): void {
    const initial = findOnBattlefield(state, cardId);
    if (!initial) return;
    // CR 614.1c — a persistent leave-the-battlefield → exile replacement
    // (Dreams of the Dead's `exileOnLeave`) redirects EVERY departure path to
    // exile, before any zone-specific handling. A card already heading to exile
    // is unaffected. This is read here, the single funnel for all battlefield
    // departures (dies / sacrifice / bounce / destroy).
    if (initial.card.exileOnLeave && toZone !== "exile") {
        toZone = "exile";
    }
    // CR 614 (issue #1145) — graveyard-bound replacement (Yawgmoth's Will /
    // Dauthi Voidwalker): "if a card would be put into a graveyard from
    // anywhere, exile it instead." Consulted AFTER `exileOnLeave` (which
    // already forces exile) so an already-redirected card isn't re-checked.
    let graveyardRedirectCounters: Record<string, number> | undefined;
    if (toZone === "graveyard") {
        const { destination, tagCounters } = graveyardDestinationFor(
            state,
            cardId,
            initial.card.ownerId,
            "battlefield"
        );
        toZone = destination;
        graveyardRedirectCounters = tagCounters;
    }
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
    if (toZone === "exile" && graveyardRedirectCounters) {
        applyGraveyardRedirectCounters(creature, graveyardRedirectCounters);
    }
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
            ...(causerControllerId ? { causerControllerId } : {}),
        },
    ];
    // Revolt (CR 702.RV): set the per-player flag when a permanent a player
    // controlled leaves the battlefield this turn.
    const controller = getPlayer(state, snapshotControllerId);
    controller.permanentYouControlledLeftThisTurn = true;
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
        // CR 702.26f — stamp the turn so `untap-cycle` phase-in skips the same
        // turn's untap step (a permanent phased out this turn returns on the
        // controller's NEXT untap step, not this one).
        phasedOutTurn: state.turn,
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

/** CR 702.26c/f — phase in every `untap-cycle` bundle controlled by
 *  `controllerId` at the start of their untap step. Phasing never changes
 *  control (CR 702.26g), so the controller is read off the host (`cards[0]`).
 *  The skip-first-untap guard (CR 702.26f): a bundle phased out on the CURRENT
 *  turn is not yet eligible — it returns on the controller's NEXT untap step,
 *  not the same turn's — so a bundle whose `phasedOutTurn` is the current turn
 *  is left phased out. Called from `untapStep` (once, at first entry, before
 *  the active player untaps — CR 502.1). */
export function phaseInUntapCycleBundles(
    state: GameState,
    controllerId: string
): void {
    for (const bundle of [...(state.phasedOut ?? [])]) {
        if (
            bundle.returnOn.kind === "untap-cycle" &&
            bundle.cards[0]?.controllerId === controllerId &&
            (bundle.phasedOutTurn === undefined ||
                bundle.phasedOutTurn < state.turn)
        ) {
            phaseInBundle(state, bundle.id);
        }
    }
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
    opts: {
        sourceId: string;
        returnTapped: boolean;
        /** CR 701.18 — whether the host's attachments travel into exile WITH it
         *  and return re-attached (default `true`, Tawnos's Coffin / Icy Prison
         *  / Safe Haven). When `false` (Banishing Light, O-Ring style) ONLY the
         *  host is exiled: its Auras are left behind to be swept to the
         *  graveyard by the orphan-aura SBA (CR 704.5n) and its Equipment
         *  detaches and stays on the battlefield — neither is held or returned. */
        includeAttachments?: boolean;
    }
): string | null {
    const found = findOnBattlefield(state, targetId);
    if (!found) return null;
    const host = found.card;
    const hostOwnerId = host.ownerId;
    // CR 122 — note the counters that were on the creature.
    const counters: Record<string, number> = { ...(host.counters ?? {}) };
    const includeAttachments = opts.includeAttachments ?? true;
    // Collect attachments (Auras) across all battlefields, in a stable order.
    // Host-only exile (Banishing Light) skips this: nothing is bundled, so the
    // orphaned Auras fall to the graveyard via the SBA and Equipment detaches.
    const attached: { id: string; ownerId: string }[] = [];
    if (includeAttachments) {
        for (const player of state.players) {
            for (const card of player.battlefield) {
                if (card.id !== targetId && card.attachedTo === targetId) {
                    attached.push({ id: card.id, ownerId: card.ownerId });
                }
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
 *  so trigger predicates can filter without re-resolving the registry.
 *
 *  Storm (CR 702.40a, ADR 0052) — this is the single choke point every cast
 *  goes through, so it doubles as the per-turn spell counter: reads
 *  `spellsCastThisTurn` BEFORE incrementing (the tally of spells cast
 *  strictly before this one), carries it on the emitted event as
 *  `priorSpellCount`, then increments. A spell COPY (`cloneSpellOntoStack`)
 *  is put onto the stack directly and never calls this function, so copies
 *  never inflate the count (CR 707.10 — a copy isn't cast). Also runs the
 *  cast-trigger collection pass (`collectCastTriggers`) so a keyword-
 *  synthesized cast trigger (today only storm) goes on the stack above this
 *  spell in the same atomic step the spell itself is announced. */
export function emitSpellCastEvent(state: GameState, item: StackItem): void {
    const cardId = (item.card as { id?: string }).id;
    if (!cardId) return;
    // Arboria (CR 508.1c) — record that this player cast a spell this turn,
    // unlocking attacks against them on the opponent's following turn.
    const caster = state.players.find((p) => p.id === item.castById);
    if (caster) caster.qualifyingActionThisTurn = true;
    const def = tryGetDefinition(cardId);
    const colors = def?.manaCost ? getColorsFromCost(def.manaCost) : [];
    const priorSpellCount = state.spellsCastThisTurn ?? 0;
    state.spellsCastThisTurn = priorSpellCount + 1;
    const event: SpellCastEvent = {
        type: "SPELL_CAST",
        casterId: item.castById,
        spellInstanceId: item.id,
        spellCardId: cardId,
        spellTypes: item.types,
        spellSubtypes: item.subtypes,
        spellColors: colors,
        priorSpellCount,
    };
    state.pendingEvents = [...(state.pendingEvents ?? []), event];
    collectCastTriggers(state, item, event);
}

const STORM_KEYWORD = "storm";
/** Stack-item marker id for the synthesized storm cast trigger. Matches the
 *  Mechanics Registry row id (`cards/mechanicsRegistry.ts`, CR 702.40). */
const STORM_TRIGGER_ID = "storm";

/** Cast-trigger collection pass (CR 702.40, ADR 0052) — distinct from
 *  `collectTriggers` (triggers.ts), which only scans BATTLEFIELD (plus
 *  just-left graveyard/exile) sources and would never see a trigger that
 *  belongs to the very spell being announced onto the stack. Invoked once per
 *  cast, from `emitSpellCastEvent`'s single choke point. Recognizes
 *  keyword-synthesized cast triggers — today only `storm` — and pushes a
 *  StackItem ABOVE `castSpell` so it resolves first (CR 603.3b — a new stack
 *  object goes on top). Built for the class, not the single keyword:
 *  gravestorm (CR 702.69, still `planned` in the registry) attaches here
 *  later as another case, not a new mechanism. */
function collectCastTriggers(
    state: GameState,
    castSpell: StackItem,
    event: SpellCastEvent
): void {
    const cardId = (castSpell.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const hasStorm = def?.staticAbilities?.some(
        (a) => a.toLowerCase() === STORM_KEYWORD
    );
    if (!hasStorm) return;
    // The storm trigger's resolve body is engine code (like flying's combat
    // handling), exempt from the DSL-first card-authoring mandate — it is the
    // keyword's implementation, not a card's effect. It carries a detached
    // SNAPSHOT of the spell (not a live stack reference) so copies are
    // created even if `castSpell` is later countered before this trigger
    // resolves (the Grapeshot/Tendrils ruling) — see `resolveStormTrigger`.
    const stormItem: StackItem = {
        ...castSpell,
        id: allocInstanceId(state),
        zone: "stack",
        castById: castSpell.castById,
        triggeredAbilityId: STORM_TRIGGER_ID,
        triggerSourceId: castSpell.id,
        triggerEvent: event,
        // CR 603.3d — a trigger's targets are chosen when it goes on the
        // stack, not inherited from what it's watching; this item targets
        // nothing itself (the COPIES it produces carry the snapshot's
        // targets instead).
        targets: undefined,
        stormSnapshot: structuredClone(castSpell),
        stormCopiesRemaining: event.priorSpellCount ?? 0,
    };
    state.stack.push(stormItem);
}

/** Emits CARD_DRAWN events for a player who just drew `count` cards
 *  (CR 121.1). The single choke point for "when you draw a card" triggers
 *  (Sheoldred, Underworld Dreams). CR 120.3 — cards are drawn ONE AT A TIME,
 *  so a batch draw (Griselbrand's "draw seven") emits ONE event per card, and
 *  a per-card trigger fires once for each. Emitting a single count-N event
 *  would collapse the swing to a single trigger (Sheoldred gaining 2 instead
 *  of 14 on a draw-7); each drawn card is its own draw. `count` stays on the
 *  event (always 1 here) for a "whenever one or more" collapse via
 *  `oncePerEventBatch`. No-op when `count <= 0` (an empty-library draw moved
 *  nothing). Callers that drive a draw at a point where pending events are
 *  later drained — `resolveTopOfStack`, the draw step's explicit drain — use
 *  this so the trigger scan picks it up. */
export function emitCardDrawn(
    state: GameState,
    playerId: string,
    count: number
): void {
    if (count <= 0) return;
    const perCard = Array.from({ length: count }, () => ({
        type: "CARD_DRAWN" as const,
        playerId,
        count: 1,
    }));
    state.pendingEvents = [...(state.pendingEvents ?? []), ...perCard];
}

/** Emits a CARD_DISCARDED event for a card that just moved hand → graveyard as
 *  a discard (CR 701.8). The single choke point for "whenever you discard a
 *  card" triggers (Necropotence). Emitted by `discardToGraveyard` AFTER the
 *  card has landed in the graveyard, so the trigger can locate the card in its
 *  destination zone. */
export function emitCardDiscarded(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    cardId?: string
): void {
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "CARD_DISCARDED",
            playerId,
            cardInstanceId,
            ...(cardId ? { cardId } : {}),
        },
    ];
}

/** Emits a CARD_MILLED event for a card that just moved library → graveyard as
 *  a mill (CR 701.17). The single choke point for "when this card is put into
 *  your graveyard from your library" triggers (Gaea's Blessing). Emitted by
 *  `millCards` AFTER the card has landed in the graveyard, so the trigger can
 *  locate the card in its destination zone — the mill twin of
 *  `emitCardDiscarded`. `ownerId` is the milled card's owner (whose library it
 *  came from and whose graveyard it now sits in — a mill never crosses owners,
 *  CR 701.17). */
export function emitCardMilled(
    state: GameState,
    ownerId: string,
    cardInstanceId: string,
    cardId?: string,
    types?: ReadonlyArray<CardType>
): void {
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "CARD_MILLED",
            ownerId,
            cardInstanceId,
            ...(cardId ? { cardId } : {}),
            ...(types && types.length > 0 ? { types } : {}),
        },
    ];
}

/** Emits a LIFE_LOST event for a player whose life total just dropped (CR
 *  119.3). The seam for "whenever you lose life" triggers (Oath of Lim-Dûl —
 *  "for each 1 life you lost, ..."). Emitted AFTER the life total has actually
 *  decreased, carrying the ACTUAL amount lost (post-replacement,
 *  post-prevention). `fromDamage` distinguishes damage-driven loss (CR 119.3)
 *  from a direct "lose life" / paid life cost. No-op for a zero-or-negative
 *  amount (a fully prevented / replaced-away loss is not a life loss). */
export function emitLifeLost(
    state: GameState,
    playerId: string,
    amount: number,
    fromDamage: boolean
): void {
    if (amount <= 0) return;
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "LIFE_LOST",
            playerId,
            amount,
            fromDamage,
        },
    ];
}

/** Single choke point for a NON-damage life loss (CR 119.3): a "lose life"
 *  effect (`loseLife` primitive) or a paid life cost (CR 118.4). Runs the CR
 *  614 lifeloss replacement layer (Lich's "if you would lose life, ... instead"
 *  may rewrite the amount or consume it), applies the resulting life drop, and
 *  emits LIFE_LOST with the actual amount lost so "whenever you lose life"
 *  triggers (Oath of Lim-Dûl) fire off every non-damage life-loss path. Damage
 *  to a player does NOT route through here — damage runs its own CR 614 / 615
 *  pipeline and calls `emitLifeLost(..., fromDamage: true)` directly after the
 *  reduced amount lands (the loss is a consequence of damage, not a separately
 *  replaceable "lose life" event). No-op for amount <= 0. */
export function loseLifeEmitting(
    state: GameState,
    playerId: string,
    amount: number
): void {
    if (amount <= 0) return;
    const repl = applyLifeChangeReplacements(state, {
        kind: "lifeloss",
        playerId,
        amount,
    });
    if (repl === null) return; // replacement consumed the loss (ran its own fx)
    if (repl.amount <= 0) return;
    getPlayer(state, repl.playerId).life -= repl.amount;
    emitLifeLost(state, repl.playerId, repl.amount, false);
}

/** Emits a LIFE_GAINED event for a player whose life total just rose (CR
 *  119.3). The seam for "whenever you gain life" triggers — the symmetric
 *  counterpart of `emitLifeLost`. Emitted AFTER the life total has actually
 *  increased, carrying the ACTUAL amount gained (post-replacement). No-op for a
 *  zero-or-negative amount (a fully replaced-away gain is not a life gain). */
export function emitLifeGained(
    state: GameState,
    playerId: string,
    amount: number
): void {
    if (amount <= 0) return;
    state.pendingEvents = [
        ...(state.pendingEvents ?? []),
        {
            type: "LIFE_GAINED",
            playerId,
            amount,
        },
    ];
}

/** Single choke point for a life GAIN (CR 119.3): the `gainLife` primitive and
 *  the CR 702.15b lifelink life gain. Runs the CR 614 lifegain replacement
 *  layer (Lich's "if you would gain life, draw cards instead" may consume the
 *  event and run its own effect), applies the resulting life increase, and
 *  emits LIFE_GAINED with the actual amount gained so "whenever you gain life"
 *  triggers fire off every life-gain path. Mirrors `loseLifeEmitting`. No-op
 *  for amount <= 0. */
export function gainLifeEmitting(
    state: GameState,
    playerId: string,
    amount: number
): void {
    if (amount <= 0) return;
    // CR 614 — Lich's "if you would gain life, draw cards instead" intercepts
    // here. The replacement consumes the event (no actual life gain) and runs
    // `drawCards` via its apply ctx.
    const repl = applyLifeChangeReplacements(state, {
        kind: "lifegain",
        playerId,
        amount,
    });
    if (repl === null) return; // replacement consumed the gain (ran its own fx)
    if (repl.amount <= 0) return;
    getPlayer(state, repl.playerId).life += repl.amount;
    emitLifeGained(state, repl.playerId, repl.amount);
}

/** CR 702.15b — Lifelink. Damage dealt by a source with lifelink also causes
 *  that source's controller to gain that much life. The life gain happens as
 *  part of the damage event (CR 119.3), simultaneously with the damage, for
 *  BOTH combat and non-combat damage. Fed the source's EFFECTIVE static-ability
 *  set (the layer-6-materialized `staticAbilities` array on the source's
 *  battlefield/stack instance — reflects granted lifelink and, when an
 *  ability-loss effect has stripped it, its absence), NOT the printed
 *  CardDefinition array. `amount` is the actual damage dealt (post-replacement,
 *  post-prevention). No-op when the source lacks lifelink or dealt no damage. */
export function applyLifelinkLifeGain(
    state: GameState,
    sourceControllerId: string,
    sourceStaticAbilities: ReadonlyArray<string>,
    amount: number
): void {
    if (amount <= 0) return;
    if (!sourceStaticAbilities.includes("lifelink")) return;
    gainLifeEmitting(state, sourceControllerId, amount);
}

/** CR 702.2b — Deathtouch. Any nonzero damage dealt by a source with deathtouch
 *  to a creature marks that creature: it is destroyed as a state-based action
 *  (CR 704.5h) by `checkDeathtouchDestroySBA`, which respects indestructible and
 *  regeneration. Covers BOTH combat and non-combat damage. Fed the source's
 *  EFFECTIVE static-ability set (the layer-6-materialized `staticAbilities`
 *  array — reflects granted deathtouch and, when an ability-loss/removal effect
 *  like Humility has stripped it, its absence), NOT the printed CardDefinition
 *  array. `amount` is the actual damage dealt (post-replacement, post-prevention).
 *  No-op when the source lacks deathtouch or dealt no damage. */
export function markDeathtouchDamage(
    recipient: CardInstanceState,
    sourceStaticAbilities: ReadonlyArray<string>,
    amount: number
): void {
    if (amount <= 0) return;
    if (!sourceStaticAbilities.includes("deathtouch")) return;
    recipient.dealtDeathtouchDamage = true;
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

/** CR 302.6 — marks a permanent as having entered the battlefield (or having
 *  changed control) this turn, starting its control-continuity clock. The
 *  `isSummoningSick` flag is set unconditionally for EVERY permanent — not just
 *  creatures — and is cleared at the controller's untap step (`untapStep`).
 *
 *  For creatures this is ordinary summoning sickness (can't attack, can't pay
 *  {T}/{Q}). For noncreature permanents the flag is inert in combat and
 *  {T}-cost checks (both gated by `isCreature`), but it becomes meaningful the
 *  moment the permanent BECOMES a creature: a manland (Mishra's Factory) or
 *  animated artifact (Jade Statue) animated the same turn it entered reads
 *  summoning-sick, while one that has been controlled continuously since the
 *  start of a prior turn (flag already cleared) does not. This is the
 *  class-wide control-continuity fix — every animate effect inherits it for
 *  free instead of opting in per card.
 *
 *  Supersedes the former creature-only / `tracksControlContinuity` opt-in. */
export function markEnteredThisTurn(card: CardInstanceState): void {
    card.isSummoningSick = true;
}

/** CR 400.7 — when a card moves from the battlefield to a non-graveyard /
 *  non-exile zone (hand, library), it becomes a new object with no memory of
 *  its previous existence. Strips battlefield-only transient fields so the
 *  same instance, if it later returns to play, ETBs cleanly. */
function resetBattlefieldTransientState(card: CardInstanceState): void {
    card.isTapped = false;
    delete card.damageMarked;
    delete card.dealtDeathtouchDamage;
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
    delete card.manaCounterRemoval;
    delete card.lifePaidThisTap;
    delete card.manaCommitted;
    delete card.tapTriggerCommitted;
    delete card.counters;
    delete card.temporaryPTMods;
    delete card.sourceTappedPTMods;
    delete card.untapLockedBy;
    delete card.skipNextUntap;
    delete card.exileOnDeath;
    delete card.colorOverride;
    delete card.cantBeBlockedThisTurn;
    delete card.cantBeBlockedBySubtypesThisTurn;
    // CR 603.6b — the chosen player is stored for the rest of the game while
    // this permanent is on the battlefield; a zone change makes a new object
    // (CR 400.7), so the choice does not carry over.
    delete card.chosenPlayerId;
    // CR 603.6b / 400.7 — the on-entry chosen subtype pair (Illusionary
    // Terrain) is stored while the permanent stays in play; a zone change makes
    // a new object, so the choice does not carry over.
    delete card.chosenSubtypes;
    // CR 612.7 — a text-changing effect ends when the object changes zones
    // (it becomes a new object). Same lifecycle as colorOverride above.
    delete card.textChanges;
}

/** Phase 1 of reanimation (issue #1094, CR 400.7): clears battlefield-only
 *  transient state and pushes the card onto `controllerId`'s battlefield —
 *  or fully disposes of it (Worms of the Earth's land block, CR 614; a shock
 *  land's stackless pay-choice, CR 614.12/ADR 0051) WITHOUT granting/ETB.
 *  Returns true when the card is now on the battlefield awaiting
 *  `finishReanimatedEntry`; false when it was already fully handled (land-
 *  blocked, or the shock-land branch — which applies its own grants and
 *  enqueues the pay-choice inline, deferring ETB to `finalizeLandEntry`).
 *
 *  Split out of the single-card `putReanimatedOnBattlefield` so the BATCH
 *  path (`putReanimatedSetOnBattlefield`, issue #1094) can stage every
 *  member of a simultaneous graveyard-set reanimation onto the battlefield
 *  BEFORE any of them runs the grant/host-legality passes that read
 *  "everyone else already in play" — see that function's doc. A shock land
 *  inside a bulk sweep is not a shipped card interaction, so it is
 *  deliberately NOT staged for the batch's sibling-aware grant pass; it is
 *  handled to completion right here instead (a documented, narrow
 *  simplification, not a correctness claim for that scenario). */
function stageReanimatedOnBattlefield(
    state: GameState,
    card: CardInstanceState,
    controllerId: string
): boolean {
    // Worms of the Earth (CR 614) — "Lands can't enter the battlefield." A land
    // moved here from graveyard/exile/library (reanimation, library tutor) is
    // prevented from entering; it is put into its owner's graveyard instead
    // (the caller already removed it from its origin zone). Covers every
    // reanimation / search-to-battlefield path that funnels through this helper.
    if (!canLandEnterBattlefield(state, card.types)) {
        resetBattlefieldTransientState(card);
        card.zone = "graveyard";
        card.attachedTo = undefined;
        getPlayer(state, card.ownerId).graveyard.push(card);
        return false;
    }
    // CR 400.7 — zone change creates a new object: clear battlefield-only
    // transient state. Then re-establish the fresh-permanent defaults.
    resetBattlefieldTransientState(card);
    card.zone = "battlefield";
    card.controllerId = controllerId;
    card.attachedTo = undefined;
    // CR 302.6 — start the control-continuity clock for every reanimated /
    // put-onto-battlefield permanent (see `markEnteredThisTurn`).
    markEnteredThisTurn(card);
    // CR 614.12 / ADR 0051 — a shock land put onto the battlefield by an EFFECT
    // (library tutor / reanimation / put-onto-battlefield), not PLAYED from
    // hand, still gets its "as it enters, you may pay 2 life" choice. Enter it
    // provisionally TAPPED (the worst-case, unpaid outcome), apply continuous
    // effects, then enqueue a stackless `land-entry-tapped` pay-choice and DEFER
    // the ETB notification to `finalizeLandEntry`: the final tapped bit and the
    // PERMANENT_ENTERED emission both wait until the controller answers, so no
    // ETB trigger ever observes an intermediate tapped state (the resolution
    // ignores this stackless choice — `resolutionSuspendedOnChoice` — and the
    // active player's next priority window resolves it).
    const putCardId = (card.card as { id?: string }).id;
    const putDef = putCardId ? tryGetDefinition(putCardId) : undefined;
    if (putDef?.entersTappedUnlessPay) {
        card.isTapped = true;
        getPlayer(state, controllerId).battlefield.push(card);
        applyExistingGrantsTo(state, card);
        applySourceStaticEffects(state, card);
        enqueueLandEntryChoice(
            state,
            controllerId,
            card.id,
            putDef.entersTappedUnlessPay,
            card.card
        );
        return false;
    }
    // CR 614.1c + 110.5b — Kismet-style replacement taps an opponent-controlled
    // artifact/creature/land as it enters via reanimation / put-onto-battlefield.
    if (shouldEnterTapped(state, card)) card.isTapped = true;
    getPlayer(state, controllerId).battlefield.push(card);
    return true;
}

/** Phase 2 of reanimation (issue #1094): grants + ETB notification for a
 *  card `stageReanimatedOnBattlefield` already pushed onto the battlefield.
 *  Single-card path only — the batch path applies grants in a batch-correct
 *  order (see `putReanimatedSetOnBattlefield`) rather than per member. */
function finishReanimatedEntry(
    state: GameState,
    card: CardInstanceState
): void {
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

/** Reanimation helper: drops a card that has been removed from its source
 *  zone onto `controllerId`'s battlefield. Mirrors the "non-Aura permanent"
 *  branch of `finalizeSpellResolution` so existing lord-grants reach the
 *  new permanent (CR 611.2) and the card's own keyword-grants reach the
 *  battlefield. Caller is responsible for removing the card from its
 *  origin zone (graveyard/exile) BEFORE invoking this so the move stays
 *  atomic. Used both by `returnToBattlefield` (Resurrection) and the
 *  graveyard-target aura branch (Animate Dead, CR 303.4i). For a SIMULTANEOUS
 *  batch of graveyard-set members (Replenish, Living Death — CR 400.7,
 *  issue #1094), use `putReanimatedSetOnBattlefield` instead: staging every
 *  member first, before any of them is granted to / notifies, is what makes
 *  the whole set a single event rather than N sequential ones. */
function putReanimatedOnBattlefield(
    state: GameState,
    card: CardInstanceState,
    controllerId: string
): void {
    if (stageReanimatedOnBattlefield(state, card, controllerId)) {
        finishReanimatedEntry(state, card);
    }
}

/** CR 400.7 / 614-batch — return a whole FROZEN graveyard-set (issue #1056
 *  `forEach { set: "graveyard" }`) to the battlefield as ONE simultaneous
 *  event (issue #1094), not N sequential `moveZone` calls: every entry is
 *  staged onto the battlefield (or Aura-attached) BEFORE ANY of them runs
 *  the grant-application pass, so a sibling's "existing grants" scan
 *  (`applyExistingGrantsTo` / `applySourceStaticEffects`) and a reanimated
 *  Aura's host-legality check both see the WHOLE set already present — never
 *  just the members staged earlier in iteration order — and every ETB
 *  notification (`emitPermanentEntered`) fires only once staging/attachment
 *  for the entire batch has settled.
 *
 *  Non-Aura members are staged first so a reanimated Aura (CR 303.4c: an
 *  Aura entering independently of a spell needs a legal host already on the
 *  battlefield) can treat a NON-AURA SIBLING entering as part of this same
 *  event as an available host, not just pre-existing permanents — that
 *  simultaneity is the whole point of the batch. An Aura with no legal host
 *  anywhere stays in the graveyard (CR 303.4g — it never enters in the first
 *  place).
 *
 *  CR 303.4f host choice (issue #1094 follow-up): each reanimated Aura's
 *  controller chooses its host among the legal candidates. Zero legal hosts →
 *  the Aura stays in the graveyard (303.4g). Exactly one → auto-attached as
 *  part of this simultaneous batch (Arena-UX auto-resolve, ADR 0003). Two or
 *  more → the Aura is held off every zone (`stagedAuraEntries`) and a
 *  `choose-aura-host` PendingChoice is enqueued; it enters LATER, via
 *  `finalizeAuraHost`, when the controller answers. DOCUMENTED SIMPLIFICATION:
 *  a ≥2-host Aura that requires a prompt enters as its OWN later event rather
 *  than truly simultaneously with the rest of the batch — modeling N genuinely
 *  simultaneous host prompts is out of scope; the candidate set is still
 *  computed against the fully-staged batch, so a sibling that entered here is a
 *  valid host.
 *
 *  Returns the cardInstanceIds that actually entered the battlefield NOW
 *  (excludes any Aura deferred on a host choice — those enter on submit). */
export function putReanimatedSetOnBattlefield(
    state: GameState,
    cards: { card: CardInstanceState; controllerId: string }[]
): string[] {
    if (cards.length === 0) return [];

    const nonAuras = cards.filter((c) => !isAura(c.card));
    const auras = cards.filter((c) => isAura(c.card));

    const staged: CardInstanceState[] = [];
    for (const { card, controllerId } of nonAuras) {
        if (stageReanimatedOnBattlefield(state, card, controllerId)) {
            staged.push(card);
        }
    }
    for (const { card, controllerId } of auras) {
        // CR 303.4f — legal hosts among the fully-staged batch + pre-existing
        // permanents (exclude the Aura's own object).
        const hosts = findAllLegalAuraHosts(state, card, card.id);
        if (hosts.length === 0) {
            // CR 303.4g — no legal object to enchant (not even a non-Aura
            // sibling that entered as part of this same event): the Aura
            // never enters, it remains in its owner's graveyard. The caller
            // already spliced it OUT of that graveyard to make the set-wide
            // move atomic, so put it back rather than leaving it in limbo.
            card.zone = "graveyard";
            card.attachedTo = undefined;
            getPlayer(state, card.ownerId).graveyard.push(card);
            continue;
        }
        if (hosts.length === 1) {
            // CR 303.4f + ADR 0003 — a single legal host is a zero-branch
            // decision: auto-attach and enter now, inside the simultaneous
            // batch (no prompt).
            if (stageReanimatedOnBattlefield(state, card, controllerId)) {
                card.attachedTo = hosts[0].id;
                staged.push(card);
            }
            continue;
        }
        // CR 303.4f — 2+ legal hosts: the controller chooses. Hold the Aura
        // off every zone and enqueue the pick; it enters via `finalizeAuraHost`.
        enqueueAuraHostChoice(
            state,
            card,
            controllerId,
            hosts.map((h) => h.id)
        );
    }

    // CR 611.2 grant application, batch-correct ordering (issue #1094). Every
    // ordered (source, target) grant pair must apply EXACTLY once. Sources /
    // targets are all battlefield permanents = pre-existing (P) + batch (B):
    //   - P→P was already applied before this batch — untouched.
    //   - B→P and B→B: covered by `applySourceStaticEffects` for each staged
    //     member (it pushes that member's grants to ALL battlefield permanents
    //     once). This is the ONLY pass that touches B as a source.
    //   - P→B: covered by `applyExistingGrantsTo(member, EXCLUDING batch
    //     sources)` — pulls only from pre-existing permanents, so it never
    //     re-applies a B→B pair the push pass already did (that double-apply
    //     was the bug: grantedActivated/grantedTriggered have no dedup guard,
    //     so a mutually-granting pair fired its granted trigger twice).
    // ETB simultaneity is preserved: all grants settle, THEN every ETB fires.
    const stagedIds = new Set(staged.map((c) => c.id));
    for (const card of staged) applySourceStaticEffects(state, card);
    for (const card of staged) applyExistingGrantsTo(state, card, stagedIds);
    for (const card of staged) emitPermanentEntered(state, card);
    return staged.map((c) => c.id);
}

/** CR 303.4f — hold `aura` off every zone (the caller has already removed it
 *  from its origin) and enqueue the controller's "choose what to enchant" pick.
 *  Freezes priority on the chooser; the Aura enters via `finalizeAuraHost` when
 *  the choice is answered. `candidateIds` are the legal hosts computed by the
 *  caller (`findAllLegalAuraHosts`). Only called with ≥2 candidates — a 0/1-host
 *  Aura is resolved inline without a prompt (CR 303.4g / ADR 0003). */
function enqueueAuraHostChoice(
    state: GameState,
    aura: CardInstanceState,
    controllerId: string,
    candidateIds: string[]
): void {
    // The Aura leaves no footprint in any zone array while staged — its stale
    // `.zone` string is never read (it is not in any zone's array), and
    // `stageReanimatedOnBattlefield` resets it on entry.
    state.stagedAuraEntries = [
        ...(state.stagedAuraEntries ?? []),
        { aura, controllerId },
    ];
    // The Aura instance only carries a slim `{ id }` in `card`; resolve the
    // printed name (and card id for the dialog image) from the definition.
    const cardId = (aura.card as { id?: string }).id;
    const name = (cardId ? tryGetDefinition(cardId) : undefined)?.name;
    state.pendingChoices = [
        ...(state.pendingChoices ?? []),
        {
            stackItemId: "", // stackless — the Aura enters during a zone move
            step: 0,
            choiceId: `aura-host-${aura.id}`,
            playerId: controllerId,
            zoneOwnerId: controllerId,
            actingPlayerId: controllerId,
            kind: "choose-aura-host",
            zone: "battlefield",
            // A legal host may be any player's permanent (Control Magic can be
            // reanimated onto an opponent's creature), so the pick spans every
            // battlefield; `candidateIds` is the authoritative allow-list.
            allControllers: true,
            auraInstanceId: aura.id,
            // Rendered as a card image in the dialog (the Aura is off every
            // projected zone while staged).
            subjectCardId: cardId,
            candidateIds,
            count: 1,
            prompt: name
                ? `Choose what ${name} enchants.`
                : "Choose what this Aura enchants.",
        },
    ];
    state.priorityPlayerId = controllerId;
}

/** CR 611.2 / 613.1b / 603.6 — finish an Aura's entry once its host is set:
 *  absorb existing grants, push its own static effects (aura → host grant),
 *  apply any control-change (Control Magic), then emit the ETB notification.
 *  Mirrors the aura tail of `finalizeSpellResolution` so a reanimated Aura
 *  behaves exactly like a cast one. The Aura must already be on the battlefield
 *  with `attachedTo` set. */
function finishAuraEntry(state: GameState, aura: CardInstanceState): void {
    applyExistingGrantsTo(state, aura);
    applySourceStaticEffects(state, aura);
    applyAuraControlChange(state, aura);
    emitPermanentEntered(state, aura);
}

/** CR 303.4f — commit a `choose-aura-host` PendingChoice: attach the staged
 *  Aura to the chosen host and finish its entry. Drops the head choice, removes
 *  the staged entry, re-runs SBAs (the new attachment / control change may
 *  trigger one), and restores priority to the active player once the queue
 *  drains — mirroring `finalizeLegendKeep`. No-op if the head is not a stackless
 *  `choose-aura-host`. If the chosen host is gone / no longer legal (defensive —
 *  the game is frozen while the choice is pending, so this should not happen),
 *  the Aura is put into its owner's graveyard (CR 303.4g). */
export function finalizeAuraHost(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "choose-aura-host" || head.stackItemId !== "") {
        return;
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    const entries = state.stagedAuraEntries ?? [];
    const idx = entries.findIndex((e) => e.aura.id === head.auraInstanceId);
    if (idx !== -1) {
        const [entry] = entries.splice(idx, 1);
        state.stagedAuraEntries = entries.length > 0 ? entries : undefined;
        const aura = entry.aura;
        const hostId = selectedIds[0];
        const host = hostId
            ? findOnBattlefield(state, hostId)?.card
            : undefined;
        if (host && isFullyLegalAuraHost(state, host, aura)) {
            if (stageReanimatedOnBattlefield(state, aura, entry.controllerId)) {
                aura.attachedTo = host.id;
                finishAuraEntry(state, aura);
            }
        } else {
            // CR 303.4g — the chosen host is no longer a legal object: the Aura
            // never enters, it goes to its owner's graveyard.
            aura.attachedTo = undefined;
            aura.zone = "graveyard";
            getPlayer(state, aura.ownerId).graveyard.push(aura);
        }
    }

    // A new attachment / control change may create an SBA (CR 704.3 — repeat
    // until none applies); more aura-host choices may still be queued.
    checkStateBasedActions(state);
    if ((state.pendingChoices?.length ?? 0) === 0 && !state.gameOver) {
        state.priorityPlayerId = state.activePlayerId;
    }
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

/** Shared clone-onto-stack helper for spell-copy primitives (CR 707.10/707.12).
 *  `original` is the spell being copied; `creator` is the resolving stack item
 *  whose effect creates the copy (Fork's spell, or the resolving spell itself
 *  for "copy this spell"). Returns the copy's new stack id, or `null` when
 *  `original` is an ability or a non-instant/sorcery spell (copies of permanent
 *  spells / abilities are out of scope, CR 707.10).
 *
 *  The copy is controlled by `creator`'s controller (CR 707.10b) and inserted
 *  directly below `creator` on the stack so it becomes the new top once
 *  `creator` is popped — works identically whether `creator` and `original` are
 *  the same object (self-copy) or different. */
function cloneSpellOntoStack(
    state: GameState,
    original: StackItem,
    creator: StackItem,
    modifications?: { colorOverride?: Color[]; controllerId?: string }
): string | null {
    // CR 707.10 — abilities aren't spells; this primitive copies only
    // instant/sorcery SPELLS. Copies of permanent spells (which would create
    // token permanents) are out of scope.
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
    // A self-copy must start its OWN resolution from step 0 — clear the
    // creator's mid-resolution checkpoint so the copy re-runs every step
    // (including its own may-pay gate) rather than inheriting a half-resolved
    // state (CR 608.2 / 707.12).
    delete copy.resolutionStep;
    delete copy.collectedChoices;
    // CR 707.10 — a copy is created, not *cast*. Any "cast" provenance the
    // original carried must be cleared so the copy doesn't inherit it: a copy
    // of a flashed-back spell (Sevinne's Reclamation) was NOT cast from a
    // graveyard, so `wasCastFromGraveyard()` must read false for it — otherwise
    // the copy re-offers its own "may copy this spell" clause and spirals into
    // unbounded copies. `exileOnResolve` is likewise a cast-site artifact (the
    // flashback card is exiled, not the copy, which ceases to exist as a
    // one-shot effect per CR 707.10/112.5).
    delete copy.castFromGraveyard;
    delete copy.exileOnResolve;
    // `shuffleIntoLibraryOnResolve` is likewise a cast-site artifact (issue
    // #898) — the ORIGINAL is shuffled into its owner's library, not the copy,
    // which ceases to exist as a one-shot effect (CR 707.10/112.5).
    delete copy.shuffleIntoLibraryOnResolve;
    // CR 702.138e — "escaped" is a cast-site artifact; a copy was not cast via
    // escape, so it must not inherit the flag (a copied escape permanent would
    // otherwise read as having escaped).
    delete copy.escaped;
    // CR 707.10b / 707.12 — the copy is controlled by the controller of the
    // effect that created it (e.g. Fork's controller, or the resolving spell's
    // own controller for "copy this spell"), unless the effect names a specific
    // player as the copier (Chain Lightning: the player who paid {R}{R}). A
    // `controllerId` override sets that player; the copy's controller (whoever
    // it is) is the one `requestCopyRetarget` lets choose new targets.
    const copyController = modifications?.controllerId ?? creator.controllerId;
    copy.castById = copyController;
    copy.controllerId = copyController;
    copy.ownerId = copyController;
    if (modifications?.colorOverride) {
        copy.colorOverride = modifications.colorOverride;
    }
    // Insert the copy directly above the original so it resolves first.
    // `creator` (the copying spell) is the current top of the stack and is
    // popped immediately after this resolve completes; inserting just below it
    // leaves the copy as the new top.
    const selfIdx = state.stack.findIndex((s) => s.id === creator.id);
    const insertAt = selfIdx === -1 ? state.stack.length : selfIdx;
    state.stack.splice(insertAt, 0, copy);
    return copy.id;
}

/** CR 707.10b / 707.12c — offers `copy`'s controller a chance to choose new
 *  targets, by populating `state.pendingTarget` (kind `"copy-retarget"`).
 *  Extracted so both `SpellContext.requestCopyRetarget` (Fork, Chain
 *  Lightning, Onslaught — always prompts) and storm's engine-code copy loop
 *  (`resolveStormTrigger`, which wraps this with an auto-resolve zero-branch
 *  check, ADR 0052) share one implementation instead of duplicating the
 *  target-requirement → PendingTarget filter translation. */
function requestCopyRetargetOn(state: GameState, copy: StackItem): void {
    const cardId = (copy.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
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
    const count = rawCount === "X" ? Math.max(0, copy.chosenX ?? 0) : rawCount;
    const minNeeded = typeof count === "number" ? count : count.min;
    if (minNeeded <= 0) return; // no targets to choose
    const subtypeFilter = req.subtypeFilter
        ? Array.isArray(req.subtypeFilter)
            ? req.subtypeFilter
            : [req.subtypeFilter]
        : undefined;
    const supertypeFilter = req.supertypeFilter
        ? Array.isArray(req.supertypeFilter)
            ? req.supertypeFilter
            : [req.supertypeFilter]
        : undefined;
    const excludeSubtypes = req.excludeSubtypes
        ? Array.isArray(req.excludeSubtypes)
            ? req.excludeSubtypes
            : [req.excludeSubtypes]
        : undefined;
    const excludeSupertypes = req.excludeSupertypes
        ? Array.isArray(req.excludeSupertypes)
            ? req.excludeSupertypes
            : [req.excludeSupertypes]
        : undefined;
    // Inline mvFilter "X" resolution (mirrors rules.resolveMvFilter;
    // duplicated to avoid a state ↔ rules import cycle).
    const resolveMv = (v: number | "X" | undefined): number | undefined =>
        v === undefined ? undefined : v === "X" ? (copy.chosenX ?? 0) : v;
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
    // CR 707.10b / 707.12c — the COPY's controller chooses new targets.
    // For Fork this equals the resolving spell's caster; for Chain
    // Lightning it's the player who paid {R}{R} (the copy's controller),
    // so key the chooser off the copy itself, not the resolving item's caster.
    state.pendingTarget = {
        playerId: copy.controllerId,
        cardInstanceId: copy.id,
        targetType: req.type,
        count,
        selected: [],
        kind: "copy-retarget",
        ...(req.colorFilter ? { colorFilter: req.colorFilter } : {}),
        ...(req.colorFilterAny ? { colorFilterAny: req.colorFilterAny } : {}),
        ...(req.zone ? { zone: req.zone } : {}),
        ...(req.controller ? { controller: req.controller } : {}),
        ...(subtypeFilter ? { subtypeFilter } : {}),
        ...(supertypeFilter ? { supertypeFilter } : {}),
        ...(req.powerFilter ? { powerFilter: req.powerFilter } : {}),
        ...(req.toughnessFilter
            ? { toughnessFilter: req.toughnessFilter }
            : {}),
        ...(excludeSubtypes ? { excludeSubtypes } : {}),
        ...(excludeSupertypes ? { excludeSupertypes } : {}),
        ...(mvFilter ? { mvFilter } : {}),
        ...(req.spellTypeFilter
            ? {
                  spellTypeFilter: Array.isArray(req.spellTypeFilter)
                      ? req.spellTypeFilter
                      : [req.spellTypeFilter],
              }
            : {}),
        ...(req.spellExcludeTypeFilter
            ? {
                  spellExcludeTypeFilter: Array.isArray(
                      req.spellExcludeTypeFilter
                  )
                      ? req.spellExcludeTypeFilter
                      : [req.spellExcludeTypeFilter],
              }
            : {}),
        ...(req.spellCreaturePtFilter
            ? { spellCreaturePtFilter: req.spellCreaturePtFilter }
            : {}),
    };
}

/** Storm's per-copy retarget offer (CR 707.10b "you may choose new targets
 *  for the copies", ADR 0052) — narrowed to the project's Arena-style
 *  zero-branch UX convention (auto-resolve a choice with no real branch):
 *  when the copy's inherited target is the ONLY legal target, there is no
 *  real choice to make, so the copy silently keeps it and no prompt is
 *  shown. Otherwise defers to `requestCopyRetargetOn`, the exact machinery
 *  Fork/Chain Lightning/Onslaught already use. */
function requestStormCopyRetarget(state: GameState, copy: StackItem): void {
    const cardId = (copy.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const req =
        (copy.chosenModeId
            ? def?.modes?.find((m) => m.id === copy.chosenModeId)
                  ?.targetRequirement
            : undefined) ?? def?.targetRequirement;
    if (!req) return; // untargeted (Empty the Warrens) — nothing to offer
    const legal = getLegalTargets(
        state,
        req,
        STATIC_EFFECT_CTX.getColors(copy),
        copy.controllerId,
        copy.chosenX,
        copy.types,
        copy.subtypes,
        true // sourceIsSpell — a spell copy, still on the stack (CR 109.5)
    );
    const currentKeys = new Set(
        (copy.targets ?? []).map((t) => `${t.type}:${t.id}`)
    );
    const hasAlternative = legal.some(
        (t) => !currentKeys.has(`${t.type}:${t.id}`)
    );
    if (!hasAlternative) return; // zero-branch — keep the inherited target
    requestCopyRetargetOn(state, copy);
}

/** Storm cast-trigger resolution (CR 702.40, ADR 0052). Loops
 *  `stormCopiesRemaining` times, creating ONE copy from the detached
 *  snapshot and offering its optional retarget PER ITERATION — never all at
 *  once — because a copy-retarget is a single-slot `state.pendingTarget`
 *  prompt: creating every copy up front would silently overwrite all but the
 *  last prompt. When a copy's retarget is offered, this suspends (returns
 *  `null`, leaving the trigger item on the stack via the ordinary
 *  peek-and-pop discipline) so the resume — once both players pass again
 *  after the choice is answered — continues the loop from where it left off.
 *  Untargeted copies (Empty the Warrens) or copies with no legal alternative
 *  target loop straight through without suspending, so an all-untargeted or
 *  all-zero-branch storm resolves in one pass like any other trigger. */
function resolveStormTrigger(
    state: GameState,
    top: StackItem
): StackItem | null {
    while ((top.stormCopiesRemaining ?? 0) > 0) {
        top.stormCopiesRemaining = (top.stormCopiesRemaining ?? 0) - 1;
        // CR 707.10/702.40 — cloned from the detached SNAPSHOT, not a live
        // stack lookup, so a copy is still produced even if the original
        // spell was countered before this trigger resolved.
        const copyId = cloneSpellOntoStack(state, top.stormSnapshot!, top);
        if (copyId) {
            const copy = state.stack.find((s) => s.id === copyId);
            if (copy) requestStormCopyRetarget(state, copy);
            if (state.pendingTarget) return null; // suspend for this copy
        }
    }
    delete top.stormSnapshot;
    delete top.stormCopiesRemaining;
    delete top.collectedChoices;
    state.stack.pop();
    return top;
}

/** Builds a SpellContext with primitives bound to the current game state. */
export function buildSpellContext(
    state: GameState,
    item: StackItem
): SpellContext {
    function requirePermanent(target: TargetSelection): CardInstanceState {
        const found = findOnBattlefield(state, target.id);
        if (!found) throw new Error(`Creature ${target.id} not on battlefield`);
        return found.card;
    }

    /** Acting-Player routing for a resolution-time choice (ADR 0037 / CR 608 —
     *  "you control the player while that spell is resolving", #580).
     *
     *  When this stack item is a controlled cast (Word of Command put the chosen
     *  spell on the stack with `actingPlayerId` = the WoC controller and
     *  `castById` = the controlled opponent), the spell's OWN resolve step
     *  enqueues its choices with `playerId = ctx.controller = item.castById`
     *  (the opponent) — it has no knowledge of the controlled-cast routing. To
     *  honour "you control the player while that spell is resolving", redirect
     *  the player who is PROMPTED to the acting player, while recording the
     *  controlled player in `actingPlayerId` so zone/resource/ownership reads
     *  (`zoneOwnerId ?? playerId` on the submit/UI side) still resolve against
     *  the controller (the oracle's "mana only from lands that player controls"
     *  / "from THEIR hand" reads stay on the opponent).
     *
     *  Strictly gated on `req.playerId === item.castById`: a choice a spell
     *  directs at a SPECIFIC OTHER player (APNAP opponent picks, e.g. Cuombajj
     *  Witches' "of an opponent's choice") is never the controlled player, so it
     *  is not redirected. For every normal (non-controlled) cast `actingPlayerId`
     *  is absent and this is the identity — existing routing is unchanged. */
    function routeActingPlayer(reqPlayerId: string): {
        playerId: string;
        actingPlayerId?: string;
    } {
        const acting = getActingPlayer(item);
        if (acting !== item.castById && reqPlayerId === item.castById) {
            // Controlled cast: the acting player answers; the controlled player
            // (the spell's controller) is recorded for zone/resource routing.
            return { playerId: acting, actingPlayerId: item.castById };
        }
        return { playerId: reqPlayerId };
    }

    const ctx: SpellContext = {
        caster: item.castById,
        controller: item.castById,
        // ADR 0037 — who answers this resolution's choices. Equals the
        // controller for every normal cast; a controlled cast (Word of Command)
        // sets `actingPlayerId` on the stack item so its decisions route to the
        // controller while the controlled opponent stays the controller/caster.
        actingPlayer: item.actingPlayerId ?? item.castById,
        // Triggered abilities (CR 603) get a fresh stack-item id, but their
        // resolver needs to reference the originating permanent (e.g. for
        // intervening-if re-check at CR 603.4). `triggerSourceId` is captured
        // in `buildTriggerItem` for exactly this purpose.
        sourceInstanceId: item.triggerSourceId ?? item.id,
        // CR 108.1 — the resolving item's card definition id (ADR 0048:
        // stamped on scheduled delayed triggers so the fired trigger renders
        // its source card). Empty for synthetic items with no registry id.
        sourceCardId: (item.card as { id?: string }).id ?? "",
        // CR 603 (ADR 0049, issue #865) — the event that fired this triggered
        // ability, threaded into the interpreter so `$event.<field>` refs
        // resolve at trigger sites. Undefined for spells / activated abilities /
        // fired delayed triggers (whose `triggerEvent` is the phase-boundary
        // event, not the original firing event); the validator forbids `$event`
        // at all of those sites, so this is only ever read at a real trigger.
        triggerEvent: item.triggerEvent,
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

        setChosenSubtypes(pair: string[]): void {
            // CR 603.6b / 614.12 — record an ordered pair of basic land types
            // chosen as this permanent enters (Illusionary Terrain), stored on
            // the source instance for the rest of the game and read by a
            // `subtype-set` static's `subtypesFor` callback (ADR 0050). The
            // source is the resolving permanent: an ETB trigger's
            // `triggerSourceId` points at the permanent that just entered.
            // No-op if it is no longer on the battlefield.
            const src = findOnBattlefield(
                state,
                item.triggerSourceId ?? item.id
            );
            if (!src) return;
            src.card.chosenSubtypes = [...pair];
            // CR 611.2c — the enchantment's continuous subtype-set static is
            // materialised (ADR 0050), not read at query time, so it was already
            // applied when the permanent entered — with no pair chosen yet, a
            // no-op. Now that the pair exists, re-materialise so basic lands of
            // the first type swap on the live board. Idempotent: the ETB pass
            // recorded no grant (subtypesFor returned null), so this is the
            // first and only materialisation for this source.
            applySourceStaticEffects(state, src.card);
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

        dealDamage(
            target: TargetSelection,
            amount: number,
            unpreventable = false
        ) {
            // CR 614 replacement effects run BEFORE CR 615 prevention. May
            // rewrite target (Simulacrum / Veteran Bodyguard / Personal
            // Incarnation redirect damage to themselves) or cancel
            // (Jade Monolith's activated redirect cancels by rewriting).
            // `unpreventable` (Urza's Rage's kicked mode: "the damage can't be
            // prevented") only suppresses CR 615 PREVENTION shields below —
            // CR 614 replacement/redirection effects are a distinct rule and
            // still apply, and so does CR 702.16 protection (a card would need
            // to say so explicitly to override protection too; no card in the
            // catalogue does).
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
                if (
                    !unpreventable &&
                    consumePreventionIfAny(state, item.id, target.id)
                )
                    return;
                const desc = describeDamageSource(state, item.id);
                // CR 615.1: per-player source-matched shields (Dark Sphere /
                // Scarecrow). Run before target-keyed shields so a half/all
                // prevention shapes the amount the N-absorption then sees.
                let reduced = unpreventable
                    ? amount
                    : applyPlayerDamagePrevention(
                          state,
                          target.id,
                          item.id,
                          desc.staticAbilities,
                          amount
                      );
                if (reduced <= 0) return;
                // CR 615.1: target-keyed prevention shields absorb up to N
                // damage per event regardless of source.
                reduced = unpreventable
                    ? reduced
                    : applyTargetPrevention(
                          state,
                          "player",
                          target.id,
                          reduced
                      );
                if (reduced <= 0) return;
                getPlayer(state, target.id).life -= reduced;
                // CR 119.3 — damage dealt to a player causes life loss.
                emitLifeLost(state, target.id, reduced, true);
                bumpDamageDealtToPlayer(state, target.id, reduced);
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
                // CR 702.15b — lifelink: if the resolving source (a permanent's
                // activated/triggered ability, LKI-snapshotted in `desc`) has
                // lifelink, its controller gains life equal to the damage dealt.
                applyLifelinkLifeGain(
                    state,
                    item.controllerId,
                    desc.staticAbilities,
                    reduced
                );
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
                const reduced = unpreventable
                    ? amount
                    : applyTargetPrevention(
                          state,
                          "permanent",
                          target.id,
                          amount
                      );
                if (reduced <= 0) return;
                // CR 120.3 / 704.5i: damage dealt to a planeswalker removes
                // that many loyalty counters instead of being marked (it has no
                // toughness). Burn "to any target" thereby kills a planeswalker;
                // the 0-loyalty death is the separate SBA (`checkZeroLoyaltySBA`),
                // not the lethal-toughness path below.
                const pw = isPlaneswalker(found.card);
                if (pw) {
                    removeLoyaltyForDamage(found.card, reduced);
                } else {
                    // CR 120.3: damage is marked on the creature and accumulates
                    // until CLEANUP (CR 514.2). Lethal damage (CR 704.5g) is
                    // applied inline using the post-accumulation marked total
                    // compared to effective toughness (layer 7c).
                    found.card.damageMarked =
                        (found.card.damageMarked ?? 0) + reduced;
                }
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
                // CR 702.15b — lifelink: the resolving source's controller
                // gains life equal to the damage marked on the permanent.
                applyLifelinkLifeGain(
                    state,
                    item.controllerId,
                    desc.staticAbilities,
                    reduced
                );
                // A planeswalker took loyalty loss above — no deathtouch/lethal
                // toughness handling applies.
                if (pw) return;
                // CR 702.2b — deathtouch: a resolving source (spell/ability)
                // with deathtouch marks the damaged creature for destruction as
                // an SBA (CR 704.5h) regardless of the damage total vs toughness.
                markDeathtouchDamage(found.card, desc.staticAbilities, reduced);
                if (
                    (found.card.damageMarked ?? 0) >=
                    getEffectiveToughness(state, found.card)
                ) {
                    // CR 704.5g lethal → destroy replacement (CR 614, ADR
                    // 0020) then regen shield gets a chance to replace the
                    // destroy (CR 614.5, 701.15a). issue #1054 — this lethal
                    // damage was dealt by the resolving item, so its
                    // controller is the causer.
                    destroyWithReplacements(state, target.id, {
                        causerControllerId: item.controllerId,
                    });
                }
            }
        },
        fight(target: TargetSelection) {
            // CR 701.12 mutual damage: the resolving ability's source permanent
            // and the target creature each deal damage equal to their power to
            // the other, simultaneously, through the normal damage path.
            // `sourceInstanceId` is the activated/triggered ability's permanent.
            if (target.type !== "permanent") return;
            // The source is the resolving ability's permanent — a triggered
            // ability carries `triggerSourceId`; an activated one is `item.id`.
            resolveFight(state, item.triggerSourceId ?? item.id, target.id);
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
        gainLifeWhenDamagedByAttacker(
            target: TargetSelection,
            duration: DurationSpec
        ): void {
            // CR 603.7 / 119 — Glyph of Life: arm a turn-scoped delayed lifegain
            // keyed to the chosen permanent. Scanned in the combat damage step;
            // fires only when the damage source is an attacker. The controller
            // is the effect's controller (CR 113.7 — the spell's caster).
            if (target.type !== "permanent") return;
            if (!findOnBattlefield(state, target.id)) return;
            state.damageTriggeredLifegain = [
                ...(state.damageTriggeredLifegain ?? []),
                {
                    instanceId: target.id,
                    controllerId: item.castById,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        addPlayerDamagePreventionShield(
            playerId: string,
            match: {
                sourceInstanceId?: string;
                sourceStaticAbility?: string;
            },
            mode: "all" | "half-down",
            duration: DurationSpec,
            remaining: number = 1
        ): void {
            // CR 615.1 — register a per-player, source-matched prevention
            // shield (Dark Sphere: half from a chosen source, once; Scarecrow:
            // all from flying sources this turn). Consumed/reduced by
            // `applyPlayerDamagePrevention` on every player-damage event.
            state.playerDamagePrevention = [
                ...(state.playerDamagePrevention ?? []),
                {
                    playerId,
                    match,
                    mode,
                    remaining,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        preventNextNDamageToTarget(
            target: TargetSelection,
            amount: number,
            duration: DurationSpec,
            tallyId?: string
        ): void {
            // CR 615.1: damage absorption shield on the target. Decremented
            // per damage event regardless of source. Permanent target must
            // still be on the battlefield; a stale id silently no-ops.
            // `tallyId` (Sacred Boon) tags the shield so the amount it actually
            // prevents is accumulated in `state.preventionTallies` for readback.
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
                    ...(tallyId !== undefined ? { tallyId } : {}),
                },
            ];
        },
        consumePreventionTally(tallyId: string): number {
            // CR 615.1 readback — returns the total damage a tagged prevention
            // shield has absorbed so far and clears the tally so it is read
            // once (Sacred Boon's next-end-step +0/+1 counters).
            const tallies = state.preventionTallies;
            if (!tallies) return 0;
            const total = tallies[tallyId] ?? 0;
            delete tallies[tallyId];
            if (Object.keys(tallies).length === 0) {
                state.preventionTallies = undefined;
            }
            return total;
        },
        gainLife(playerId: string, amount: number) {
            // CR 119.3 / 614 — routed through the single `gainLifeEmitting`
            // choke point: runs the Lich lifegain replacement, applies the
            // increase, and emits LIFE_GAINED so "whenever you gain life"
            // triggers fire off this primitive too.
            gainLifeEmitting(state, playerId, amount);
        },
        loseLife(playerId: string, amount: number) {
            if (amount <= 0) return;
            // CR 614 — Lich's "if you would lose life, sacrifice instead"
            // intercepts inside `loseLifeEmitting`. After the resulting drop it
            // emits LIFE_LOST (CR 119.3) so "whenever you lose life" triggers
            // (Oath of Lim-Dûl) fire off this primitive too.
            loseLifeEmitting(state, playerId, amount);
        },
        addPoisonCounters(playerId: string, n: number) {
            if (n <= 0) return;
            // CR 122 — counters on a player. CR 704.5c (lose at ten or more) is
            // enforced by the SBA, not here, so the field has no cap.
            const player = getPlayer(state, playerId);
            player.poisonCounters = (player.poisonCounters ?? 0) + n;
        },
        addEnergy(playerId: string, n: number) {
            if (n <= 0) return;
            // CR 122.1 — "you get {E}": add energy counters to the player. No
            // cap and no loss SBA (energy, unlike poison, is a pure resource).
            const player = getPlayer(state, playerId);
            player.energyCounters = (player.energyCounters ?? 0) + n;
        },
        getEnergy(playerId: string): number {
            return getPlayer(state, playerId).energyCounters ?? 0;
        },
        payEnergy(playerId: string, n: number): boolean {
            // CR 122.1 / 118.12 — "pay {E}": spend energy counters, all-or-
            // nothing. Returns false (and spends nothing) when the player lacks
            // the required amount; n <= 0 is a trivially-paid no-op.
            if (n <= 0) return true;
            const player = getPlayer(state, playerId);
            const have = player.energyCounters ?? 0;
            if (have < n) return false;
            player.energyCounters = have - n;
            return true;
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
        // CR 302.6 / 502.1 (Barl's Cage, The Dark): one-shot "doesn't untap
        // during its controller's next untap step." Records a self-clearing
        // flag the untap step reads and deletes exactly once.
        skipNextUntap(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.skipNextUntap = true;
        },
        allowAttackDespiteDefender(target: TargetSelection): void {
            // CR 508.1a override — "can attack this turn as though it didn't
            // have defender" (FEM Vodalian War Machine). Cleared at CLEANUP.
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.canAttackDespiteDefenderThisTurn = true;
        },
        setBasePT(
            target: TargetSelection,
            power: number | undefined,
            toughness: number | undefined,
            duration: DurationSpec | "indefinite"
        ): void {
            if (target.type !== "permanent") return;
            if (power === undefined && toughness === undefined) return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            // CR 613.4b / 613.7 — append; the latest entry per characteristic
            // wins at read time. A phase-scoped set is purged with
            // temporaryPTMods at the boundary; "indefinite" (Wall of
            // Tombstones) carries no duration and is never ticked out.
            const entry: {
                power?: number;
                toughness?: number;
                duration?: Duration;
            } =
                duration === "indefinite"
                    ? {}
                    : {
                          duration: resolveDuration(
                              duration,
                              item.castById,
                              state
                          ),
                      };
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
            // CR 122.6 — emit a COUNTER_REMOVED event so "whenever a counter is
            // removed" triggers (Vanishing's CR 702.63d sacrifice) can fire.
            // Drained by `processPendingActionTriggers` after the current
            // resolution completes, exactly like PERMANENT_ENTERED.
            if (removed > 0) {
                state.pendingEvents = [
                    ...(state.pendingEvents ?? []),
                    {
                        type: "COUNTER_REMOVED",
                        instanceId: found.card.id,
                        controllerId: found.card.controllerId,
                        counterType: type,
                        removed,
                        remaining,
                    },
                ];
            }
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
        // CR 305.7 / 611.2 — timed subtype change ("becomes a Swamp until its
        // controller's next untap step", Orcish Farmer). Overwrites `subtypes`
        // so subtype-driven reads (intrinsic mana, landwalk) see the change at
        // once; `temporarySubtypeChange` records the printed value so the
        // phase-boundary purge (`tickAllDurations`) can restore it on expiry.
        setSubtypesUntil(
            target: TargetSelection,
            subtypes: string[],
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            // Restore against the ORIGINAL printed subtypes even if a prior
            // timed change is still active (CR 305.7 — the most recent change
            // wins, and only one is held at a time).
            const restoreSubtypes =
                found.card.temporarySubtypeChange?.restoreSubtypes ??
                found.card.subtypes;
            found.card.subtypes = [...subtypes];
            found.card.temporarySubtypeChange = {
                subtypes: [...subtypes],
                restoreSubtypes: [...restoreSubtypes],
                duration: resolveDuration(
                    duration,
                    found.card.controllerId,
                    state
                ),
            };
        },
        // CR 205.4a — indefinite supertype mutation (Arcum's Weathervane).
        // Writes the same source-keyed markers as the `supertype-set` static
        // effect with the `"indefinite"` sentinel source so `hasSupertype`
        // reads the live status. Adding clears a prior removal (and vice
        // versa) so toggling back and forth is consistent.
        setSupertype(
            target: TargetSelection,
            supertype: string,
            present: boolean
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            applyIndefiniteSupertypeMutation(found.card, supertype, present);
        },
        getCounterCount(target: TargetSelection, type: string): number {
            if (target.type !== "permanent") return 0;
            const found = findOnBattlefield(state, target.id);
            if (found) return found.card.counters?.[type] ?? 0;
            // CR 608.2g / last-known information: a "Sacrifice this creature:
            // ... for each [counter] on it" ability (Icatian Moneychanger) pays
            // its sacrifice cost at activation, so by resolution the source is
            // gone from the battlefield. The resolving stack item is a snapshot
            // of the source taken AFTER cost payment but it retains the counters
            // it had — read them so the count reflects the pre-sacrifice state.
            if (target.id === item.id) return item.counters?.[type] ?? 0;
            return 0;
        },
        isEscaped(target: TargetSelection): boolean {
            // CR 702.138e — "escaped" is a permanent-level flag stamped at the
            // escape cast; it rides the stack item onto the battlefield.
            if (target.type !== "permanent") return false;
            const found = findOnBattlefield(state, target.id);
            if (found) return found.card.escaped === true;
            // Last-known information (CR 608.2g): the resolving stack item still
            // carries the flag (e.g. read during its own ETB resolution).
            if (target.id === item.id) return item.escaped === true;
            return false;
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
        // CR 108.3 — ownership is immutable. Returns undefined if the id is no
        // longer on the battlefield (the lookup half of "you own" clauses).
        getOwnerId(cardInstanceId: string): string | undefined {
            return findOnBattlefield(state, cardInstanceId)?.card.ownerId;
        },
        // CR 508.1 — true while the permanent is a declared attacker. False for
        // permanents off the battlefield or not attacking.
        getIsAttacking(cardInstanceId: string): boolean {
            return (
                findOnBattlefield(state, cardInstanceId)?.card.isAttacking ===
                true
            );
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
            // issue #1054 — the resolving spell/ability's controller is the
            // causer; threaded onto the emitted PERMANENT_LEFT event so
            // "destroyed by an opponent's spell/ability" triggers (Karmic
            // Justice) can gate on it.
            return destroyWithReplacements(state, target.id, {
                ...opts,
                causerControllerId: ctx.controller,
            });
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
            fromZone: "graveyard" | "exile",
            controllerId?: string
        ): boolean {
            const player = getPlayer(state, playerId);
            const pile =
                fromZone === "graveyard" ? player.graveyard : player.exile;
            const idx = pile.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return false;
            const [card] = pile.splice(idx, 1);
            // CR 400.7 / 800.4a — owner stays the source pile's owner; the new
            // controller defaults to that owner (Resurrection) but may differ
            // (Hymn of Rebirth: "from a graveyard ... under your control").
            if (isAura(card)) {
                // CR 303.4f — an Aura reanimated with no specified host must
                // choose what it enchants. Route through the batch helper (a
                // batch of one) so the 0/1/≥2-host decision is identical to the
                // mass-reanimation path. A ≥2-host Aura enters LATER on the
                // controller's choice, so `entered` is empty NOW (documented:
                // the boolean under-reports a deferred entry — no single Aura
                // reanimator in the pool ties an "if you do" rider to it).
                const entered = putReanimatedSetOnBattlefield(state, [
                    { card, controllerId: controllerId ?? playerId },
                ]);
                return entered.length > 0;
            }
            putReanimatedOnBattlefield(state, card, controllerId ?? playerId);
            return true;
        },
        // CR 400.7 / 614-batch (issue #1094) — the simultaneous twin of
        // `returnToBattlefield`: splices every entry out of ITS OWN owner's
        // graveyard first (so the whole set is already "gone" before any of
        // them enters), then hands the full batch to
        // `putReanimatedSetOnBattlefield` as ONE event (CR 400.7 — no
        // returned permanent's ETB/grant pass observes a partial subset of
        // its siblings). `controllerId` — when given — redirects EVERY
        // entry's controller the same way `returnToBattlefield`'s 4th
        // argument does (Hymn-of-Rebirth-style "under your control"); omitted
        // defaults each entry to its own owner (Replenish, Living Death).
        // Entries whose id is no longer in the named graveyard at resolution
        // are silently skipped (CR 608.2b). Returns the cardInstanceIds that
        // actually entered the battlefield — excludes vanished entries, a
        // Worms-of-the-Earth-blocked land, and a hostless Aura (CR 303.4c).
        returnGraveyardSetToBattlefield(
            entries: { playerId: string; cardInstanceId: string }[],
            controllerId?: string
        ): string[] {
            const staged: { card: CardInstanceState; controllerId: string }[] =
                [];
            for (const { playerId, cardInstanceId } of entries) {
                const player = getPlayer(state, playerId);
                const idx = player.graveyard.findIndex(
                    (c) => c.id === cardInstanceId
                );
                if (idx === -1) continue; // CR 608.2b — no longer there, skip
                const [card] = player.graveyard.splice(idx, 1);
                staged.push({ card, controllerId: controllerId ?? playerId });
            }
            return putReanimatedSetOnBattlefield(state, staged);
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
        // CR 400.7 — hand → battlefield (Gaea's Touch). Splice the instance out
        // of the hand and put it onto the same player's battlefield via the
        // shared entry path (same ETB / continuous-effect application as the
        // library variant). Returns false on silent fizzle when the id is no
        // longer in hand at resolution (CR 608.2b).
        putFromHandOntoBattlefield(
            playerId: string,
            cardInstanceId: string
        ): boolean {
            const player = getPlayer(state, playerId);
            const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return false;
            const [card] = player.hand.splice(idx, 1);
            putReanimatedOnBattlefield(state, card, playerId);
            return true;
        },
        // CR 305.2 / 116.2a — PLAY a land from `playerId`'s hand under their
        // control, "if able". Unlike `putFromHandOntoBattlefield` (a free zone
        // change that does NOT consume a land drop), this models the special
        // action of playing a land: it consumes the player's one-land-per-turn
        // drop and is refused when that drop is already spent. Word of Command
        // ("The player plays that card if able") uses it to play the chosen
        // land under the controlled opponent's control. The land enters via the
        // canonical play-land sequence (drop bookkeeping → CR 302.6 entry clock
        // → CR 603.6a ETB notification + pending-action triggers); the resolve
        // flow runs SBAs afterwards. Returns true if the land was played, false
        // if not able (not in hand, not a Land, or the land drop is spent —
        // honoring "if able"). Land-play locks (Worms of the Earth) are NOT
        // re-checked here: WoC playing a land is a resolution effect, not the
        // active player's land-play action.
        playLandForPlayer(playerId: string, cardInstanceId: string): boolean {
            const player = getPlayer(state, playerId);
            const card = player.hand.find((c) => c.id === cardInstanceId);
            if (!card || !card.types.includes("Land")) return false;
            // CR 614 — a land-play lock (Worms of the Earth) blocks the play.
            if (landPlayLockActive(state)) return false;
            // CR 305.2 — one land per turn, plus any extra-drop grants (e.g.
            // Fastbond) the controlled player has. Refuse if already spent
            // ("if able").
            const maxDrops = LAND_DROPS_PER_TURN + getExtraLandDrops(player);
            if ((player.landsPlayedThisTurn ?? 0) >= maxDrops) return false;
            // Route through the canonical land-play transition: it records the
            // land drop (CR 305.2), sets the control-continuity / summoning-sick
            // clock (CR 302.6), emits the ETB (CR 603.6a) and settles SBAs.
            applyPlayLand(state, player, cardInstanceId);
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
        // CR 611.2b / 613.1b (layer 2) — "gain control of a permanent until end
        // of turn" (Ray of Command, Magus of the Unseen, issue #730). Unlike the
        // `condition`-based `gainControl` (reverted by the conditional-control
        // SBA), this installs a phase-boundary `duration` that `tickAllDurations`
        // reverts at CLEANUP (CR 514.2). `tapOnLoss` carries the "when you lose
        // control of it, tap it" rider (CR 701.20a) — the permanent taps the
        // instant control reverts.
        gainControlUntilEndOfTurn(
            target: TargetSelection,
            newControllerId: string,
            opts?: { tapOnLoss?: boolean }
        ): void {
            if (target.type !== "permanent") return;
            if (!findOnBattlefield(state, target.id)) return;
            applyControlChange(
                state,
                target.id,
                newControllerId,
                item.id,
                undefined,
                {
                    duration: { phase: "end-of-turn" },
                    tapOnLoss: opts?.tapOnLoss,
                }
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
                // `cantBeRegenerated` (CR 701.15c). issue #1054 — the
                // resolving spell/ability's controller is the causer for
                // every victim (Wrath of God-style mass destroy).
                destroyWithReplacements(state, id, {
                    ...opts,
                    causerControllerId: ctx.controller,
                });
            }
        },
        // CR 121.1: cards are drawn one at a time. Stops if the library empties
        // (CR 704.5b: hasDrawnFromEmpty flagged by drawCard; SBA ends the game).
        drawCards(playerId: string, amount: number): void {
            const player = getPlayer(state, playerId);
            let drawn = 0;
            for (let i = 0; i < amount; i++) {
                if (drawCard(player) === null) break;
                drawn++;
            }
            // CR 121.1 — emit a draw event so "when you draw a card" triggers
            // (Fasting) fire. The post-resolution scan in `resolveTopOfStack`
            // drains this from `pendingEvents`.
            emitCardDrawn(state, playerId, drawn);
        },
        // CR 701.17: mill the top `amount` cards library → graveyard, one at a
        // time — re-reading the LIVE top each pass so successive mills chase the
        // receding library top, and stopping early once it empties (CR 701.17a).
        // The mill analogue of `drawCards`: the single choke point that emits a
        // CARD_MILLED event per card (Gaea's Blessing's "when this card is put
        // into your graveyard from your library" self-trigger). No-op for
        // `amount ≤ 0`. The post-resolution scan in `resolveTopOfStack` drains
        // the events from `pendingEvents`.
        millCards(playerId: string, amount: number): void {
            if (amount <= 0) return;
            const player = getPlayer(state, playerId);
            for (let i = 0; i < amount; i++) {
                const top = player.library[0];
                if (!top) break; // library empty — mill fewer (CR 701.17a)
                const cardId = (top.card as { id?: string }).id;
                const types = cardId
                    ? tryGetDefinition(cardId)?.types
                    : undefined;
                // CR 614 (issue #1145) — a graveyard-bound replacement
                // (Yawgmoth's Will / Dauthi Voidwalker) can redirect this
                // mill to exile instead of the graveyard.
                const { destination, tagCounters } = graveyardDestinationFor(
                    state,
                    top.id,
                    top.ownerId,
                    "library"
                );
                moveCard(player, top.id, "library", destination);
                if (destination !== "graveyard") {
                    applyGraveyardRedirectCounters(top, tagCounters);
                }
                // Emit AFTER the move so the trigger scan finds the card in its
                // destination graveyard (CR 603.10 emit-after-move discipline).
                // Only a genuine "put into graveyard from library" counts as a
                // mill (CR 701.17a) — a replacement-redirected card was exiled,
                // not milled, so Gaea's Blessing-style "put into your graveyard
                // from your library" triggers correctly don't see it.
                if (destination === "graveyard") {
                    emitCardMilled(state, playerId, top.id, cardId, types);
                }
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
        // CR 614 (issue #1145) — arm a turn-scoped "if a card would be put
        // into your graveyard from anywhere this turn, exile it instead"
        // grant (Yawgmoth's Will's redirect clause). Unlike a permanent-bound
        // `replacementEffects[]` entry, this survives the SOURCE leaving play
        // (a one-shot sorcery has no battlefield presence to carry a
        // continuous effect) — it rides `state.graveyardBoundRedirectThisTurn`
        // instead, cleared at CLEANUP (CR 514.2).
        armGraveyardRedirectThisTurn(ownerId: string): void {
            state.graveyardBoundRedirectThisTurn = [
                ...(state.graveyardBoundRedirectThisTurn ?? []),
                { ownerId },
            ];
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
            for (const id of ids)
                moveCardWithGraveyardReplacement(state, player, id, from, to);
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
            moveCardWithGraveyardReplacement(
                state,
                player,
                cardInstanceId,
                from,
                to
            );
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
        // Endurance's ETB (mh2/green.ts, #1207): "put all the cards from their
        // graveyard on the bottom of their library in a random order." Detach
        // the whole graveyard, randomize it among itself with the seeded PRNG
        // (deterministic under replay), then append after the existing library
        // (index end = bottom, CR 701.22 sense — `library[0]` is the top). The
        // resulting bottom ordering is unwitnessed, so clear knowledge on the
        // moved cards (ADR 0026, exactly like a shuffle). No-op on an empty
        // graveyard.
        putGraveyardOnBottomOfLibrary(playerId: string): void {
            const player = getPlayer(state, playerId);
            if (player.graveyard.length === 0) return;
            const moved = player.graveyard.splice(0, player.graveyard.length);
            seededShuffle(state, moved);
            clearKnowledge(moved, null);
            player.library.push(...moved);
        },
        // CR 701.5a: to counter a spell is to remove it from the stack and put
        // it into its owner's graveyard. If the target is no longer on the
        // stack (already resolved/countered), this is a silent no-op — the
        // countering spell simply fails to find a legal target (CR 608.2b).
        // `destination` (issue #683) overrides the graveyard default for
        // "if that spell is countered this way, exile it / put it on top of
        // its owner's library / put it into its owner's hand instead" (No
        // More Lies, Memory Lapse, Remand) — always a real card move, never
        // applicable to a countered ABILITY (which has no card to redirect).
        counter(
            target: TargetSelection,
            destination: CounterDestination = "graveyard"
        ): void {
            if (target.type !== "spell") {
                throw new Error("counter() requires a spell target");
            }
            const idx = state.stack.findIndex((s) => s.id === target.id);
            if (idx === -1) return; // target no longer on stack — fizzle silently
            const found = state.stack[idx];
            // CR 701.5c — "can't be countered": the countering spell/ability
            // still legally targets this spell (targeting is unaffected — see
            // CardDefinition.cantBeCountered's doc comment for the Obliterate
            // ruling), but the counter itself fizzles: the spell is NOT
            // removed from the stack. Abilities have no card definition to
            // flag, so only a spell (a card id) can carry this.
            const foundCardId = (found.card as { id?: string }).id;
            const foundDef = foundCardId ? tryGetDefinition(foundCardId) : null;
            if (foundDef?.cantBeCountered) return;
            const [item] = state.stack.splice(idx, 1);
            const owner = getPlayer(state, item.ownerId);
            // Abilities on the stack are not cards: activated (CR 113.7a),
            // triggered (CR 113.7a) and delayed-triggered abilities all just
            // vanish when countered (CR 701.5a — Stifle). Only a countered
            // SPELL moves to a destination zone.
            if (
                item.abilityId ||
                item.triggeredAbilityId ||
                item.delayedTriggerId
            )
                return;
            switch (destination) {
                case "exile":
                    item.zone = "exile";
                    owner.exile.push(item);
                    break;
                case "library-top":
                    item.zone = "library";
                    owner.library.unshift(item);
                    break;
                case "hand":
                    item.zone = "hand";
                    owner.hand.push(item);
                    break;
                case "graveyard":
                default:
                    // CR 614 (issue #1145) — a countered spell heading to its
                    // owner's graveyard is itself a graveyard-bound event; a
                    // matching replacement (Yawgmoth's Will / Dauthi
                    // Voidwalker) can redirect it to exile instead.
                    sendStackItemToGraveyard(state, item);
                    break;
            }
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
                if (
                    color === "X" ||
                    color === "xFactor" ||
                    typeof amount !== "number" ||
                    amount <= 0
                )
                    continue;
                player.manaPool[color] = (player.manaPool[color] ?? 0) + amount;
            }
        },
        addManaTo(playerId: string, cost: CardManaCost): void {
            const player = getPlayer(state, playerId);
            for (const [color, amount] of Object.entries(cost)) {
                if (
                    color === "X" ||
                    color === "xFactor" ||
                    typeof amount !== "number" ||
                    amount <= 0
                )
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
                if (
                    color === "X" ||
                    color === "xFactor" ||
                    typeof amount !== "number" ||
                    amount <= 0
                )
                    continue;
                addRestrictedManaToPool(player, color, amount, restriction);
            }
        },
        getNotedManaSpent(): Record<string, number> {
            // CR 106.10 — the type and amount of mana spent to pay this
            // activation's cost, snapshotted at commit (Jeweled Amulet, Ice
            // Cauldron). Per-colour counts; empty when the activation spent no
            // mana or the ability didn't request the note.
            return item.notedManaSpent ?? {};
        },
        noteMana(
            cardInstanceId: string,
            note: { mana: Record<string, number>; castableCardId?: string }
        ): void {
            // CR 106.10 — store the noted mana on the source permanent (a Mana
            // Battery: Jeweled Amulet / Ice Cauldron) so the later "add the
            // noted mana" activation can read it. Overwrites the previous note
            // ("this artifact's LAST noted type"). No-op for an id not on the
            // battlefield. Keeps only positive per-colour entries.
            const found = findOnBattlefield(state, cardInstanceId);
            if (!found) return;
            const mana: Record<string, number> = {};
            for (const [color, amount] of Object.entries(note.mana)) {
                if (amount > 0) mana[color] = amount;
            }
            const noted: NonNullable<CardInstanceState["notedMana"]> = { mana };
            if (note.castableCardId !== undefined) {
                noted.castableCardId = note.castableCardId;
            }
            found.card.notedMana = noted;
        },
        addNotedMana(cardInstanceId: string, playerId: string): void {
            // CR 106.10 — replay the noted mana into `playerId`'s pool. When the
            // note carries a `castableCardId` (Ice Cauldron) the mana is added
            // as instance-restricted mana spendable only to cast that card;
            // otherwise it is ordinary mana (Jeweled Amulet). No-op for an id
            // not on the battlefield or with no noted mana.
            const found = findOnBattlefield(state, cardInstanceId);
            const noted = found?.card.notedMana;
            if (!noted) return;
            const player = getPlayer(state, playerId);
            for (const [color, amount] of Object.entries(noted.mana)) {
                if (amount <= 0) continue;
                if (noted.castableCardId !== undefined) {
                    addRestrictedManaToPool(
                        player,
                        color,
                        amount,
                        undefined,
                        noted.castableCardId
                    );
                } else {
                    player.manaPool[color] =
                        (player.manaPool[color] ?? 0) + amount;
                }
            }
        },
        grantCastFromExile(
            cardInstanceId: string,
            playerId: string,
            zoneOwnerId?: string,
            window: "this-turn" | "while-exiled" = "while-exiled"
        ): void {
            // CR 601.3e — Ice Cauldron: mark a card in `zoneOwnerId`'s exile
            // (defaults to `playerId` — the historical same-player shape) as
            // playable from exile by `playerId` ("You may cast that card for
            // as long as it remains exiled"). No-op for an id not in that
            // zone owner's exile. A distinct `zoneOwnerId` supports a
            // CROSS-PLAYER grant (Robber of the Rich: the defending player's
            // library card, exiled into THEIR OWN exile per CR 400.7, is
            // castable by the attacking player).
            //
            // CR 514.2 / 608.2g — `window` picks the expiry semantics:
            //   - "while-exiled" (default): open-ended, persists as long as the
            //     card stays exiled (Ice Cauldron, Robber of the Rich).
            //   - "this-turn": an impulse window (Headliner Scarlett, Expressive
            //     Iteration — "play that card this turn"). Stamps the current
            //     turn number so the CLEANUP step revokes it at end of turn.
            const owner = getPlayer(state, zoneOwnerId ?? playerId);
            const card = owner.exile.find((c) => c.id === cardInstanceId);
            if (!card) return;
            card.castableFromExileBy = playerId;
            if (window === "this-turn") {
                card.castableFromExileUntilTurn = state.turn;
            } else {
                delete card.castableFromExileUntilTurn;
            }
        },
        getX(): number {
            return item.chosenX ?? 0;
        },
        // CR 702.33 / 702.33e — times this spell's Kicker cost was paid, read
        // back off the stack item (0 = not kicked). `> 0` is "if this spell was
        // kicked"; the raw count is the Multikicker tally (Everflowing Chalice).
        getKickerCount(): number {
            return item.kickerCount ?? 0;
        },
        // Domain (CR 702 preamble ability word, issue #1066) — the number of
        // basic land types among `playerId`'s controlled lands (0–5). `state`
        // structurally satisfies `StaticEffectStateView` (players[].battlefield
        // / graveyard, both present on the live GameState), so this is the
        // SAME `countDomain` scan `StaticPTCDA.compute` closures and the
        // Collective Restraint dynamic `costPerAttacker` use — one execution
        // path, no duplicated logic.
        getDomain(playerId: string): number {
            return countDomain(state as never, playerId);
        },
        // CR 202.3 / 202.3b — mana value lookup. For permanents on the
        // battlefield, X in the printed cost counts as 0 (the chosen X is
        // not currently preserved on the resulting permanent). For stack
        // spells, X folds in the chosen value from the stack item.
        // Players / graveyard-card / synthetic targets return 0.
        getAdditionalSacrificeMv(): number | undefined {
            return item.additionalSacrificeSnapshot?.mv;
        },
        getAdditionalCostSubtypes(): string[] | undefined {
            return item.additionalSacrificeSnapshot?.subtypes;
        },
        getAdditionalSacrificePower(): number | undefined {
            return item.additionalSacrificeSnapshot?.power;
        },
        getManaValue(target: TargetSelection): number {
            if (target.type === "permanent") {
                const found = findOnBattlefield(state, target.id);
                if (!found) return 0;
                const cardId = (found.card.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                return manaValue(def?.manaCost);
            }
            if (target.type === "spell") {
                const stackItem = state.stack.find((s) => s.id === target.id);
                if (!stackItem) return 0;
                const cardId = (stackItem.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                const base = manaValue(def?.manaCost);
                return base + (stackItem.chosenX ?? 0);
            }
            // CR 202.3 (issue #680) — a graveyard-card target (Reanimate's
            // "lose life equal to that card's mana value"). Mirrors
            // `getGraveyardCards`' own per-card mana-value computation.
            if (target.type === "graveyard-card") {
                const owner = target.playerId;
                if (owner === undefined) return 0;
                const found = getPlayer(state, owner).graveyard.find(
                    (c) => c.id === target.id
                );
                if (!found) return 0;
                const cardId = (found.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                return manaValue(def?.manaCost);
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
        // CR 601.2d / 120.4 — divide AS YOU CHOOSE among the chosen targets,
        // each target getting at least 1. The split was assigned at
        // announcement and snapshotted on the stack item (`targetAmounts`);
        // when absent (e.g. a GRE-driven test that pre-set `targets` but no
        // amounts), fall back to the deterministic ≥1-each division below so
        // the call is always safe. Empty targets / total <= 0 is a no-op.
        dealDamageDividedAsChosen(
            targets: TargetSelection[],
            totalAmount: number
        ): void {
            if (targets.length === 0 || totalAmount <= 0) return;
            const split = resolveChosenDivision(
                item.targetAmounts,
                targets,
                totalAmount
            );
            for (const target of targets) {
                const amount = split.get(targetKey(target)) ?? 0;
                if (amount > 0) this.dealDamage(target, amount);
            }
        },
        // CR 601.2d / 120.4 — distribute counters AS YOU CHOOSE, each chosen
        // target getting at least 1. Same announcement-time split / fallback
        // rules as `dealDamageDividedAsChosen`. Non-permanent targets are
        // skipped (counters live on permanents, CR 122).
        distributeCountersAsChosen(
            targets: TargetSelection[],
            totalAmount: number,
            type: string
        ): void {
            if (targets.length === 0 || totalAmount <= 0) return;
            const split = resolveChosenDivision(
                item.targetAmounts,
                targets,
                totalAmount
            );
            for (const target of targets) {
                if (target.type !== "permanent") continue;
                const amount = split.get(targetKey(target)) ?? 0;
                if (amount > 0) this.addCounter(target, type, amount);
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
        // looked up at activation time via getDefinition. Used by Channel.
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
        // CR 104.2a — a resolving spell/ability designates its winner
        // (Coalition Victory), through the SAME `state.gameOver` seam
        // State-Based Actions use (`checkGameOverSBA`, `gre/sba.ts`). No-op if
        // the game already ended (mirrors `drawGame`'s guard) — CR 104.2a
        // doesn't re-decide an already-decided game.
        winGame(playerId: string): void {
            if (state.gameOver) return;
            getPlayer(state, playerId);
            const opponent = state.players.find((p) => p.id !== playerId);
            state.gameOver = {
                winnerId: playerId,
                loserId: opponent?.id ?? playerId,
                reason: "alternate-win",
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
                // Tokens have no printing, hence no real rarity (CR 206);
                // a nominal "common" satisfies the required field.
                rarity: "common",
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
                    // CR 302.6 — every token starts its control-continuity
                    // clock on creation (see `markEnteredThisTurn`); the flag is
                    // inert for noncreature tokens until they become creatures.
                    isSummoningSick: true,
                    // CR 111 / 707.1 — token provenance link. Records the
                    // creating permanent so a source can later identify the
                    // tokens it made (Tetravus exiles its own Tetravites to
                    // recover +1/+1 counters).
                    ...(createdBy ? { createdBy } : {}),
                };
                // CR 614.1c + 110.5b — Kismet-style replacement taps an
                // opponent-controlled artifact/creature/land token as it enters.
                if (shouldEnterTapped(state, token)) token.isTapped = true;
                owner.battlefield.push(token);
                applyExistingGrantsTo(state, token);
                applySourceStaticEffects(state, token);
                ids.push(id);
            }
            return ids;
        },
        createTokenCopyOf(
            sourceCreatureId,
            controllerId,
            createdBy,
            opts
        ): string | undefined {
            // CR 707.2 + CR 111.1 — token-recipient form of the copy path.
            // Dance of Many: "create a token that's a copy of target nontoken
            // creature." The token is born from a minimal placeholder spec,
            // then `applyCopy` overwrites its copiable characteristics with the
            // source's printed values (the SAME engine path Clone / Copy
            // Artifact use via `becomeCopyOf`; the recipient here is a fresh
            // token instead of the resolving permanent). No-op if the source
            // has already left the battlefield (the copy fizzles, CR 707.2).
            const source = findOnBattlefield(state, sourceCreatureId)?.card;
            if (!source) return undefined;
            // Minimal placeholder body: a 0/0 creature token. `applyCopy`
            // immediately replaces every copiable field, so the placeholder is
            // never observed on the battlefield.
            const [tokenId] = ctx.createToken(
                {
                    name: "Copy",
                    types: ["Creature"],
                    power: 0,
                    toughness: 0,
                },
                controllerId,
                1,
                createdBy
            );
            const token = findOnBattlefield(state, tokenId)?.card;
            if (!token) return undefined;
            applyCopy(token, source, opts);
            // CR 611 — re-apply existing grants / source static effects after
            // the copy rewrites the token's characteristics so anthem-style and
            // P/T-buff effects observe the copied type/color.
            applyExistingGrantsTo(state, token);
            applySourceStaticEffects(state, token);
            // CR 603.10 — bind the creator to its token (both directions) so the
            // creator's leave-linkage triggers can identify the exact token by
            // id after it has left the battlefield. The token already records
            // its creator via `createdBy`; this stores the reverse pointer.
            if (createdBy) {
                const creator = findOnBattlefield(state, createdBy)?.card;
                if (creator) creator.linkedTokenId = tokenId;
            }
            return tokenId;
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
        // CR 113.1 / 611.1b: grants an ACTIVATED ability for a limited
        // duration (Touch of Vitae: "gains '{0}: Untap this creature. Activate
        // only once.' until end of turn"). The template lives on the granting
        // card's `grantTemplates[]` (looked up by the activation entry point in
        // game.ts), so the permanent exposes it as if printed on it. The
        // duration-scoped sibling of the continuous `activated-grant` static
        // effect; the phase-boundary purge splices it back out when `duration`
        // expires. The "activate only once" cap rides on the template's
        // `oncePerTurn` — an until-EOT grant spans exactly one turn, so
        // once-per-turn == once-per-grant.
        grantActivatedAbility(
            target: TargetSelection,
            sourceCardId: string,
            abilityId: string,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.grantedActivatedAbilities = [
                ...(found.card.grantedActivatedAbilities ?? []),
                {
                    sourceCardId,
                    abilityId,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        // CR 113.1 / 611.1b: grants a triggered ability for a limited duration.
        // The template lives on the granting card's `triggeredGrantTemplates[]`
        // (looked up by `effectiveTriggeredAbilities`), so the trigger collector
        // scans and resolves it as if printed on the target. The duration-scoped
        // sibling of the continuous `triggered-grant` static effect; the
        // phase-boundary purge splices it back out when `duration` expires.
        // Used by Rapid Fire's "gains rampage 2 until end of turn".
        grantTriggeredAbility(
            target: TargetSelection,
            sourceCardId: string,
            abilityId: string,
            duration: DurationSpec
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.grantedTriggeredAbilities = [
                ...(found.card.grantedTriggeredAbilities ?? []),
                {
                    sourceCardId,
                    abilityId,
                    duration: resolveDuration(duration, item.castById, state),
                },
            ];
        },
        // CR 113.1 / 611.2c: grants a triggered ability with NO duration and NO
        // aura link — it persists for as long as the target stays on the
        // battlefield (the duration tick and the aura-unapply pass both skip
        // entries lacking duration/auraId). The template is looked up on the
        // granting card's `triggeredGrantTemplates[]` by
        // `effectiveTriggeredAbilities`, so the trigger collector scans / resolves
        // it as if printed on the target. Used by Balduvian Shaman / Dreams of
        // the Dead's "that permanent gains 'Cumulative upkeep {N}'".
        grantTriggeredAbilityPermanent(
            target: TargetSelection,
            sourceCardId: string,
            abilityId: string
        ): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            // Idempotent: don't stack a second copy of the same grant from the
            // same source on a permanent that already carries it (CR 113.1 —
            // re-applying an identical grant has no extra effect).
            const already = (found.card.grantedTriggeredAbilities ?? []).some(
                (g) =>
                    g.sourceCardId === sourceCardId &&
                    g.abilityId === abilityId &&
                    g.duration === undefined &&
                    g.auraId === undefined
            );
            if (already) return;
            found.card.grantedTriggeredAbilities = [
                ...(found.card.grantedTriggeredAbilities ?? []),
                { sourceCardId, abilityId },
            ];
        },
        // CR 614.1c — persistent leave-the-battlefield → exile replacement on a
        // single permanent (Dreams of the Dead). Unlike `setExileOnDeath` (death
        // only, cleared at CLEANUP) this flag survives across turns and is read
        // by `removePermanentTo` for EVERY departure path; cleared only when the
        // permanent actually leaves play.
        setExileOnLeave(target: TargetSelection): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.exileOnLeave = true;
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
        // CR 302.6 — summoning sickness is governed by the `isSummoningSick`
        // control-continuity flag set at entry (`markEnteredThisTurn`) and
        // cleared at the controller's untap step. Animation does NOT touch it:
        // a manland (Mishra's Factory) animated the turn it entered is still
        // sick (flag set), while one controlled since a prior turn is not (flag
        // cleared). This applies class-wide to every animate effect (Jade
        // Statue, etc.).
        animateAsCreature(target: TargetSelection, spec: AnimateSpec): void {
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const card = found.card;
            if (card.animation) return; // already animated — one at a time
            const addedCreatureType = !card.types.includes("Creature");
            // CR 208.2, 611.1: add only the types this animation grants that
            // aren't already present, so the end-of-turn revert removes
            // exactly what was added (e.g. Mishra's Factory gains "Artifact").
            const addedTypes = (spec.additionalTypes ?? []).filter(
                (t) => t !== "Creature" && !card.types.includes(t)
            );
            const addedSubtype =
                spec.subtype !== undefined &&
                !card.subtypes.includes(spec.subtype)
                    ? spec.subtype
                    : undefined;
            card.animation = {
                savedPower: card.power,
                savedToughness: card.toughness,
                addedCreatureType,
                addedTypes: addedTypes.length > 0 ? addedTypes : undefined,
                addedSubtype,
                duration: resolveDuration(spec.duration, item.castById, state),
            };
            const newTypes = [...card.types];
            if (addedCreatureType) {
                newTypes.push("Creature");
            }
            newTypes.push(...addedTypes);
            card.types = newTypes;
            if (addedSubtype !== undefined) {
                card.subtypes = [...card.subtypes, addedSubtype];
            }
            card.power = spec.power;
            card.toughness = spec.toughness;
        },
        // CR 603.7a: queues a delayed triggered ability. On the template
        // path the resolve body lives on the scheduling card's def and is
        // looked up by id when the firing condition (e.g. END_STEP) is
        // reached; on the inline path (ADR 0048) the body Op list is
        // persisted on the instance itself and the interpreter runs it
        // directly at fire time — no card-def lookup.
        scheduleDelayedTrigger(
            sourceCardId: string,
            triggerId: string,
            timing: DelayedTriggerTiming,
            payload: Record<string, string | string[]>,
            targetPlayerId?: string,
            inline?: DelayedTriggerInlineBody,
            watchInstanceId?: string
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
                ...(watchInstanceId ? { watchInstanceId } : {}),
                ...(inline
                    ? {
                          effects: inline.effects,
                          oracleText: inline.oracleText,
                      }
                    : {}),
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

        getStaticAbilities(target: TargetSelection): string[] {
            if (target.type !== "permanent") return [];
            const found = findOnBattlefield(state, target.id);
            return found ? [...found.card.staticAbilities] : [];
        },

        preventAllCombatDamage(): void {
            state.preventAllCombatDamageThisTurn = true;
        },

        restrictSpellCasting(playerId: string, cardTypes?: CardType[]): void {
            // CR 601.3a — mark `playerId` unable to cast spells for the rest of
            // this turn (Xantid Swarm: "defending player can't cast spells this
            // turn"; Abeyance passes `cardTypes: ["Instant", "Sorcery"]` to
            // narrow the lock instead of forbidding every spell). Idempotent
            // per player+cardTypes shape; cleared unconditionally at CLEANUP
            // (CR 514.2).
            const list = state.cannotCastSpellsThisTurn ?? [];
            const already = list.find((e) => e.playerId === playerId);
            if (!already) {
                list.push({ playerId, cardTypes });
            } else if (cardTypes === undefined) {
                // A blanket (all-spells) lock always wins over a narrower one.
                already.cardTypes = undefined;
            }
            state.cannotCastSpellsThisTurn = list;
        },

        restrictAbilityActivation(playerId: string): void {
            // CR 602.1 / 605.1a — mark `playerId` unable to activate non-mana
            // abilities for the rest of this turn (Abeyance: "that player can't
            // activate abilities that aren't mana abilities"). Idempotent;
            // cleared unconditionally at CLEANUP (CR 514.2).
            const list = state.cannotActivateAbilitiesThisTurn ?? [];
            if (!list.includes(playerId)) list.push(playerId);
            state.cannotActivateAbilitiesThisTurn = list;
        },

        markAssignsNoCombatDamage(target: TargetSelection): void {
            // CR 510.1c — the target assigns no combat damage this turn
            // (Farrel's Mantle, Farrel's Zealot). Idempotent; cleared at
            // CLEANUP. No-op for non-permanent targets.
            if (target.type !== "permanent") return;
            const list = state.assignsNoCombatDamageThisTurn ?? [];
            if (!list.includes(target.id)) list.push(target.id);
            state.assignsNoCombatDamageThisTurn = list;
        },

        redirectUnblockedCombatDamage(
            playerId: string,
            toPermanentId: string
        ): void {
            // CR 614.6 — Kjeldoran Royal Guard: all combat damage that unblocked
            // creatures would deal to `playerId` this turn is dealt to
            // `toPermanentId` instead. Idempotent per (player, permanent);
            // cleared at CLEANUP.
            const list = state.combatDamageRedirectToPermanent ?? [];
            if (
                !list.some(
                    (e) =>
                        e.playerId === playerId &&
                        e.toPermanentId === toPermanentId
                )
            ) {
                list.push({ playerId, toPermanentId });
            }
            state.combatDamageRedirectToPermanent = list;
        },

        markGazeOfPainActive(playerId: string): void {
            // ICE Gaze of Pain — "until end of turn" turn-scoped floating
            // trigger (CR 603.7a). Records that `playerId` has an active rider;
            // the card's graveyard-zone trigger reads this flag. Idempotent;
            // cleared at CLEANUP.
            const list = state.gazeOfPainActiveThisTurn ?? [];
            if (!list.includes(playerId)) list.push(playerId);
            state.gazeOfPainActiveThisTurn = list;
        },

        replaceLandManaWithBlue(playerId: string): void {
            // CR 614 — idempotent: one entry per player suffices (the
            // replacement is all-or-nothing). Cleared at CLEANUP.
            const list = state.landManaReplacedToBlueThisTurn ?? [];
            if (!list.includes(playerId)) list.push(playerId);
            state.landManaReplacedToBlueThisTurn = list;
        },

        addHighTide(playerId: string): void {
            // FEM High Tide — additive, NOT idempotent: each resolution adds
            // another entry so two High Tides give two extra {U} per Island tap
            // (CR 614-style stacking riders). Cleared at CLEANUP.
            const list = state.highTideThisTurn ?? [];
            list.push(playerId);
            state.highTideThisTurn = list;
        },

        addLandManaRider(rider: {
            subtype: string;
            color: Color;
            mode: "additional" | "override";
        }): void {
            // CR 614 / 514.2 — additive list, NOT idempotent: each arm pushes an
            // entry so two "additional" riders give two extra mana per tap.
            // Cleared at CLEANUP.
            const list = state.landManaRidersThisTurn ?? [];
            list.push(rider);
            state.landManaRidersThisTurn = list;
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

        setSourceCantBeRegeneratedThisTurn(): void {
            // CR 701.15c — flag the resolving ability's source so the rest of
            // the turn's regeneration (shields + auto-regen replacement) is
            // suppressed. Cleared at CLEANUP (CR 514.2).
            const found = findOnBattlefield(state, item.id);
            if (!found) return;
            found.card.cantBeRegeneratedThisTurn = true;
        },

        setTargetCantBeRegeneratedThisTurn(target: TargetSelection): void {
            // CR 701.15c — target-scoped twin of the source version above
            // (Incinerate, Orcish Healer, Word of Blasting). Sets the same
            // per-instance flag; cleared at CLEANUP (CR 514.2).
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found || !found.card.types.includes("Creature")) return;
            found.card.cantBeRegeneratedThisTurn = true;
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

        // CR 509.1 / 506.4 — swap the block assignments of two blocking
        // creatures (Sorrow's Path). Orthogonal combat operation: read each
        // blocker's currently-assigned attacker set, verify each blocker could
        // LEGALLY block every attacker in the OTHER's set (the same
        // declare-blockers legality the engine enforces — evasion, "can't be
        // blocked by", protection, pile restrictions; CR 509.1b/c via
        // `validateBlockerEligibility`), then atomically swap the two sets.
        // Either creature being absent / not blocking, or any leg of the
        // legality check failing, makes the whole reassignment a no-op (CR — the
        // "if each could block all creatures the other is blocking" clause is a
        // hard gate: if it can't be satisfied, nothing happens). The attackers
        // stay blocked (they remain in `blockedAttackerIds`); only WHICH blocker
        // is assigned to each changes. Reusable by any future block-swap effect.
        reassignBlocks(blockerAId: string, blockerBId: string): boolean {
            const combat = state.combat;
            if (!combat) return false;
            if (blockerAId === blockerBId) return false;

            const foundA = findOnBattlefield(state, blockerAId);
            const foundB = findOnBattlefield(state, blockerBId);
            if (!foundA || !foundB) return false;
            const cardA = foundA.card;
            const cardB = foundB.card;
            if (!cardA.isBlocking || !cardB.isBlocking) return false;

            const ba = combat.blockerAssignments;
            const setA = ba[blockerAId] ?? [];
            const setB = ba[blockerBId] ?? [];

            // Legality gate (CR 509.1b/c): A must be able to block every attacker
            // B is blocking, and vice versa. `validateBlockerEligibility` reads
            // the defending player's battlefield for landwalk-style checks; the
            // blocking creatures share a controller (both are the same
            // opponent's), so either blocker's owning battlefield is the
            // defender's for both legality passes.
            const defenderBattlefield = foundA.player.battlefield;
            const canBlockAll = (
                blocker: CardInstanceState,
                attackerIds: ReadonlyArray<string>
            ): boolean =>
                attackerIds.every((atkId) => {
                    const atk = findOnBattlefield(state, atkId);
                    if (!atk) return false;
                    return validateBlockerEligibility(
                        atk.card,
                        blocker,
                        defenderBattlefield,
                        state
                    ).eligible;
                });

            if (!canBlockAll(cardA, setB) || !canBlockAll(cardB, setA)) {
                return false;
            }

            // Atomic swap: remove both from combat (clears isBlocking +
            // assignment keys, CR 506.4), then re-block them onto the OTHER's
            // former attacker set (CR 509.1). `blockedAttackerIds` is untouched —
            // the attackers stay blocked throughout.
            this.removeFromCombat({ type: "permanent", id: blockerAId });
            this.removeFromCombat({ type: "permanent", id: blockerBId });

            cardA.isBlocking = true;
            cardB.isBlocking = true;
            combat.blockerAssignments[blockerAId] = [...setB];
            combat.blockerAssignments[blockerBId] = [...setA];
            return true;
        },

        reassignAttackerBlockers(
            attackerXId: string,
            attackerYId: string
        ): boolean {
            const combat = state.combat;
            if (!combat) return false;
            if (attackerXId === attackerYId) return false;

            const foundX = findOnBattlefield(state, attackerXId);
            const foundY = findOnBattlefield(state, attackerYId);
            if (!foundX || !foundY) return false;
            const cardX = foundX.card;
            const cardY = foundY.card;
            // CR 509.1 — both chosen creatures must be blocked attackers.
            if (!cardX.isAttacking || !cardY.isAttacking) return false;
            const blocked = combat.blockedAttackerIds ?? [];
            if (
                !blocked.includes(attackerXId) ||
                !blocked.includes(attackerYId)
            ) {
                return false;
            }

            // Gather every creature blocking X and every creature blocking Y
            // from the authoritative blocker→attacker graph.
            const ba = combat.blockerAssignments;
            const blockersOfX: string[] = [];
            const blockersOfY: string[] = [];
            for (const [blockerId, atkIds] of Object.entries(ba)) {
                if (atkIds.includes(attackerXId)) blockersOfX.push(blockerId);
                if (atkIds.includes(attackerYId)) blockersOfY.push(blockerId);
            }

            // Legality gate (CR 509.1b/c): X must be blockable by every creature
            // Y is blocked by, and vice versa. `validateBlockerEligibility`
            // reads the defending (blocker's) battlefield for landwalk-style
            // checks, so each blocker is validated against its own controller's
            // battlefield.
            const canBeBlockedByAll = (
                attackerCard: CardInstanceState,
                blockerIds: ReadonlyArray<string>
            ): boolean =>
                blockerIds.every((bid) => {
                    const b = findOnBattlefield(state, bid);
                    if (!b) return false;
                    return validateBlockerEligibility(
                        attackerCard,
                        b.card,
                        b.player.battlefield,
                        state
                    ).eligible;
                });

            if (
                !canBeBlockedByAll(cardX, blockersOfY) ||
                !canBeBlockedByAll(cardY, blockersOfX)
            ) {
                return false;
            }

            // Reassign: each blocker blocking exactly one of {X, Y} swaps that
            // membership to the other attacker (CR 509.1). A blocker blocking
            // BOTH (or neither) is untouched; any third attacker it also blocks
            // is preserved. `Object.entries` snapshots the keys, so mutating
            // during the loop is safe. `blockedAttackerIds` is untouched — both
            // attackers remain blocked throughout.
            for (const [blockerId, atkIds] of Object.entries(ba)) {
                const hasX = atkIds.includes(attackerXId);
                const hasY = atkIds.includes(attackerYId);
                if (hasX === hasY) continue;
                combat.blockerAssignments[blockerId] = atkIds.map((id) =>
                    id === attackerXId
                        ? attackerYId
                        : id === attackerYId
                          ? attackerXId
                          : id
                );
            }
            return true;
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

        setCantAttackThisTurn(target: TargetSelection): void {
            // CR 508.1a (ADR 0053, pile division) — the attack-side twin of
            // `setCantBlockThisTurn`: flags a creature so it cannot be
            // declared an attacker this turn (Fight or Flight's unchosen
            // pile). Read by `validateAttackerEligibility`; cleared at
            // CLEANUP (CR 514.2). No-op off the battlefield.
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            found.card.cantAttackThisTurn = true;
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

        setCantBeBlockedBySubtypeThisTurn(
            target: TargetSelection,
            subtype: string
        ): void {
            // CR 509.1b — flag an attacker as unblockable this turn by creatures
            // of a given subtype (Tower of Coireall, "can't be blocked by
            // Walls"). Read on the attacker side by `validateBlockerEligibility`;
            // cleared at CLEANUP (CR 514.2). No-op off the battlefield.
            if (target.type !== "permanent") return;
            const found = findOnBattlefield(state, target.id);
            if (!found) return;
            const existing = found.card.cantBeBlockedBySubtypesThisTurn ?? [];
            if (existing.includes(subtype)) return;
            found.card.cantBeBlockedBySubtypesThisTurn = [...existing, subtype];
        },

        setColorOverride(
            target: TargetSelection,
            colors: Color[],
            duration?: DurationSpec
        ): void {
            if (target.type === "permanent") {
                const found = findOnBattlefield(state, target.id);
                if (!found) return;
                // issue #1065 — a timed override ("becomes the color of your
                // choice UNTIL END OF TURN", Kavu Chameleon) records what to
                // restore on expiry; an indefinite call (no duration, Dream
                // Coat / Shyft) behaves exactly as before.
                if (duration) {
                    found.card.temporaryColorOverride = {
                        colors: [...colors],
                        ...(found.card.colorOverride
                            ? {
                                  restoreColorOverride: [
                                      ...found.card.colorOverride,
                                  ],
                              }
                            : {}),
                        duration: resolveDuration(
                            duration,
                            item.controllerId,
                            state
                        ),
                    };
                }
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
            const def = cardId ? tryGetDefinition(cardId) : undefined;
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

        // Camouflage (CR 509 variant — the random twin of Raging River,
        // ADR 0012). Replaces the defender's declare-blockers step: the
        // defender's piles are assigned to distinct attackers at random (seeded
        // PRNG — deterministic for replay), then each creature in a pile that
        // can legally block its assigned attacker is forced to do so (CR 509.1 —
        // "each creature in a pile that can block the creature that pile is
        // assigned to does so"). The forced blocks are written into
        // `combat.blockerAssignments`; the DECLARE_BLOCKERS step auto-confirms.
        applyCamouflagePileBlocks(defenderId: string, piles: string[][]): void {
            const combat = state.combat;
            if (!combat) return;
            // Marks "declare-blockers replaced by Camouflage" for this combat;
            // consumed by the DECLARE_BLOCKERS phase hook. Cleared at end of
            // combat alongside the other combat-scoped state.
            state.camouflageCombat = true;

            const defender = getPlayer(state, defenderId);
            const attackerOwner = getPlayer(state, state.activePlayerId);

            // Assign each pile to a DIFFERENT attacker at random. seededShuffle
            // reorders a copy of the attacker ids; pile i is then assigned to
            // shuffled[i]. Piles beyond the attacker count have no attacker to
            // block and are dropped (the defender can declare at most N piles).
            const shuffledAttackers = seededShuffle(state, [
                ...combat.attackerIds,
            ]);

            for (let i = 0; i < piles.length; i++) {
                const attackerId = shuffledAttackers[i];
                if (attackerId === undefined) break;
                const attacker = attackerOwner.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (!attacker) continue;
                for (const blockerId of piles[i]) {
                    const blocker = defender.battlefield.find(
                        (c) => c.id === blockerId
                    );
                    if (!blocker) continue;
                    // CR 509.1b — only creatures that CAN legally block their
                    // assigned attacker do so; others stay back.
                    const { eligible } = validateBlockerEligibility(
                        attacker,
                        blocker,
                        defender.battlefield,
                        state
                    );
                    if (!eligible) continue;
                    blocker.isBlocking = true;
                    blocker.hasBlockedThisTurn = true;
                    combat.blockerAssignments[blockerId] = [attackerId];
                }
            }
        },
        enableAttackerChoosesBlocks(): void {
            // Melee (CR 509.1 variant, #669) — for THIS combat the attacking
            // (active) player declares blocks instead of the defender. The flag
            // is consumed by the block-selection mutations (which route to the
            // active player) and the blocker-confirmation rider; cleared at end
            // of combat alongside the other combat-scoped state.
            if (!state.combat) return;
            state.meleeCombat = true;
        },
        copyStackItem(targetStackItemId, modifications): string | null {
            const original = state.stack.find(
                (s) => s.id === targetStackItemId
            );
            if (!original) return null;
            return cloneSpellOntoStack(state, original, item, modifications);
        },
        copyResolvingSpell(modifications): string | null {
            // CR 707.12 — "copy this spell". A resolving spell that copies
            // ITSELF (Chain Lightning, Backdraft-likes) clones `item`, the
            // currently-resolving stack object, rather than a different spell
            // still on the stack (that's `copyStackItem`). During a stepped
            // resolve the resolving spell is still on the stack (peek-and-pop),
            // so the same insert-below-self discipline leaves the copy as the
            // new top once this spell finishes and is popped.
            return cloneSpellOntoStack(state, item, item, modifications);
        },
        requestCopyRetarget(copyStackItemId): void {
            const copy = state.stack.find((s) => s.id === copyStackItemId);
            if (!copy) return;
            requestCopyRetargetOn(state, copy);
        },
        requestRetarget(spellStackItemId, requirement): void {
            // CR 114.6 — change the target(s) of a spell ALREADY on the stack
            // (the original object, not a copy). Reflecting Mirror. Mirrors
            // requestCopyRetarget but `cardInstanceId` points at the original
            // spell, so finalization writes new targets onto it in place.
            const spell = state.stack.find((s) => s.id === spellStackItemId);
            if (!spell) return; // spell left the stack — nothing to retarget
            const rawCount = requirement.count;
            const count =
                rawCount === "X" ? Math.max(0, item.chosenX ?? 0) : rawCount;
            const minNeeded = typeof count === "number" ? count : count.min;
            if (minNeeded <= 0) return; // no targets to choose
            const subtypeFilter = requirement.subtypeFilter
                ? Array.isArray(requirement.subtypeFilter)
                    ? requirement.subtypeFilter
                    : [requirement.subtypeFilter]
                : undefined;
            const supertypeFilter = requirement.supertypeFilter
                ? Array.isArray(requirement.supertypeFilter)
                    ? requirement.supertypeFilter
                    : [requirement.supertypeFilter]
                : undefined;
            const excludeSubtypes = requirement.excludeSubtypes
                ? Array.isArray(requirement.excludeSubtypes)
                    ? requirement.excludeSubtypes
                    : [requirement.excludeSubtypes]
                : undefined;
            const excludeSupertypes = requirement.excludeSupertypes
                ? Array.isArray(requirement.excludeSupertypes)
                    ? requirement.excludeSupertypes
                    : [requirement.excludeSupertypes]
                : undefined;
            state.pendingTarget = {
                // The activating player (controller of THIS resolving ability)
                // chooses the new target (CR 114.6 / 608.2).
                playerId: item.castById,
                cardInstanceId: spell.id,
                targetType: requirement.type,
                count,
                selected: [],
                kind: "retarget",
                ...(requirement.colorFilter
                    ? { colorFilter: requirement.colorFilter }
                    : {}),
                ...(requirement.colorFilterAny
                    ? { colorFilterAny: requirement.colorFilterAny }
                    : {}),
                ...(requirement.zone ? { zone: requirement.zone } : {}),
                ...(requirement.controller
                    ? { controller: requirement.controller }
                    : {}),
                ...(subtypeFilter ? { subtypeFilter } : {}),
                ...(supertypeFilter ? { supertypeFilter } : {}),
                ...(requirement.powerFilter
                    ? { powerFilter: requirement.powerFilter }
                    : {}),
                ...(requirement.toughnessFilter
                    ? { toughnessFilter: requirement.toughnessFilter }
                    : {}),
                ...(excludeSubtypes ? { excludeSubtypes } : {}),
                ...(excludeSupertypes ? { excludeSupertypes } : {}),
                ...(requirement.spellTypeFilter
                    ? {
                          spellTypeFilter: Array.isArray(
                              requirement.spellTypeFilter
                          )
                              ? requirement.spellTypeFilter
                              : [requirement.spellTypeFilter],
                      }
                    : {}),
                ...(requirement.spellExcludeTypeFilter
                    ? {
                          spellExcludeTypeFilter: Array.isArray(
                              requirement.spellExcludeTypeFilter
                          )
                              ? requirement.spellExcludeTypeFilter
                              : [requirement.spellExcludeTypeFilter],
                      }
                    : {}),
                ...(requirement.spellCreaturePtFilter
                    ? {
                          spellCreaturePtFilter:
                              requirement.spellCreaturePtFilter,
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
            // ADR 0037 (#580) — redirect the prompt to the acting player for a
            // controlled cast's resolution; the explicit `req.actingPlayerId`
            // (Word of Command's own card pick) still wins when supplied.
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: req.kind,
                zone: req.zone,
                count: req.count,

                prompt: req.prompt,
            };
            if (req.filter) entry.filter = req.filter;
            // Default the picked-from zone owner to the controlled player so the
            // chosen spell's resolution reads from THEIR zones (CR 608.2) even
            // though the acting player answers.
            const zoneOwnerId = req.zoneOwnerId ?? routed.actingPlayerId;
            if (zoneOwnerId) entry.zoneOwnerId = zoneOwnerId;
            // Acting Player (ADR 0037): carry the override only when it differs
            // from the prompted player — normal choices stay unannotated.
            const actingPlayerId = req.actingPlayerId ?? routed.actingPlayerId;
            if (actingPlayerId && actingPlayerId !== entry.playerId) {
                entry.actingPlayerId = actingPlayerId;
            }
            if (req.allControllers) entry.allControllers = true;
            if (req.candidateIds) entry.candidateIds = req.candidateIds;
            if (req.candidatePlayerIds) {
                entry.candidatePlayerIds = req.candidatePlayerIds;
            }
            if (req.destination) entry.destination = req.destination;
            if (req.putOnTop) entry.putOnTop = true;
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        readOrderedSecond(choiceId): string[] {
            const step = item.resolutionStep ?? 0;
            return item.collectedChoices?.[`${step}:${choiceId}:second`] ?? [];
        },
        requestMayPay(req): boolean | undefined {
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored[0] === "yes";
            // ADR 0037 (#580) — a may-pay during a controlled cast's resolution
            // is the acting player's decision; resources still come from the
            // controlled player (whose pool pays the cost).
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: "may-pay",
                count: 1,

                prompt: req.prompt,
            };
            if (req.cost) entry.cost = req.cost;
            if (req.manaRestriction)
                entry.manaRestriction = req.manaRestriction;
            if (routed.actingPlayerId)
                entry.actingPlayerId = routed.actingPlayerId;
            // CR 701.16b — when the may-pay's sacrifice leg admits a real victim
            // choice (more matching permanents than the leg sacrifices), light up
            // the payer's battlefield so the client can prompt WHICH permanent(s)
            // to sacrifice before confirming. Reuses the standard battlefield
            // pick machinery (`zone`/`filter`/`candidateIds`); the submit reads the
            // picked ids back. With a single legal candidate (or `count` covering
            // all) no fields are set and the pay auto-selects (Arena UX).
            if (
                req.cost &&
                mayPaySacrificeChoiceRequired(state, routed.playerId, req.cost)
            ) {
                const norm = normalizeMayPayCost(req.cost);
                entry.zone = "battlefield";
                if (norm.sacrifice) entry.filter = norm.sacrifice.filter;
                entry.candidateIds = getMayPaySacrificeCandidateIds(
                    state,
                    routed.playerId,
                    req.cost
                );
            } else if (
                // CR 701.9 / 118.3 (issue #899) — when the may-pay's discard leg
                // admits a real card choice (more hand cards than the leg
                // discards), light up the payer's hand so the client can prompt
                // WHICH card(s) to discard before confirming. Mirrors the
                // sacrifice leg's `zone`/`candidateIds` machinery above, but from
                // hand instead of the battlefield — `else if` because a single
                // may-pay entry carries only one real picker (no card needs both
                // legs to admit a choice simultaneously yet). With a single
                // legal candidate (or `count` covering all) no fields are set
                // and the pay auto-selects (Arena UX).
                req.cost &&
                mayPayDiscardChoiceRequired(state, routed.playerId, req.cost)
            ) {
                entry.zone = "hand";
                entry.candidateIds = getMayPayDiscardCandidateIds(
                    state,
                    routed.playerId,
                    req.cost
                );
            }
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        noteMassRiderTargets(playerIds: string[]): void {
            // CR 608.2 — persist the per-permanent billing list on the stack
            // item so it survives the irreversible mass effect (step 0) and any
            // suspension on a later may-pay (step 1). Stench of Evil.
            item.massRiderTargets = [...playerIds];
        },
        getMassRiderTargets(): string[] {
            return item.massRiderTargets ? [...item.massRiderTargets] : [];
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
            // ADR 0037 (#580) — modal / "choose one" picks made DURING a
            // controlled cast's resolution route to the acting player; the
            // explicit `req.actingPlayerId` (Word of Command's own X / mode
            // picks during its cast) still wins when supplied.
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: "option-pick",
                count: 1,
                options: req.options,
                prompt: req.prompt,
            };
            // Acting Player (ADR 0037): annotate only when it differs from the
            // prompted player (Word of Command — controller picks X / mode).
            const actingPlayerId = req.actingPlayerId ?? routed.actingPlayerId;
            if (actingPlayerId && actingPlayerId !== entry.playerId) {
                entry.actingPlayerId = actingPlayerId;
            }
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        requestPickPile(req): "A" | "B" | undefined {
            // ADR 0053 (pile division, "separate into two piles" cycle) — step
            // 2 of `divideIntoPiles`: the CHOOSER picks pile "A" or "B" once
            // the divider's partition (step 1, a `divide-piles` `requestChoice`)
            // has already committed. Mirrors `requestOptionChoice`'s
            // suspend/replay contract exactly, with `pileA`/`pileB` (the
            // completed piles) carried on the entry instead of `options` so
            // the chooser's client can render pile contents before deciding.
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored[0] as "A" | "B";
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: "pick-pile",
                count: 1,
                pileA: req.pileA,
                pileB: req.pileB,
                prompt: req.prompt,
            };
            const actingPlayerId = req.actingPlayerId ?? routed.actingPlayerId;
            if (actingPlayerId && actingPlayerId !== entry.playerId) {
                entry.actingPlayerId = actingPlayerId;
            }
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        requestNameCard(req): string | undefined {
            // CR 202.3 / 701.x "chooses a card name" — open name choice over the
            // whole card registry. Mirrors `requestChoice`'s suspend/replay
            // contract: first call enqueues a `name-card` PendingChoice and
            // returns undefined (the step must return early to suspend); the
            // replay after `submitNameCard` reads the stored name back. The
            // name (a single string) is committed into collectedChoices as a
            // one-element array, like every other resolved answer.
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${req.choiceId}`;
            const stored = item.collectedChoices?.[key];
            if (stored) return stored[0];
            // ADR 0037 (#580) — a name-a-card choice during a controlled cast's
            // resolution is the acting player's decision.
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: "name-card",
                count: 1,
                prompt: req.prompt,
            };
            if (routed.actingPlayerId)
                entry.actingPlayerId = routed.actingPlayerId;
            state.pendingChoices = [...(state.pendingChoices ?? []), entry];
            return undefined;
        },
        getCardName(cardInstanceId): string | undefined {
            // CR 108.1 / 201.1 — resolve any instance (any zone) to its printed
            // name via the registry. Used to compare a revealed card against a
            // named card (Petra Sphinx).
            for (const p of state.players) {
                for (const zone of [
                    p.library,
                    p.hand,
                    p.graveyard,
                    p.exile,
                    p.battlefield,
                ]) {
                    const found = zone.find((c) => c.id === cardInstanceId);
                    if (found) {
                        const id = (found.card as { id?: string }).id;
                        return id ? tryGetDefinition(id)?.name : undefined;
                    }
                }
            }
            return undefined;
        },
        revealRandomHandCard(playerId): string | undefined {
            // CR 701.20a — "reveal a card at random from your hand". The pick
            // is drawn from the game's seeded PRNG (rngSeed/rngCounter) so it
            // is deterministic on replay, exactly like `flipCoin` /
            // `discardCardsAtRandom`. It MUST run in the final, non-suspending
            // resolution segment (after any `requestNameCard` suspension) so
            // the replayed step never advances the counter twice and re-rolls a
            // different card. Empty hand → nothing is revealed (CR 608.2b).
            const player = getPlayer(state, playerId);
            if (player.hand.length === 0) return undefined;
            const picked = player.hand[randomInt(state, player.hand.length)];
            // CR 701.20a — the revealed card is shown to every player, so the
            // wire projection surfaces the real card (not a nulled slot).
            grantKnowledgeToAll(state, playerId, [picked.id]);
            return picked.id;
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
            // ADR 0037 (#580) — a coin flip during a controlled cast's
            // resolution is acknowledged by the acting player.
            const routed = routeActingPlayer(req.playerId);
            const entry: PendingChoice = {
                stackItemId: item.id,
                step,
                choiceId: req.choiceId,
                playerId: routed.playerId,
                kind: "random-reveal",
                count: 1,
                prompt: "Flip a coin",
                randomKind: "coin",
                sides: 2,
                // CR 705.2 — 1 = heads (the flipping player wins), 0 = tails.
                result: won ? 1 : 0,
                realized,
            };
            if (routed.actingPlayerId)
                entry.actingPlayerId = routed.actingPlayerId;
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
            // CR 205.4a — `supertypesOf` resolves live snow status for
            // `supertypes` filters (Cold Snap / Avalanche snow-land counts).
            return bf
                .filter((c) => {
                    // CR 201.2 — live printed name from the registry, so a
                    // `name` filter (issue #985) matches on the battlefield.
                    const cardId = (c.card as { id?: string }).id;
                    const name = cardId
                        ? tryGetDefinition(cardId)?.name
                        : undefined;
                    return matchesPermanentFilter(
                        {
                            ...c,
                            name,
                            colors: STATIC_EFFECT_CTX.getColors(c),
                        },
                        filter,
                        { supertypesOf: liveSupertypesOf }
                    );
                })
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
        getColors(target: TargetSelection): Color[] {
            // CR 202.2 / 105 — effective colors of a battlefield permanent,
            // honoring any layer-5 color override (Painter's Servant etc.) via
            // the shared static-effect color derivation. Empty for non-permanent
            // targets (players / stack spells).
            if (target.type !== "permanent") return [];
            const found = findOnBattlefield(state, target.id);
            if (!found) return [];
            return STATIC_EFFECT_CTX.getColors(found.card);
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
        noteChoice(choiceId: string, values: string[]): void {
            // Persist a value computed in the CURRENT step so a LATER step can
            // read it via `recallChoice` (CR 608.2h last-known information): a
            // step that must reference an object BEFORE an irreversible op in
            // the same resolution destroys it — e.g. Chain Lightning capturing
            // the targeted permanent's controller before dealing lethal damage
            // — records it here, then recalls it after the suspend/replay. Keyed
            // under the current step like the `request*` primitives; survives
            // serialization in `collectedChoices` and is cleared on completion.
            const step = item.resolutionStep ?? 0;
            const key = `${step}:${choiceId}`;
            item.collectedChoices = {
                ...(item.collectedChoices ?? {}),
                [key]: values,
            };
        },
        // --- Effect Script interpreter plumbing (ADR 0045, issue #805) ---
        // The interpreter checkpoints the CURRENT Op index in the stack
        // item's `resolutionStep` — the same resume checkpoint the stepped
        // (`resolveSteps`) paths use — so a `choice` Op suspension resumes at
        // the exact Op (earlier Ops never re-run, CR 608.3) and
        // `requestChoice` / `noteChoice` key `collectedChoices` under the Op
        // index. Interpreter-internal: card resolve bodies must never call
        // these.
        getScriptCheckpoint(): number | undefined {
            return item.resolutionStep;
        },
        setScriptCheckpoint(opIndex: number): void {
            item.resolutionStep = opIndex;
        },
        clearScriptCheckpoint(): void {
            // Delete (not set undefined) so a completed script leaves no
            // stale checkpoint on the card instance as it changes zone — a
            // recast with a leftover `resolutionStep` would skip the
            // target-legality gate (CR 608.2b) and mis-key its choices.
            delete item.resolutionStep;
        },
        // CR 701.16: to sacrifice a permanent is for its controller to put
        // it into its owner's graveyard. Indestructible does not prevent
        // sacrifice (CR 701.16a). No-op if the id is not on the battlefield.
        // issue #1054 — the resolving spell/ability's controller is the
        // causer (an Edict effect forcing an opponent's sacrifice, or a
        // card's own "sacrifice a permanent: ..." ability sacrificing its
        // own controller's permanent — either way `ctx.controller` is
        // correct: "caused by an opponent" conditions compare it against the
        // sacrificed permanent's OWN controller, never assume it here).
        sacrifice(cardInstanceId: string): void {
            removePermanentTo(
                state,
                cardInstanceId,
                "graveyard",
                "sacrifice",
                ctx.controller
            );
        },
        // CR 702.30a — Echo: clear the resolving trigger source's `echoPending`
        // flag once its echo cost is paid, so the trigger's intervening-if
        // never fires again on a later upkeep. No-op if the source has left the
        // battlefield.
        markEchoPaid(): void {
            const sourceId = item.triggerSourceId ?? item.id;
            const found = findOnBattlefield(state, sourceId);
            if (found) delete found.card.echoPending;
        },
        // CR 701.8: to discard a card is to move it from its owner's hand
        // into that player's graveyard. No-op if the card is no longer in
        // hand (e.g. already moved by a concurrent step).
        discardCard(playerId: string, cardInstanceId: string): void {
            const player = getPlayer(state, playerId);
            const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
            if (idx === -1) return;
            // CR 614 — Library of Leng's discard replacement intercepts inside
            // discardToGraveyard; on a real discard it emits CARD_DISCARDED
            // (CR 701.8) so "whenever you discard" triggers fire (Necropotence).
            if (!discardToGraveyard(state, playerId, cardInstanceId)) return;
            // ADR 0026 (revised): a discard does NOT clear a non-owner knower's
            // knowledge of the REMAINING hand. Knowledge is tracked per card
            // INSTANCE, and the discarded card goes to the public graveyard —
            // removing it leaves every other known instance still identifiable
            // (its identity→instance mapping is unchanged). Only a genuine
            // uncertainty event (shuffle / hidden return to library) revokes
            // hand knowledge. Before the revision this over-conservatively
            // reverted the whole hand to hidden, which hid the cards a full
            // reveal (Thoughtseize) had legitimately exposed.
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
        // CR 401.4 "put it on top of your library" (issue #1125) — the
        // tutor-to-top template: relocate specific card(s), by id, from
        // ANYWHERE in `playerId`'s library onto the top, preserving
        // `orderedIds`' order (index 0 ends up the very top). Unlike
        // `reorderLibraryTop`, the ids are NOT required to already be within
        // a known top-N window — a search `choice` picks a card from the
        // WHOLE library, and the classic tutor sequence (Vampiric Tutor,
        // Mystical Tutor, Imperial Seal) shuffles the rest of the library
        // BEFORE this runs, so the picked card can be anywhere. An id no
        // longer present is silently skipped (CR 608.2b). The searcher
        // selected and placed these cards, so they stay known to `playerId`
        // (ADR 0026 self-knowledge) until the next shuffle clears it —
        // mirrors `orderTop`'s "kept cards stay known" grant.
        putLibraryCardsOnTop(playerId: string, orderedIds: string[]): void {
            const player = getPlayer(state, playerId);
            const moved: CardInstanceState[] = [];
            for (const id of orderedIds) {
                const idx = player.library.findIndex((c) => c.id === id);
                if (idx === -1) continue;
                const [card] = player.library.splice(idx, 1);
                moved.push(card);
            }
            if (moved.length === 0) return;
            player.library.unshift(...moved);
            grantKnowledge(
                state,
                playerId,
                moved.map((c) => c.id),
                playerId
            );
        },
        // CR 701.22 Scry / 701.44 Surveil / "put them back in any order" (Ponder,
        // Index) — the single reusable ordered-top primitive behind the drag
        // picker. Looks at the top `n` cards, raises an `order-top` PendingChoice
        // (candidateIds = those n, projected face-up as `libraryPeek`), and on
        // resume applies the player's two ordered lists: the KEPT cards return to
        // the top in the chosen order, the rest go to `destination`
        // (`library-bottom` scry / `graveyard` surveil / `none` order-only). The
        // kept cards are marked known to the controller (ADR 0026 — you know your
        // own top cards after a scry). Returns `false` while suspended on the
        // choice (the caller must `return`), `true` once applied (resolution
        // continues — e.g. Preordain's "then draw a card").
        orderTop(
            playerId: string,
            n: number,
            opts: {
                destination: LibraryDestination;
                prompt?: string;
                choiceId?: string;
            }
        ): boolean {
            const player = getPlayer(state, playerId);
            const topIds = player.library.slice(0, n).map((c) => c.id);
            if (topIds.length === 0) return true;
            const step = item.resolutionStep ?? 0;
            const choiceId = opts.choiceId ?? `order-top-${item.id}`;
            const key = `${step}:${choiceId}`;
            const storedTop = item.collectedChoices?.[key];
            if (!storedTop) {
                const entry: PendingChoice = {
                    stackItemId: item.id,
                    step,
                    choiceId,
                    playerId,
                    kind: "order-top",
                    zone: "library",
                    destination: opts.destination,
                    candidateIds: topIds,
                    count: { min: 0, max: topIds.length },
                    prompt:
                        opts.prompt ??
                        DEFAULT_ORDER_TOP_PROMPT[opts.destination],
                };
                state.pendingChoices = [...(state.pendingChoices ?? []), entry];
                return false;
            }
            // Resume — `storedTop` is the kept order (topmost first), the un-kept
            // cards live under the sibling `:second` key (submit-time split).
            const second = item.collectedChoices?.[`${key}:second`] ?? [];
            if (opts.destination === "graveyard") {
                // CR 614 (issue #1145) — Surveil's "put into graveyard" leg is
                // itself a card-entering-a-graveyard event; a graveyard-bound
                // replacement (Yawgmoth's Will / Dauthi Voidwalker) can
                // redirect it to exile.
                for (const id of second) {
                    const card = player.library.find((c) => c.id === id);
                    const ownerId = card?.ownerId ?? playerId;
                    const { destination, tagCounters } =
                        graveyardDestinationFor(state, id, ownerId, "library");
                    const moved = moveCard(player, id, "library", destination);
                    if (destination !== "graveyard") {
                        applyGraveyardRedirectCounters(moved, tagCounters);
                    }
                }
            } else if (opts.destination === "library-bottom") {
                for (const id of second) {
                    const idx = player.library.findIndex((c) => c.id === id);
                    if (idx !== -1) {
                        const [c] = player.library.splice(idx, 1);
                        player.library.push(c); // true bottom (CR 701.22)
                    }
                }
                // ADR 0026 — the controller looked at these cards and PLACED
                // them at the bottom in a chosen order (CR 701.22 "in any
                // order"), so their position is certain: they stay known
                // (face-up in the controller's bottom-of-library view) until an
                // uncertainty event (shuffle) clears them. The projection
                // exposes them as the contiguous known run from the bottom.
                grantKnowledge(state, playerId, second, playerId);
            }
            // After removing the un-kept cards, the kept cards are exactly the top
            // `storedTop.length` of the library — reorder them to the chosen order.
            const m = storedTop.length;
            if (m > 0) {
                const topCards = player.library.splice(0, m);
                const reordered = storedTop.map((id) => {
                    const card = topCards.find((c) => c.id === id);
                    if (!card) {
                        throw new Error(
                            `Card ${id} not in kept top of library`
                        );
                    }
                    return card;
                });
                player.library.unshift(...reordered);
                // ADR 0026 — the controller has seen and arranged the kept
                // cards; they stay known (face-up on top) until a shuffle or a
                // draw moves them. Graveyard'd cards (surveil) are not marked
                // here — the graveyard is public anyway.
                grantKnowledge(state, playerId, storedTop, playerId);
            }
            return true;
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
        // Reveal dialog — enqueue a one-shot "these cards were just revealed to
        // you" notification (separate from the persistent `markKnown` /
        // `markKnownToAll` knowledge grant, which the caller still does). Opt-in
        // for pure look/reveal cards (Mishra's Bauble, Gitaxian Probe): NOT
        // wired into the knowledge primitives, so scry / surveil / impulse-exile
        // never pop a dialog. Snapshots the cards by scanning every zone so the
        // entry is self-contained (renders even after the cards move). The id is
        // resolution-derived (replay-stable, never wall-clock). No-op when the
        // audience or the resolved card set is empty (CR 608.2b).
        notifyReveal(
            audience: string[],
            cardInstanceIds: string[],
            source: string,
            kind: "look" | "reveal"
        ): void {
            if (audience.length === 0 || cardInstanceIds.length === 0) return;
            const wanted = new Set(cardInstanceIds);
            const found = new Map<string, string>();
            for (const p of state.players) {
                for (const zone of [
                    p.library,
                    p.hand,
                    p.graveyard,
                    p.exile,
                    p.battlefield,
                ]) {
                    for (const c of zone) {
                        if (!wanted.has(c.id)) continue;
                        const cid = (c.card as { id?: string }).id;
                        if (cid) found.set(c.id, cid);
                    }
                }
            }
            // Preserve the caller's order (top-of-library first, etc.).
            const cards = cardInstanceIds
                .filter((id) => found.has(id))
                .map((id) => ({ instanceId: id, cardId: found.get(id)! }));
            if (cards.length === 0) return;
            const step = item.resolutionStep ?? 0;
            const index = state.pendingReveals?.length ?? 0;
            const entry: RevealNotification = {
                id: `${item.id}:${step}:${index}`,
                audience: [...new Set(audience)],
                source,
                kind,
                cards,
            };
            state.pendingReveals = [...(state.pendingReveals ?? []), entry];
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
            name: string;
            types: CardType[];
            subtypes: string[];
            supertypes: CardSupertype[];
            manaValue: number;
            colors: Color[];
        }> {
            return getPlayer(state, playerId).hand.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                return {
                    id: c.id,
                    // CR 201.2 — printed name from the registry (empty for a
                    // definition-less instance; fail-closed for a name filter).
                    name: def?.name ?? "",
                    types: def?.types ?? c.types,
                    subtypes: def?.subtypes ?? c.subtypes,
                    // CR 205.4 — supertypes (Basic) from the registry; hidden
                    // hand cards carry none on the instance.
                    supertypes: def?.supertypes ?? [],
                    manaValue: manaValue(def?.manaCost),
                    // CR 202.2 — mana-cost-derived colors of the hand card.
                    colors: getColorsFromCost(def?.manaCost),
                };
            });
        },
        // CR 108.1 — library card characteristics from the registry. Mirrors
        // `getHandCards`; used to precompute the `candidateIds` allow-list for a
        // filtered `search-library` choice (Transmute Artifact: artifact cards;
        // issue #677 — a fetchland's "search for a BASIC land card" reads
        // `supertypes`; Natural Order's "a green creature card" reads `colors`).
        getLibraryCards(playerId: string): Array<{
            id: string;
            name: string;
            types: CardType[];
            subtypes: string[];
            supertypes: CardSupertype[];
            colors: Color[];
            manaValue: number;
        }> {
            return getPlayer(state, playerId).library.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                return {
                    id: c.id,
                    // CR 201.2 — printed name from the registry.
                    name: def?.name ?? "",
                    types: def?.types ?? c.types,
                    subtypes: def?.subtypes ?? c.subtypes,
                    // CR 205.4 — supertypes (Basic) from the registry; hidden
                    // library cards carry none on the instance.
                    supertypes: def?.supertypes ?? [],
                    // CR 202.2 — mana-cost-derived colors of the library card.
                    colors: getColorsFromCost(def?.manaCost),
                    manaValue: manaValue(def?.manaCost),
                };
            });
        },
        // CR 108.1 — graveyard card characteristics from the registry. Mirrors
        // `getHandCards`; used by effects that count graveyard cards by colour
        // (Nameless Race: "white cards in their graveyards").
        getGraveyardCards(playerId: string): Array<{
            id: string;
            name: string;
            types: CardType[];
            subtypes: string[];
            manaValue: number;
            colors: Color[];
        }> {
            return getPlayer(state, playerId).graveyard.map((c) => {
                const cardId = (c.card as { id?: string }).id;
                const def = cardId ? tryGetDefinition(cardId) : undefined;
                return {
                    id: c.id,
                    // CR 201.2 — printed name from the registry (Accumulated
                    // Knowledge's "each other card named ~", issue #985).
                    name: def?.name ?? "",
                    types: def?.types ?? c.types,
                    subtypes: def?.subtypes ?? c.subtypes,
                    manaValue: manaValue(def?.manaCost),
                    colors: getColorsFromCost(def?.manaCost),
                };
            });
        },
        // CR 404 / 400.7 — which graveyard holds `id` (owner playerId), or
        // undefined. Powers the interpreter's graveyard-source `$source`
        // resolution (Ashen Ghoul self-reanimation).
        getGraveyardCardOwner(id: string): string | undefined {
            for (const p of state.players) {
                if (p.graveyard.some((c) => c.id === id)) return p.id;
            }
            return undefined;
        },
        // Revolt (CR 702.RV): true when a permanent the given player controlled
        // left the battlefield this turn. Set by removePermanentTo, reset at
        // turn start (advanceTurn).
        hasRevolt(playerId: string): boolean {
            return (
                getPlayer(state, playerId)
                    .permanentYouControlledLeftThisTurn === true
            );
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
        exileSelf(): void {
            // CR 608.2 — "Exile <this spell>". A copy ceases to exist anyway
            // (CR 707.10) and an ability has no card to exile; both no-op.
            if (item.isCopy) return;
            if (item.abilityId || item.triggeredAbilityId) return;
            item.exileOnResolve = true;
        },
        shuffleSelfIntoLibrary(): void {
            // CR 608.2 / 701.24 (issue #898) — "Shuffle <this spell> into its
            // owner's library" (Green Sun's Zenith). Mirrors `exileSelf`
            // exactly: a copy ceases to exist anyway (CR 707.10) and an
            // ability has no card to shuffle away; both no-op.
            if (item.isCopy) return;
            if (item.abilityId || item.triggeredAbilityId) return;
            item.shuffleIntoLibraryOnResolve = true;
        },
        grantFlashback(target, cost): void {
            // CR 702.34 — grant Flashback to a target instant/sorcery card in a
            // graveyard until end of turn (Snapcaster Mage). Locate the card in
            // the named graveyard and stamp `grantedFlashback`; the cost
            // defaults to the card's own mana cost ("The flashback cost is equal
            // to its mana cost"). No-op if the target isn't a graveyard card or
            // has left the graveyard by resolution (CR 608.2b).
            if (target.type !== "graveyard-card") return;
            let card: CardInstanceState | undefined;
            if (target.playerId) {
                card = getPlayer(state, target.playerId).graveyard.find(
                    (c) => c.id === target.id
                );
            } else {
                for (const p of state.players) {
                    const found = p.graveyard.find((c) => c.id === target.id);
                    if (found) {
                        card = found;
                        break;
                    }
                }
            }
            if (!card) return;
            const printedCostId = (card.card as { id?: string }).id;
            const printedCost = printedCostId
                ? tryGetDefinition(printedCostId)?.manaCost
                : undefined;
            const granted = cost ?? printedCost;
            if (!granted) return;
            card.grantedFlashback = granted;
        },
        wasCastFromGraveyard(): boolean {
            // CR 702.34 — the flag is stamped on the stack item at cast commit
            // when the spell was flashed back from the graveyard.
            return item.castFromGraveyard === true;
        },
        getCardTargetRequirement(casterId, cardInstanceId) {
            // CR 108.1 — read the chosen card's target requirement from the
            // registry so a controlled cast (Word of Command) can branch on
            // whether the Acting Player must choose targets.
            const owner = getPlayer(state, casterId);
            const handCard = owner.hand.find((c) => c.id === cardInstanceId);
            const cardId = handCard
                ? (handCard.card as { id?: string }).id
                : undefined;
            const def = cardId ? tryGetDefinition(cardId) : undefined;
            return def?.targetRequirement;
        },
        getCardModes(casterId, cardInstanceId) {
            // CR 700.2 / 108.1 — the modes of a chosen card, read from the
            // registry so a controlled cast (Word of Command) can prompt the
            // Acting Player to choose one (CR 700.2c). Empty for a non-modal
            // card. Only id/label are surfaced (the picker's needs).
            const def = getHandCardDef(state, casterId, cardInstanceId);
            return (def?.modes ?? []).map((m) => ({
                id: m.id,
                label: m.label,
            }));
        },
        getCardModeTargetRequirement(casterId, cardInstanceId, modeId) {
            // CR 700.2d — only the chosen mode's target requirement is honored.
            const def = getHandCardDef(state, casterId, cardInstanceId);
            return def?.modes?.find((m) => m.id === modeId)?.targetRequirement;
        },
        cardHasXCost(casterId, cardInstanceId) {
            // CR 107.3 — a variable {X} is a string-valued X in the cost.
            const def = getHandCardDef(state, casterId, cardInstanceId);
            return typeof (def?.manaCost as { X?: unknown } | undefined)?.X ===
                "string"
                ? true
                : false;
        },
        getCardSacrificeFilter(casterId, cardInstanceId) {
            // CR 117.9 — the additional sacrifice cost's filter, if any.
            const def = getHandCardDef(state, casterId, cardInstanceId);
            return def?.additionalCosts?.sacrificeFilter;
        },
        getMaxAffordableX(controllerId, cardInstanceId) {
            // CR 107.3 / ADR 0037 — the largest X payable SOLELY from lands the
            // controlled opponent controls (Word of Command's mana
            // restriction). Mirrors `castChosenSpell`'s payment model: build
            // the cost at each candidate X, fold X into the generic cost
            // (honoring xFactor) and apply cost modifiers, then ask the SAME
            // auto-tap solver used at cast whether it is payable from THEIR
            // battlefield + floating pool. Walk X upward until the first
            // unpayable value; the previous X is the cap. A loose upper bound of
            // total available mana guarantees termination (each extra X adds ≥1
            // to the generic cost). Returns 0 when even X=0 is unpayable — the
            // caller treats that as "not played" ("if able").
            const owner = getPlayer(state, controllerId);
            const def = getHandCardDef(state, controllerId, cardInstanceId);
            if (!def) return 0;
            const handCard = owner.hand.find((c) => c.id === cardInstanceId);
            if (!handCard) return 0;
            const subs = getManaSubstitutions(state, controllerId);
            const sources = buildAutoTapSources(owner.battlefield);
            // Upper bound: floating pool + every land's max output. X can't
            // exceed this (the generic portion alone would exhaust the mana).
            const poolTotal = MANA_COLORS.reduce(
                (acc, c) => acc + (owner.manaPool[c] ?? 0),
                0
            );
            const sourceTotal = sources.reduce((acc, s) => {
                // Max mana this source can contribute across its options.
                const maxOut = s.options.reduce((m, opt) => {
                    const out = MANA_COLORS.reduce(
                        (sum, c) => sum + (opt.mana[c] ?? 0),
                        0
                    );
                    return Math.max(m, out);
                }, 0);
                return acc + Math.max(1, maxOut);
            }, 0);
            const cap = poolTotal + sourceTotal;
            let best = -1;
            for (let x = 0; x <= cap; x++) {
                const cost = normalizeManaCost(def.manaCost ?? {}, {
                    chosenX: x,
                });
                applyCostModifiers(
                    cost,
                    getCostModifiers(state, handCard, "spell")
                );
                const plan = solveSmartAutoTap(
                    owner.manaPool,
                    cost,
                    subs,
                    sources
                );
                if (plan === null) break;
                best = x;
            }
            return best < 0 ? 0 : best;
        },
        getLegalTargetsForCard(casterId, cardInstanceId, requirement) {
            // ADR 0037 / CR 601.2c — enumerate the legal targets for the chosen
            // card cast under `casterId`'s control (Word of Command's spell
            // branch). Reuses `getLegalTargets` exactly as a normal cast does
            // (moves.ts) so the candidate set is identical: "any target",
            // opponent-relative restrictions, color/type/power filters all come
            // out the same. The relationship filters ("opponent", "you") are
            // resolved against `casterId` — the controlled opponent, whose spell
            // it is — so an "any target" spell (Lightning Bolt) places no
            // restriction and the Acting Player may aim it at the opponent
            // (the controlled player) themselves.
            const owner = getPlayer(state, casterId);
            const handCard = owner.hand.find((c) => c.id === cardInstanceId);
            const cardId = handCard
                ? (handCard.card as { id?: string }).id
                : undefined;
            const def = cardId ? tryGetDefinition(cardId) : undefined;
            const sourceColors = getColorsFromCost(def?.manaCost);
            return getLegalTargets(
                state,
                requirement,
                sourceColors,
                casterId,
                undefined,
                def?.types ?? [],
                def?.subtypes ?? [],
                // The chosen card is being cast as a spell (CR 601), not an
                // activated ability — mirror moves.ts.
                true
            );
        },
        castChosenSpell(
            controllerId,
            cardInstanceId,
            actingPlayerId,
            opts
        ): boolean {
            // ADR 0037 / CR 601 — Word of Command's spell branch. The chosen
            // card is the controlled opponent's spell (controllerId =
            // opponent), but the Word of Command controller (actingPlayerId)
            // makes its decisions — its targets (CR 601.2c), the value of X
            // (CR 107.3), the chosen mode (CR 700.2c), and any additional
            // sacrifice cost (CR 117.9) — all decided by the caller and passed
            // in via `opts`. Resources are consumed from the CONTROLLED
            // OPPONENT (controllerId): mana from their lands, the sacrifice
            // from their battlefield.
            const targets = opts?.targets;
            const chosenX = opts?.chosenX;
            const chosenModeId = opts?.chosenModeId;
            const additionalSacrificeId = opts?.additionalSacrificeId;

            const owner = getPlayer(state, controllerId);
            const handCard = owner.hand.find((c) => c.id === cardInstanceId);
            if (!handCard) return false; // not in hand — no-op (CR 608.2b)

            const cardId = (handCard.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : undefined;
            if (!def) return false;

            // CR 117.9 — additional sacrifice cost. The picked permanent must
            // be on the CONTROLLED OPPONENT's battlefield and match the card's
            // sacrifice filter; an absent/illegal pick when the card REQUIRES a
            // sacrifice means the cost is unmeetable → not played ("if able").
            const sacrificeFilter = def.additionalCosts?.sacrificeFilter;
            let sacrificed: CardInstanceState | undefined;
            if (sacrificeFilter) {
                sacrificed = owner.battlefield.find(
                    (c) => c.id === additionalSacrificeId
                );
                if (
                    !sacrificed ||
                    !matchesPermanentFilter(
                        // CR 202.2 — populate effective colors so color-scoped
                        // sacrifice filters match (mirrors getBattlefieldIds).
                        {
                            ...sacrificed,
                            colors: STATIC_EFFECT_CTX.getColors(sacrificed),
                        },
                        sacrificeFilter
                    )
                ) {
                    return false; // unmeetable additional cost — not played
                }
            }

            // CR 107.3 — fold the chosen X into the generic cost (xFactor
            // honored). CR 601.2f — apply cost modifiers, mirroring a normal
            // cast (announceCast). Pay the mana ONLY from lands the controlled
            // player controls (the oracle's mana restriction): auto-tap over
            // THEIR battlefield and THEIR floating pool; unpayable from those
            // sources => the card is not played ("if able", CR 117.3 / 608.2).
            const cost = normalizeManaCost(def.manaCost ?? {}, { chosenX });
            applyCostModifiers(
                cost,
                getCostModifiers(state, handCard, "spell")
            );
            const subs = getManaSubstitutions(state, controllerId);
            const sources = buildAutoTapSources(owner.battlefield);
            const plan = solveSmartAutoTap(owner.manaPool, cost, subs, sources);
            if (plan === null) return false; // unpayable — not played

            // Execute the plan against the controlled player's own pool: tap
            // the chosen lands and add their mana (CR 605.1a). `manaFromPlan`
            // totals the planned output so the pool covers the cost.
            const tappedIds = new Set(plan.map((step) => step.cardId));
            for (const src of owner.battlefield) {
                if (tappedIds.has(src.id)) src.isTapped = true;
            }
            const produced = manaFromPlan(sources, plan);
            for (const color of MANA_COLORS) {
                const v = produced[color];
                if (v) {
                    owner.manaPool[color] = (owner.manaPool[color] ?? 0) + v;
                }
            }
            // CR 601.2g — pay the cost from the controlled player's pool only.
            if (Object.keys(cost).length > 0) {
                payManaCostForSpell(owner, cost, def.types, subs);
                commitLandsForCost(owner, cost);
            }

            // CR 117.9 — pay the additional sacrifice from the opponent's
            // battlefield, snapshotting its pre-sacrifice mana value for the
            // stack item so `getAdditionalSacrificeMv()` reads it at resolve
            // (mirrors the normal-cast snapshot in tryCommitCast).
            let additionalSacrificeSnapshot:
                | StackItem["additionalSacrificeSnapshot"]
                | undefined;
            if (sacrificed) {
                const sacCardId = (sacrificed.card as { id?: string }).id;
                const sacDef = sacCardId
                    ? tryGetDefinition(sacCardId)
                    : undefined;
                const mv = sacDef?.manaCost
                    ? Object.entries(sacDef.manaCost).reduce<number>(
                          (acc, [, v]) => acc + (typeof v === "number" ? v : 0),
                          0
                      )
                    : 0;
                additionalSacrificeSnapshot = {
                    cardInstanceId: sacrificed.id,
                    mv,
                };
                removePermanentTo(
                    state,
                    sacrificed.id,
                    "graveyard",
                    "sacrifice"
                );
            }

            // Move hand -> stack as a real spell controlled by the opponent,
            // with the acting-player override so any choice during the cast /
            // resolution routes to the Word of Command controller (ADR 0037).
            const card = removeFromZone(owner, cardInstanceId, "hand");
            const stackItem: StackItem = {
                ...card,
                zone: "stack",
                castById: controllerId,
                actingPlayerId,
            };
            // CR 601.2c — the targets chosen by the Acting Player ride onto the
            // stack item so the spell resolves against them, exactly like a
            // normal cast (the resolve step reads `ctx.targets`). Omitted for a
            // non-targeted spell (`targets` undefined) so the field stays clean.
            if (targets && targets.length > 0) stackItem.targets = targets;
            // CR 107.3 / 700.2c / 117.9 — the X / mode / sacrifice-snapshot
            // chosen by the Acting Player ride onto the stack item so the
            // resolve reads them back via getX / chosenModeId dispatch /
            // getAdditionalSacrificeMv. Omitted when absent so the item stays
            // clean (matches the normal-cast stack item shape).
            if (chosenX !== undefined) stackItem.chosenX = chosenX;
            if (chosenModeId) stackItem.chosenModeId = chosenModeId;
            if (additionalSacrificeSnapshot) {
                stackItem.additionalSacrificeSnapshot =
                    additionalSacrificeSnapshot;
            }
            // Insert directly below the resolving item (Word of Command) so it
            // becomes the new top after the pop and resolves next (CR 608.2f),
            // mirroring `castFaceDown` / `copyStackItem`.
            const idx = state.stack.findIndex((s) => s.id === item.id);
            if (idx === -1) state.stack.push(stackItem);
            else state.stack.splice(idx, 0, stackItem);
            // CR 601.2i — the spell is cast: make it a public object and let
            // cast triggers fire.
            emitSpellCastEvent(state, stackItem);
            return true;
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

/** CR 108.1 — resolve the CardDefinition of an instance in `playerId`'s hand
 *  via the registry, or undefined if it isn't in their hand / has no known id.
 *  Shared by the controlled-cast getters (Word of Command, ADR 0037) that
 *  inspect a chosen card's modes / X cost / additional costs before casting. */
function getHandCardDef(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): CardDefinition | undefined {
    const owner = getPlayer(state, playerId);
    const handCard = owner.hand.find((c) => c.id === cardInstanceId);
    const cardId = handCard ? (handCard.card as { id?: string }).id : undefined;
    return (cardId ? tryGetDefinition(cardId) : undefined) ?? undefined;
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

/** `moveCard`, but consults the CR 614 graveyard-bound replacement layer
 *  (issue #1145) first when `to === "graveyard"` — the general zone-change
 *  primitives (`SpellContext.moveZone`/`moveCardById`) are a chokepoint many
 *  card effects route a "put into graveyard" through (self-mill, forced
 *  discard-alikes, library manipulation), so a matching replacement
 *  (Yawgmoth's Will / Dauthi Voidwalker) can redirect the move to exile
 *  before it lands. Falls straight through to `moveCard` for any other
 *  destination. */
function moveCardWithGraveyardReplacement(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    from: Exclude<Zone, "stack">,
    to: Exclude<Zone, "stack">
): CardInstanceState {
    if (to !== "graveyard") return moveCard(player, cardInstanceId, from, to);
    const sourceCard = (
        player[ZONE_TO_FIELD[from]] as CardInstanceState[]
    ).find((c) => c.id === cardInstanceId);
    const ownerId = sourceCard?.ownerId ?? player.id;
    const { destination, tagCounters } = graveyardDestinationFor(
        state,
        cardInstanceId,
        ownerId,
        from as Exclude<Zone, "graveyard">
    );
    const moved = moveCard(player, cardInstanceId, from, destination);
    if (destination !== "graveyard") {
        applyGraveyardRedirectCounters(moved, tagCounters);
    }
    return moved;
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
    // CR 601.3e — Ice Cauldron's cast-from-exile permission is consumed once the
    // card leaves exile for the stack; clear the stale flag and its expiry marker.
    delete card.castableFromExileBy;
    delete card.castableFromExileUntilTurn;
    // CR 702.35d — a madness card cast from exile leaves the madness marker
    // behind (it is no longer a discarded-and-exiled card once it is on the
    // stack); clear it so a later bounce/exile never re-reads it.
    delete card.madnessExiled;
    return card;
}

// Loose structural mana-cost shape used by the mana-payment helpers below. The
// value union includes the `phyrexian` object (CR 107.4f, ADR: Phyrexian mana)
// so a real `CardManaCost` carrying `phyrexian?: Partial<Record<Color, number>>`
// is assignable here; the payment helpers ignore that key (Phyrexian pips are
// resolved to mana/life before payment — see `convex/gre/phyrexian.ts`).
type ManaCost = Record<
    string,
    number | string | Partial<Record<Color, number>> | undefined
>;

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
 *  pay a second activation this turn. Routes through `discardToGraveyard` so it
 *  honors CR 614 discard replacements (Library of Leng) and emits CARD_DISCARDED
 *  (CR 701.8) like every other discard path (Necropotence). */
export function payDiscardLastDrawn(
    state: GameState,
    player: PlayerState
): void {
    const id = player.lastDrawnCardId;
    if (!id || !player.hand.some((c) => c.id === id)) {
        throw new Error("No card drawn this turn left to discard");
    }
    discardToGraveyard(state, player.id, id);
    player.lastDrawnCardId = undefined;
}

/** Single choke point for discarding one card hand → graveyard (CR 701.8).
 *  Runs the CR 614 discard replacement layer (Library of Leng) first; if a
 *  replacement consumed the event, the card was routed elsewhere and this
 *  returns false WITHOUT emitting CARD_DISCARDED (the card was not discarded to
 *  a graveyard). Otherwise it moves the card to the graveyard and emits
 *  CARD_DISCARDED so "whenever you discard a card" triggers (Necropotence) fire
 *  off EVERY discard path. Knowledge clearing (ADR 0026) stays at the call
 *  sites because the conservative scope differs per path (owner-chosen vs
 *  random vs cleanup). No-op (returns false) if the card is no longer in hand. */
export function discardToGraveyard(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): boolean {
    const player = getPlayer(state, playerId);
    const handCard = player.hand.find((c) => c.id === cardInstanceId);
    if (!handCard) return false;
    // CR 614 — discard replacements (Library of Leng) intercept here.
    const repl = applyDiscardReplacements(state, {
        kind: "discard",
        playerId,
        cardInstanceId,
    });
    if (repl === null) return false; // replacement routed the card elsewhere
    // CR 614 (issue #1145) — the card HAS been discarded (CARD_DISCARDED still
    // fires below), but a graveyard-bound replacement (Yawgmoth's Will /
    // Dauthi Voidwalker) can redirect where it actually lands.
    const redirect = graveyardDestinationFor(
        state,
        repl.cardInstanceId,
        handCard.ownerId,
        "hand"
    );
    let destination = redirect.destination;
    const tagCounters = redirect.tagCounters;
    // CR 702.35c — Madness's replacement: a discarded card with a madness cost
    // is exiled instead of being put into the graveyard, then a reflexive
    // triggered ability (built by `collectTriggers` off the CARD_DISCARDED event
    // emitted below) goes on the stack, giving its owner one window to cast it
    // for the madness cost when it resolves (CR 702.35d — `openMadnessCastWindow`
    // / `declineMadness`). Applies only when the discard was otherwise headed to
    // the graveyard (a Yawgmoth's-Will exile redirect already sent it to exile,
    // so madness is moot there).
    const madnessCost = getMadnessCost(handCard);
    const madnessRoute =
        madnessCost !== undefined && destination === "graveyard";
    if (madnessRoute) destination = "exile";
    const moved = moveCard(player, repl.cardInstanceId, "hand", destination);
    if (madnessRoute) {
        markMadnessExiled(moved);
    } else if (destination !== "graveyard") {
        applyGraveyardRedirectCounters(moved, tagCounters);
    }
    const cardId = (moved.card as { id?: string }).id;
    emitCardDiscarded(state, playerId, repl.cardInstanceId, cardId);
    return true;
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
            const def = cardId ? tryGetDefinition(cardId) : undefined;
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
        // intercepts each discard inside discardToGraveyard; on a real discard
        // it emits CARD_DISCARDED (CR 701.8 — Necropotence).
        discardToGraveyard(state, playerId, cardId);
    }
    // ADR 0026 (revised): a random discard does NOT clear knowledge of the
    // remaining hand. Each discarded card is revealed into the public graveyard
    // and knowledge is per-instance, so the cards left behind stay identifiable
    // to any prior knower — no uncertainty is introduced. Only shuffle / hidden
    // return to library revokes hand knowledge.
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

/** Per-colour delta between a mana pool snapshot taken BEFORE a payment and the
 *  pool AFTER it (CR 106.10 — noted-mana battery). Returns only the colours that
 *  decreased, mapped to the amount spent. Used to capture the TYPE and amount of
 *  mana spent to pay an activation cost (Jeweled Amulet, Ice Cauldron). Empty
 *  when nothing was spent. */
export function manaSpentDelta(
    before: Record<string, number>,
    after: Record<string, number>
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const color of MANA_COLORS) {
        const spent = (before[color] ?? 0) - (after[color] ?? 0);
        if (spent > 0) out[color] = spent;
    }
    return out;
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
        case "cumulative-upkeep":
            // CR 702.24 / ADR 0042 — cumulative-upkeep mana is never spendable
            // on a spell; it is eligible only for the CU `may-pay` payment.
            return false;
    }
}

/** True if a single restricted-mana unit may pay for a spell (CR 106.6).
 *  Bridges the two restriction shapes:
 *   - instance-keyed (`castableCardId`, Ice Cauldron) — eligible only when the
 *     spell being cast is that exact instance (`spellCardId` must match);
 *   - type-keyed (`restriction`) — delegates to `restrictionAllowsSpell`.
 *  A unit with neither field is unrestricted and always eligible (defensive;
 *  the engine never produces such a unit). `spellCardId` is the instance id of
 *  the card being cast — undefined at sites that don't track it (then
 *  instance-keyed mana is treated as ineligible). */
export function restrictedUnitAllowsSpell(
    unit: RestrictedMana,
    spellTypes: readonly string[],
    spellCardId?: string
): boolean {
    if (unit.castableCardId !== undefined) {
        return spellCardId !== undefined && unit.castableCardId === spellCardId;
    }
    if (unit.restriction !== undefined) {
        return restrictionAllowsSpell(unit.restriction, spellTypes);
    }
    return true;
}

/** Adds `amount` restricted mana of `color` to a player's pool, merging into
 *  an existing entry of the same color + restriction (CR 106.4 — mana of the
 *  same kind is fungible). When `castableCardId` is supplied (Ice Cauldron) the
 *  unit is instance-keyed instead of type-keyed; merge is gated on the same
 *  `castableCardId` so two activations against different exiled cards stay
 *  distinct. */
export function addRestrictedManaToPool(
    player: PlayerState,
    color: string,
    amount: number,
    restriction: ManaRestriction | undefined,
    castableCardId?: string
): void {
    if (amount <= 0) return;
    const list = player.restrictedMana ?? [];
    const existing = list.find(
        (r) =>
            r.color === color &&
            r.restriction === restriction &&
            r.castableCardId === castableCardId
    );
    if (existing) existing.amount += amount;
    else {
        const unit: RestrictedMana = { color, amount };
        if (restriction !== undefined) unit.restriction = restriction;
        if (castableCardId !== undefined) unit.castableCardId = castableCardId;
        list.push(unit);
    }
    player.restrictedMana = list;
}

/** Builds the spendable pool for casting a spell: the base `manaPool` plus any
 *  restricted mana whose restriction permits this spell (CR 106.6). Used for
 *  the affordability check at spell-cast sites — callers pass whether the
 *  spell being cast is a creature spell. */
export function spendablePoolForSpell(
    player: PlayerState,
    spellTypes: readonly string[],
    spellCardId?: string
): Record<string, number> {
    const pool = { ...player.manaPool };
    for (const r of player.restrictedMana ?? []) {
        if (restrictedUnitAllowsSpell(r, spellTypes, spellCardId)) {
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
    substitutions: ManaSubstitution[] = [],
    spellCardId?: string
): void {
    const eligible = (player.restrictedMana ?? []).filter((r) =>
        restrictedUnitAllowsSpell(r, spellTypes, spellCardId)
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
                // CR 603.3 — mana now spent on a spell: the tap is committed
                // via `manaCommitted`, so drop the tap-trigger irreversibility
                // flag (its job is done; both block untap).
                card.tapTriggerCommitted = undefined;
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
                    // CR 603.3 — see colored-cost loop above; mana spent,
                    // clear the tap-trigger irreversibility flag.
                    card.tapTriggerCommitted = undefined;
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
    // CR 107.3 — a `{X}{X}` cost adds the chosen X `xFactor` times (Recall:
    // `{X}{X}{U}` → twice). Defaults to 1 for a single `{X}`.
    const xFactor =
        typeof cost.xFactor === "number" && cost.xFactor > 0 ? cost.xFactor : 1;
    for (const [key, val] of Object.entries(cost)) {
        if (key === "xFactor") continue;
        // CR 107.3 — fixed generic that coexists with a variable `{X}` pip
        // (Soul Burn `{X}{2}{B}`). Folded into the generic total, never a key
        // of its own in the normalized record.
        if (key === "generic") {
            extraGeneric += typeof val === "number" ? val : 0;
            continue;
        }
        if (key === "X" && typeof val === "string") {
            extraGeneric += (opts.chosenX ?? 0) * xFactor;
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
            const def = cardId ? tryGetDefinition(cardId) : null;
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

/** One resolved static NON-mana additional-cost requirement (CR 601.2f / 118.5,
 *  Drought): `count` permanents matching `filter` must be sacrificed by the
 *  announcing player. */
export interface StaticAdditionalSacrifice {
    filter: PermanentFilter;
    count: number;
}

/** Count of `color` mana SYMBOLS in a printed mana cost — colored pips only.
 *  Generic (`X`) never counts (Drought: "for each black mana symbol"). */
function countColorSymbols(cost: ManaCost | undefined, color: Color): number {
    if (!cost) return 0;
    const v = (cost as Record<string, number | string | undefined>)[color];
    return typeof v === "number" ? v : 0;
}

/** Scan the battlefield for `additional-cost` static effects that apply to the
 *  announced spell/ability and return the per-effect sacrifice requirements
 *  (CR 601.2f / 118.5, Drought). `rawManaCost` is the object's PRINTED mana
 *  cost; each `perPipColor` symbol in it multiplies that effect's required
 *  sacrifice count. Multiple applying effects (e.g. two Droughts) each
 *  contribute their own requirement. */
export function getStaticAdditionalSacrifices(
    state: GameState,
    rawManaCost: ManaCost | undefined,
    announced: PermanentView,
    kind: "spell" | "ability"
): StaticAdditionalSacrifice[] {
    const out: StaticAdditionalSacrifice[] = [];
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const cardId = (source.card as { id?: string }).id;
            const def = cardId ? tryGetDefinition(cardId) : null;
            const effects = getEffectiveStaticEffects(def, source.chosenModeId);
            for (const effect of effects) {
                if (effect.kind !== "additional-cost") continue;
                const pred =
                    kind === "spell"
                        ? effect.appliesToSpell
                        : effect.appliesToAbility;
                if (!pred || !pred(announced, STATIC_EFFECT_CTX, source)) {
                    continue;
                }
                const count = countColorSymbols(
                    rawManaCost,
                    effect.perPipColor
                );
                if (count > 0) {
                    out.push({ filter: effect.sacrificeFilter, count });
                }
            }
        }
    }
    return out;
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
            const def = cardId ? tryGetDefinition(cardId) : null;
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

// ─── May-pay cost union (CR 117.3a / 118.4 / 702.24, ADR 0042) ──────────────

/** Widened `may-pay` cost: the `{ mana?, life?, sacrifice? }` shape. */
export interface NormalizedMayPayCost {
    mana?: CardManaCost;
    life?: number;
    /** Typed sacrifice leg (CR 701.16). `count` is either a fixed cardinal
     *  ("sacrifice N matching permanents") or a summed-power threshold
     *  (`{ minTotalPower }` — "sacrifice any number of matching permanents with
     *  total EFFECTIVE power ≥ N", Phyrexian Dreadnought, CR 118). */
    sacrifice?: {
        filter: PermanentFilter;
        count: number | { minTotalPower: number };
    };
    /** Discard leg (CR 701.9 / 118.3, issue #899). Fixed cardinal only — the
     *  payer picks exactly `count` distinct cards from HAND. */
    discard?: {
        count: number;
    };
}

/** Distinguishes the union shape `{ mana?, life?, sacrifice?, discard? }` from
 *  a bare `ManaCost`. The union is the ONLY value carrying a `mana` / `life` /
 *  `sacrifice` / `discard` key; a bare `ManaCost` carries only mana symbol
 *  keys. */
function isMayPayUnion(cost: MayPayCost): cost is {
    mana?: CardManaCost;
    life?: number;
    sacrifice?: {
        filter: PermanentFilter;
        count: number | { minTotalPower: number };
    };
    discard?: {
        count: number;
    };
} {
    return (
        "mana" in cost ||
        "life" in cost ||
        "sacrifice" in cost ||
        "discard" in cost
    );
}

/** Normalizes either `may-pay` cost shape to `{ mana?, life?, sacrifice?,
 *  discard? }`. A bare `ManaCost` (the historical mana-only shape) widens to
 *  `{ mana }` so every legacy caller is unaffected (ADR 0042). */
export function normalizeMayPayCost(cost: MayPayCost): NormalizedMayPayCost {
    if (isMayPayUnion(cost)) {
        return {
            ...(cost.mana ? { mana: cost.mana } : {}),
            ...(cost.life !== undefined ? { life: cost.life } : {}),
            ...(cost.sacrifice ? { sacrifice: cost.sacrifice } : {}),
            ...(cost.discard ? { discard: cost.discard } : {}),
        };
    }
    return { mana: cost as CardManaCost };
}

/** Battlefield permanents controlled by `playerId` matching the sacrifice
 *  filter (CR 701.16). Used to gate affordability and pick the victims. */
function sacrificeCandidates(
    state: GameState,
    playerId: string,
    filter: PermanentFilter
): CardInstanceState[] {
    const player = getPlayer(state, playerId);
    return player.battlefield.filter((c) =>
        matchesPermanentFilter(
            { ...c, colors: STATIC_EFFECT_CTX.getColors(c) },
            filter,
            { selfControllerId: playerId }
        )
    );
}

/** Instance ids of `playerId`'s permanents that could pay a `may-pay` cost's
 *  sacrifice leg (CR 701.16b — the controller chooses which they sacrifice).
 *  Returns `[]` when the cost has no sacrifice leg. Exported so the submit
 *  boundary (`applyMayPaySubmit`) and the bot driver can validate / pick a
 *  legal victim against the SAME candidate set `requestMayPay` computed. */
export function getMayPaySacrificeCandidateIds(
    state: GameState,
    playerId: string,
    cost: MayPayCost
): string[] {
    const norm = normalizeMayPayCost(cost);
    if (!norm.sacrifice) return [];
    return sacrificeCandidates(state, playerId, norm.sacrifice.filter).map(
        (c) => c.id
    );
}

/** The summed-power threshold of a `may-pay` sacrifice leg (`{ minTotalPower }`
 *  mode), or `undefined` when the leg uses a fixed cardinal `count` (or has no
 *  sacrifice leg). Threshold mode means "sacrifice any number of matching
 *  permanents with total EFFECTIVE power ≥ N" (Phyrexian Dreadnought, CR 118). */
export function mayPaySacrificeThreshold(cost: MayPayCost): number | undefined {
    const count = normalizeMayPayCost(cost).sacrifice?.count;
    return typeof count === "object" ? count.minTotalPower : undefined;
}

/** Summed EFFECTIVE power (CR 613 layer pipeline) of the given permanents. The
 *  literal "total power" of CR 118 — a chosen set's contribution toward a
 *  `minTotalPower` threshold. */
export function sumEffectivePower(
    state: GameState,
    permanents: CardInstanceState[]
): number {
    let total = 0;
    for (const c of permanents) total += getEffectivePower(state, c);
    return total;
}

/** Summed EFFECTIVE power of the payer's battlefield permanents named by `ids`
 *  (CR 118 threshold validation). Ids not currently on the payer's battlefield
 *  contribute nothing. Used by the submit boundary to verify a threshold-mode
 *  sacrifice pick reaches its `minTotalPower`. */
export function mayPaySacrificeSetPower(
    state: GameState,
    playerId: string,
    ids: string[]
): number {
    const player = getPlayer(state, playerId);
    const set = new Set(ids);
    return sumEffectivePower(
        state,
        player.battlefield.filter((c) => set.has(c.id))
    );
}

/** Whether a `may-pay` sacrifice leg admits a real victim choice (CR 701.16b):
 *  the payer controls MORE matching permanents than the leg sacrifices, so
 *  which one(s) to sacrifice is the payer's decision, not an auto-pick. When
 *  the filter matches exactly `count` (or fewer) permanents there is nothing to
 *  choose — auto-selection stays and no prompt is shown (Arena UX auto-resolve).
 *  Threshold mode (`{ minTotalPower }`, Phyrexian Dreadnought) ALWAYS admits a
 *  choice when any candidate exists — the payer picks a variable-size set, so
 *  there is never a trivial auto-pick. Returns false for a cost with no
 *  sacrifice leg. */
export function mayPaySacrificeChoiceRequired(
    state: GameState,
    playerId: string,
    cost: MayPayCost
): boolean {
    const norm = normalizeMayPayCost(cost);
    if (!norm.sacrifice) return false;
    const candidateCount = getMayPaySacrificeCandidateIds(
        state,
        playerId,
        cost
    ).length;
    if (typeof norm.sacrifice.count === "object") {
        // Threshold mode: any candidate at all makes the variable-size victim
        // set the payer's decision (CR 118 / 701.16b).
        return candidateCount > 0;
    }
    return candidateCount > norm.sacrifice.count;
}

/** Instance ids of `playerId`'s hand cards that could pay a `may-pay` cost's
 *  discard leg (CR 701.9 / 118.3 — the discarder chooses which they discard).
 *  Returns `[]` when the cost has no discard leg. Exported so the submit
 *  boundary (`applyMayPaySubmit`) and the bot driver can validate / pick a
 *  legal card against the SAME candidate set `requestMayPay` computed. Mirrors
 *  {@link getMayPaySacrificeCandidateIds}, but from hand instead of the
 *  battlefield — no type filter (every printed discard leg is untyped). */
export function getMayPayDiscardCandidateIds(
    state: GameState,
    playerId: string,
    cost: MayPayCost
): string[] {
    const norm = normalizeMayPayCost(cost);
    if (!norm.discard) return [];
    const player = getPlayer(state, playerId);
    return player.hand.map((c) => c.id);
}

/** Whether a `may-pay` discard leg admits a real card choice (CR 701.9 /
 *  118.3): the payer holds MORE cards than the leg discards, so which one(s)
 *  to discard is the payer's decision, not an auto-pick. When the hand has
 *  exactly `count` (or fewer) cards there is nothing to choose — auto-
 *  selection stays and no prompt is shown (Arena UX auto-resolve). Returns
 *  false for a cost with no discard leg. Mirrors
 *  {@link mayPaySacrificeChoiceRequired}. */
export function mayPayDiscardChoiceRequired(
    state: GameState,
    playerId: string,
    cost: MayPayCost
): boolean {
    const norm = normalizeMayPayCost(cost);
    if (!norm.discard) return false;
    const candidateCount = getMayPayDiscardCandidateIds(
        state,
        playerId,
        cost
    ).length;
    return candidateCount > norm.discard.count;
}

/** Pool a `may-pay` payment may draw on: the fungible `manaPool` plus any
 *  restricted mana whose restriction equals `restriction` (CR 106.6, ADR 0022 /
 *  0042). Returns a plain `manaPool` copy when no restriction is given (the
 *  historical mana-only path). Used by the cumulative-upkeep `may-pay`, which
 *  passes `"cumulative-upkeep"` so Adarkar Unicorn / Snowfall mana counts. */
function spendablePoolForRestriction(
    player: PlayerState,
    restriction?: ManaRestriction
): Record<string, number> {
    const pool = { ...player.manaPool };
    if (!restriction) return pool;
    for (const r of player.restrictedMana ?? []) {
        if (r.restriction === restriction) {
            pool[r.color] = (pool[r.color] ?? 0) + r.amount;
        }
    }
    return pool;
}

/** Pays a `may-pay` mana leg drawing on eligible restricted mana FIRST, then
 *  the fungible pool (CR 106.6, settlement policy from ADR 0022). Mirrors
 *  `payManaCostForSpell` but keys eligibility on a `ManaRestriction` value
 *  rather than spell types. Caller MUST have confirmed coverage against the
 *  merged pool. */
function payManaCostForRestriction(
    player: PlayerState,
    cost: Record<string, number>,
    restriction: ManaRestriction | undefined,
    substitutions: ManaSubstitution[]
): void {
    const eligible = (player.restrictedMana ?? []).filter(
        (r) => restriction !== undefined && r.restriction === restriction
    );
    if (eligible.length === 0) {
        payManaCost(player.manaPool, cost, substitutions);
        return;
    }
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
    const remaining = (player.restrictedMana ?? []).filter((r) => r.amount > 0);
    player.restrictedMana = remaining.length > 0 ? remaining : undefined;
}

/** True if `playerId` can pay the whole `may-pay` cost union right now —
 *  mana pool covers the mana leg, life ≥ the life leg, and enough matching
 *  permanents exist for the sacrifice leg (CR 702.24c — all-or-nothing). A
 *  cost with no legs present is trivially payable. When `manaRestriction` is
 *  given (the cumulative-upkeep `may-pay`, ADR 0042), the mana leg may also be
 *  covered by restricted mana carrying that restriction. */
export function canPayMayPayCost(
    state: GameState,
    playerId: string,
    cost: MayPayCost,
    manaRestriction?: ManaRestriction
): boolean {
    const norm = normalizeMayPayCost(cost);
    const player = getPlayer(state, playerId);
    if (norm.mana) {
        const normalized = normalizeManaCost(norm.mana);
        const subs = getManaSubstitutions(state, playerId);
        const pool = spendablePoolForRestriction(player, manaRestriction);
        if (!isManaCostCovered(pool, normalized, subs)) return false;
    }
    if (norm.life !== undefined && player.life < norm.life) return false;
    if (norm.sacrifice) {
        const candidates = sacrificeCandidates(
            state,
            playerId,
            norm.sacrifice.filter
        );
        if (typeof norm.sacrifice.count === "object") {
            // CR 118 / 701.16 threshold mode — affordable iff the best-case set
            // (every matching candidate with EFFECTIVE power > 0; a 0-or-less
            // creature can never help reach the threshold) sums to ≥ the
            // required total power.
            const best = candidates.filter(
                (c) => getEffectivePower(state, c) > 0
            );
            if (
                sumEffectivePower(state, best) <
                norm.sacrifice.count.minTotalPower
            ) {
                return false;
            }
        } else if (candidates.length < norm.sacrifice.count) {
            return false;
        }
    }
    if (norm.discard && player.hand.length < norm.discard.count) {
        return false;
    }
    return true;
}

/** Pays the whole `may-pay` cost union from `playerId`'s resources (CR 117.3a /
 *  118.4 / 701.16 / 701.9). Caller MUST have already confirmed affordability
 *  with `canPayMayPayCost` (the mana leg asserts coverage; the life, sacrifice
 *  and discard legs are applied unconditionally). Mana is taken from the pool
 *  (lands must already be tapped, as for any `may-pay`); life is lost through
 *  the replacement chain; the sacrifice leg sacrifices the permanents the
 *  payer CHOSE (CR 701.16b — the controller picks which of their matching
 *  permanents are sacrificed); the discard leg discards the hand cards the
 *  payer CHOSE (CR 701.9, issue #899 — mirrors the sacrifice leg's picker).
 *  `sacrificeIds` / `discardIds`, validated at the submit boundary, name the
 *  victims/cards; when absent (only one legal candidate, `count` covers all,
 *  or a bot's minimal-legal default) the first `count` matching
 *  permanents/cards are auto-selected in author/hand order — CR 701.16b /
 *  701.9 is satisfied trivially when there is nothing to choose. */
export function payMayPayCost(
    state: GameState,
    playerId: string,
    cost: MayPayCost,
    manaRestriction?: ManaRestriction,
    sacrificeIds?: string[],
    discardIds?: string[]
): void {
    const norm = normalizeMayPayCost(cost);
    const player = getPlayer(state, playerId);
    if (norm.mana) {
        const normalized = normalizeManaCost(norm.mana);
        const subs = getManaSubstitutions(state, playerId);
        const pool = spendablePoolForRestriction(player, manaRestriction);
        if (!isManaCostCovered(pool, normalized, subs)) {
            throw new Error("Cannot pay the mana cost from your mana pool");
        }
        payManaCostForRestriction(player, normalized, manaRestriction, subs);
        commitLandsForCost(player, normalized);
    }
    if (norm.life !== undefined && norm.life > 0) {
        // CR 118.4 — paying life is losing life. Routes through the shared
        // choke point so it runs the CR 614 lifeloss replacement chain (Lich)
        // AND emits LIFE_LOST (CR 119.3) like every other life-loss path
        // (Oath of Lim-Dûl).
        loseLifeEmitting(state, playerId, norm.life);
    }
    if (norm.sacrifice) {
        // CR 701.16b — the payer chooses which of their matching permanents to
        // sacrifice. Honour the caller-supplied `sacrificeIds` (validated at the
        // submit boundary) when present; otherwise fall back to author order.
        const candidates = sacrificeCandidates(
            state,
            playerId,
            norm.sacrifice.filter
        );
        let victims: CardInstanceState[];
        if (typeof norm.sacrifice.count === "object") {
            // CR 118 / 701.16 threshold mode ("sacrifice any number … total
            // power ≥ N"). When the payer named a set, sacrifice ALL of it (the
            // whole caller-supplied `sacrificeIds`, already validated at the
            // submit boundary to meet the threshold — over-payment is legal).
            // When absent (a bot's minimal-legal default), greedily take the
            // highest-EFFECTIVE-power candidates first until the running total
            // reaches the threshold — the smallest-bodied legal set.
            const threshold = norm.sacrifice.count.minTotalPower;
            if (sacrificeIds && sacrificeIds.length > 0) {
                victims = candidates.filter((c) => sacrificeIds.includes(c.id));
            } else {
                const greedy = [...candidates].sort(
                    (a, b) =>
                        getEffectivePower(state, b) -
                        getEffectivePower(state, a)
                );
                victims = [];
                let running = 0;
                for (const c of greedy) {
                    if (running >= threshold) break;
                    victims.push(c);
                    running += getEffectivePower(state, c);
                }
            }
        } else {
            // Fixed cardinal — the payer chose `count` victims (or author order
            // when there was nothing to choose).
            const chosen =
                sacrificeIds && sacrificeIds.length > 0
                    ? candidates.filter((c) => sacrificeIds.includes(c.id))
                    : candidates;
            victims = chosen.slice(0, norm.sacrifice.count);
        }
        for (const v of victims) {
            removePermanentTo(state, v.id, "graveyard", "sacrifice");
        }
    }
    if (norm.discard) {
        // CR 701.9 / 118.3 — the payer chooses which of their hand cards to
        // discard. Honour the caller-supplied `discardIds` (validated at the
        // submit boundary) when present; otherwise fall back to hand order.
        // Routed through `discardToGraveyard` so CR 614 discard replacements
        // (Library of Leng) and CARD_DISCARDED triggers (Necropotence-style)
        // apply exactly as for any other discard.
        const candidates = player.hand;
        const chosen =
            discardIds && discardIds.length > 0
                ? candidates.filter((c) => discardIds.includes(c.id))
                : candidates;
        const toDiscard = chosen.slice(0, norm.discard.count);
        for (const c of toDiscard) {
            discardToGraveyard(state, playerId, c.id);
        }
    }
}
