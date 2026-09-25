/**
 * The engine's state declarations — `GameState`, `CardInstanceState`,
 * `PlayerState`, `StackItem`, the `Pending*` family and the shapes they
 * carry — moved verbatim out of `gre/state.ts` (issue #4449, PRD #4447).
 *
 * TYPE-ONLY: this module declares no runtime value and imports only types, so
 * a module that needs a state shape imports it from here without creating an
 * import cycle through the core. `gre/state.ts` re-exports every declaration,
 * so its importers compile unchanged.
 */
import type { SpellFilter } from "../../cards/filters";
import type { PlayLandFace } from "../../cards/modalDfc";
import type { SplitHalfSide } from "../../cards/splitCard";
import type {
    AsEntersChoice,
    CardSupertype,
    CardType,
    Color,
    ControlChangeCondition,
    CopyEffectOptions,
    CostLegs,
    CostReductionAmount,
    DelayedTriggerTiming,
    EffectCardFilter,
    EffectOp,
    EmblemInstance,
    EnchantRestriction,
    EntryTypeLine,
    FlashbackCost,
    GameEvent,
    LiveGraveyardPlayPermission,
    ManaCost as CardManaCost,
    ManaPersistence,
    ManaSubstitutionBreadth,
    MayPayCost,
    NameRestriction,
    PermanentFilter,
    PermanentView,
    RecipientDamagePreventionShield,
    SourceDamagePreventionShield,
    TargetRequirement,
    TargetSelection,
    TextChange,
} from "../../cards/types";
import type { GrantedAbilityOrigin } from "../activatedAbilities";
import type { ContinuousEffect } from "../continuousEffects";
import type { DeckColorsBySeat } from "../deckKnowledge";
import type { FaceDownProducer } from "../faceDown";
import type { KickerPayments } from "../kicker";
import type { SacrificeSelection } from "../sacrificeChoice";
import type {
    LookDistributeDestination,
    LookDistributeKeepTo,
    ManaRestriction,
    PendingChoiceKind,
    Phase,
    PhaseReturnCondition,
    RandomKind,
    RealizedOutcome,
    Zone,
} from "../types";

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

/** One granted attack requirement (CR 508.1d) — see
 *  `CardInstanceState.grantedAttackRequirements`. */
export type GrantedAttackRequirement = {
    /** Absent = indefinite (CR 611.2a). */
    duration?: Duration;
    /** Layer timestamp of the grant (CR 613.7), allocated at resolution like
     *  every other ability grant from a resolving ability. */
    seq: number;
};

/** Returns the duration after one phase-boundary tick, or null if it has
 *  expired. Non-matching boundaries return the duration unchanged. The
 *  caller is responsible for splicing out expired entries and any side
 *  effects (e.g. removing granted keywords from `staticAbilities`). */
/** The boundary a {@link tickDuration} call represents. */
export type DurationTickView = {
    phase: Phase;
    activePlayerId: string;
    /** CR 514.3a (issue #2472) — true when this TURN's boundary tick has
     *  already been counted and the engine is running the same boundary again
     *  (the "another cleanup step begins" repeat). A `skip` counter is a
     *  per-TURN countdown ("until end of your next turn") expressed as a
     *  BOUNDARY count, so a second tick in one turn ends the effect a full
     *  turn early. When set, `tickDuration` is a no-op.
     *
     *  Scoped to durations only. The turn-scoped GLOBAL flags that
     *  `tickAllDurations` clears alongside them (`TURN_SCOPED_GLOBAL_FLAGS`
     *  in `phases.ts`) are cleared outside `tickDuration`, gated on the
     *  CLEANUP boundary alone, and so DO re-run on the repeat step: an instant
     *  cast in the CR 514.3a priority window cannot arm one and leak it into
     *  the next turn.
     *
     *  Residual, pre-existing and unchanged by this flag: a DURATION created
     *  during that same window misses this turn's tick and ends one turn late.
     *  It already did before the window existed — `finalizeCleanup` has always
     *  run before anything the cleanup step's own priority window creates. */
    boundaryAlreadyCounted?: boolean;
};

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
    /** CR 701.43a/b / 605.1a — set when THIS payment tap's `cost.exertThis`
     *  leg (Arena of Glory) is what exerted the source, i.e. `skipNextUntap`
     *  was not already set. An untap-toggle that reverses the mana-ability
     *  activation before its mana is spent must un-exert exactly what it
     *  exerted and nothing else: CR 701.43b lets a permanent be exerted more
     *  than once before its next untap step, so a source ALREADY exerted by an
     *  earlier effect keeps that earlier exert when this tap is reversed.
     *  The exert-side sibling of `lifePaidThisTap` / `manaPaidThisTap`;
     *  cleared at untap step / on refund, like both. */
    exertedThisTap?: boolean;
    /** CR 601.2h / 605.1a — mana the controller actually spent from their pool
     *  to pay this tap-for-mana's own MANA cost leg (a filter/upgrader rock:
     *  Chromatic Star / Chromatic Sphere / Barbed Sextant / Implements of
     *  Sacrifice "{1}, {T}, Sacrifice this: Add …", Celestial Prism / Mana
     *  Cylix "{N}, {T}: Add one mana of any color", Standing Stones, Fire
     *  Sprites "{G}, {T}: Add {R}"). Snapshotted as the real per-colour pool
     *  delta — the cost may be paid with any combination of colours, and
     *  `getManaSubstitutions` can change which — so an untap-toggle that
     *  reverses the whole activation before the produced mana is spent refunds
     *  exactly what was taken. The cost-side sibling of `lifePaidThisTap`.
     *  Cleared at untap step / on refund, like `chosenMana`. */
    manaPaidThisTap?: CardManaCost;
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
    /** CR 614.12 as-enters NAME choice (issue #1953 — Meddling Mage). Written
     *  by the as-enters `name` choice onto the entering object, so it is
     *  already present the moment the permanent enters and its continuous
     *  effects start applying. Persisted (a `cast-restriction`
     *  static reads it on every later cast attempt, so it must survive the DB
     *  write); the open-ended twin of `chosenModeId`. */
    chosenName?: string;
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
    /** CR 302.6 / 400.7 (issue #1458) — the turn number (`GameState.turn`) on
     *  which this permanent ENTERED the battlefield. Stamped unconditionally
     *  for every permanent by `markEnteredThisTurn` (and directly by
     *  `createTokenPermanents` for tokens); cleared by
     *  `resetBattlefieldTransientState` when the object leaves the
     *  battlefield, because a zone change creates a NEW object.
     *
     *  Deliberately NOT the same thing as `isSummoningSick`, which this
     *  intentionally does not replace:
     *   - `isSummoningSick` is cleared only in the CONTROLLER's untap step, so
     *     it stays true across the whole of the opponent's next turn — correct
     *     for CR 302.6, wrong for "entered this turn".
     *   - `isSummoningSick` is (re)set by `applyControlChange` /
     *     `revertControlChange` on a creature that never changed zones —
     *     gaining control is not entering the battlefield (CR 400.7 / 603.6),
     *     so those sites must NOT touch this field.
     *
     *  Read by `PermanentFilter.enteredThisTurn` (`convex/cards/filters.ts`)
     *  via `enteredOnTurn === state.turn`. Per-card turn stamping has
     *  precedent in `phasedOutTurn`. */
    enteredOnTurn?: number;
    /** CR 702.30a — Echo: true while this permanent still owes its echo cost,
     *  i.e. it came under its controller's control and has not yet had its
     *  first upkeep under that control. Set at ETB for permanents whose
     *  definition declares the `echo` keyword; read by the echo trigger's
     *  CR 603.4 intervening-if so it fires exactly once (on the controller's
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
     *  - `duration` for one-shot until-end-of-turn grants (CR 611.2a), spliced
     *    out by the phase-boundary purge when the duration expires (Touch of
     *    Vitae: "gains '{0}: Untap this creature. Activate only once.'"). */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        /** Which list on `sourceCardId`'s definition holds the template
         *  (issue #2943) — see {@link GrantedAbilityOrigin}. Absent means
         *  `grantTemplates[]`, which is every entry written before #2943 and
         *  every lord-style grant since; `"card-abilities"` names the card's
         *  own `activatedAbilities[]` and is what an ability-COPY grant
         *  (Agatha's Soul Cauldron, CR 607.2a) writes.
         *
         *  A DISCRIMINATOR, not a hint: `resolveGrantedActivatedAbility` reads
         *  exactly one list and never the other, so a template that has gone
         *  missing reads as "no such ability" instead of silently resolving to
         *  a same-named ability in the other list.
         *
         *  Rides the existing `grantedActivatedAbilities` row through
         *  serialization (the whole array is in `PERSISTED_OPTIONAL_KEYS`) and
         *  through the wire projection. The resolved ability object is
         *  deliberately NOT inlined here: this row is persisted and projected
         *  on every permanent, and a fat field on a hot row is a read-cost
         *  regression (`docs/agents/...` — Convex bills a read by the whole
         *  document). */
        origin?: GrantedAbilityOrigin;
        auraId?: string;
        duration?: Duration;
        /** Layer timestamp of the grant (CR 613.7). Read against
         *  `abilitiesSuppressedBy[].seq` so a grant that PREDATES a "loses all
         *  abilities" stripper is removed by it while a later one survives. */
        seq?: number;
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
     *  - `duration` for one-shot until-end-of-turn grants (CR 611.2a), spliced
     *    out by the phase-boundary purge when the duration expires (Rapid Fire:
     *    "that creature gains rampage 2 until end of turn"). */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: Duration;
        /** Layer timestamp of the grant (CR 613.7) — see the same field on
         *  `grantedActivatedAbilities`. */
        seq?: number;
    }[];
    /** CR 613.1f — every `ability-loss` effect currently applying to this
     *  permanent, both arms: the CONTINUOUS one derived from a live source's
     *  static ability (Titania's Song, Blood Moon) and the LEDGER one generated
     *  by a resolving ability (`abilityLossHolds`). While non-empty: native
     *  activated abilities don't resolve, native triggered abilities are
     *  excluded from the trigger scan, and the intrinsic mana ability is
     *  unavailable.
     *
     *  DERIVED OUTPUT, written ONLY by `layer6DerivedFields` (`gre/layer6.ts`)
     *  and read back by nothing in the derivation — the input arm is
     *  `abilityLossHolds` below.
     *
     *  It is the ONE derived-output field PRD #2064 S6b-part-2 kept, and the
     *  reason is that its consult sites have no board. `abilitiesSuppressed`
     *  (`gre/constants.ts`) is a per-card predicate the whole mana planner gates
     *  on — eleven call sites in that module alone, plus `gre/rules.ts`,
     *  `gre/autoTapDemands.ts`, `gre/tapManaBonus.ts`, `gre/manaConverters.ts`
     *  — and `abilityLossTimestamp` (`gre/activatedAbilities.ts`) is read by the
     *  CLIENT's ability view through the same module. None of them can reach a
     *  `GameState`, and the continuous arm cannot be answered without one, so
     *  deriving here would turn every mana read into a battlefield sweep: the
     *  precise hazard ADR 0082's consequences section says to measure rather
     *  than assume.
     *
     *  `seq` is the source's layer timestamp, because layer 6 applies grants and
     *  removals in TIMESTAMP order (CR 613.7): an ability GRANTED to this
     *  permanent before the stripper applied is removed by it, one granted after
     *  survives (Humility, then Fire Whip). */
    abilitiesSuppressedBy?: { sourceId: string; seq: number }[];
    /** CR 611.2b / 611.2c — the LEDGER of "loses all abilities" effects
     *  generated by a RESOLVING ability: `SpellContext.loseAllAbilities`
     *  (Oko's `+1`, keyed to the `"indefinite"` sentinel) and
     *  `loseAllAbilitiesWhileSourceRemains` (Tishana's Tidebinder, keyed to
     *  the resolving permanent's own instance id).
     *
     *  The INPUT half of the pair whose OUTPUT half is `abilitiesSuppressedBy`
     *  above (PRD #2064 S3). They were one field, which stopped working the
     *  moment layer 6 became derived: the CONTINUOUS arm (Titania's Song,
     *  Blood Moon) is now re-derived from the board at every read and writes no
     *  row, so a single field would have to be its own input and its own output
     *  — and `syncLayer6` would either erase the resolving arm's holds or
     *  double-count the continuous one. This field is written ONLY by
     *  `applyAbilityLossHold`; `abilitiesSuppressedBy` is written ONLY by
     *  `syncLayer6`, which composes both arms.
     *
     *  PRD #2064 S6 replaces it with `duration`/`indefinite` registry entries
     *  written straight onto `GameState.continuousEffects`. */
    abilityLossHolds?: { sourceId: string; seq: number }[];
    /** CR 613.1f — the PRE-LAYER-6 keyword multiset: what this permanent has
     *  before any grant or removal applies. The layer-6 twin of
     *  `printedSubtypes` (layer 4), and the input `deriveLayer6`
     *  (`gre/layer6.ts`) composes the registry's entries on top of.
     *
     *  Captured lazily from `staticAbilities` at the first `syncLayer6`, while
     *  that field still holds the base alone — grants no longer materialise
     *  into it. Every path that rewrites the base from BELOW layer 6 (an
     *  identity swap: copy, transform, turn face down / face up; a CR 614.12c
     *  as-enters body choice) clears this field so the next sync re-captures. */
    baseStaticAbilities?: string[];
    /** Damage marked on the creature this turn (CR 120.3). Accumulates across
     *  damage events; checked against effective toughness for lethal damage
     *  (CR 704.5g). Removed at CLEANUP (CR 514.2). */
    damageMarked?: number;
    /** CR 606.3 — how many loyalty abilities of this permanent have been
     *  activated this turn, counted across ALL of its loyalty abilities and
     *  across all players ("no player has previously activated a loyalty
     *  ability of that permanent that turn").
     *
     *  The USED half of the CR 606.3 pair; the ALLOWANCE half is
     *  `loyaltyActivationAllowance` (`gre/loyalty.ts`), which defaults to 1 and
     *  is raised by a `loyalty-activation-allowance` static effect. A tally
     *  rather than the boolean lock it replaced (issue #3339), because a
     *  permanent whose own text grants it a second activation ("You may
     *  activate the loyalty abilities of Urza twice each turn rather than only
     *  once") cannot be expressed by a flag.
     *
     *  Incremented at activation commit (`payLoyaltyCost`); reset for every
     *  permanent at the start of each turn (`phases.ts` untap-step turn
     *  reset). Absent means zero. */
    loyaltyActivationsThisTurn?: number;
    /** CR 702.2b / 704.5h — set true when this creature has been dealt nonzero
     *  damage by a source with deathtouch this turn. `checkDeathtouchDestroySBA`
     *  destroys any creature so marked as a state-based action (respecting
     *  indestructible/regeneration via `destroyWithReplacements`). Marked by
     *  `markDeathtouchDamage` at every damage sink (combat and non-combat) off
     *  the source's EFFECTIVE static-ability set. Removed at CLEANUP (CR 514.2). */
    dealtDeathtouchDamage?: boolean;
    /** Regeneration shields stacked on this permanent (CR 701.19a). Each shield
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
    /** Instance id of the permanent this card is attached to (CR 303.4b,
     *  701.3 — ADR 0065's unified attachment model). Set on auras when they
     *  ETB (cleared by SBA 704.5m when the host becomes illegal — the Aura
     *  goes to the graveyard); set by a Reconfigure permanent's `attach`
     *  activated ability (CR 702.151, issue #1311; cleared in place by
     *  `checkAttachmentSBA`, CR 704.5n, or by its own `unattach` ability —
     *  the Equipment stays on the battlefield). A permanent with neither
     *  capability leaves this undefined. */
    attachedTo?: string;
    /** CR 303.4 — the enchant restriction this permanent was GRANTED at
     *  runtime, when an effect made it an Aura while it was already on the
     *  battlefield ("it becomes an Aura with enchant creature"). A printed
     *  Aura has none: its restriction is derived from the card definition's
     *  cast-time `targetRequirement`. `resolveEnchantRestriction` returns this
     *  clause ALONGSIDE any printed one (CR 702.5c — all instances of enchant
     *  apply, the host must match every one), so the CR 303.4c / 704.5m
     *  attachment SBA sees the granted clause — without it, a permanent
     *  flipped to an Aura has no readable restriction and is binned the
     *  instant it attaches.
     *
     *  It lives on the INSTANCE and not on the definition for the same reason
     *  `escaped` / `evoked` / `dashed` do (see their docs below): it is a fact
     *  about THIS object, not about the card. Stronger, in fact — the
     *  restriction may name a specific object (`hostId`), which no definition
     *  could express. Battlefield-scoped: `clearGrantedEnchantRestriction`
     *  drops it on every departure and before every entry-time legality
     *  question (CR 400.7, the object that re-enters is a new one), so no
     *  legality site ever reads a granted clause off an object that is not on
     *  the battlefield. Persisted through
     *  `compactCard`/`expandCard` (`serialize.ts`) — there is no definition to
     *  re-derive it from, so a dropped field means the Aura is binned by the
     *  first SBA sweep after a save/load. */
    grantedEnchantRestriction?: EnchantRestriction;
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
        /** CR 613.1b — the controller this change INSTALLS. Written by
         *  `applyControlChange`; absent only on a row persisted before PRD
         *  #2064 S4, which `ensureLayers2to5Base` fills in from the stack's own
         *  chain (row i's new controller is row i+1's `previousControllerId`,
         *  and the last row's is the recorded `controllerId`).
         *
         *  Needed because layer 2 is now DERIVED: the walk replays the stack
         *  from `baseControllerId`, so each row has to say where it points, not
         *  only where it came from. */
        controllerId?: string;
        /** CR 613.7 layer timestamp, minted by `allocStaticTimestamp` when the
         *  change is applied. Absent on a pre-S4 row, which the derivation then
         *  orders by array position (below every minted stamp). */
        seq?: number;
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
        /** "When you lose control of the permanent, tap it" rider (CR 701.26a —
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
        /** CR 613.7 (PRD #2064 S4) — the layer timestamp the animation applies
         *  at, so its layer-4 type/subtype half orders against a live
         *  `type-add` aura by WHEN the animation resolved. Absent on a record
         *  persisted before S4, which the derivation orders below every minted
         *  stamp. */
        seq?: number;
        savedPower: number | undefined;
        savedToughness: number | undefined;
        /** The P/T the animation SETS (CR 613.4b layer 7b — `AnimateSpec`'s
         *  own `power`/`toughness`), as opposed to the `saved*` pair above,
         *  which is the pre-animation ANCHOR. Recorded (issue #1705) because
         *  the effect value is otherwise unrecoverable from the record: an
         *  identity swap (copy / face-down / transform) rebuilds `power` and
         *  `toughness` from the new face's copiable values, and the replay
         *  needs the set value to put the animation back on top. Absent on
         *  rows persisted before #1705 — the replay then falls back to the
         *  live pre-swap `power`/`toughness`, which hold exactly this value
         *  (an animation is the only MATERIALISED P/T writer; every other
         *  layer-7 record is read-time). */
        setPower?: number;
        setToughness?: number;
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
        /** Omitted for an INDEFINITE animation (CR 611.2b, `AnimateSpec.duration`
         *  unset — Earthbend N): the phase-boundary purge (`tickAllDurations`,
         *  phases.ts) skips any entry with no `duration`, so it never reverts on
         *  its own; only the permanent leaving the battlefield (a fresh object,
         *  CR 400.7) clears it. */
        duration?: Duration;
        /** CR 613.1e layer 5 (issue #3459) — the colours the animate clause
         *  asked for ("becomes a 3/2 BLUE AND BLACK Elemental creature",
         *  Creeping Tar Pit), as PROVENANCE. The colours themselves live in
         *  `colorOverride` / `temporaryColorOverride`, which the `setColor` Op
         *  writes identically (CR 105.3), so the live fields cannot say WHO set
         *  them; without this a lowered animation round-trips colourless. Same
         *  footing as `setPower`/`setToughness` above — what was ASKED, never
         *  what is true now, so it is not a second authority over the colour. */
        colors?: Color[];
        /** CR 611.2a layer 6 (issue #3459) — the keyword abilities the animate
         *  clause granted as part of becoming a creature (Treetop Village's
         *  trample, earthbend's haste), as PROVENANCE, for the same reason as
         *  `colors`: each becomes a layer-6 registry entry that declares no
         *  animation as its origin, so nothing on the board attributes it back.
         *  Written on the FIRST application only (the grant block runs again on
         *  a re-application, and those keywords belong to that later ability's
         *  own duration, CR 611.2a). */
        grantedAbilities?: string[];
    };
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
        /** CR 613.7 (PRD #2064 S4) — the layer timestamp of the SET. See
         *  `indefiniteSubtypeSet.seq`. */
        seq?: number;
        /** CR 205.1a (issue #3809) — `"creature"` when the set replaces only
         *  the creature types ("becomes that [creature] type", Unnatural
         *  Selection). Absent = the pre-existing replace. */
        family?: "creature";
    };
    /** CR 400.7 / 611.2a (issue #1746) — provenance for an INDEFINITE subtype
     *  REPLACEMENT (`SpellContext.setSubtypes` — Figure of Destiny's "becomes a
     *  Kithkin Spirit", Living Lands). The replacement mutates `subtypes` in
     *  place and has no duration to tick it out, so this records the line to
     *  restore when the permanent leaves the battlefield and becomes a new
     *  object. Written ONCE — a staged respec replaces the subtypes repeatedly
     *  and only the first value is the printed one. */
    /** CR 205.1a / 613.1d / 611.2c (issue #2993) — a PENDING layer-4 type line
     *  the card must show AS IT ENTERS the battlefield ("return it to the
     *  battlefield. It's an enchantment." — the DSK "Enduring" cycle). Stamped
     *  by `SpellContext.returnToBattlefield`'s `entersAs` option while the card
     *  sits in the graveyard / exile, and CONSUMED (deleted) by
     *  `applyEntryTypeLine` inside `stageReanimatedOnBattlefield`, after the
     *  CR 400.7 entry-side reset and before the permanent is on the battlefield
     *  — the one window in which the type line can be in place by the time
     *  `emitPermanentEntered` announces the entry (CR 603.6a).
     *
     *  A pending stamp rather than a call parameter because the entry funnel
     *  can PARK the card mid-flight: a permanent owing "as it enters" choices
     *  (CR 614.12a, ADR 0100) is held in `stagedEntries` across a real save
     *  point and re-enters the funnel on a later mutation, so the type line has
     *  to ride the instance. It is therefore persisted, not transient.
     *
     *  Never observable on a permanent already on the battlefield: the entry
     *  path deletes it as it applies it, and the CR 614 redirect branches
     *  (Worms of the Earth, Containment Priest) never enter and never consume
     *  it — the card lands in its new zone with its PRINTED line, which is
     *  correct: nothing entered, so no continuous effect began (CR 611.2c). */
    entersAsTypeLine?: EntryTypeLine;
    indefiniteSubtypeSet?: {
        restoreSubtypes: string[];
        /** CR 613.7 (PRD #2064 S4) — the layer timestamp the SET applies at, so
         *  it orders against a live `subtype-set` aura by WHEN it resolved.
         *  Absent on a row persisted before S4, which the derivation then
         *  orders below every minted stamp. */
        seq?: number;
        /** The subtype line the effect SET, verbatim as passed to
         *  `SpellContext.setSubtypes` (before any CR 305.7 land-type
         *  narrowing). Recorded (issue #1705) for the same reason as
         *  `animation.setPower`: an identity swap rebuilds `subtypes` from the
         *  new face's copiable values, and the replay needs the effect value —
         *  the record otherwise stores only the anchor. Absent on rows
         *  persisted before #1705; the replay then falls back to the live
         *  pre-swap `subtypes`. */
        subtypes?: string[];
    };
    /** Conditional P/T modifications held "for as long as [the source] remains
     *  tapped" (CR 611.2 — duration tied to a continuously re-evaluated game
     *  state rather than a phase boundary; ATQ cluster E — Ashnod's Battle Gear,
     *  Tawnos's Weaponry). Each entry adds to effective power/toughness at read
     *  time (layer 7c, alongside the registry's own `duration` entries) while
     *  its `sourceId`
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
     *  stat reads. Mutated by `addCounter`/`removeCounter`.
     *  Battlefield-only (CR 122.2): stripped on EVERY departure from the
     *  battlefield — graveyard and exile included — by `leaveBattlefield`,
     *  which snapshots the map into `countersAtLeave` first. */
    counters?: Record<string, number>;
    /** CR 716.2b (issue #3234) — this permanent's LEVEL, the designation a
     *  class level bar sets ("this Class's level becomes N"). Absent means
     *  level 1 (CR 716.2d); read through `classLevelOf`
     *  (`cards/abilities/classLevels.ts`), never by hand.
     *
     *  A field of its own rather than an entry in `counters` because CR 716.4
     *  and CR 711.7 both say class levels and level counters do not interact: a
     *  `"level"` counter would be visible to every counter-removal,
     *  counter-doubling and "for each counter" effect in the pool, which is the
     *  precise trap CR 711.7 warns about. It is also why it is NOT cleared
     *  alongside the counter map: CR 716.2b — "a Class retains its level even
     *  if it stops being a Class". It IS cleared on a zone change, because that
     *  is a new object (CR 400.7), and it is never copied (CR 716.2b — levels
     *  are not a copiable characteristic), which needs no code: `applyCopy`
     *  rewrites only copiable values, so a copy keeps its own level and a fresh
     *  token copy has none at all. */
    classLevel?: number;
    /** CR 608.2h last-known information: the `counters` map this permanent had
     *  at the instant it left the battlefield. The counters themselves cease
     *  to exist on a zone change (CR 122.2) — this is the read-only memory of
     *  them, for death/LTB triggers that need "how many counters were on it".
     *  NEVER a live counter set: nothing pays a cost from it, no layer folds
     *  it into P/T, and it is dropped on any further zone change and on any
     *  re-entry to the battlefield (`resetBattlefieldTransientState`). */
    countersAtLeave?: Record<string, number>;
    /** CR 608.2h / 400.7 (issue #2384): binding rows one of THIS permanent's
     *  abilities captured for a LATER, separate ability of the same permanent
     *  to read — the cross-ability last-known-information channel, written by
     *  the `captureBinding` Effect Op and read by `recallCapturedBinding`.
     *
     *  Each value is a `bindSnapshot` row (`gre/effects/interpreter.ts`) — the
     *  same `string[]` shape a normal in-script binding stores — so a recalled
     *  binding is indistinguishable from a freshly-bound one to every reader.
     *  Skyclave Apparition's ETB exile records the exiled card's mana value
     *  and owner here; its own leave-trigger, possibly many turns later, sizes
     *  the replacement Illusion off that row even though the exiled card is by
     *  then a different object (CR 400.7) or gone from exile entirely.
     *
     *  NOT wiped when the permanent LEAVES the battlefield — the leave-trigger
     *  that reads it resolves after the departure, which is the entire point
     *  (contrast `countersAtLeave`, whose live twin is wiped there). It is
     *  dropped when the permanent ENTERS the battlefield
     *  (`markEnteredThisTurn`): CR 400.7 makes that a new object, which
     *  remembers nothing its previous incarnation captured. */
    capturedBindings?: Record<string, string[]>;
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
    /** CR 613.7 layer timestamp of THIS permanent's continuous static effects
     *  (issue #1715). Stamped by `beginApplyingStaticEffects` every time the
     *  source's effects are applied afresh — the permanent entering the
     *  battlefield, or an Aura becoming attached to a different object
     *  (CR 613.7d) — and copied onto every layer-4/6 record the apply writes
     *  (`grantedStaticAbilities.seq`, `removedKeywords.seq`,
     *  `grantedSubtypes.seq`, `grantedSubtypesAdd.seq`). A counter-gated
     *  RE-EVALUATION (`recomputeContinuousEffects`) explicitly PRESERVES it:
     *  re-running a predicate is not a new timestamp, so the source keeps its
     *  position in every layer's ordering no matter how many SBA passes run.
     *  Cleared when the permanent leaves the battlefield, so a permanent that
     *  re-enters is a new object with a new (latest) timestamp. */
    staticSeq?: number;
    /** Per-turn activation counter keyed by ability id (CR 602.5 — "activate
     *  this ability only once each turn"). Incremented on activation commit,
     *  reset at the active player's turn start. Read by the activation
     *  validator to enforce `ActivatedAbility.oncePerTurn`. */
    activationsThisTurn?: Record<string, number>;
    /** Per-turn TRIGGER counter keyed by triggered-ability id (CR 603.2 —
     *  "this ability triggers only twice each turn", Nadu, Winged Wisdom). The
     *  trigger twin of `activationsThisTurn`: incremented by `collectTriggers`
     *  the moment an ability carrying `TriggeredAbility.maxTriggersPerTurn`
     *  fires, read by that same scan to stop firing once the cap is reached,
     *  and reset at the turn boundary alongside `activationsThisTurn`
     *  (gre/phases.ts). Keyed by ability id, so a permanent carrying a GRANTED
     *  capped ability (Nadu grants its trigger to every creature you control)
     *  tallies its own quota independently of every other recipient — which is
     *  what "this ability" in the granted text refers to. */
    triggersThisTurn?: Record<string, number>;
    /** When set, the lethal-damage SBA exiles this creature instead of sending
     *  it to the graveyard (CR 614.1a — Disintegrate). Also incompatible with
     *  regeneration: the SBA path treats this identically to `cantBeRegenerated`.
     *  Transient — cleared at CLEANUP (CR 514.2). */
    exileOnDeath?: boolean;
    /** When set, damage that would be dealt TO this permanent this turn "can't
     *  be prevented or dealt instead to another permanent or player"
     *  (Whippoorwill, issue #2231) — CR 615.12 for the first clause (including
     *  protection's damage leg, CR 702.16e, which CR 702.16e itself words as
     *  "is prevented") and CR 614.9 for the second. Source-agnostic: it applies
     *  to combat damage, spell damage, ability damage and fight damage alike,
     *  which is why every one of the four damage sinks reads it through
     *  `isDamageLockedTarget` rather than any one of them owning the check.
     *  Transient — cleared at CLEANUP (CR 514.2) and scrubbed on leaving the
     *  battlefield, exactly like `exileOnDeath`. Set by
     *  `SpellContext.setDamageLockThisTurn` / the `lockDamage` Op. */
    damageLockThisTurn?: boolean;
    /** When set, this permanent is exiled instead of going to any other zone if
     *  it would leave the battlefield (CR 614.1c — Dreams of the Dead). Read by
     *  `removePermanentTo` for EVERY departure path (dies, sacrifice, bounce,
     *  destroy), redirecting the destination to exile. PERSISTENT — unlike
     *  `exileOnDeath` it is not cleared at CLEANUP and survives across turns;
     *  it vanishes only when the permanent actually leaves play (the instance
     *  is gone). Set by `setExileOnLeave`. */
    exileOnLeave?: boolean;
    /** When set, this permanent can't be regenerated for the rest of the turn
     *  (CR 701.19c). Suppresses BOTH regeneration shields and the continuous
     *  auto-regeneration replacement granted by the `"auto-regenerate"` static
     *  ability (Clergy of the Holy Nimbus — "{1}: This creature can't be
     *  regenerated this turn"). Read by `regenerateOrDestroy` as an additional
     *  `cantBeRegenerated` source. Transient — cleared at CLEANUP (CR 514.2). */
    cantBeRegeneratedThisTurn?: boolean;
    /** When set, the creature must attack this combat if able (CR 508.1d).
     *  Set by Nettling Imp's activated ability. Checked by combat enforcement
     *  in `mustAttack()`. Transient — cleared at CLEANUP (CR 514.2). */
    mustAttackThisTurn?: boolean;
    /** CR 508.1d / 613.1f (issue #1972) — "This creature attacks each combat
     *  if able" GRANTED to this permanent by a resolving ability (the
     *  `grantAbility` Op's `attackRequirement` payload), as opposed to printed
     *  in its definition's `staticEffects`. One entry per grant:
     *  - no `duration` — INDEFINITE (CR 611.2a: with no stated duration the
     *    effect lasts until the end of the game); kept across turns, and gone
     *    only when the permanent leaves the battlefield, because the object
     *    that returns is a new one (CR 400.7);
     *  - `duration` — spliced out by the phase-boundary purge
     *    (`tickAllDurations`, `gre/phases.ts`) when it expires.
     *
     *  Read ONLY by `hasAttackRequirement` (`gre/combat.ts`). An entry is an
     *  object rather than a boolean so a later widening (a requirement pinned
     *  to a specific defender, issue #3247) adds a field here instead of a
     *  second store. Battlefield-scoped: cleared by `removePermanentTo` and
     *  `resetBattlefieldTransientState`. Persisted by `compactCard` /
     *  `expandCard` — nothing re-derives it. */
    grantedAttackRequirements?: GrantedAttackRequirement[];
    /** CR 613.1e layer 5 — the colour grants applying (Kormus Bell's "black
     *  creatures"). DERIVED OUTPUT, written only by `layers2to5DerivedFields`
     *  (`gre/layers2to5.ts`) and never read back as input.
     *
     *  Kept materialised for the reason `abilitiesSuppressedBy` is (PRD #2064
     *  S6b-part-2): its consult site has no board. `getEffectiveColors`
     *  (`cards/effectiveColors.ts`) is a frontend-safe leaf module with no
     *  engine imports at all, and seven call sites read a permanent's colours
     *  through it. */
    grantedColors?: { color: string; sourceId: string }[];
    /** CR 205.4a layer 4 — supertypes ADDED by a `supertype-set` static effect
     *  or an indefinite `setSupertype` mutation (Arcum's Weathervane's "becomes
     *  snow"). DERIVED OUTPUT, written only by `layers2to5DerivedFields`.
     *
     *  Materialised for the same reason as `grantedColors` above:
     *  `hasSupertypeLive` (`cards/snowReads.ts`) is the cycle-free LEAF module
     *  card sets value-import directly, so it can never take a `GameState`. */
    grantedSupertypes?: { supertype: string; sourceId: string }[];
    /** CR 205.4a layer 4 — the subtractive twin of `grantedSupertypes` (Melting
     *  / Arcum's Weathervane's "is no longer snow"). Same provenance, same
     *  reason for staying materialised. */
    removedSupertypes?: { supertype: string; sourceId: string }[];
    /** CR 613.1b (PRD #2064 S4) — the pre-layer-2 controller: who put the
     *  permanent onto the battlefield (CR 108.3), before any control-change
     *  effect applies. The layer-2 twin of `baseStaticAbilities`;
     *  `controllerId` is the derived answer. */
    baseControllerId?: string;
    /** CR 613.1d (PRD #2064 S4) — the pre-layer-4 card types, captured lazily
     *  at the first derivation. Cleared by every path that rewrites the
     *  copiable values from below (copy, face-down, transform, identity swap),
     *  so the next derivation re-captures. */
    baseTypes?: CardType[];
    /** CR 613.1d (PRD #2064 S4) — the pre-layer-4 subtypes. Supersedes
     *  `printedSubtypes`, whose capture was conditional on a `subtype-set`
     *  having fired and therefore could not be trusted as a base once
     *  `subtypes` became derived output. */
    baseSubtypes?: string[];
    /** CR 612 layer 3 (PRD #2064 S4) — the LEDGER of text changes a resolved
     *  spell left on this object (Magical Hack, Sleight of Mind).
     *  `textChanges` is the derived output the read-time transform consumes;
     *  this is what the derivation reads. Each row carries the CR 613.7 stamp
     *  minted when the spell resolved, so CR 612.6's timestamp order survives a
     *  re-derivation that no longer has array order to rely on. */
    textChangeHolds?: { change: TextChange; seq: number }[];
    /** CR 205.1a layer 4 (PRD #2064 S4, issue #2084) — the LEDGER of one-shot
     *  card-type SETs (`SpellContext.setCardTypes`, the DSK "Enduring" cycle's
     *  entry type line). `grantedTypes` / `suppressedTypes` are the derived
     *  output; this is the effect. CR 611.2a: no duration stated, so it lasts
     *  until the permanent leaves and becomes a new object (CR 400.7), which
     *  drops the ledger with the instance. */
    typeLineHolds?: { types: CardType[]; seq: number }[];
    /** CR 305.7 layer 4 (PRD #2064 S4) — the LEDGER of indefinite subtype ADDs
     *  (`SpellContext.addSubtype`). Stamped with a real minted timestamp
     *  (issue #1750) so a resolved add orders against a live `subtype-set` by
     *  WHEN it resolved. `grantedSubtypesAdd` is the derived output. */
    subtypeAddHolds?: { subtype: string; seq: number }[];
    /** CR 205.4a layer 4 (PRD #2064 S4) — the LEDGER of indefinite supertype
     *  mutations (`SpellContext.setSupertype` — Arcum's Weathervane's "becomes
     *  snow" / "is no longer snow"). `grantedSupertypes` / `removedSupertypes`
     *  are the derived output. */
    supertypeHolds?: {
        add?: CardSupertype[];
        remove?: CardSupertype[];
        seq: number;
    }[];
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
    /** CR 715.3b/715.4 — the FRONT (printed) card id of a stack item cast as
     *  an Adventure, retained for the revert the moment the object leaves the
     *  stack. Its presence IS the "was cast as an Adventure" mark
     *  (`wasCastAsAdventure`, `gre/adventure.ts`) that CR 715.3d's exile
     *  redirect keys on, exactly as `faceDownOf`'s presence marks a face-down
     *  object — one field, never a flag beside an id that could be set apart
     *  from it.
     *
     *  PUBLIC information, unlike `faceDownOf`: an Adventure spell shows its
     *  alternative characteristics to both players (CR 715.3b), so nothing is
     *  hidden at the projection boundary. */
    adventureOf?: string;
    /** CR 709.3b/709.4 — the PARENT (combined) card id of a stack item cast as
     *  one half of a split card, retained for the revert the moment the object
     *  leaves the stack. Its presence IS the "was cast as a split half" mark,
     *  exactly as `adventureOf`'s presence marks an Adventure — one field,
     *  never a flag beside an id that could be set apart from it.
     *
     *  PUBLIC information: a split half on the stack shows its own
     *  characteristics to both players (CR 709.3b), so nothing is hidden at
     *  the projection boundary. */
    splitHalfOf?: string;
    /** WHICH mechanic put this object face down (issue #2904) — see
     *  {@link FaceDownProducer}. Public information: an opponent watching a
     *  morph cast knows it was a morph, and the face-down FACE the client
     *  renders is keyed on this alone, never on the hidden card. Stamped by
     *  `turnFaceDown` (permanents and stack items) and by `exileFaceDownCard`
     *  (CR 406.3 face-down exile), cleared by `turnFaceUp`. Absent on state
     *  written before #2904 — the display resolver then falls back to the
     *  generic card back. */
    faceDownBy?: FaceDownProducer;
    /** True while this permanent is showing its BACK face (CR 712, ADR 0067,
     *  issue #1210) — has been transformed an odd number of times. Distinct
     *  from `faceDown`/`faceDownOf` (CR 707.4 morph: a HIDDEN identity that
     *  turns up to its OWN characteristics) — transform swaps between two
     *  DISTINCT, always-PUBLIC (CR 712.6) printed characteristic sets, so
     *  (unlike `faceDown`) there is no per-viewer hiding in
     *  `gameProjections.ts`. Set by `transformPermanent` (`gre/transform.ts`),
     *  mirroring `faceDown.ts`'s definition-swap pattern: `card.card.id` and
     *  the mutable characteristic fields (`types`/`subtypes`/`power`/
     *  `toughness`/`staticAbilities`) are overwritten in place from the
     *  registered back-face `CardDefinition`, so every existing reader
     *  (layers, combat, activated-ability discovery) observes the swap. */
    transformed?: boolean;
    /** The FRONT face's own definition id, captured by `transformPermanent`
     *  when first transforming to the back face, so a later flip back (CR
     *  712.8a) can restore it. Public to both players (unlike `faceDownOf`,
     *  no hiding is needed). Only meaningful while `transformed` is true. */
    transformedFrom?: string;
    /** CR 701.27f (issue #3249) — the value of `GameState.nextDelayedSeq` at
     *  this permanent's most recent transform, stamped by
     *  `SpellContext.transform`. A delayed triggered ability `delayed-N` of
     *  this permanent that tries to transform it does nothing when this is
     *  `>= N`: the permanent has transformed since that delayed trigger was
     *  created (the creation incremented the counter TO N, so a transform
     *  before it stamps at most N - 1). Cleared on CR 400.7 re-entry — the new
     *  object has never transformed. The rule's OTHER sentence (a non-delayed
     *  ability, "since the ability was put onto the stack") reads
     *  `transformCount` below instead. */
    transformedAtDelayedSeq?: number;
    /** CR 701.27f (issue #3537) — how many times THIS object has transformed,
     *  incremented by `SpellContext.transform` on every real flip. An activated
     *  or triggered ability of this permanent records the count as it is put
     *  onto the stack (`StackItem.stackTransformStamp`); when the two differ
     *  at resolution the permanent has transformed since, and the ability's
     *  instruction to transform it is ignored. Cleared on CR 400.7 re-entry. */
    transformCount?: number;
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
    /** CR 707.2 / 202.3 (issue #2339) — an instance-level MANA COST override.
     *  The one writer today is a copy effect's "except it has no mana cost"
     *  clause (Eternalize CR 702.129a, Embalm CR 702.128a), which sets `{}` so
     *  the token's mana value reads 0 and its cost contributes no colour.
     *
     *  It has to live on the INSTANCE rather than on `card.manaCost`: a copy
     *  presents the COPIED card's definition (`applyCopy` overwrites
     *  `card.id`), and the wire projection rewrites `card` down to `{ id }` —
     *  an embedded cost would be correct server-side and silently gone on the
     *  client. Read through `getInstanceManaCost` (`cards/registry.ts`), the
     *  single authority every mana-value / colour reader shares. */
    manaCostOverride?: CardManaCost;
    /** CR 111 (issue #2339) — an instance-level Scryfall print id for ART.
     *  Cosmetic only; no rules reader touches it. Set by a copy effect whose
     *  result has its OWN printed card (an Eternalize/Embalm token: Fanatic of
     *  Rhonas's tmh3 #15 Zombie Snake Druid frame, not the MH3 creature's), and
     *  preferred by the card renderer over the definition-derived art. */
    imagePrintId?: string;
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
    /** Copy effect anchor (CR 707.2, 706). When this permanent is a copy of
     *  another (Clone, Copy Artifact, Vesuvan Doppelganger), `card.id` is
     *  overwritten with the copied object's definition id so every
     *  characteristic reader (abilities, colors, P/T, types) observes the
     *  copy automatically. `copiedFrom` holds this instance's ORIGINAL printed
     *  definition id — the value `card.id` is restored to when the copy leaves
     *  the battlefield (`revertCopy`). Its presence marks the instance as an
     *  active copy and survives Vesuvan's upkeep re-copy unchanged. */
    copiedFrom?: string;
    /** CR 707.2's "except its base power and toughness are N/N" clause, as
     *  stamped on THIS copy (Eternalize's 4/4, issue #2076). Present only
     *  while the instance is an active copy whose copy effect named the
     *  exception; `revertCopy` clears it.
     *
     *  It exists because the exception is a COPIABLE value, not a layer-7
     *  continuous effect: CR 707.3 — "the copy's copiable values become the
     *  copied information. Objects that copy the object will use the new
     *  copiable values." `applyCopy` derives the copiable base from the COPIED
     *  CARD's definition (`getDefinition(presentedDefId)`), which knows nothing
     *  about an exception a previous copy effect applied, so a Clone copying an
     *  Eternalize token would hand back the printed body without this stamp.
     *
     *  Deliberately NOT read off the materialised `power`/`toughness`: those
     *  carry non-copiable layer overlays too (an animated Chimeric Staff is
     *  5/5 on the instance, and CR 707.2's own example says a Clone of it is
     *  not). Isolating the exception is what keeps the two apart.
     *
     *  Named for the CR's own word so the remaining exception shapes — colour,
     *  added subtypes, granted keywords, "no mana cost", none of which survive
     *  a copy-of-the-copy today either — widen it purely additively. */
    copyExcept?: { basePower?: number; baseToughness?: number };
    /** The "except" options (`CopyEffectOptions`) of the copy effect this
     *  permanent currently presents (CR 707.9 — "copy effects may include
     *  modifications or exceptions to the copying process"). Written by
     *  `applyCopy`, cleared by `revertCopy`; absent for an unexceptional copy
     *  and for every non-copy.
     *
     *  Read in exactly one place: when a TIMED copy effect lands on a
     *  permanent that is already an indefinite copy (issue #3236), the
     *  indefinite one is recorded as `timedCopyEffects.underlying` so it can be
     *  re-applied — "except" clause and all — when the last timed effect ends.
     *  The materialised fields (`types`, `colorOverride`, …) cannot answer
     *  that: they already carry every overlay a later effect added. */
    copyOptions?: CopyEffectOptions;
    /** CR 611.2a / 613.7 (issue #3236) — copy effects with a stated duration
     *  ("becomes a copy of … until end of turn", Saheeli, Sublime Artificer).
     *
     *  `effects` is a LIST, one entry per timed copy effect, each carrying its
     *  own expiry — never a single slot, which is the shape that let a second
     *  timed colour set clobber the first's expiry (issues #2254 / #2936). In
     *  layer 1 the LATEST timestamp wins (CR 613.7), so the permanent presents
     *  the last entry; when an entry expires (`expireTimedCopyEffects`,
     *  ticked from `tickAllDurations`) the survivors are re-applied over
     *  `underlying`, the copy effect (if any) that applied BEFORE the first
     *  timed one — `null` when the permanent was presenting its own printed
     *  copiable values.
     *
     *  Every source is snapshotted at resolution: a copy effect's copiable
     *  values are locked in when the effect begins (CR 611.2c), so the copied
     *  permanent later leaving or changing does not touch this copy.
     *
     *  Cleared with the copy itself on every battlefield departure
     *  (`revertCopy`): a permanent that leaves and returns is a new object
     *  (CR 400.7) and no pending revert may fire on it. An INDEFINITE copy
     *  effect applied on top also clears it — its later timestamp outranks
     *  every earlier timed entry for as long as they could last. */
    timedCopyEffects?: {
        underlying: TimedCopyLayer | null;
        effects: Array<TimedCopyLayer & { duration: Duration }>;
    };
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
    /** Cast-from-exile permission (CR 601.3 — Ice Cauldron: "You may cast that
     *  card for as long as it remains exiled"). When set on a card in the exile
     *  zone, the named player may CAST it from exile as if it were in their
     *  hand. CR 305.9 / 116.2a (issue #1689): a cast permission alone does
     *  NOT also authorize playing a LAND — a land is never cast, so this
     *  flag is meaningless for one unless {@link
     *  castableFromExileIncludesLand} is ALSO set (see that field's doc for
     *  which grants qualify). Cleared when the card leaves exile. Persisted
     *  so the permission survives a DB round-trip. */
    castableFromExileBy?: string;
    /** CR 305.9 (issue #1689) — rides alongside {@link castableFromExileBy};
     *  true iff the GRANTING effect's Oracle text explicitly says "play"
     *  (not merely "cast") that card, e.g. "You may look at and play that
     *  card this turn" (Headliner Scarlett), "You may play the exiled card
     *  this turn" (Expressive Iteration), "you may play it this turn
     *  without paying its mana cost" (Dauthi Voidwalker). ONLY then does a
     *  LAND sitting in exile under the grant become a legal "play" source
     *  (`getLegalActions`'s land branch, `gre/rules.ts`) — mirroring how CR
     *  305.9 restricts land plays to hand unless an effect EXPLICITLY says
     *  otherwise. A grant whose Oracle text says "cast" instead (Ice
     *  Cauldron, Robber of the Rich, Ragavan, Nimble Pilferer) never sets
     *  this flag — `SpellContext.grantCastFromExile`'s `includesLand` opt
     *  defaults to false/omitted, so a land under one of those grants is
     *  simply unusable (no play, no cast — a land can't be cast either).
     *  Meaningless (and never read) for a non-land card. Cleared alongside
     *  `castableFromExileBy` wherever that field is cleared. Persisted so
     *  the flag survives a DB round-trip. */
    castableFromExileIncludesLand?: boolean;
    /** CR 609.4b (issue #2890) — rides alongside {@link castableFromExileBy}:
     *  the granting Oracle text ALSO says "you may spend mana as though it were
     *  mana of any color/type to cast that spell" (Robber of the Rich). While
     *  set, `getManaSubstitutions` adds every pair of that breadth — but ONLY
     *  for a payment that names THIS card as the cast in progress, so the
     *  permission can never leak onto another spell or an activated ability.
     *  Per CR 609.4b the spell's COST is untouched; only how it may be paid
     *  changes. Cleared alongside `castableFromExileBy` wherever that field is
     *  cleared. Persisted so the permission survives a DB round-trip. */
    castFromExileManaSubstitution?: ManaSubstitutionBreadth;
    /** CR 601.2f (issue #2383) — an OBJECT-SCOPED cost increase riding {@link
     *  castableFromExileBy}: "For as long as that card remains exiled, its
     *  owner may play it. A spell cast this way costs {2} more to cast"
     *  (Elite Spellbinder). The tax belongs to THIS EXILED CARD, not to the
     *  permanent that granted it, so it keeps applying after Elite Spellbinder
     *  dies, is bounced or is exiled — which is exactly what a
     *  `StaticCostModifier` (`kind: "cost-modifier"`) cannot express: that one
     *  is re-scanned off the battlefield at every cost computation and stops
     *  the moment its carrier leaves. Folded in by `getCostModifiers` (`gre/state.ts`),
     *  the ONE collector every cost site already runs through, so the real
     *  payment (`announceCast`, `convex/game.ts`), the "cast" affordance
     *  (`getLegalActions`, `gre/rules.ts`) and the Bot's tap planner
     *  (`enumerateCastMoves`, `gre/moves.ts`) all price the taxed cast the
     *  same way. Cleared alongside `castableFromExileBy` wherever that field
     *  is cleared. Persisted so the tax survives a DB round-trip. */
    castFromExileCostIncrease?: ManaCost;
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
    /** CR 514.2 / 608.2g (issue #3235, PR #3549 review finding 3) — the
     *  "until the end of YOUR next turn" window's expiry, expressed as the
     *  GRANTEE's own {@link PlayerState.turnsTaken} value rather than as a
     *  global turn number.
     *
     *  It cannot be a global turn number. `castableFromExileUntilTurn` assumes
     *  turns alternate, which EXTRA TURNS (CR 500.7) break: granted on your own
     *  turn T, "your next turn" is T+2 normally but T+1 if an extra turn is
     *  queued for you — and an extra turn granted AFTER the stamp moves the
     *  boundary again, which no absolute stamp can follow. `turnsTaken` is
     *  incremented once per turn its owner actually takes, extra turns
     *  included (`advanceTurn`, gre/phases.ts), so "your next turn" is exactly
     *  `turnsTaken + 1` at stamp time and stays exact however the turn order
     *  is bent afterwards. Skipped turns (CR 614.10) come out right for the
     *  same reason: a skipped turn is never taken, so it never increments.
     *
     *  Revoked by the SAME cleanup sweep the absolute bound is, against the
     *  grantee named by `castableFromExileBy`. Mutually exclusive with
     *  `castableFromExileUntilTurn` in practice — each window stamps one or
     *  the other — and a card carrying neither is an open-ended grant. */
    castableFromExileUntilOwnTurn?: number;
    /** LOWER turn bound for {@link castableFromExileBy} — the symmetric twin of
     *  {@link castableFromExileUntilTurn}, and the one shape the upper bound
     *  cannot express: the permission exists but has not OPENED yet. While set,
     *  the grant is inert on every turn whose number is `<` this value and live
     *  from that turn onward (for as long as the card remains exiled, or until
     *  an upper bound also present revokes it — the two compose).
     *
     *  CR 702.185a (Warp, issue #1268) is its first consumer: "its owner may
     *  cast this card AFTER THE CURRENT TURN HAS ENDED for as long as it
     *  remains exiled", i.e. the card is exiled during some turn N's end step
     *  and becomes castable on turn N+1. Falling open here would make the card
     *  castable during the very turn it was warped out, which is the whole
     *  point of the clause.
     *
     *  Deliberately a TURN NUMBER, not a `warped-this-turn` flag: the same
     *  primitive then expresses any later opening ("not before your next
     *  upkeep", a suspended card's window) without a schema change, exactly as
     *  the upper bound stores a number rather than a bare "this turn" flag.
     *  ABSENT means the grant is open from the moment it is made — every grant
     *  shipped before Warp.
     *
     *  Honoured at the ONE shared authority every consumer reads,
     *  `exileCastPermission` (`gre/castCost.ts`): the "cast" affordance
     *  (`getLegalActions`), the real payment path (`findCastableExileCard`,
     *  `convex/game.ts`), the exile projection the client's Cast button gates
     *  on (`gameProjections.ts`), the land-play leg (`gre/playLand.ts`) and the
     *  Bot's non-hand cast enumeration (`gre/moves.ts`). Cleared alongside
     *  `castableFromExileBy` wherever that field is cleared. Persisted so the
     *  window survives a DB round-trip. */
    castableFromExileFromTurn?: number;
    /** CR 601.3 / 118.9 (issue #1156) — a cost waiver riding {@link
     *  castableFromExileBy}: when both are set, `castableFromExileBy`'s
     *  named player may cast/play this card WITHOUT PAYING ITS MANA COST
     *  ("You may play it this turn without paying its mana cost" — Dauthi
     *  Voidwalker's second ability). Distinct from `castableFromExileBy`
     *  ALONE (Ice Cauldron, Robber of the Rich, Headliner Scarlett), which
     *  grants only cast PERMISSION — the card is still cast for its normal
     *  printed mana cost. Consulted at the ONE place a cast's mana cost is
     *  computed (`castRawManaCost`, `convex/game.ts`) and by
     *  `getLegalActions`'s exile-cast affordability branch (`gre/rules.ts`)
     *  so the "Cast" button never requires unaffordable mana. Cleared
     *  wherever `castableFromExileBy` is cleared (the SAME permission
     *  window) — `removeFromZone`, the CLEANUP turn-scoped expiry loop
     *  (`phases.ts`), and `applyPlayLandFromExile`. Persisted so the grant
     *  survives a DB round-trip. */
    castFromExileWithoutPayingManaCost?: boolean;
    /** CR 715.3d — the SEVENTH sibling of {@link castableFromExileBy}: the
     *  permission granted by an Adventure's own resolution does not offer the
     *  Adventure cast option again ("It can't be cast as an Adventure this
     *  way").
     *
     *  It rides the PERMISSION, never the zone, and that distinction is the
     *  whole of the subrule's second half: "although other effects that allow
     *  a player to cast it may allow a player to cast it as an Adventure." A
     *  card exiled by its own Adventure and then reached by, say, a
     *  play-from-exile grant is castable as an Adventure again; this flag
     *  suppresses the option only for the grant that carries it. Cleared
     *  wherever `castableFromExileBy` is cleared (the SAME permission window).
     *  Persisted so the restriction survives a DB round-trip. */
    castFromExileNotAsAdventure?: boolean;
    /** Cast-from-graveyard permission for a SPECIFIC card (CR 601.3, with the
     *  waiver's own CR 118.9, issue #1344 — Malcolm, Alluring Scoundrel: "you may cast
     *  the discarded card without paying its mana cost"). The graveyard-zone
     *  twin of {@link castableFromExileBy}. Distinct from the BROAD,
     *  player-wide `grantGraveyardPlay` permission
     *  (`state.graveyardPlayPermissionThisTurn`, `canCastFromGraveyardByPermission`)
     *  — this is a PER-CARD grant. Always scoped to the grantee's OWN
     *  graveyard: no cross-player shape exists for a graveyard cast (CR
     *  305.1-analog / 601 — every graveyard-cast mechanism in this engine is
     *  same-player, `castZoneOwner`'s doc in `convex/gre/activation.ts`). When set on a
     *  card in the graveyard, the named player may CAST it from there as if
     *  it were in their hand (never PLAY — a land discarded this way carries
     *  no affordance, CR ruling: "You may not play land cards discarded with
     *  Malcolm's last ability"). Cleared when the card leaves the graveyard.
     *  Persisted so the permission survives a DB round-trip. */
    castableFromGraveyardBy?: string;
    /** Turn-scoped expiry marker for {@link castableFromGraveyardBy} (CR
     *  514.2 / 608.2g), mirroring {@link castableFromExileUntilTurn}'s
     *  exile-zone twin. Set when the grant is an impulse "this turn" window
     *  (Malcolm, Alluring Scoundrel — see the card's own doc comment,
     *  `convex/cards/sets/lci/blue.ts`, for the documented simplification
     *  vs. the stricter Oracle ruling) and revoked at the CLEANUP step of a
     *  turn whose number is `>=` this value, while the card stays in the
     *  graveyard. ABSENT means an open-ended grant (parity with the exile
     *  primitive's "while-exiled" default; no shipped card needs this shape
     *  yet). */
    castableFromGraveyardUntilTurn?: number;
    /** CR 601.3 / 118.9 (issue #1344) — a cost waiver riding {@link
     *  castableFromGraveyardBy}: when both are set, the named player may
     *  cast this card WITHOUT PAYING ITS MANA COST (Malcolm's "without
     *  paying its mana cost"). Mirrors {@link castFromExileWithoutPayingManaCost}
     *  exactly. Consulted at the ONE place a cast's mana cost is computed
     *  (`castRawManaCost`, `convex/game.ts`) and by `getLegalActions`'s
     *  graveyard-grant affordability branch (`gre/rules.ts`). Cleared
     *  wherever `castableFromGraveyardBy` is cleared — `removeFromZone`, and
     *  the CLEANUP turn-scoped expiry loop (`phases.ts`). Persisted so the
     *  grant survives a DB round-trip. */
    castFromGraveyardWithoutPayingManaCost?: boolean;
    /** CR 614.1 / 400.7 (issue #2380) — a REPLACEMENT rider on {@link
     *  castableFromGraveyardBy}: when both are set, a spell cast from the
     *  graveyard under this grant is EXILED as it leaves the stack instead of
     *  being put into its owner's graveyard (Jace, Telepath Unbound's −3: "You
     *  may cast target instant or sorcery card from your graveyard this turn.
     *  If that spell would be put into your graveyard, exile it instead.").
     *  Stamps `exileOnResolve` onto the resulting stack item at cast-commit
     *  (`graveyardCastStackFlags`, `convex/game.ts`) — the SAME flag Flashback
     *  uses for its own CR 702.34a exile, so there is one exile-as-it-leaves-
     *  the-stack path, not two. Cleared wherever `castableFromGraveyardBy` is
     *  cleared. Persisted so the grant survives a DB round-trip. */
    castFromGraveyardExilesOnResolve?: boolean;
    /** CR 111 / 400.7 provenance link (issue #791) — the battlefield permanent
     *  instance id that exiled this card "with it", set when a card is exiled
     *  by a specific source that later refers back to "the cards exiled with
     *  this permanent" (Currency Converter — "Put a card exiled with this
     *  artifact into its owner's graveyard"). The mirror of `createdBy` for
     *  tokens: a card records which permanent linked it while it sits in exile,
     *  so `getCardsExiledWith` can enumerate the linked set across any owner's
     *  exile (the card stays in its OWNER's exile per CR 400.7, distinct from
     *  the linking source's controller). Distinct from `castableFromExileBy`
     *  (a play PERMISSION, CR 601.3 / 305.1-analog) and from `exileHeld`
     *  ExileReturnBundles (an exile-AND-return arm on the source's LTB, ADR
     *  0028) — this is a bare retrievable tag with no play grant and no
     *  auto-return. Cleared when the card leaves exile (`removeFromZone`).
     *  Persisted so the link survives a DB round-trip; projected via
     *  `exiledByPermanentId` (Arena pinning). */
    exiledBySourceId?: string;
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
    /** CR 702.138b — true iff this permanent ESCAPED, i.e. it was cast from a
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
     *  MADNESS cost, CR 702.35a) from an Ice-Cauldron-style exile cast (normal
     *  cost). Cleared when the card is cast to the stack (`removeFromZone`) or
     *  binned on decline (`declineMadness`). Persisted so it survives a DB
     *  round-trip. */
    madnessExiled?: boolean;
    /** CR 702.35a — true while a madness-exiled card is still awaiting its
     *  reflexive cast-trigger. Set alongside `madnessExiled` by `markMadnessExiled`
     *  at discard→exile; consumed by `collectTriggers` when it builds the
     *  reflexive trigger StackItem (so the trigger is created exactly once), and
     *  cleared by `openMadnessCastWindow` when that trigger resolves. Absent once
     *  the card is castable (window open) or has been binned. Persisted. */
    madnessTriggerPending?: boolean;
    /** CR 702.88a — true iff this card was exiled by Rebound (a hand-cast
     *  rebound spell redirected from the graveyard at resolution, see
     *  `markReboundExiled`, gre/rebound.ts). Rides alongside
     *  `castableFromExileBy` once the reflexive trigger opens the caster's
     *  cast window; distinguishes a rebound exile (free recast, CR 702.88a)
     *  from an Ice-Cauldron-style exile cast (normal cost). Cleared when the
     *  card is cast to the stack (`removeFromZone`) or when the caster
     *  declines the window (`declineRebound`) — either way the card "remains
     *  exiled" (CR 702.88c) but is no longer rebound-tracked. Persisted so it
     *  survives a DB round-trip. */
    reboundExiled?: boolean;
    /** CR 702.74a — true iff this permanent was cast for its Evoke cost. Set
     *  on the stack item at cast commit (`convex/game.ts`, when the chosen
     *  alternative cost === `CardDefinition.evoke`) and rides onto the
     *  resulting battlefield permanent for free (a stack item IS its
     *  CardInstanceState, the `escaped` precedent). Read by the
     *  `evokeTrigger` template's `condition` (`convex/cards/abilities/evoke.ts`)
     *  to decide whether the "sacrifice this when it enters" half of Evoke
     *  fires. See {@link PermanentView.evoked} for the full doc. */
    evoked?: boolean;
    /** CR 702.96a (issue #3215) — true iff this spell was cast for its Overload
     *  cost. Set on the stack item at cast commit (`convex/game.ts`, when the
     *  chosen alternative cost === `CardDefinition.overload`) and by the
     *  cast-mode census inside both search executors (`gre/castMode.ts`). It is
     *  the whole of CR 702.96a's second static ability: the SpellContext built
     *  for an overloaded item takes its `targets` from
     *  `overloadAffectedTargets` (`gre/overload.ts`) instead of the announced
     *  slots, so `forEach { set: "targets" }` — the script construct that means
     *  "every object this spell is affecting" — sweeps each matching object
     *  rather than the one announced target. The marker rides onto the
     *  resulting permanent for free like `evoked`/`dashed`, where it is inert:
     *  no overload card in the pool is a permanent spell, and nothing reads it
     *  off the battlefield. */
    overloaded?: boolean;
    /** CR 702.109a — true iff this permanent was cast for its Dash cost. Set
     *  on the stack item at cast commit (`convex/game.ts`, when the chosen
     *  alternative cost === `CardDefinition.dash`) and rides onto the
     *  resulting battlefield permanent for free (a stack item IS its
     *  CardInstanceState, the `escaped`/`evoked` precedent). Read by the
     *  `dashTrigger` template's `condition` (`convex/cards/abilities/dash.ts`)
     *  to decide whether the "gains haste, returned to hand at the next end
     *  step" half of Dash fires. See {@link PermanentView.dashed} for the
     *  full doc. */
    dashed?: boolean;
    /** CR 702.185a — true iff this permanent's spell was cast for its Warp
     *  cost. Set on the stack item at cast commit (`convex/game.ts`, when the
     *  chosen alternative cost === `CardDefinition.warp`) and by the cast-mode
     *  census inside both search executors (`gre/castMode.ts`), riding onto the
     *  resulting battlefield permanent for free (a stack item IS its
     *  CardInstanceState, the `evoked`/`dashed` precedent). It is the "if this
     *  spell's warp cost was paid" clause of 702.185a's second static ability:
     *  `finalizeSpellResolution` schedules the next-end-step exile only for a
     *  permanent carrying it (`scheduleWarpExile`, `gre/warp.ts`), and the
     *  delayed trigger re-reads it at fire time to answer CR 400.7 — a
     *  permanent that LEFT and RETURNED is a new object, and
     *  `resetBattlefieldTransientState` has cleared the marker off it, so the
     *  original trigger does not chase it. Cleared alongside
     *  `evoked`/`dashed`/`escaped` at BOTH transient-state gates for the same
     *  reason they are (issue #2412): a countered or bounced warp spell must
     *  not carry the marker into its next cast. */
    warped?: boolean;
    /** CR 702.185b — true iff this card in exile "is a warped card in exile":
     *  one "exiled by the delayed triggered ability created by a warp ability"
     *  (`applyWarpExile`, `gre/warp.ts`). The exile-zone sibling of
     *  `madnessExiled` / `reboundExiled`, and, like them, what distinguishes
     *  this exile from every other one that also carries a
     *  `castableFromExileBy` grant.
     *
     *  Nothing QUERIES it yet — no shipped card reads "a warped card in exile"
     *  (issue #1268 ships the keyword, not the cards that refer to it). It is
     *  written because the referent is only derivable at the moment of the
     *  exile: once the card is sitting in exile beside an ordinary impulse
     *  grant there is no way to recover which ability put it there. Cleared
     *  alongside `castableFromExileBy` wherever that field is cleared (the same
     *  exile departure ends both facts). Persisted so it survives a DB
     *  round-trip. */
    warpExiled?: boolean;
    /** CR 702.49c — the planeswalker (or battle) the returned creature was
     *  attacking, captured when a Ninjutsu cost was paid so the card entering
     *  the battlefield attacking joins combat against the SAME defender.
     *
     *  A STAMP consumed once, not a lasting property (the `entersAsTypeLine`
     *  shape): the ability's cost payment writes it on the source card while
     *  it is still in hand, `moveZone`'s hand carrier reads it at
     *  resolution and clears it as the permanent enters. Absent means the
     *  returned creature was attacking a PLAYER — the default defender, which
     *  `combat.attackTargets` records nothing for — so the entering creature
     *  needs no entry there either.
     *
     *  A stamp CAN outlive its activation: an ability that is countered, or
     *  whose card left hand in response, never reaches the consuming Op, and
     *  nothing on the fizzle path clears it. That is inert rather than unsafe,
     *  and deliberately so — the ONLY writer is the cost payment
     *  (`captureNinjutsuAttackTarget`), which re-stamps or deletes on every
     *  activation, so the next ninjutsu of that card cannot read a stale
     *  defender; and the only reader refuses a defender that is no longer a
     *  live planeswalker or battle (CR 506.3c). */
    enterAttackingTarget?: string;
    /** CR 702.103b — true iff this object is currently BESTOWED: it was cast
     *  for its Bestow cost and has not yet ceased to be bestowed
     *  (CR 702.103e–g). Set on the stack item at cast commit
     *  (`convex/game.ts`, when the chosen alternative cost ===
     *  `CardDefinition.bestow`) by `applyBestowCharacteristics`
     *  (`convex/gre/bestow.ts`), which in the same breath rewrites `types` /
     *  `subtypes` / `power` / `toughness` to the Aura enchantment the spell
     *  becomes (CR 205.1a) and stamps `grantedEnchantRestriction` with the
     *  gained "enchant creature". Rides onto the resulting battlefield
     *  permanent for free (a stack item IS its CardInstanceState, the
     *  `escaped`/`evoked`/`dashed` precedent). Bestow requires that verbatim
     *  (CR 702.103b): "the permanent it becomes as it resolves will be a
     *  bestowed Aura".
     *
     *  UNLIKE `evoked`/`dashed`, this flag is not merely a memory a trigger
     *  reads: it is the live discriminator for two engine behaviours.
     *   - `checkAuraAttachmentSBA` (`sba.ts`) reverts a bestowed Aura to a
     *     creature IN PLACE instead of putting it into its owner's graveyard
     *     (CR 702.103f, the explicit exception to CR 704.5m).
     *   - `finalizeSpellResolution` lets a bestowed Aura spell with an
     *     illegal target keep resolving as a CREATURE spell rather than
     *     fizzling (CR 702.103e / 608.3b).
     *
     *  Because it is paired with an in-place type mutation, every boundary at
     *  which the object stops being bestowed calls `revertBestow`, never a
     *  bare `delete`: the two SBA/resolution sites above, plus the CR 400.7
     *  zone-change resets (`resetStackTransientState`, `removePermanentTo`,
     *  `resetBattlefieldTransientState`). */
    bestowed?: boolean;
    /** CR 307.1 / 117.1a / 601.3a — true iff this spell was cast at a moment
     *  a sorcery couldn't have been cast (stack non-empty, not the caster's
     *  main phase, or not the caster's turn) — the memory "if you cast it
     *  any time a sorcery couldn't have been cast, …" clauses key on
     *  (Necromancy, PRD #1975, #2392). A pure snapshot of board state at cast
     *  time, NOT a legality verdict: it is stamped whether or not the cast
     *  itself was legal at instant speed, and it is stamped `false`/absent
     *  for a perfectly ordinary sorcery-speed cast. Derived from
     *  `isSorceryTimingFor` (the CASTER-aware predicate `castTimingBaseLegal`
     *  already uses — `phases.ts`, issue #1690) at ANNOUNCEMENT (CR 601.2a)
     *  and threaded to the commit through `PendingTarget`/`PendingCast`, the
     *  `evoked`/`dashed` shape — never re-derived at the commit, which spans
     *  a different board once mana abilities have been activated (CR 601.2g /
     *  605.4a). Rides onto the resulting
     *  battlefield permanent for free (a stack item IS its CardInstanceState,
     *  the `escaped`/`evoked`/`dashed` precedent). Engine capability only in
     *  this slice — no shipped card reads it yet; Necromancy (#2392) will.
     *  See {@link PermanentView.castOffSorceryTiming} for the full doc. */
    castOffSorceryTiming?: boolean;
    /** CR 106.4 / 202.3 — per-colour mana spent to CAST this permanent,
     *  captured once at ETB (`resolveTopOfStack`) from the originating stack
     *  item's `notedManaSpent`. See {@link PermanentView.notedManaSpentOnCast}
     *  for the full doc — this is the persistent post-ETB twin of the
     *  ephemeral `StackItem.notedManaSpent`. */
    notedManaSpentOnCast?: Record<string, number>;
    /** CR 702.33 / 614.1c — true iff any of the resolving spell's Kicker costs
     *  was paid as it was cast, snapshotted from the stack item's per-Kicker
     *  payment record (`StackItem.kickerPayments`, summed via
     *  `totalKickerCount` — ADR 0079) the instant it enters the battlefield
     *  (`finalizeSpellResolution`, which writes BOTH branches explicitly —
     *  `true` when kicked, `delete`d when not — so the write is authoritative
     *  standalone and never depends on the object having arrived "already
     *  clean"). "Was kicked" is a ONE-SHOT fact fixed the moment the spell
     *  resolves (CR 702.33) — the CR 614.1c "if this creature was kicked …"
     *  ETB replacement reads it exactly once and nothing in the CR ever
     *  revisits the answer afterwards, unlike a `+1/+1` counter count (which
     *  SBAs / `-1/-1` annihilation, CR 704.5q, or an unrelated pump spell can
     *  change at any later point). That difference is what makes this field
     *  safe to read from a materialized `keyword-grant` `applies` predicate
     *  without `dependsOnCounters`, where the `+1/+1`-counter-count PROXY it
     *  replaces (issue #1716, Pouncing Kavu / Duskwalker,
     *  `cards/sets/inv/red.ts` / `cards/sets/inv/black.ts`) was not: an
     *  unkicked creature later pumped to 2+ counters would spuriously read as
     *  kicked, and a kicked one whose counters were later wiped would
     *  spuriously read as unkicked. This field is not mutated by anything
     *  else while the SAME object stays on the battlefield. It does NOT
     *  survive a CR 400.7 zone change, though (issue #1753):
     *  `resetBattlefieldTransientState` deletes it (and the stray runtime
     *  `kickerPayments` a resolved stack item can still be carrying) on a
     *  bounce to hand/library, where CR 400.7 makes the hand/library card a
     *  new object immediately. A departure to graveyard/exile does NOT clear
     *  it there — historical state is deliberately preserved while the card
     *  sits in a hidden/last-known-information zone (mirrors
     *  `exiledBySourceId` above) — but the SAME helper runs again just before
     *  any reanimation-style re-entry to the battlefield
     *  (`stageReanimatedOnBattlefield`), so a later recast (via hand) or
     *  reanimation (via graveyard/exile) of the same instance can never
     *  inherit a stale `true` onto the battlefield. Undefined for a permanent
     *  cast unkicked / without a Kicker cost. */
    wasKicked?: boolean;
    /** CR 702.33 (ADR 0079, issue #1950) — the PER-KICKER-ID twin of
     *  `wasKicked`, for a card that declares TWO OR MORE independently
     *  payable Kickers ("Kicker {A} and/or {B}", the Planeshift Battlemage
     *  cycle): `wasKicked`'s single boolean can say "kicked at all" but never
     *  WHICH of two, and the Battlemage's own ETB triggers are worded "if it
     *  was kicked with its {2}{U} kicker" / "…{2}{R} kicker" — genuinely
     *  distinct CR 603.4 intervening-ifs. Snapshotted from the resolving
     *  stack item's `kickerPayments` the instant it enters the battlefield
     *  (`finalizeSpellResolution`), the same instant `wasKicked` is derived
     *  from it via `totalKickerCount` — so the two never drift. Before this
     *  field existed, a resolved stack item still carried its `kickerPayments`
     *  onto the battlefield object as an untyped stray property (the object
     *  IS pushed as-is, per `finalizeSpellResolution`), which is what let
     *  `wasKicked` be computed at all; this promotes that from "incidental
     *  leftover a future cleanup could reasonably delete" to a supported,
     *  typed, documented read — exactly the promotion `wasKicked` itself
     *  already got over the `+1/+1`-counter-count proxy it replaced (issue
     *  #1716). Same CR 400.7 zone-change lifecycle as `wasKicked`:
     *  `resetBattlefieldTransientState` clears it on a bounce to hand/library
     *  and before any reanimation-style re-entry. Undefined for a permanent
     *  cast without a Kicker cost, or one whose Kickers were all declined. */
    kickerPayments?: KickerPayments;
    /** CR 702.33d / 702.175a (ADR 0085) — the SIBLING record: the same per-id
     *  payment tally for optional additional costs whose keyword does NOT make
     *  the spell "kicked" (CR 702.175a Offspring; CR 702.33d defines "kicked"
     *  over kicker costs alone). Written by the same partition-at-the-write
     *  that fills `kickerPayments` ({@link additionalCostPaymentSnapshot},
     *  `gre/kicker.ts`) and inherited by the permanent through the same
     *  `finalizeSpellResolution` push.
     *
     *  It exists so that `wasKicked` and every other kicked-ness read can go on
     *  consulting `kickerPayments` ALONE and stay honest — none of them needs
     *  the card definition, which matters most for the one reader that runs on
     *  the CLIENT and has none. A PER-ID question ("was its offspring cost
     *  paid?") is asked across both records via `additionalCostPaidCount`.
     *
     *  Same CR 400.7 zone-change lifecycle as `kickerPayments`:
     *  `resetBattlefieldTransientState` clears it on a bounce to hand/library
     *  and before any reanimation-style re-entry. Undefined for a permanent
     *  cast without a non-kicker additional cost, or one that declined it. */
    unkickedCostPayments?: KickerPayments;
    /** CR 107.3 / 601.2b — the value chosen for {X} in this permanent's own
     *  casting cost, snapshotted from the resolving stack item's `chosenX` the
     *  instant it enters the battlefield (`finalizeSpellResolution`). The
     *  persistent, post-ETB twin of the ephemeral `StackItem.chosenX`, exactly
     *  as `wasKicked` is to `StackItem.kickerPayments` (issue #1753) and
     *  `notedManaSpentOnCast` is to `StackItem.notedManaSpent`.
     *
     *  Needed by any predicate that runs AFTER the spell has finished
     *  resolving and must still know what X was — Ravenous (CR 702.156a,
     *  Jacked Rabbit, `cards/sets/blc/white.ts`): "When this permanent enters,
     *  if X is 5 or greater, draw a card" is a triggered ability whose CR
     *  603.4 intervening-if is re-checked when the TRIGGER resolves, long
     *  after the creature spell's stack item is gone. Three reasons the raw
     *  `chosenX` a resolved stack item leaves on the battlefield object (it is
     *  pushed as-is by `finalizeSpellResolution`) cannot be relied on there:
     *  it is untyped, it is NOT part of the card serializer (so it silently
     *  vanishes across the DB round-trip that happens at every stable point —
     *  including the one between the trigger going on the stack and it
     *  resolving), and nothing cleared it on a CR 400.7 zone change until this
     *  field's sibling clear in `resetBattlefieldTransientState`.
     *
     *  The +1/+1 counter COUNT is deliberately NOT used as a proxy for X
     *  (issue #1753): a counter can be added or annihilated by any later
     *  effect (a pump spell, `-1/-1` counters, CR 704.5q), while X is a
     *  one-shot fact fixed at CR 601.2b announcement that nothing revisits.
     *  Like `wasKicked`, it does NOT survive a CR 400.7 zone change back to
     *  the battlefield: `resetBattlefieldTransientState` deletes it. Undefined
     *  for a permanent whose cost had no {X} (or that never resolved as a
     *  spell — a token, a reanimated card). */
    chosenXOnCast?: number;
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
     *  step/phase (CR 500.5). Absent when the player has no restricted mana. */
    restrictedMana?: RestrictedMana[];
    /** Set when a player attempts to draw from an empty library (CR 704.5b). */
    hasDrawnFromEmpty?: boolean;
    /** Number of lands played by this player during the current turn
     *  (CR 305.2 / 117.2c). Reset to 0 at the start of each turn. */
    landsPlayedThisTurn?: number;
    /** Number of spells THIS PLAYER has cast during the current turn (CR
     *  601.2i), the per-player counterpart of the GLOBAL `GameState.
     *  spellsCastThisTurn` Storm counter (ADR 0052) — mirrors
     *  `landsPlayedThisTurn`'s shape (issue #1343). Incremented inside
     *  `emitSpellCastEvent`, which also snapshots the value BEFORE
     *  incrementing onto `SpellCastEvent.casterSpellCountThisTurn`; reset to 0
     *  at the start of each turn (`advanceTurn`, alongside
     *  `landsPlayedThisTurn`). Needed because the global counter can't
     *  distinguish "P1's 1st spell + P2's 1st spell = 2 total" from "P1's 2nd
     *  spell" — connive's "whenever a player casts their SECOND spell each
     *  turn" (CR 701.50, Ledger Shredder) needs the per-caster tally, not the
     *  table-wide one. */
    spellsCastThisTurn?: number;
    /** CR 702.185c — how many spells THIS PLAYER has WARPED during the current
     *  turn ("a spell was warped this turn" means "a spell was cast for its
     *  warp cost this turn"). Incremented at the one cast choke point
     *  `emitSpellCastEvent` reads `StackItem.warped` from, exactly where the
     *  Storm/connive tallies beside it are counted; reset to 0 at the start of
     *  each turn (`advanceTurn`, alongside `spellsCastThisTurn`).
     *
     *  Nothing QUERIES it yet — issue #1268 ships the keyword, not the cards
     *  that refer to it — and it is deliberately a COUNT rather than a boolean
     *  so "how many" is answerable too. It is written now because the fact is
     *  only observable at the cast: once the spell has resolved there is
     *  nothing on the board that records which cost paid for it. */
    spellsWarpedThisTurn?: number;
    /** Number of spells THIS PLAYER has cast during the WHOLE GAME (CR 601.2i),
     *  NEVER reset — the lifetime sibling of `spellsCastThisTurn` (issue #790).
     *  Incremented at the same choke point (`emitSpellCastEvent`), pre-
     *  incremented reads only. Exists to answer "is this the caster's first
     *  spell of the GAME" (Once Upon a Time's free-cast condition), a question
     *  the per-turn counter can't answer since it resets every turn. */
    spellsCastThisGame?: number;
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
    /** Count of cards that have LEFT this player's graveyard during the current
     *  turn, by any means and to any zone — exile (flashback / escape / delve
     *  cost, Bojuka Bog), the battlefield (reanimation), hand, or library
     *  (CR 400.7 — every one of those is a zone change out of the graveyard).
     *  Cleared at the start of each turn (`advanceTurn`) and nowhere else, so
     *  a tally raised during a turn is still standing at that turn's own end
     *  step for BOTH of the CR 603.4 checks the rule forces there — once when
     *  the trigger would fire, once as it resolves (Gau, Feral Youth). The
     *  opponent's end step is a DIFFERENT turn (CR 500.1 / 513.1: one ending
     *  phase per turn), by which point this has correctly reset.
     *
     *  Written at ONE chokepoint, {@link noteGraveyardDeparture} — never
     *  incremented inline by a caller. A card that never reached the graveyard
     *  (a CR 614 replacement redirected it on the way) never left it and never
     *  enters this tally, which is exactly the CR 400.7 reading: the departure
     *  is the zone change, not the destination.
     *
     *  A COUNT rather than a boolean for the same reason `deathsThisTurn` is:
     *  "a card left your graveyard this turn" is `> 0`, and a future "for each
     *  card that left your graveyard this turn" reads the same field. */
    leftGraveyardThisTurn?: number;
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
    /** COUNT of this player's upcoming turns that are skipped entirely (CR
     *  614.10). NOT a boolean (issue #1957): CR 614.10a — "If two effects
     *  each cause a player to skip their next occurrence, that player must
     *  skip the next two; one effect will be satisfied in skipping the first
     *  occurrence, while the other will remain until another occurrence can
     *  be skipped." `setSkipNextTurn` (below) increments this by 1 per call,
     *  so two independent skip effects against the same player accumulate to
     *  2 rather than collapsing to `true`. Decremented by 1 (and cleared at
     *  0) by `advanceTurn()` each time it lands on this player, mirroring
     *  `GameState.extraTurns`' own queue shape for the same reason — a turn
     *  effect that can legitimately stack cannot be represented as a flag.
     *  Set by Time Vault's untap ability and the `skipNextTurn` Effect Op
     *  (Waterspout Elemental). */
    skipNextTurn?: number;
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
    /** Experience counters on this player (CR 122.1 — "A counter is a marker
     *  placed on an object or player"). Absent means zero; no cap and no loss
     *  condition. Experience counters have NO rule of their own in the CR
     *  (`bun run cr grep "experience counter"` matches nothing) — they are an
     *  ordinary player counter whose meaning is entirely the card text that
     *  reads them (Otharri, Suns' Glory: "you get an experience counter …
     *  create a token for each experience counter you have").
     *
     *  They are never removed by any rule: CR 122.2 ("Counters on an object are
     *  not retained if that object moves from one zone to another") is scoped
     *  to OBJECTS, and a player never changes zones, so this total survives the
     *  granting permanent dying, being exiled or leaving the battlefield — that
     *  persistence is the whole engine of the cards that use it. Kept as a
     *  dedicated scalar rather than an entry in the object `counters[type]`
     *  map, mirroring `poisonCounters`/`energyCounters` (ADR 0032). */
    experienceCounters?: number;
    /** Revolt — an ability word (CR 207.2c: ability words tie together cards
     *  with similar functionality but have no rules meaning of their own and
     *  no Comprehensive Rules entry of their own, so there is no 702 section
     *  to cite). True when a permanent this player controlled left
     *  the battlefield this turn. Set by `removePermanentTo` whenever a
     *  permanent leaves the battlefield (destroy / exile / sacrifice / bounce).
     *  Reset to false at the start of each turn (`advanceTurn`). Read by
     *  cards with the Revolt ability word (Fatal Push). */
    permanentYouControlledLeftThisTurn?: boolean;
    /** Companion (CR 702.139, ADR 0064) — a SINGLE per-player slot, NOT a
     *  general "outside the game" zone. Auto-declared at game init
     *  (`buildPlayerState`, game.ts) by scanning the player's SIDEBOARD
     *  snapshot for a Companion-keyword card whose `CardDefinition.companion`
     *  condition the MAINDECK satisfies (`selectCompanion`, gre/companion.ts).
     *  `instance` is revealed to both players (CR 702.139c) — carried
     *  unchanged through `projectPublicState`/`projectFullState`, never
     *  hidden like a hand/library card. `used` is the once-per-game spent
     *  flag (CR 702.139a), set true by the `summon-companion` special action
     *  (`summonCompanion` mutation, game.ts) once its {3} cost is paid; a
     *  spent or condition-failed companion shows no summon affordance.
     *  Code that enumerates GameState zones (`ZONE_TO_FIELD` and friends)
     *  must NOT treat this as one — the instance never lives in a real
     *  zone array (`hand`/`library`/etc.) until summoned into `hand`. */
    companion?: {
        instance: CardInstanceState;
        used: boolean;
    };
};

export type StackItem = Omit<CardInstanceState, "chosenModeId"> & {
    castById: string;
    /** Targets chosen during spell announcement (CR 601.2c). Never a
     *  `lookDistribute`-bind-only "hand-card" in practice (issue #1101) — see the
     *  note on `SpellContext.targets` in `cards/types.ts`.
     *
     *  **Its INDEX is load-bearing.** A `{ target: N }` reference in an Effect
     *  Script — and every `ctx.targets[N]` in an imperative `resolve()` — names
     *  the object announced in slot `N`, so this list is never reordered and
     *  never closed up after announcement. The resolution-time legality verdict
     *  (CR 608.2b) is recorded out-of-band in `illegalTargetSlots` instead;
     *  issue #2985. */
    targets?: TargetSelection[];
    /** CR 608.2b — the indices into `targets` the resolution-time legality gate
     *  found ILLEGAL for this resolution ("Illegal targets, if any, won't be
     *  affected by parts of a resolving spell's effect for which they're
     *  illegal"). Written once by `targetLegalityGate` on a fresh resolution and
     *  read only through `buildSpellContext`, which blanks those slots in
     *  `ctx.targets` so the parts that name them are skipped while the rest of
     *  the script runs. Absent = every announced target is still legal.
     *
     *  Out-of-band rather than a flag on `TargetSelection` because the SAME
     *  object may be announced in two slots and be illegal for only one of them
     *  (CR 608.2b's Plague Spores example: one creature land chosen both as the
     *  "target nonblack creature" and as the "target land"), so the verdict
     *  belongs to the SLOT, not to the selection. Persisted (`serialize.ts`) —
     *  a resolution that suspends on a choice must resume with the same
     *  positions. Cleared wherever `targets` is re-chosen (a copy's retarget).
     *  Issue #2985. */
    illegalTargetSlots?: number[];
    /** Value chosen for X at cast-time for spells with X in their cost
     *  (CR 107.3, 601.2b). Undefined for spells without X. Read on
     *  resolution by SpellContext.getX(). */
    chosenX?: number;
    /** CR 702.33 — how many times EACH of this spell's Kicker costs was paid as
     *  it was cast, keyed by `KickerCost.id` (absent = not kicked; 1 for a paid
     *  single kicker; N for a paid-N-times Multikicker, CR 702.33e). Snapshotted
     *  at cast commit from `PendingCast.kickerPayments`.
     *
     *  Keyed per Kicker rather than a bare total because "Kicker {A} and/or {B}"
     *  (the Planeshift Battlemage cycle) has one intervening-if per Kicker and a
     *  total cannot say WHICH was paid (ADR 0079). The total is DERIVED —
     *  `totalKickerCount` (`gre/kicker.ts`) — and never stored beside this, so
     *  the two can never drift: `SpellContext.getKickerCount()`, the
     *  `{ kickerCount: true }` value and `entersWith.counters` count `"kicker"`
     *  all read the derived sum; `SpellContext.getKickerPaidCount(id)` and
     *  `{ additionalCostPaid: "<id>" }` read one entry. Undefined for spells without a
     *  Kicker cost / cast unkicked. */
    kickerPayments?: KickerPayments;
    /** CR 702.33d / 702.175a (ADR 0085) — the SIBLING of `kickerPayments`: the
     *  per-id tally for the paid additional costs whose keyword does NOT count
     *  as a kick. Both fields are written by ONE partition at cast commit
     *  ({@link additionalCostPaymentSnapshot}, `gre/kicker.ts`), which is what
     *  keeps every kicked-ness reader — including the client's, which sees a
     *  slim item with no definition — correct without any edit. Per-id reads
     *  span both records (`additionalCostPaidCount`). See
     *  {@link CardInstanceState.unkickedCostPayments} for the full doc. */
    unkickedCostPayments?: KickerPayments;
    /** CR 702.47c (issue #2394) — the PRINTED card ids of every card REVEALED
     *  from hand to splice its rules text onto this spell, in the order that
     *  text runs (CR 702.47b: the main spell's own effects happen first, then
     *  these in list order). Written by the same cast-commit partition as the
     *  two records above ({@link additionalCostPaymentSnapshot}, `gre/kicker.ts`),
     *  which resolves each payment id's revealed INSTANCE to its printed card
     *  while that instance is still in the caster's hand.
     *
     *  The printed id, not the instance, because CR 702.47c's text change is
     *  applied AS THE SPELL IS CAST and does not depend on the revealed card
     *  afterwards — CR 702.47a's own example has it discarded to the spell's own
     *  cost before resolution. Consumed at resolution by `spliceMergedEffects`
     *  (`gre/splice.ts`), which appends each named card's `effects` to the
     *  spell's own script; CR 702.47e ("the spell loses any splice changes once
     *  it leaves the stack") is free, since the field leaves the stack with the
     *  item. Undefined for every cast with no splice reveal. */
    splicedCardIds?: string[];
    /** CR 702.27a — whether this spell's Buyback cost was paid as it was cast
     *  (absent/false = not paid). Snapshotted at cast commit from
     *  `PendingCast.buybackPaid`; read at resolution by
     *  `finalizeSpellResolution` (`convex/gre/state.ts`), which routes the
     *  card to its owner's hand instead of the graveyard when set. Undefined
     *  for spells without a Buyback cost / cast without paying it. */
    buybackPaid?: boolean;
    /** Divide-as-you-choose split (CR 601.2d / 120.4). Maps a target key
     *  (`${type}:${id}`) to the amount of damage / counters the caster assigned
     *  to that target at announcement, each ≥ 1, summing to the spell's total.
     *  Read at resolve by `dealDamageDividedAsChosen` /
     *  `distributeCountersAsChosen`. Undefined when the caster did not record an
     *  explicit split (the resolver then auto-divides ≥1-each). Used by Fire
     *  Covenant, Fiery Justice, Meteor Shower, Spoils of War. */
    targetAmounts?: Record<string, number>;
    /** Mode ids chosen at announcement for a modal spell or ability (CR
     *  700.2a / 700.2b, ADR 0094) — one entry per MODE INSTANCE, normalised to
     *  printed order with a repeated mode's instances consecutive (CR 608.2c /
     *  700.2d), so array order IS execution order. On resolution each
     *  instance's body runs in turn instead of the card/ability-level body.
     *  A copy carries the whole array (CR 700.2g). */
    chosenModeIds?: string[];
    /** How many entries of the flat `targets` list each instance of
     *  `chosenModeIds` owns, index-aligned (ADR 0094): instance `i` reads
     *  `targets` from the sum of the spans before it. Stored, never inferred —
     *  a variable-count requirement makes the span undecidable after the fact.
     *  Written whenever more than one instance was chosen; a multi-instance
     *  item without it is an engine error, never an assumed zero. */
    modeTargetCounts?: number[];
    /** Snapshot of the permanent sacrificed OR exiled as an additional cost at
     *  announcement (CR 118.8 / 601.2f). Captured at commit and read at
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
        /** Effective TOUGHNESS at the moment of sacrifice — `power`'s twin
         *  (CR 613 layer 7c, last-known-information CR 608.2h). Read at resolve
         *  via `SpellContext.getAdditionalSacrificeToughness` for "gain life
         *  equal to the sacrificed creature's toughness" (Diamond Valley).
         *  Omitted for sacrificed permanents without a toughness. */
        toughness?: number;
        /** Effective COLORS at the moment of sacrifice (CR 105.2 / 613.1e
         *  layer 5, last-known information CR 608.2h, issue #3806). Read at
         *  resolve via `SpellContext.getAdditionalSacrificeColors` for
         *  "discards all cards of each of the sacrificed creature's colors"
         *  (Mind Extraction). Present for every victim — colour is not a
         *  creature-only characteristic — and an EMPTY array is the real
         *  answer for a colourless one (CR 105.2c), distinct from the field
         *  being absent on a snapshot written before this field existed. */
        colors?: Color[];
    };
    /** Type and amount of mana spent to pay THIS activation's cost (CR 106.10).
     *  Captured at activation commit (the manaPool delta) when the ability sets
     *  `noteManaSpent: true`, so the resolve step can read which colours were
     *  spent (`SpellContext.getNotedManaSpent`) and store them on the source —
     *  Jeweled Amulet ("note the type of mana spent"), Ice Cauldron ("note the
     *  type and amount of mana spent"). Per-colour counts. Undefined for the
     *  overwhelming majority of activations that don't note their mana. */
    notedManaSpent?: Record<string, number>;
    /** CR 106.6 / 701.13 (issue #1559, Delighted Halfling) — set at cast-cost
     *  commit when ANY mana leg spent on this spell carried the
     *  `RestrictedMana.cantBeCounteredRider` (`payManaCostForSpell`'s return
     *  value). Read by `counter()` alongside the static per-definition
     *  `CardDefinition.cantBeCountered`: either one makes the counter attempt
     *  fizzle (the spell stays on the stack). Per-CAST, not per-card — the
     *  same spell cast without spending that mana is perfectly counterable. */
    dynamicCantBeCountered?: boolean;
    /** CR 106.6 / 611.2c (issue #3354, Arena of Glory) — set at cast-cost
     *  commit when this spell is a CREATURE spell and any mana leg spent on it
     *  carried `RestrictedMana.hasteRider` (`payManaCostForSpell`'s verdict).
     *  Unlike `dynamicCantBeCountered`, which is read while the item is still
     *  ON the stack and dies with it, this flag exists to be HANDED OFF:
     *  `finalizeSpellResolution` turns it into an until-end-of-turn layer-6
     *  haste grant on the permanent the spell becomes, then drops it. Per-CAST
     *  — the same creature cast off ordinary mana enters summoning-sick. */
    dynamicHasteFromMana?: boolean;
    /** If set, this stack item is an activated ability (not a spell). Source permanent stays on battlefield. */
    abilityId?: string;
    /** When the activated ability was GRANTED to the source by another card
     *  (CR 113.1, e.g. Zombie Master's "{B}: Regenerate this creature."), the
     *  template lives on the granting card's def, not on the source's own
     *  card def. Set to the granting card def id; resolveTopOfStack uses it
     *  to look up `activatedAbilities[abilityId]`. Undefined for native
     *  activated abilities. */
    grantedSourceCardId?: string;
    /** Which list on `grantedSourceCardId`'s definition holds the template
     *  (issue #2943). Absent — every grant written before #2943 — means
     *  `grantTemplates[]`; `"card-abilities"` means the named card's own
     *  `activatedAbilities[]` (the CR 607.2a ability-COPY shape, Agatha's Soul
     *  Cauldron). Travels with `grantedSourceCardId` at every hand-off, because
     *  the pair is what `resolveGrantedActivatedAbility` needs to look the
     *  template up without falling back between the two lists. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
    /** If set, this stack item is a triggered ability (CR 603). The source
     *  permanent stays on the battlefield; the trigger vanishes on resolution. */
    triggeredAbilityId?: string;
    /** Instance id of the source permanent that produced this trigger (the
     *  id on the battlefield, not the stack item id). Captured at trigger
     *  time; read by `SpellContext.sourceInstanceId` on resolution so the
     *  resolver can re-inspect the source (intervening-if, CR 603.4). */
    triggerSourceId?: string;
    /** CR 608.2h / 113.7a departure-time LAST KNOWN INFORMATION for the source
     *  permanent named by `triggerSourceId` (issue #2042). Stamped by
     *  `removePermanentTo` — the single battlefield-departure funnel — onto
     *  every stack item already sourced from the departing instance, and
     *  preferred over the live battlefield lookup by `resolveTopOfStackInner`
     *  when it re-evaluates `TriggeredAbility.interveningIf` (CR 603.4).
     *
     *  Why the stack item and not the card: CR 400.7 makes a returning
     *  permanent a NEW object, but the engine never reallocates the instance
     *  id, so a blink (Ephemerate) puts a same-id permanent back on the
     *  battlefield with `resetBattlefieldTransientState` having wiped exactly
     *  the fields an `interveningIf` reads (`chosenXOnCast`,
     *  `hasAttackedThisTurn`, `counters`). A card-level snapshot would be
     *  wiped by that same reset (see `countersAtLeave`, which is); a
     *  stack-item snapshot survives it and dies with the item, so it needs no
     *  prune window.
     *
     *  Its PRESENCE is itself the "this source departed since the trigger was
     *  created" signal — that is why no battlefield-ENTRY stamp exists (entry
     *  is not a single funnel; departure is). Written once, never overwritten:
     *  the LKI of the object the ability was sourced from is fixed the moment
     *  that object ceased to exist, so a SECOND departure of the new same-id
     *  object must not replace it.
     *
     *  A THIRD LKI shape, deliberately: `removePermanentTo` already computes
     *  EFFECTIVE (layer-folded) P/T for the PERMANENT_LEFT payload that death
     *  triggers read, and ADR 0086 proposes a store of COPIABLE values for
     *  `createTokenCopyOf`. This one is neither — it is the raw instance
     *  record as it last sat on the battlefield, because `interveningIf`
     *  predicates read raw instance fields (`self.hasAttackedThisTurn`,
     *  `self.counters`), never effective or copiable ones. Do not unify the
     *  three: they answer different questions. */
    sourceLki?: CardInstanceState;
    /** The originating event captured at trigger time. Passed to resolve(). */
    triggerEvent?: GameEvent;
    /** CR 603.3b — for a `oncePerEventBatch` ability, the FULL set of events in
     *  the firing batch (not just the first). `triggerEvent` above still holds
     *  the first member for the singular-event paths (intervening-if re-check,
     *  `$event` refs); this is the extra channel a batch-aware `resolve()` reads
     *  to enumerate every member — Twilight Diviner's "copy one of THEM" choice
     *  over a simultaneous reanimation (issue #2954). Undefined for a plain
     *  single-event trigger (and never set for a delayed/emblem trigger), so a
     *  resolver can treat `triggerEventBatch ?? [triggerEvent]` as the batch. */
    triggerEventBatch?: GameEvent[];
    /** CR 608.2 / 603.3 (issue #1189) — set the FIRST time this triggered
     *  ability's resolution has tallied `GameState.abilityResolutionCounts`
     *  (`recordAbilityResolution`, `resolveTopOfStackInner`). A dedicated
     *  per-item guard rather than reusing `resolutionStep`: `resolutionStep`
     *  is ONLY set by a `resolveSteps` loop or the DSL interpreter's own
     *  checkpointing (`runEffectScript`) — a plain imperative `resolve()`
     *  ability that suspends via a bare `ctx.requestChoice` (Scythecat Cub's
     *  target pick) leaves `resolutionStep` undefined across the
     *  suspend/resume replay, so gating the tally on it would double-count.
     *  This flag is set unconditionally on first tally and simply travels
     *  with the stack item until it resolves/pops — no cleanup needed. */
    abilityResolutionRecorded?: boolean;
    /** CR 702.35a — set on the synthetic reflexive triggered ability that a
     *  discarded madness card puts on the stack (`buildMadnessReflexiveTrigger`,
     *  triggers.ts). Holds the id of the exiled card. On resolution
     *  (`resolveTopOfStack`) `openMadnessCastWindow` opens the owner's single
     *  cast window on that card. Distinct from `triggeredAbilityId` (no card-def
     *  ability lookup — the reflexive ability is engine-owned). */
    madnessTrigger?: string;
    /** CR 702.88a — set on the synthetic reflexive triggered ability a fired
     *  Rebound delayed trigger puts on the stack (`buildReboundReflexiveTrigger`,
     *  triggers.ts). Holds the id of the still-exiled rebound card. On
     *  resolution (`resolveTopOfStackInner`) `openReboundCastWindow` opens the
     *  caster's single Cast/Decline window on that card. Mirrors
     *  `madnessTrigger`; distinct because Rebound schedules through the
     *  DELAYED TRIGGER infra (next-upkeep) rather than an immediate
     *  event-driven collection. */
    reboundTrigger?: string;
    /** CR 702.185a — set on the synthetic triggered ability a fired Warp
     *  delayed trigger puts on the stack (`buildWarpExileTrigger`,
     *  triggers.ts). Holds the id of the permanent the warp spell became. On
     *  resolution (`resolveTopOfStackInner`) `applyWarpExile` (`gre/warp.ts`)
     *  exiles that permanent and opens the owner's not-before-next-turn recast
     *  window. Mirrors `reboundTrigger` exactly — same delayed-trigger infra,
     *  same engine-owned (no card-def ability) shape; distinct because what
     *  resolves is an EXILE plus a grant, not a Cast/Decline prompt. */
    warpTrigger?: string;
    /** CR 114 (issue #1221) — set on a triggered ability that fired from a
     *  command-zone emblem (`buildEmblemTriggerItem`, triggers.ts). Holds the
     *  emblem's `emblemId`; `resolveTopOfStack` reads it to resolve the
     *  triggered ability from the emblem registry (`convex/cards/emblems.ts`)
     *  rather than the card registry — the emblem's abilities aren't a
     *  `CardDefinition`, so the generic triggered-ability branch (which looks
     *  up `cardDef.triggeredAbilities`) can't find them. Distinct from
     *  `triggerSourceId`, which carries the emblem's instance id for LKI. */
    emblemSourceId?: string;
    /** Cast-Copy (ADR 0052) — present ONLY on a synthesized cast-copy
     *  trigger's own stack item: Storm's (CR 702.40, `triggeredAbilityId ===
     *  "storm"`) or Replicate's (CR 702.56, `triggeredAbilityId ===
     *  "replicate"`). The trigger id names which keyword supplied the count;
     *  the mechanism below is identical for both. A detached snapshot of the
     *  spell being copied, captured at cast time — NOT a live stack reference
     *  — so `resolveCastCopyTrigger` still creates copies from it even if the
     *  original spell has since left the stack (countered). See
     *  `collectCastTriggers`. */
    castCopySnapshot?: StackItem;
    /** Cast-Copy Count — copies still to create as this trigger resolves.
     *  Fixed at cast time by the keyword that supplies it (CR 702.40a Storm:
     *  `priorSpellCount`; CR 702.56a Replicate: the times its cost was paid);
     *  decremented by one per copy created. The trigger stays on the stack
     *  (peek-and-pop) while this is > 0 so a suspended per-copy retarget
     *  prompt resumes the loop for the next copy rather than losing progress. */
    castCopiesRemaining?: number;
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
    /** ADR 0048 — the oracle text of a fired delayed trigger (CR 603.7a) that
     *  was scheduled inline by the DSL `delayedTrigger` Op. Copied from
     *  `DelayedTriggerInstance.oracleText` when the trigger fires, because an
     *  inline trigger carries the constant `INLINE_DELAYED_TRIGGER_ID` as its
     *  `delayedTriggerId` — there is NO `cardDef.delayedTriggers[]` row for the
     *  client to look the text up from. The stack UI reads this to render the
     *  ability tile (art + oracle text) instead of the full-card image. Undefined
     *  for the legacy template path, where the text lives on the card def. */
    delayedOracleText?: string;
    /** CR 701.27f (issue #3249) — where this fired delayed trigger came from:
     *  `seq` is the `N` of the `delayed-N` instance (the `nextDelayedSeq`
     *  value its CREATION took), `sourceInstanceId` the permanent whose
     *  ability created it. `SpellContext.transform` reads both so "a delayed
     *  triggered ability of a permanent" never transforms that permanent when
     *  it has already transformed since the delayed trigger was created. */
    delayedOrigin?: { seq: number; sourceInstanceId?: string };
    /** CR 701.27f (issue #3537) — which permanent this activated or
     *  triggered ability belongs to and its `transformCount` at the moment the
     *  ability was put onto the stack (`stackTransformStamp`, gre/transform.ts),
     *  stamped by `buildActivatedAbilityStackItem`, `buildTriggerItem` and a
     *  reflexive trigger's placement. An explicit field rather than the
     *  snapshot's own cloned `transformCount`, so an item nothing stamped (a
     *  spell, a delayed trigger) is never mistaken for one whose source has
     *  not transformed. */
    stackTransformStamp?: StackTransformStamp;
    /** CR 603.12/603.3d — the target requirement of a REFLEXIVE triggered
     *  ability (the `reflexiveTrigger` Op). A reflexive ability has no
     *  `cardDef.triggeredAbilities[]` row, so the requirement its targets are
     *  announced from rides ON the stack item instead;
     *  `raiseTriggerTargetSelection` reads it exactly where it would read a
     *  card-def ability's `targetRequirement`. Undefined for a non-targeted
     *  reflexive ability and for every other kind of stack item. */
    inlineTargetRequirement?: TargetRequirement;
    /** CR 603.12 — marks this stack item as a REFLEXIVE triggered ability
     *  (created by the `reflexiveTrigger` Op). It rides the inline-body
     *  machinery (`delayedTriggerId` / `delayedEffects`) but, unlike a genuine
     *  delayed / Madness / Storm firing, it IS an ordinary triggered ability
     *  its controller may order against other simultaneous triggers
     *  (CR 603.3b) — this flag is what tells `isPlainTrigger` so. */
    reflexiveTrigger?: boolean;
    /** CR 725 (issue #1305) — a source-less inherent DESIGNATION triggered
     *  ability on the stack (the Monarch's end-step draw). Keys a state
     *  designation (`convex/cards/designations.ts`) so the stack UI renders the
     *  marker-card art + name instead of the empty tile a card-less inline
     *  trigger would otherwise show (`card.id` is ""). Purely cosmetic — the
     *  resolution path is the inline `delayedEffects` one. */
    designationId?: string;
    /** Per-source Scryfall print id overriding the designation's global marker
     *  art on this tile (issue #1305). Set by `buildMonarchDrawStackItem` from
     *  `state.monarchSourceCardId` (resolved via `tokenPrintIdFor`) so the
     *  Monarch draw shows the granting card's own set-themed marker; omitted
     *  when there is no themed source, and the client falls back to
     *  `designation.imagePrintId`. Cosmetic only. */
    designationImagePrintId?: string;
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
     *  rather than moving to a graveyard (CR 707.10a), and it can never
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
    /** CR 702.88a — true iff this spell has Rebound AND was cast from HAND
     *  (stamped at cast-commit by `reboundCastStackFlags`, game.ts — the
     *  gate that makes CR 702.88a "free": an exile recast never carries this
     *  flag, so it can't rebound again). Read by `finalizeSpellResolution`
     *  (state.ts): when set, the resolving non-permanent spell is exiled
     *  instead of graveyarded and a caster-scoped next-upkeep delayed
     *  trigger is scheduled. */
    reboundFromHand?: boolean;
    /** Acting Player (ADR 0037): the player who answers this item's resolution
     *  choices, split off from the controller (`castById`) for a controlled
     *  cast (Word of Command — the controller of WoC decides for the opponent
     *  whose card was put on the stack). Defaults to `castById` when absent —
     *  read via `getActingPlayer`. Equal to `castById` for all normal play, so
     *  every existing cast is unaffected. Cleared when the item leaves the
     *  stack ("you control the player while that spell is resolving"). */
    actingPlayerId?: string;
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
     *  global-boundary timings (which fire on ANY player's step) UNLESS the
     *  scheduling mechanism is itself caster-scoped — CR 702.88a Rebound's
     *  "at the beginning of YOUR next upkeep" sets it on an otherwise-global
     *  `next-upkeep` instance for exactly this reason (`fireDelayedTriggers`'
     *  match check honors `targetPlayerId` whenever present, regardless of
     *  timing). */
    targetPlayerId?: string;
    /** CR 603.7 (issue #3812) — the turn the trigger was CREATED on, set only
     *  for `player-next-turn-end-step`: "that player's NEXT turn" is a turn
     *  that begins after this one, so `fireDelayedTriggers` refuses to fire
     *  it while `state.turn` still equals this value. */
    scheduledOnTurn?: number;
    /** For the `leaves-battlefield` timing (CR 603.7a / 603.10): the specific
     *  instance whose `PERMANENT_LEFT` event fires this delayed trigger ("when
     *  THAT creature leaves the battlefield this turn, …"). Undefined for every
     *  phase-boundary timing. A pending leave-watch expires unfired at CLEANUP
     *  (the "this turn" bound, CR 514.2). */
    watchInstanceId?: string;
    /** CR 509.3d (issue #3809) — the `becomes-blocked-by` timing's blocker
     *  condition: the watched creature's delayed trigger fires only for a
     *  blocking creature having at least one of these colours ("becomes
     *  blocked by a creature OF THAT COLOR", Zombie Boa). Read against the
     *  `BLOCKERS_CONFIRMED` event's own layer-5 `blockerColors`. Absent means
     *  "blocked by a creature" with no colour condition; never set on any
     *  other timing (validator-enforced). */
    blockerColors?: Color[];
    /** CR 701.27f (issue #3249) — the permanent whose ability CREATED this
     *  delayed trigger (the scheduling stack item's `triggerSourceId`, else
     *  its own id — `SpellContext.sourceInstanceId`). Carried onto the fired
     *  stack item's `delayedOrigin`, so "a delayed triggered ability of a
     *  permanent" can be told apart from one that merely targets it. */
    sourceInstanceId?: string;
    /** CR 702.88a (Rebound) — marks this delayed trigger as the rebound
     *  reflexive Cast/Decline window rather than a generic scheduled effect.
     *  Holds the instance id of the exiled rebound card (in the
     *  `controller`'s exile). When set, `fireDelayedTriggers` (phases.ts)
     *  builds a `buildReboundReflexiveTrigger` StackItem (triggers.ts)
     *  instead of the generic `buildDelayedTriggerStackItem` path — casting a
     *  spell is not an Op, so this can't run through `delayedEffects` like
     *  every other delayed trigger. Undefined for every non-rebound
     *  instance. */
    reboundCardInstanceId?: string;
    /** CR 702.185a (Warp) — marks this delayed trigger as the next-end-step
     *  WARP EXILE rather than a generic scheduled effect. Holds the instance id
     *  of the permanent the warp spell became. When set, `fireDelayedTriggers`
     *  (phases.ts) builds a `buildWarpExileTrigger` StackItem (triggers.ts)
     *  instead of the generic `buildDelayedTriggerStackItem` path.
     *
     *  It is engine-owned rather than an inline Effect Script body for one
     *  reason: CR 400.7. The ability must exile "the permanent this spell
     *  BECAME", so at fire time it has to ask whether the object still standing
     *  under that id is the same one — a permanent that left and returned is a
     *  new object and must not be chased — and no check-time predicate
     *  available to a delayed body can ask that. The battlefield-side marker
     *  (`CardInstanceState.warped`, cleared by
     *  `resetBattlefieldTransientState` on the way out) is what answers it.
     *  Undefined for every non-warp instance. */
    warpCardInstanceId?: string;
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
    /** CR 702.33 — which of this spell's Kickers the caster chose to pay at
     *  announcement, and how many times each (absent = not kicked; > 1 for one
     *  entry only under Multikicker, CR 702.33e). Each paid Kicker's MANA leg is
     *  folded into `manaCost`, its LIFE leg into `payLife`, and its PERMANENT /
     *  HAND legs into this cast's `sacrificeSelection` /
     *  `alternativeCostHandChoice` pickers (CR 702.33a — a Kicker cost is an
     *  additional cost of ANY kind, ADR 0079). The record is propagated to the
     *  stack item at commit so resolution reads
     *  `SpellContext.getKickerCount()` / `getKickerPaidCount(id)`. */
    kickerPayments?: KickerPayments;
    /** CR 702.27a — whether the caster chose to pay this spell's Buyback cost
     *  at announcement (absent/false = not paid). The buyback mana is folded
     *  into `manaCost` alongside it; the flag is propagated to the stack item
     *  at commit so `finalizeSpellResolution` routes the card to hand. */
    buybackPaid?: boolean;
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
    /** Mode ids chosen at announcement for a modal spell (CR 700.2a, ADR
     *  0094), printed order. Undefined for non-modal spells. Propagated to the
     *  stack item. */
    chosenModeIds?: string[];
    /** Per-instance target spans of `chosenModeIds` — see
     *  `StackItem.modeTargetCounts`. */
    modeTargetCounts?: number[];
    /** Acting Player (ADR 0037): the player who answers every resolution choice
     *  for this cast, split off from the controller (`playerId`) for a
     *  controlled cast (Word of Command). Defaults to `playerId` when absent —
     *  read via `getActingPlayer`. Propagated onto the resulting StackItem so
     *  the spell's resolution choices also route to the acting player. */
    actingPlayerId?: string;
    /** In-progress additional cost picker (CR 118.8 / 601.2f). Set when the
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
     *  own cost, CR 601.2a). `pickedCardIds` is undefined until the player
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
        /** CR 702.66 (Delve) — the `payWith` VARIABLE-OFFSET mode (CR 601.2g,
         *  ADR 0063). When set, the picker accepts ANY number of cards in
         *  `min..max` and `count` is ignored (a nominal 0). Each picked card
         *  pays for {1} of the spell's GENERIC cost (CR 702.66b) — never a
         *  coloured pip — applied by decrementing this `PendingCast`'s
         *  `manaCost.X` as the pick is recorded, exactly like the Improvise
         *  clamp, so `isManaCostCovered` needs no payWith-specific branch.
         *  `min` is the shortfall the caster's mana can't cover (0 = purely
         *  tactical); `max` is min(eligible graveyard cards, generic remaining
         *  after CR 601.2f reductions). Built by `buildDelveExileChoice`
         *  (`gre/payWith.ts`). Undefined for every non-delve exile cost. */
        offsetGeneric?: { min: number; max: number };
    };
    /** In-progress "exile / discard N cards from your HAND" ALTERNATIVE-cost
     *  picker (CR 118.9 — Force of Will's "exile a blue card", Foil's "discard
     *  an Island card and another card"). Set when the chosen alternative cost
     *  carries a `CostLegs.hand` leg (`{ action, requirements }`, ADR 0079) and
     *  the choice is real (more matching hand cards than required).
     *  `requirements` mirror that leg's hand requirements
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
    /** CR 702.109a — true iff the alternative cost chosen for this cast is the
     *  card's Dash cost (`chosenAltCost === cardDef.dash` at announcement).
     *  Carried through a parked cast (real mana payment, or a real non-mana
     *  pick when Dash composes with another cost) so the deferred commit
     *  (`tryAutoCommitPendingCast`) can still tag the resulting stack item
     *  `dashed: true` once mana is covered / the pick resolves. */
    dashed?: boolean;
    /** CR 702.185a — true iff the alternative cost chosen for this cast is the
     *  card's Warp cost (`chosenAltCost === cardDef.warp` at announcement).
     *  Carried through a parked cast — a warp cost is pure MANA, so it parks on
     *  `tapForPayment` like any ordinary one — so the deferred commit
     *  (`tryAutoCommitPendingCast`) can still tag the resulting stack item
     *  `warped: true`. Same shape and same reason as `evoked`/`dashed` above:
     *  the choice is made at announcement (CR 601.2b) but the stack item is not
     *  built until commit, and without the carry the permanent that enters is
     *  one nobody warped — bought at the discount and never exiled. */
    warped?: boolean;
    /** CR 702.103a — true iff the alternative cost chosen for this cast is the
     *  card's Bestow cost (`isBestowAlternativeCost` at announcement). Carried
     *  through a parked cast (the ordinary "tap for the mana" park, or a real
     *  non-mana pick) so the deferred commit (`tryAutoCommitPendingCast`) can
     *  still apply the CR 702.103b characteristic change to the resulting
     *  stack item once mana is covered / the pick resolves. Same shape as
     *  `evoked`/`dashed` above, and the same reason: the choice is made at
     *  announcement (CR 601.2b) but the stack item is not built until commit. */
    bestowed?: boolean;
    /** CR 702.37a/c — true iff the alternative cost chosen for this cast is the
     *  card's MORPH face-down cast (`isMorphCastAlternativeCost` at
     *  announcement). Carried through the parked cast so the deferred commit
     *  (`tryAutoCommitPendingCast`) can still turn the resulting stack item
     *  FACE DOWN once the {3} is covered. Same shape and same reason as
     *  `bestowed` above — the choice is made at announcement (CR 601.2b), the
     *  stack item is not built until commit — and, like `bestowed`, this is not
     *  a marker for a later trigger but a rewrite of the object put on the
     *  stack (CR 702.37c: "Put it onto the stack (as a face-down spell with the
     *  same characteristics)").
     *
     *  The parked cast leaks nothing: `PendingCast` carries only a
     *  `cardInstanceId`, and the card is still in the caster's HAND while the
     *  payment is open, where the opponent's projection nulls it. */
    morphed?: boolean;
    /** CR 702.96a — true iff the alternative cost chosen for this cast is the
     *  card's Overload cost (`isOverloadAlternativeCost` at announcement).
     *  Carried through a parked cast for the same reason as `evoked`/`dashed`/
     *  `bestowed`/`morphed`: the mode is chosen at announcement (CR 601.2b) but
     *  the stack item is not built until commit, and without it the deferred
     *  commit would build an item whose text was never changed — a spell that
     *  cost the overload price and then affected the one thing it never
     *  targeted. */
    overloaded?: boolean;
    /** CR 715.3 (ADR 0120) — true iff the alternative cost chosen for this cast
     *  is the card's ADVENTURE cast (`isAdventureCastAlternativeCost` at
     *  announcement). Carried through the parked cast for the same reason as
     *  `bestowed`/`morphed`, and it is the same KIND of thing they are: not a
     *  marker for a later trigger but a rewrite of the object put on the stack
     *  (CR 715.3b — "while on the stack as an Adventure, the spell has only its
     *  alternative characteristics"). Without it the deferred commit puts the
     *  CREATURE half on the stack for a cast the caster paid the Adventure's
     *  price for. */
    castAsAdventure?: boolean;
    /** CR 709.3 (ADR 0121) — which HALF of a split card this cast announced,
     *  or `undefined` for every other cast. Same kind of thing as
     *  `castAsAdventure` beside it and carried for the same reason: it is not
     *  a marker for a later trigger but a rewrite of the object put on the
     *  stack (CR 709.3b — "while on the stack, only the characteristics of the
     *  half being cast exist"). Without it the deferred commit — a cast whose
     *  mana was paid across a separate `tapForPayment` mutation — would put
     *  the COMBINED card on the stack for a cast the caster paid one half's
     *  price for. */
    castAsSplitHalf?: SplitHalfSide;
    /** CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — the "a sorcery
     *  couldn't have been cast right now" snapshot, taken at ANNOUNCEMENT
     *  (`announceCast`, before any cost is paid) and carried here so the
     *  deferred commit stamps the same value it would have stamped had the
     *  cast completed in one mutation. Re-deriving it at commit is NOT
     *  equivalent: paying mana is part of casting (CR 601.2g/h), and
     *  `tapForPayment` → `resolveManaAbilityTriggerImmediately` can leave a
     *  SUSPENDED triggered mana ability (CR 605.4a — Fertile Ground's colour
     *  pick) sitting on the stack when `tryAutoCommitPendingCast` runs in the
     *  same mutation, which would turn an ordinary sorcery-speed main-phase
     *  cast into a false positive. Same announcement-snapshot shape as
     *  `evoked`/`dashed` above; absent = the cast WAS at sorcery timing. */
    castOffSorceryTiming?: boolean;
    /** CR 601.2b / 118.8 — id of the ADDITIONAL-cost leg the caster picked out
     *  of `CardDefinition.additionalCosts.oneOf` (Bitter Triumph's "discard a
     *  card or pay 3 life"), carried from announcement. The legs themselves are
     *  already PAID or already BUILT into this pending cast by the time it
     *  parks (life folded into `payLife`, discard folded into
     *  `alternativeCostHandChoice`, sacrifice/exile into `sacrificeSelection` /
     *  `additionalCost`) — this field is the record of WHICH leg that was, so
     *  the board can label the picker and a replay can be read back. Absent for
     *  a card with no disjunction. */
    additionalCostLegId?: string;
    /** CR 702.126 — Improvise: ids of untapped artifacts the caster has tapped
     *  DURING this payment, each paying for {1} of the spell's GENERIC cost
     *  (only reduces `manaCost.X`/generic, never a colored pip — CR 702.126a).
     *  Tapping directly decrements `manaCost.X` (mirrors the `reductionGeneric`
     *  cost-modifier clamp in `applyCostModifiers`) so `isManaCostCovered`
     *  needs no special-casing; untapping (`untapArtifactForImprovise`) or a
     *  cancelled/abandoned payment (`rollbackPendingCast`) restores it and
     *  untaps the artifact. Mirrors `tappedLandIds`'s rollback-tracking shape,
     *  kept as a separate list since these taps never add to the mana pool. */
    improviseTappedArtifactIds?: string[];
    /** CR 702.51 / 601.2g (`payWith`, ADR 0063 — issue #1338) — Convoke: the
     *  in-progress creature-tap picker for a cast being paid by tapping
     *  creatures. Convoke is a COLOURED `payWith`: each tapped creature pays for
     *  {1} OR one mana of that creature's colour (CR 702.51a), so it can satisfy
     *  a generic pip, a single-colour pip, or a guild-hybrid pip (`{B/G}`). Set
     *  by `buildConvokeCreatureChoice` (`gre/payWith.ts`) when the cast has
     *  convoke; commit is blocked until the player calls `selectConvokeCreatures`
     *  (or it auto-resolves). `min`/`max` bound the tap count (min = the
     *  hybrid + single-colour pips only convoke can pay under can't-spend-mana;
     *  max = all payable pips capped by eligible creatures). `hybridPips` /
     *  `coloredPips` are the pips convoke must satisfy, matched to creature
     *  colours by the shared greedy at record. `pickedCreatureIds` is undefined
     *  until the pick is recorded; the creatures are TAPPED at cast commit
     *  (`tryAutoCommitPendingCast`), so cancelling leaves them untapped. Rides
     *  inside `pendingCast`, persisted with the parent (no separate serialize
     *  key), mirroring `exileFromGraveyardChoice`. */
    convokeCreatureChoice?: {
        min: number;
        max: number;
        hybridPips: [Color, Color][];
        coloredPips?: Partial<Record<Color, number>>;
        pickedCreatureIds?: string[];
    };
    /** CR 601.2g — an ambiguous generic-mana payment parked awaiting the caster's
     *  choice of which mana in the pool pays the generic cost. Set at the payment
     *  finalize point (`tryAutoCommitPendingCast`) when
     *  `genericSpendAmbiguityForPayment` returns non-null and no spend order was
     *  supplied; the cast is NOT put on the stack until `resolveManaSpendChoice`
     *  supplies a valid order and resumes the commit. `generic` is the amount
     *  owed; `candidateColors` are the pool colors the caster may draw it from.
     *  Rides inside `pendingCast` (mirroring `sacrificeSelection`), so it is
     *  persisted with the parent and needs no separate serialize key. */
    manaSpendChoice?: GenericSpendAmbiguity;
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
    /** CR 700.2a / 602.2b (issue #1341, ADR 0094) — modes locked in at
     *  announcement for a MODAL activated ability (Umezawa's Jitte), printed
     *  order. Propagated to the stack item at commit so resolution dispatches
     *  the chosen modes' bodies. Undefined for a non-modal ability. */
    chosenModeIds?: string[];
    /** Per-instance target spans of `chosenModeIds` — see
     *  `StackItem.modeTargetCounts`. */
    modeTargetCounts?: number[];
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback on cancel. */
    tappedLandIds: string[];
    /** True iff the ability has a {T} cost — applied at commit. */
    tapSource: boolean;
    /** True iff the ability has a sacrifice cost — applied at commit. */
    sacrificeSource: boolean;
    /** CR 605.3b (issue #3455) — this announcement belongs to a MANA ability:
     *  at commit it resolves IMMEDIATELY, without ever being put on the stack
     *  and without granting priority. The park exists only because the ability's
     *  cost carries a FILTERED give-up leg (`sacrificeFilter` /
     *  `discardFilter` — Ashnod's Altar, Skirk Prospector, Phyrexian Tower,
     *  Bog Witch) that the payer must answer; every other mana ability still
     *  resolves inline at its own mutation with no record here at all.
     *  Non-park: a flag read at commit, never a pick anyone is waiting on. */
    resolveWithoutStack?: boolean;
    /** CR 605.1a / 601.2b (issue #3455) — the mana a `resolveWithoutStack`
     *  activation will ADD at commit, resolved at ANNOUNCEMENT: the option the
     *  activator picked from a chooser (Orcish Lumberjack's RRR/RRG/RGG/GGG),
     *  or the ability's fixed `manaProduced` (Ashnod's Altar's {C}{C}).
     *  Locked here rather than re-derived at commit because the choice is made
     *  when the ability is activated (CR 601.2b) and the board it was derived
     *  from can change while the cost pick is open. Absent for a mana ability
     *  whose output is an Effect Script / `resolve()` body, which runs through
     *  a transient stack item instead. Non-park: a choice already made. */
    inlineManaOutput?: ManaCost;
    /** Unified filtered-sacrifice choice for this activation (CR 602.1 / 118.5 /
     *  701.21a): the ability's own "sacrifice a permanent matching <filter>"
     *  cost AND any board-wide static additional sacrifice (Drought), folded
     *  into one selection. Commit is blocked while it is incomplete regardless
     *  of mana coverage; on commit the picked permanents are sacrificed and the
     *  snapshot-flagged victim's mv/subtypes/power ride on the stack item (read
     *  at resolve via getAdditionalSacrificeMv/Power — Priest of Yawgmoth,
     *  Freyalise Supplicant). */
    sacrificeSelection?: SacrificeSelection;
    /** CR 702.49a — true iff `sacrificeSelection` above is a NINJUTSU return
     *  leg rather than a sacrifice. A marker qualifying the selection, read at
     *  commit (the `cyclingCost` shape): the selection itself already carries
     *  `action: "return"`, but the commit path works off `pendingActivation`
     *  and never re-resolves the ability, so this is what tells it to capture
     *  the returned creature's defender (CR 702.49c) before the bounce removes
     *  it from combat. Nothing to submit, so nobody is waiting on the payer. */
    returnUnblockedAttacker?: boolean;
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
    /** In-progress "tap untapped permanents matching <filter> you control"
     *  cost picker (CR 602.1, 118.8 — Hand of Justice "Tap three untapped white
     *  creatures you control"; CR 702.122a Crew N "tap any number of untapped
     *  creatures you control with total power N or greater"). Set when the
     *  ability has `cost.tapOtherFilter`. `pickedIds` accumulates the player's
     *  choices via `selectActivationCost`; commit is blocked until
     *  `isTapOtherSelectionComplete` (`gre/tapOtherCost.ts`) says the cost is
     *  paid, regardless of mana coverage. On commit each picked permanent is
     *  tapped (distinct from the source's own {T}). The source is never a legal
     *  pick.
     *
     *  `count` and `totalPower` mirror the declared `cost.tapOtherFilter`
     *  shapes (exactly one is set). `pickedPower` is the running sum of the
     *  picks' crew contributions (effective power + `crewPowerBonus`, CR
     *  702.122b), recomputed server-side on every pick so the client can render
     *  the remaining-power hint without re-deriving effective power itself. */
    tapOtherChoice?: {
        filter: PermanentFilter;
        count?: number;
        totalPower?: number;
        pickedIds: string[];
        pickedPower?: number;
    };
    /** Counter-removal cost (CR 122.6 — "Remove a [type] counter from this
     *  creature"). Applied at commit. */
    removeCounterCost?: { type: string; count: number };
    /** Life-payment cost (CR 119.4 — "Pay N life"). Validated up-front at
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
    /** CR 702.29c / 702.29f — the deferred `discardThisSource` above pays an
     *  activation cost of a CYCLING ability (cycling or typecycling), so the
     *  discard performed at commit carries `cause: "cycling"`. Mirrors
     *  `ActivatedAbility.cost.cyclingCost`, which `buildPendingActivation`
     *  copies here: the ability object is not in scope at the commit site, and
     *  re-deriving the fact from an id or oracle text would fail open. Absent
     *  ⇒ an ordinary discard cost (Harvester of Misery). */
    cyclingCost?: boolean;
    /** CR 702.129a / 118.3 — the Eternalize "Exile this card from your
     *  graveyard" cost. When set, the SOURCE card moves graveyard → exile at
     *  commit. Deferred to commit for the same reason as `discardThisSource`:
     *  a cancelled or dropped mana payment must leave the graveyard exactly as
     *  it was (CR 601.2h). */
    exileThisSource?: boolean;
    /** CR 602.1a / 118.1 — the `cost.returnThisToHand` leg's intent, carried
     *  from announcement to commit exactly as `exileThisSource` is, so a
     *  cancelled mana payment leaves the permanent on the battlefield
     *  (CR 601.2h). Paid by `payReturnThisToHandCost`. */
    returnThisToHandSource?: boolean;
    /** CR 701.43a / 602.1a — the `cost.exertThis` leg's intent, carried to
     *  commit so a cancelled mana payment leaves the source un-exerted. Always
     *  payable (CR 701.43b), so unlike the zone-move legs it needs no re-check
     *  at commit. */
    exertSource?: boolean;
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
    /** CR 601.2d / 120.4 — divide-as-you-choose split assigned at target
     *  selection (Arc Mage). Propagated to the stack item's `targetAmounts` at
     *  commit so the ability's resolve reads the caster's chosen division.
     *  Undefined for a non-divide ability. */
    targetAmounts?: Record<string, number>;
    /** Source card def id when the ability was granted to the activator's
     *  permanent by another card (CR 113.1). Pipes through to StackItem so
     *  resolveTopOfStack reads the correct template. Undefined for native
     *  activated abilities. */
    grantedSourceCardId?: string;
    /** Which list on `grantedSourceCardId`'s definition holds the template
     *  (issue #2943). Absent — every grant written before #2943 — means
     *  `grantTemplates[]`; `"card-abilities"` means the named card's own
     *  `activatedAbilities[]` (the CR 607.2a ability-COPY shape, Agatha's Soul
     *  Cauldron). Travels with `grantedSourceCardId` at every hand-off, because
     *  the pair is what `resolveGrantedActivatedAbility` needs to look the
     *  template up without falling back between the two lists. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
    /** Noted-mana battery (CR 106.10 — Jeweled Amulet / Ice Cauldron). Set when
     *  the ability declares `noteManaSpent: true`. At commit the engine captures
     *  the manaPool delta (which colours paid the cost) and writes it onto the
     *  resulting stack item as `notedManaSpent`. */
    noteManaSpent?: boolean;
    /** CR 601.2g — an ambiguous generic-mana payment parked awaiting the
     *  activator's choice of which mana pays the generic cost. Mirrors
     *  `PendingCast.manaSpendChoice`: set at the activation finalize point
     *  (`tryAutoCommitPendingActivation`) when
     *  `genericSpendAmbiguityForPayment` returns non-null and no order was
     *  supplied, cleared and resumed by `resolveManaSpendChoice`. Rides inside
     *  `pendingActivation`, so it is persisted with the parent. */
    manaSpendChoice?: GenericSpendAmbiguity;
};

/** Tracks the {3} payment for the `summon-companion` special action (CR
 *  116.2 / 702.139a, ADR 0064). Deliberately minimal next to `PendingCast`/
 *  `PendingActivation`: the companion summon has no card being cast/
 *  activated, no target, no mode, no additional cost leg — just a fixed
 *  generic cost against `player.companion`. See the `GameState.
 *  pendingCompanionPay` doc for why this is a dedicated state. */
export type PendingCompanionPay = {
    playerId: string;
    /** Always `{ X: 3 }` (CR 702.139a's fixed {3}) — kept as a normalized
     *  `Record<string, number>` cost, mirroring `PendingCast.manaCost`, so it
     *  can be handed straight to `solveSmartAutoTap`/`payManaCost`. */
    manaCost: Record<string, number>;
    /** Land ids tapped during this payment, for rollback/audit — mirrors
     *  `PendingCast.tappedLandIds`. */
    tappedLandIds: string[];
};

/** A unit of restricted mana floating in a player's pool (CR 106.6). Produced
 *  by effects like Metamorphosis ("Add X mana of any one color … Spend this
 *  mana only to cast creature spells"). Kept separate from the fungible
 *  `manaPool` so the spend restriction can be enforced at payment time; emptied
 *  alongside `manaPool` at end of step/phase (CR 500.5).
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
    /** CR 106.6 rider (Delighted Halfling, issue #1559 — Cavern of Souls
     *  carries the same rider on its own, still-unbuilt restriction) — a
     *  spell paid for with this mana can't be countered. Orthogonal to
     *  `restriction`: it never changes which spells the mana is ELIGIBLE to
     *  pay for (that's `restriction`'s job), only what happens to the spell
     *  once mana carrying it is actually spent on it. Detected at payment by
     *  `payManaCostForSpell`, which reports back whether any spent unit
     *  carried it so the caller can stamp `StackItem.dynamicCantBeCountered`;
     *  read at counter time by `counter()` alongside the static
     *  `CardDefinition.cantBeCountered`. */
    cantBeCounteredRider?: true;
    /** CR 106.6 rider #2 (Arena of Glory, issue #3354 — "If that mana is spent
     *  on a creature spell, it gains haste until end of turn"). Same class as
     *  `cantBeCounteredRider` — a property the mana carries that changes what
     *  happens to the spell it is spent on — but the FIRST rider that rides an
     *  UNRESTRICTED unit: Arena's mana may pay for anything, so the unit has
     *  neither `restriction` nor `castableCardId` and
     *  `restrictedUnitAllowsSpell` / `restrictedUnitAllowsAbility` both return
     *  `true` for it. Detected at payment by `payManaCostForSpell`, which
     *  reports it only when the spell paid for is a CREATURE spell (the
     *  oracle's own condition), so the caller stamps
     *  `StackItem.dynamicHasteFromMana`; handed off at
     *  `finalizeSpellResolution` onto the permanent the spell becomes, as an
     *  until-end-of-turn layer-6 keyword grant (CR 611.2c). */
    hasteRider?: true;
    /** CR 702.189a (firebending, issue #3235) — how long this unit survives
     *  the CR 500.5 end-of-step mana-pool emptying. Absent (every other unit,
     *  including every rider-tagged one) means the default: the unit empties
     *  with the fungible pool as each step and phase ends.
     *
     *  NOT a {@link ManaRiders} member, and deliberately so: a rider never
     *  changes which spells the mana may pay for NOR how long it lasts — it
     *  changes what happens to the spell it is spent on. This is a LIFETIME,
     *  orthogonal to both `restriction` (eligibility) and the riders
     *  (consequences), and a firebending unit carries no restriction and no
     *  rider at all: it is plain red mana that simply outlives its step.
     *
     *  It is part of the CR 106.4 bucket key everywhere `restriction`,
     *  `castableCardId` and the riders are (deposit, reversal, balance
     *  lookup): two units of the same colour that empty at different moments
     *  are not the same kind of mana, so a persistent unit must never merge
     *  into an ephemeral one — nor, more dangerously, be the unit an untap
     *  reversal decrements. */
    persistsUntil?: ManaPersistence;
};

/** CR 106.6 — the riders a unit of mana can carry: properties that never
 *  change WHICH spells the mana may pay for (that is `ManaRestriction`'s job),
 *  only what happens to the spell once mana carrying them is actually spent on
 *  it. One record rather than a growing tail of booleans, so every bucket key,
 *  every deposit and every reversal names the same shape and a third rider
 *  costs one field instead of one parameter at eight call sites.
 *
 *  `undefined` and `{}` both mean "no riders" and both key the same
 *  (untagged) bucket — see {@link manaRidersEqual}. */
export type ManaRiders = {
    /** Delighted Halfling (issue #1559) — the spell can't be countered. */
    cantBeCountered?: boolean;
    /** Arena of Glory (issue #3354) — a CREATURE spell gains haste UEOT. */
    haste?: boolean;
};

/** What a spell's mana payment turned out to carry (CR 106.6) — the same two
 *  riders as {@link ManaRiders}, but as a REQUIRED-field verdict rather than an
 *  optional tag, because every cast-commit site must decide both questions and
 *  a missing field there would read as "no" by accident. Returned by
 *  `payManaCostForSpell` and turned into stack-item fields by
 *  {@link manaRiderStackStamps}. */
export type SpellManaRiders = {
    /** Delighted Halfling (issue #1559) — stamps `dynamicCantBeCountered`. */
    cantBeCountered: boolean;
    /** Arena of Glory (issue #3354) — the spell WAS a creature spell and the
     *  mana carried the haste rider; stamps `dynamicHasteFromMana`. */
    haste: boolean;
};

/** The zone a play-land action is sourcing its card from (CR 305.9 — hand
 *  unless an effect explicitly says otherwise). Lives here rather than in
 *  `gre/playLand.ts` because `PendingChoice.landSourceZone` needs it and
 *  `playLand.ts` imports FROM `gre/state.ts`, never the other way round;
 *  `playLand.ts` re-exports it so its existing importers are unaffected. */
export type PlayLandSourceZone = "hand" | "exile" | "graveyard" | "library-top";

/** Where the land a suspended `land-entry-tapped` pay-choice (CR 614.12) is
 *  waiting on currently SITS. The four `PlayLandSourceZone` values are the
 *  play-land origins, each of which suspends BEFORE its zone move so the card
 *  is still in its source zone; `"battlefield"` is the effect-entry case (a
 *  tutored / reanimated land already put onto the battlefield provisionally
 *  tapped, with its ETB deferred — `stageReanimatedOnBattlefield`). */
export type LandEntrySourceZone = PlayLandSourceZone | "battlefield";

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
     *  `candidateIds` rather than a hidden-zone snapshot. `exile` (issue
     *  #1156 — Dauthi Voidwalker) is the same public-zone shape. */
    zone?: "battlefield" | "hand" | "library" | "graveyard" | "exile";
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
     *  702.24). A bare `ManaCost` (mana-only, historical shape) OR the shared
     *  `CostLegs` shape (cumulative upkeep — ADR 0042 / 0079). Undefined for
     *  cost-less yes/no choices ("may draw a card"). The submit path
     *  (`applyMayPaySubmit`) normalizes either shape. */
    cost?: MayPayCost;
    /** For a `kind: "may-pay"` whose PERMANENT leg opened the battlefield
     *  picker (`zone: "battlefield"`), the leg's terminal action — `"sacrifice"`
     *  (CR 701.21) or `"return"` to the owner's hand (CR 400.7 / 118.9, ADR
     *  0079). Drives the prompt WORDING client-side and nothing else — its one
     *  consumer is `mayPayPermanentPickVerb` (`src/lib/pending-choice-labels
     *  .ts`); the bot re-derives the action from `cost.permanent` itself
     *  (`gre/ai/choiceCandidates.ts`, `src/lib/ai/bot-view.ts`). Absent for a
     *  cost with no permanent leg (and for every non-may-pay kind).
     *  Denormalized from `cost.permanent.action` so the prompt need not
     *  re-derive it from the cost union. */
    permanentAction?: "return" | "sacrifice";
    /** For `kind: "land-entry-tapped"` only (CR 614.12, ADR 0051) — the
     *  instance id of the land currently entering, which is still sitting in
     *  the zone named by `landSourceZone` while this choice is pending (a
     *  PLAYED land suspends BEFORE the zone move; an effect-put land is
     *  already on the battlefield). `finalizeLandEntry` reads it to complete
     *  the entry on submit. */
    landInstanceId?: string;
    /** For `kind: "land-entry-tapped"` only (CR 614.12, ADR 0051, issue #1980)
     *  — WHERE `landInstanceId` currently is, so `finalizeLandEntry` can find
     *  it again on submit. The explicit, fail-closed discriminator that
     *  replaced a hand-then-library-top sniff: the sniff could not see a land
     *  played from `"exile"` (a hideaway / impulse-draw permission) or from a
     *  `"graveyard"` (Icetill Explorer), which is why neither origin dared
     *  raise this choice at all and a shock land played from exile entered
     *  untapped for free. `"battlefield"` is the effect-entry case
     *  (`stageReanimatedOnBattlefield` — a tutored / reanimated land already
     *  in play with its ETB deferred). Every enqueue site passes it; it is
     *  optional only so a choice persisted before this field existed still
     *  finalizes, through the legacy sniff. */
    landSourceZone?: LandEntrySourceZone;
    /** For `kind: "land-entry-tapped"` only (CR 712.12, ADR 0122 §2) — WHICH
     *  FACE of `landInstanceId` is being played, when the play was a modal
     *  double-faced card's ("a player playing a modal double-faced card … as a
     *  land chooses one of its faces that's a land BEFORE putting it onto the
     *  battlefield"). The choice window sits between that choice and the zone
     *  move, so the answer has to be carried across it: absent means
     *  `"front"`, which is every land that is not modal.
     *
     *  Carried rather than re-derived on submit for the same fail-closed
     *  reason `landSourceZone` is: a re-derivation could not tell "the front
     *  face is also a land and that is what the player picked" from "the back
     *  face is the only land face" for a `land // land` pathway, and CR 712.12
     *  makes that a real choice with two answers. It is also why CR 712.8a
     *  stays satisfied — the card in hand keeps its front-face identity for
     *  the whole window, and the swap happens at the zone move. */
    landEntryFace?: PlayLandFace;
    /** For `kind: "madness-cast"` only (CR 702.35a) — the instance id of the
     *  discarded-and-exiled card this choice decides. The client's "Cast" button
     *  fires `announceCast` on it (which consumes the choice); the DECLINE routes
     *  through `submitMadnessDecline`, which reads it to bin the card. */
    cardInstanceId?: string;
    /** For `kind: "choose-aura-host"` only (CR 303.4f) — the instance id of the
     *  Aura currently entering, held off every zone in
     *  `GameState.stagedEntries` while this choice is pending.
     *  `finalizeAsEnters` reads it to match the choice to its staged Aura and
     *  complete the attachment + entry on submit. */
    auraInstanceId?: string;
    /** ADR 0100 D5 — the instance id of the permanent held in
     *  `GameState.stagedEntries` that this choice belongs to. It is the
     *  EXPLICIT, fail-closed discriminator that routes a submission to the
     *  as-enters finalize instead of the generic mid-resolution tail: an
     *  as-enters park enqueues with `stackItemId: ""`, so the generic tail would
     *  throw `Stack item not found` on it, and `kind` alone cannot tell an
     *  as-enters `option-pick` from an ordinary resolution-time one. Set on
     *  EVERY as-enters choice (the CR 303.4f `choose-aura-host` included) and on
     *  nothing else. */
    asEntersCardId?: string;
    /** ADR 0100 D3 — which member of the `AsEntersChoice` union this choice is
     *  answering. Carried on the choice so the finalize dispatches on the
     *  declared kind rather than re-deriving it from the (reused)
     *  `PendingChoiceKind` shape. Set together with `asEntersCardId`. */
    asEntersKind?: AsEntersChoice["kind"];
    /** The card definition id of the subject this choice is ABOUT. The client
     *  renders it as a card image ABOVE the prompt, so the chooser sees WHICH
     *  card the question refers to. Carried verbatim through the wire
     *  projection.
     *
     *  Two producers, and the second is why this is not only an off-zone
     *  escape hatch: a subject that is reachable in no projected zone at all
     *  (a `choose-aura-host` Aura held in `stagedEntries`), and a subject that
     *  IS in a projected zone but would otherwise go unnamed by a prompt that
     *  deliberately says "the card" (the resolve-time Cast/Decline offer,
     *  issue #3413).
     *
     *  CR 406.3 — a `PendingChoice` crosses the wire UNREDACTED to both
     *  viewers, so this field tells the OPPONENT which card it is just as
     *  surely as naming it in `prompt` would. THE RULE: set it only for a card
     *  whose identity is ALREADY PUBLIC, never for a face-down one. Inside an
     *  Effect Script, `SpellContext.getPublicCardIdentity` is what answers
     *  that; the two producers that cannot reach a SpellContext at all
     *  (`gre/madness.ts`, `gre/rebound.ts`) set it unconditionally and are
     *  correct in substance — a madness card was publicly discarded, a rebound
     *  card was public on the stack. */
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
    /** `kind: "search-library"` only (CR 701.23a, issue #788 re-review
     *  finding 1) — set when this choice is a GENUINE library search (CR
     *  701.23a: look at the whole library, filtered by card characteristics),
     *  as opposed to a "look at the top N, pick one" prompt that reuses
     *  `search-library` for its candidate-restricted picker UI (Expressive
     *  Iteration, Diabolic Vision — `candidateIds` there is a peeked TOP-N
     *  window, not a library-wide filter match). `emitLibrarySearchedEvent`
     *  gates on this flag rather than on `kind` alone or on
     *  `candidateIds === undefined` (the latter is an implicit invariant that
     *  fails OPEN the moment a future look-pick card sets no `candidateIds`).
     *  Set explicitly at every genuine raise site — the DSL `choice` Op
     *  (`gre/effects/interpreter.ts`, whenever `kind === "search-library"`,
     *  since that Op's library branch always scans the WHOLE library via
     *  `matchesCardFilter`, never a peeked window) and each genuine raw
     *  `resolve()` search (Path to Exile, Erode, Demonic-Tutor-shaped
     *  Altar of Bone, Jester's Mask, the Transmute search). Undefined on a
     *  choice persisted before this field existed — `emitLibrarySearchedEvent`
     *  then fails CLOSED (no spurious trigger) for that in-flight choice,
     *  never open. */
    isSearch?: true;
    /** `look-distribute` only (issue #1266, Narset, Parter of Veils) — the
     *  subset of the looked-at `candidateIds` that may go to HAND. The full
     *  `candidateIds` window is still shown face-up ("look at the top four"),
     *  but a card outside `eligibleIds` (e.g. a creature/land under Narset's
     *  "noncreature, nonland" filter) can only be placed on the BOTTOM. The
     *  backend rejects a hand pick outside it; the frontend picker locks such a
     *  card out of the hand pile. Undefined = every looked-at card is
     *  hand-eligible (Impulse, Stock Up — the unfiltered dig). */
    eligibleIds?: string[];
    /** `look-distribute` only (Narset, Parter of Veils) — the un-kept cards go
     *  to `destination` in a RANDOM order, so the submitted second-zone order
     *  is discarded server-side. The frontend routes such picks to the simple
     *  grid pick (choose the hand cards; nothing to order) instead of the
     *  two-zone drag picker — an ordering UI for a random outcome would be a
     *  lie. Undefined/absent = the rest is ordered (Impulse, Stock Up). */
    randomizeRest?: boolean;
    /** `look-distribute` (issue #1364, Atraxa, Grand Unifier) or
     *  `choose-categorized` (issue #1945, Noxious Vapors / Planar Overlay) —
     *  a CATEGORIZED keep: at most one member per category, and a member that
     *  qualifies for several categories may be kept for only ONE of them
     *  (a multicoloured card, a dual land). Each entry is a display label
     *  plus the matching instance ids — revealed library cards for
     *  `look-distribute`, hand/battlefield ids for `choose-categorized`. A
     *  keep-set is legal exactly when an injective member → category
     *  assignment exists (the bipartite matching in
     *  `gre/categorizedPick.ts`); `count.max` is that matching's size. The
     *  backend rejects an unmatchable submission; the frontend gates each
     *  click through the SAME helper, so the two never disagree. Undefined =
     *  an ordinary uncategorized dig (Impulse, Narset). See `categoryRule`
     *  for the second legality rule the same buckets can carry. */
    categories?: { label: string; cardIds: string[] }[];
    /** Which of `gre/categorizedPick.ts`'s two legality rules validates this
     *  categorized pick (issue #1945). Absent = the INJECTIVE rule described
     *  on `categories` above (Atraxa's "for each card type you MAY put A card
     *  of that type into your hand" — every existing consumer). `"cover"` =
     *  each non-empty category must be ANSWERED, and one member may answer
     *  SEVERAL categories at once (Gatherer, Planar Overlay: "a dual land
     *  could be chosen as two of your land types"; Noxious Vapors' gold card
     *  may be the card chosen for both its colours). Under `"cover"`,
     *  `count.min` is the smallest covering set — smaller than `count.max`
     *  whenever a member answers more than one category. Server and client
     *  branch on the SAME field, so the Done gate and the submit validation
     *  can never disagree about which rule applies. */
    categoryRule?: "cover";
    /** Whether being PICKED is good or bad for the chooser (issue #1945) — a
     *  pure POLICY hint for the bot, never read by the rules engine.
     *  `"picked-kept"`: the picks survive and the unpicked rest is swept
     *  (Noxious Vapors' `onPicked: "keep"`), so the chooser wants its BEST
     *  members picked. `"picked-removed"`: the picks are exactly what leaves
     *  (Planar Overlay's `returnToHand` bounce), so the polarity is INVERTED
     *  and the chooser wants its WORST members picked. Without it the bot
     *  ranks every categorized pick "best first" and deterministically
     *  bounces its two best lands. Undefined = `"picked-kept"` (every other
     *  kind's polarity — a pick is something gained). */
    pickPolarity?: "picked-kept" | "picked-removed";
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
     *  option, with a `ManaSymbol` icon when `color` is set (a choice among
     *  the five colors — CR 105.1 — "choose a color" / protection-granting
     *  abilities). Used by Primal Clay / Shapeshifter (choose-body-on-entry,
     *  no `color`) and the color-choice family (Mother/Giver of Runes,
     *  Blind Seer, `chooseColorEffects`). */
    options?: {
        id: string;
        label: string;
        color?: Color;
        /** Set ONLY when this option is a genuine "protection from the colour
         *  of your choice" pick (CR 702.16a) — `protectionColorModes`
         *  (`cards/abilities/index.ts`), never `colorChoiceModes`/`COLOR_OPTIONS`
         *  (issue #2306 review finding 1). `color` above is a UI RENDERING tag
         *  set by BOTH families (`cards/types.ts`'s `EffectMode.color` doc) —
         *  it says nothing about intent, so `color` alone cannot gate a
         *  bot heuristic that should apply to a DEFENSIVE "dodge a threatened
         *  colour" pick and must NOT apply to an OFFENSIVE/neutral
         *  "become a colour" pick (a directional inversion for the latter).
         *  Derived structurally by the `optionChoice` interpreter Op: true
         *  only when the mode's own effects grant an ability that
         *  `parseProtectionFromColor` (`gre/protection.ts`, the issue's own
         *  named single authority) resolves back to this same `color` — never
         *  a hand-set flag a card author could get wrong. */
        protectionColor?: Color;
        /** Set ONLY when this option IS a SUBTYPE offered by an as-enters
         *  `{ kind: "subtypes" }` choice — a creature type (CR 205.3m) for
         *  Engineered Plague and Conspiracy, a basic land type (CR 205.3i) for
         *  Illusionary Terrain's ordered pair. It carries the subtype itself
         *  rather than a bare flag, so a consumer never has to assume
         *  `id === label === subtype`. Its reader (`subtypeModePrior`) censuses
         *  every permanent's subtypes, not only creatures', for exactly that
         *  reason: the two families share this channel.
         *
         *  Its reason for existing is the BOT, and it is the structural twin of
         *  `protectionColor` directly above: CR 205.3m's table is ~280 entries,
         *  so this is the one `option-pick` whose option list is two orders of
         *  magnitude wider than `CHOICE_TOP_K`. With no structural hint every
         *  option scores the flat `NEUTRAL_PRIOR`, the top-K truncation keeps
         *  the first eight ALPHABETICALLY, and the bot names Advisor on every
         *  board in the game — legal, enumerated, and inert. `subtypeModePrior`
         *  (`gre/ai/choicePriors.ts`) reads this to rank the subtypes actually
         *  represented on the battlefield; which of THOSE is best is left to
         *  the search, so no sign (a debuff wants the opponent's tribe, a lord
         *  wants its own) is baked in here. */
        subtype?: string;
    }[];
    /** For `kind: "order-top"` only — the second zone the un-kept looked-at
     *  cards are sent to (`library-bottom` scry / `graveyard` surveil / `none`
     *  order-only Ponder). Set when the choice is raised; read by the resolve
     *  step (`SpellContext.orderTop`) to apply the split. See
     *  {@link LibraryDestination}. A `look-distribute` choice may additionally
     *  name `"exile"` (`LookDistributeDestination`) — Karn, Scion of Urza's +1
     *  sends the un-kept card to exile with a silver counter, issue #1570. */
    destination?: LookDistributeDestination;
    /** `kind: "look-distribute"` only (issue #2070) — where the KEPT cards
     *  land: `"hand"` (every card shipped before #2070), `"library-top"`
     *  (Thassa's Oracle) or `"battlefield"` (issue #3249, Aang, at the
     *  Crossroads). Orthogonal to `destination` above, which names the
     *  UN-kept cards' target. Set at the one raise site
     *  (`SpellContext.requestChoice` from the `lookDistribute` Op) — never
     *  left to an implicit default (fail-closed: a consumer that forgets to
     *  branch on it should see `undefined`, not silently assume "hand").
     *  Read by the frontend picker to label the keep-pile and by the bot's
     *  look-distribute chooser to decide whether "kept" competes with the
     *  hand-size / card-advantage heuristics a hand-bound keep implies. */
    keepTo?: LookDistributeKeepTo;
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
    /** For `kind: "name-card"` only (issue #1085) — a restriction on the
     *  legal name, checked at SUBMIT time (`applyNameCardSubmit`,
     *  `pendingChoiceSubmit.ts`) rather than post-hoc filtered by the
     *  resolving Op. `"no-basic-land"` is CR 201.4a's "a card name other than
     *  a basic land card name" (Desperate Research) — a submission naming
     *  Plains/Island/Swamp/Mountain/Forest/Wastes is rejected and the
     *  chooser is asked again, exactly like every other illegal-choice
     *  rejection in that pipeline. `"no-land"` (issue #2713) is the STRONGER
     *  printed wording, Cabal Therapy's "a nonland card name": every land is
     *  rejected, basic or not. Undefined = no restriction (Petra
     *  Sphinx — any registered card name is legal). */
    nameRestriction?: NameRestriction;

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

    // --- numeric-nomination family (CR 107.1b / 107.3f, issue #1701) ---
    /** For `kind: "number-pick"` only — the FLOOR of the nominal range. Absent
     *  means 0, which is every shipped nomination: "pay any amount of mana"
     *  and "you may pay {X}" both admit X = 0 (CR 107.3f), and 0 IS the
     *  decline. */
    numberMin?: number;
    /** For `kind: "number-pick"` only — the AUTHORED ceiling of the nominal
     *  range, when the ability's own text caps it. Absent for a `paysMana`
     *  nomination whose only bound is the payer's pool: never read directly,
     *  always through {@link numberChoiceRange}, which is the one place that
     *  decides between an authored cap and the live pool. */
    numberMax?: number;
    /** For `kind: "number-pick"` only — the nominated amount is also PAID, as
     *  generic mana out of the payer's pool (CR 107.3f "you may pay {X}" /
     *  "may pay any amount of mana", issue #1701). The payment rides the
     *  existing may-pay payment path (`canPayMayPayCost` / `payMayPayCost`
     *  with a `{ mana: { generic: amount } }` leg), honouring
     *  `manaRestriction` exactly as every other may-pay leg does. Absent for a
     *  bare nomination that spends nothing. */
    paysMana?: true;
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
    /** If set, EXCLUDES legal permanent targets whose card types include ANY of
     *  these (CR 109.1). Propagated from TargetRequirement.excludeTypes — the
     *  interactive-choice mirror of the `getLegalTargets` filter, so the
     *  offered set and the accepted set can't diverge. Used by "nonland
     *  permanent" (Phelia's `type: PERMANENT_TYPES` + `excludeTypes: "Land"`). */
    excludeTypes?: CardType[];
    /** If set, EXCLUDES specific permanent instances by id (CR 601.2c "other
     *  than ~"). Propagated from TargetRequirement.excludeInstanceIds — carries
     *  the reflexive self-exclude resolved from `excludeSource` for a triggered
     *  ability (Phelia's own source id), so "up to one OTHER target permanent"
     *  can't pick its own source in the interactive choice. */
    excludeInstanceIds?: string[];
    /** If set, EXCLUDES permanents of any of these colors (CR 202.2, Terror's
     *  "nonblack"). Propagated from TargetRequirement.excludeColors. */
    excludeColors?: Color[];
    /** If set, restricts to tapped / untapped permanents (CR 701.26).
     *  Propagated from TargetRequirement.tappedFilter. */
    tappedFilter?: "tapped" | "untapped";
    /** If set, restricts to permanents in the named combat role(s) (CR 508.1 /
     *  509.1, "target attacking/blocking creature"). Propagated from
     *  TargetRequirement.combatRoleFilter. */
    combatRoleFilter?: "attacking" | "blocking" | ("attacking" | "blocking")[];
    /** If set, restricts to permanents that HAVE this keyword ability (CR 702,
     *  "target creature with flying"). Propagated from
     *  TargetRequirement.requireAbility. */
    requireAbility?: string;
    /** If set, restricts to permanents that have AT LEAST ONE of these keyword
     *  abilities (CR 702 — OR semantics, "target creature with trample or
     *  haste"). Propagated from TargetRequirement.requireAbilityAny. */
    requireAbilityAny?: ReadonlyArray<string>;
    /** If set, EXCLUDES permanents that have this keyword ability (CR 702,
     *  "target creature without flying"). Propagated from
     *  TargetRequirement.excludeAbility. */
    excludeAbility?: string;
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
     *  is the activating player (CR 115.7 / 115.10). Propagated from
     *  TargetRequirement.spellSingleTargetingController. Used by Reflecting
     *  Mirror. Ignored for non-spell target types. */
    spellSingleTargetingController?: boolean;
    /** Restricts legal SPELL targets to spells that would destroy a land the
     *  activating player controls (CR 114.1 + 701.7). Propagated from
     *  TargetRequirement.spellWouldDestroyLandYouControl. Used by Equinox's
     *  granted counter ability. Ignored for non-spell target types. */
    spellWouldDestroyLandYouControl?: boolean;
    /** Restricts legal SPELL targets to stack objects that THEMSELVES target
     *  a permanent matching EVERY clause at once (CR 115.2 / 109.2).
     *  Propagated from TargetRequirement.spellTargetsPermanentFilter (already
     *  LOWERED — `types` is normalized to an array). Used by Confound
     *  ("counter target spell that targets a creature") and Teferi's Response
     *  ("...that targets a land you control"). Ignored for non-spell target
     *  types. */
    spellTargetsPermanentFilter?: {
        types?: CardType[];
        controller?: TargetRequirement["controller"];
    };
    /** Restricts legal SPELL targets by the candidate's own Kicker state
     *  (CR 702.33a — `true` = kicked only, `false` = unkicked only).
     *  Propagated from TargetRequirement.spellWasKicked. Used by Ertai's
     *  Trickery. Ignored for non-spell target types. */
    spellWasKicked?: boolean;
    /** Restricts a stack-object target by object kind (CR 113 / 114.1).
     *  Propagated from TargetRequirement.spellStackKind. Used by Brown Ouphe
     *  ("counter target activated ability ...") and Stifle ("... activated or
     *  triggered ability", `"ability"`), and Ward ("... spell or ability",
     *  `"any"`, CR 702.21a). Ignored for non-spell types. */
    spellStackKind?: "spell" | "activated-ability" | "ability" | "any";
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
    /** Restricts legal PLAYER targets to players controlling strictly more
     *  permanents of `type` than the `than` baseline seat (CR 601.2c, issue
     *  #2707). Propagated from TargetRequirement.playerControlsMoreThan. Used
     *  by Oath of Druids ("target player who controls more creatures than they
     *  do and is their opponent"). Ignored for non-player target types. */
    playerControlsMoreThan?: {
        type: CardType;
        than: "you" | "active";
    };
    /** Zone the target lives in (CR 109.2). Default "battlefield" — set to
     *  "graveyard" for reanimation/recursion spells like Regrowth. Propagated
     *  from TargetRequirement.zone. */
    zone?: "battlefield" | "graveyard";
    /** Restricts targets by relationship to the chooser. Propagated from
     *  TargetRequirement.controller. Honored only when zone is non-default.
     *  `"active"` restricts to the active player's permanents (Arcum's
     *  Whistle). */
    controller?: "you" | "opponent" | "any" | "active";
    /** CR 601.2c (issue #1104) — cross-slot same-controller constraint
     *  (Barrin's Spite: "two target creatures controlled by the same
     *  player"). Propagated from TargetRequirement.sameController through
     *  `lowerPermanentFilters` (ADR 0068's generic per-key lower loop — no
     *  per-construction-site edit needed). Read by `selectTarget`
     *  (`game.ts`) alongside `selected` to compute the sibling's live
     *  controllerId via `siblingControllerIdFor`. */
    sameController?: boolean;
    /** Restricts legal permanent targets by token-ness (CR 111.5, issue
     *  #1195). `true` keeps ONLY tokens; `false` keeps ONLY nontoken
     *  permanents. Propagated from TargetRequirement.isToken. */
    isToken?: boolean;
    /** CR 302.6 / 400.7 (issue #1824) — restricts legal permanent targets to
     *  those their current controller has controlled continuously since the
     *  beginning of the turn (Norritt, Arcum's Whistle). Propagated from
     *  TargetRequirement.controlledSinceTurnStart through
     *  `lowerPermanentFilters`. Evaluated by `hasControlledSinceTurnStart`
     *  (`gre/controlContinuity.ts`), which reads `GameState.turn` +
     *  `GameState.controlChangedThisTurn` — both of which the CLIENT must
     *  supply on its synthetic filter state or the check fails CLOSED. */
    controlledSinceTurnStart?: boolean;
    /** Restricts legal permanent targets by their CURRENT attachment (CR
     *  303.4b — "target Aura attached to a land" / "... attached to a
     *  creature you control"). Propagated from
     *  TargetRequirement.attachedToFilter through `lowerPermanentFilters`.
     *  Read by the SAME `checkPermanentTargetFilters` authority both
     *  `getLegalTargets` (offered set) and `selectTarget` (accepted set) run
     *  against the candidate's OWN `attachedTo` host, never the candidate
     *  itself. Used by Pyramids/Savaen Elves ("attached to a land") and
     *  Miracle Worker ("attached to a creature you control"). */
    attachedToFilter?: {
        types?: CardType[];
        controlledBy?: "you" | "opponent" | "any" | "active";
    };
    /** Targets already selected. */
    selected: TargetSelection[];
    /** Divide-as-you-choose budget (CR 601.2d / 120.4). When set, this spell
     *  divides this total of damage / counters among the chosen targets, each
     *  target receiving at least 1. Propagated from the card's resolved total
     *  (Fire Covenant = chosen X, Meteor Shower = X+1, Fiery Justice = 5,
     *  Spoils of War = derived X). Drives the cap on target count (a player
     *  can't choose more targets than the total) and the per-target amount UI. */
    divideTotal?: number;
    /** What the divided budget DOES (default `"deal"` damage when omitted) —
     *  propagated from `TargetRequirement.divideAsChosen.kind`. `"prevent"`
     *  for Pollen Remedy's divided damage prevention; the frontend's divide
     *  banner reads this to label the finalize button correctly instead of
     *  always saying "Deal damage". */
    divideKind?: "deal" | "prevent";
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
    /** CR 702.33 — which of this spell's Kickers the caster chose to pay at
     *  announcement, and how many times each (absent = not kicked). Propagated
     *  from announceCast through `finalizeTargetSelection` → pendingCast → stack
     *  item so the kicked target set (`kickedTargetRequirement`) governs this
     *  selection and the per-Kicker record reaches resolution (ADR 0079). */
    kickerPayments?: KickerPayments;
    /** CR 702.27a — whether the caster chose to pay this spell's Buyback cost
     *  at announcement (absent/false = not paid). Propagated from announceCast
     *  through `finalizeTargetSelection` → pendingCast → stack item so
     *  resolution routes the card to hand instead of the graveyard. */
    buybackPaid?: boolean;
    /** CR 601.3c / 601.2f (issue #2146) — whether this cast owes the card's
     *  conditional-flash SURCHARGE ("You may cast this spell as though it had
     *  flash if you pay {2} more to cast it"). Unlike `buybackPaid` this is
     *  NOT a caster choice: it is DERIVED once at announcement by
     *  `flashSurchargeRequired` (`gre/rules.ts`) — mandatory when the cast
     *  relies on the CR 601.3c permission, impossible when it doesn't — and
     *  locked in here so `finalizeTargetSelection` folds the surcharge into
     *  the total without re-deriving the timing on a board that has moved on
     *  (CR 601.6a: having begun the cast under the permission, the caster
     *  finishes it even if the condition stops being met). Absent = no
     *  surcharge owed. Deliberately NOT propagated to the stack item —
     *  nothing downstream reads "was this surcharged". */
    flashSurchargePaid?: boolean;
    /** CR 107.4f — how many of this cast's Phyrexian pips ({C/P}) the caster
     *  chose to pay with LIFE (2 each), propagated from announceCast so the
     *  mana-vs-life split is applied at cast commit
     *  (`finalizeTargetSelection` → `resolvePhyrexianCastPayment`). Absent =
     *  auto-resolve to the most-life affordable split. Used by targeted
     *  Phyrexian spells (Dismember, Gitaxian Probe). */
    phyrexianLifePips?: number;
    /** Mode ids chosen at announcement for a modal spell or ability (CR
     *  700.2a, ADR 0094), printed order. Propagated to the stack item. Their
     *  target groups are flattened, instance by instance, into this
     *  selection's group queue (`remainingRequirements`). */
    chosenModeIds?: string[];
    /** Which mode INSTANCE (index into `chosenModeIds`) owns the group being
     *  chosen now, then each queued group in `remainingRequirements` order
     *  (ADR 0094). Undefined unless more than one instance was chosen. */
    groupModeInstances?: number[];
    /** Targets each earlier-completed instance has locked in so far, index-
     *  aligned with `chosenModeIds` — becomes the stack item's
     *  `modeTargetCounts` at finalization. Undefined unless more than one
     *  instance was chosen. */
    modeTargetCounts?: number[];
    /** CR 601.2c (issue #4193) — which half of the effect each announced
     *  target of the CURRENT group will receive, index-aligned with the
     *  group's slots ("returned to its owner's hand", "dealt 2 damage" for a
     *  kicked Jilt). The per-Target twin of `groupModeInstances` above: a
     *  single instance of the word "target" may announce several objects the
     *  script then reads POSITIONALLY, and without this the caster picks
     *  blind and the first click silently takes slot 0.
     *
     *  Derived ONCE at announcement from the resolving script
     *  (`announcedTargetRoles`, `gre/targetRoles.ts`) rather than re-derived
     *  on the client, so the prompt states what the ENGINE will do and cannot
     *  drift from it (ADR 0074 — the client is a view). Absent whenever the
     *  derivation cannot tell the slots apart, which is every symmetric card
     *  (Magma Burst, Rushing River) and every single-target announcement:
     *  their prompt is unchanged. Cleared when the walk advances to the next
     *  independent group (`applyRequirementToPendingTarget`). */
    announcedTargetRoles?: string[];
    /** CR 118.9 — id of a chosen ALTERNATIVE casting cost
     *  (`CardDefinition.alternativeCosts`), propagated from announcement so it
     *  is paid at cast commit (`finalizeTargetSelection`) instead of the mana
     *  cost. Used by targeted alt-cost spells (Thwart, Fireblast). */
    alternativeCostId?: string;
    /** CR 601.2b / 118.8 — id of the ADDITIONAL-cost leg the caster picked out
     *  of `CardDefinition.additionalCosts.oneOf` ("discard a card OR pay 3
     *  life", Bitter Triumph). Chosen at ANNOUNCEMENT, before targets and
     *  before any payment, and propagated here because a targeted cast spans
     *  several mutations: `finalizeTargetSelection` re-reads the card's
     *  additional cost from the definition and must flatten the SAME leg the
     *  caster named (`resolveAdditionalCosts`, `gre/additionalCost.ts`).
     *  Absent for a card with no disjunction. */
    additionalCostLegId?: string;
    /** CR 601.2 / 307.1 / 117.1a / 601.3a (issue #2473) — the announcement-time
     *  "a sorcery couldn't have been cast right now" snapshot, taken in
     *  `announceCast` and propagated through `finalizeTargetSelection` → the
     *  stack item (or → `PendingCast.castOffSorceryTiming` when the cast then
     *  parks for payment). A TARGETED cast spans several mutations, so the
     *  board it commits on is not the board it was announced on; see the
     *  matching `PendingCast` field for why re-deriving at commit is wrong.
     *  Absent = the cast WAS at sorcery timing. */
    castOffSorceryTiming?: boolean;
    /** Distinguishes a spell cast (default) from an activated ability that
     *  requires targets (CR 602.2b). When "ability", `abilityId` is set and
     *  costs are paid at finalization instead of at announcement. When
     *  "copy-retarget", target selection re-points the targets of a spell
     *  COPY already on the stack (CR 707.10c — Fork's "you may choose new
     *  targets for the copy"); `cardInstanceId` holds the copy's stack id and
     *  finalization writes the chosen targets onto that stack item instead of
     *  casting anything. When "retarget", target selection re-points the targets
     *  of the ORIGINAL spell already on the stack (CR 115.7 — Reflecting Mirror's
     *  "change the target of target spell"); `cardInstanceId` holds the original
     *  spell's stack id and finalization writes the chosen targets onto it. */
    kind?: "cast" | "ability" | "copy-retarget" | "retarget" | "trigger";
    /** For `kind: "ability"` only — id of the activated ability template on
     *  the source card definition. */
    abilityId?: string;
    /** For `kind: "ability"` only — set when the activated ability was granted
     *  to the source by another card (CR 113.1, e.g. Zombie Master granting
     *  "{B}: Regenerate ~" to other Zombies). The template is looked up via
     *  this card def id; the ability resolves with the source permanent as
     *  `ctx.sourceInstanceId`. Undefined for native activated abilities. */
    grantedSourceCardId?: string;
    /** Which list on `grantedSourceCardId`'s definition holds the template
     *  (issue #2943). Absent — every grant written before #2943 — means
     *  `grantTemplates[]`; `"card-abilities"` means the named card's own
     *  `activatedAbilities[]` (the CR 607.2a ability-COPY shape, Agatha's Soul
     *  Cauldron). Travels with `grantedSourceCardId` at every hand-off, because
     *  the pair is what `resolveGrantedActivatedAbility` needs to look the
     *  template up without falling back between the two lists. */
    grantedAbilityOrigin?: GrantedAbilityOrigin;
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
    /** CR 601.2c (issue #3805) — when a target-choice requirement binds the
     *  pick being made NOW ("while an opponent is choosing targets …, that
     *  player must choose at least one Flagbearer if able"), the permanent
     *  instance ids the chooser must choose among. Absent — the ordinary case,
     *  no such permanent on the battlefield — means the pick is unconstrained
     *  by this rule.
     *
     *  Written by `refreshRequiredTargetChoiceIds`
     *  (`gre/targetChoiceRequirements.ts`) at announcement, after every
     *  accepted pick and at each hand-off to a further independent group; read
     *  by the Bot's enumerators and by the client's clickability gate. It is a
     *  VIEW of the rule, never its authority: `applyOneTargetSelection`
     *  re-derives the narrowing from the live board before accepting a pick
     *  (ADR 0074 — a client that ignored this field gets its illegal pick
     *  rejected, not applied). */
    requiredTargetChoiceIds?: string[];
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

/** A one-shot "this just happened in a hidden zone" notification (Reveal
 *  dialog). `kind` distinguishes a private look (`look` — Mishra's Bauble,
 *  Gitaxian Probe) from a public reveal (`reveal`) and from a public
 *  fail-to-find (`fail-to-find`); the UI title/wording keys off it. `cards` is
 *  a self-contained snapshot (instance id + card def id) so the dialog renders
 *  even after the cards move. `id` is deterministic (resolution-derived, never
 *  wall-clock) so the client can dedup and the engine stays replay-stable. */
export type RevealNotification = {
    id: string;
    /** Player ids that see the dialog: the looker for a private look, every
     *  player for a public reveal or a fail-to-find. */
    audience: string[];
    /** Source card def id (art / title). */
    source: string;
    /** `fail-to-find` (CR 701.23b, issue #3425) — a library search that ended
     *  with the searcher finding nothing. The ACT of searching is public even
     *  though a library is a Hidden Zone (CR 400.2), so the outcome is
     *  announced to every player; without it an opponent cannot tell a whiffed
     *  fetchland from a tutor that found exactly what it wanted. Carries an
     *  EMPTY `cards` (nothing was found to show) — the one kind for which that
     *  is legal. */
    kind: "look" | "reveal" | "fail-to-find";
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

/** One queued ADDITIONAL phase (CR 500.8 — "Some effects can add phases to a
 *  turn. They do this by adding the phases directly after the specified phase.
 *  If multiple extra phases are created after the same phase, the most
 *  recently created phase will occur first.").
 *
 *  UNANCHORED by design (ADR 0111 decision 2): an entry records its KIND, not
 *  the phase it was created after. Consumption is hardcoded to the
 *  `END_OF_COMBAT` exit in `advancePhase`, which is correct for every
 *  extra-combat effect that exists — they all resolve during combat. The
 *  CR-shaped `{ kind, after: Phase }` was deliberately deferred: combat here
 *  is six sibling `Phase` values with no enclosing `"COMBAT"` value, so
 *  anchoring would need a step -> enclosing-phase-exit map (the CR 505.1a-
 *  adjacent classification #2494 scoped out). An OBJECT rather than a bare
 *  string precisely so adding `after` later is a field addition, not a
 *  reshape. */
export type ExtraPhase = { kind: "combat" };

/** CR 707.2 — the copiable values of a permanent that has LEFT the
 *  battlefield, as `GameState.lastKnownCopiable` holds them (ADR 0086).
 *
 *  Deliberately NOT a materialised characteristic dump. The copiable values of
 *  an object ARE its presented definition's, "as modified by other copy
 *  effects, by its face-down status, and by … 'as … enters' or 'as … is turned
 *  face up'" — so the definition id the permanent PRESENTED as it left, plus
 *  the instance-level exception a copy effect had stamped on it, reproduce
 *  types, subtypes, base P/T and static abilities exactly, through the very
 *  `getDefinition(presentedDefId)` read `applyCopy` performs for a live
 *  source. Materialising them here would duplicate the definition into the
 *  hottest row in the system for no behavioural gain (row size is the Convex
 *  cost driver, PRD #1776) and would introduce a second, driftable authority
 *  on what a copy of this object is.
 *
 *  The pairing to keep true: this type carries whatever `CopySource`
 *  (`gre/copy.ts`) declares a copy source contributes, minus what the
 *  definition id already answers. Widen one and the other owes a field —
 *  issue #2963, which will make the remaining "except" clauses (colours,
 *  additional subtypes, no mana cost) inherit off the SOURCE INSTANCE rather
 *  than be rebuilt from the copied definition, is exactly that day. */
/** One copy effect's layer-1 contribution, as recorded on
 *  `CardInstanceState.timedCopyEffects` (issue #3236): WHAT was copied, locked
 *  in when the effect began (CR 611.2c), and the effect's own "except" clause
 *  (CR 707.9). Enough to re-apply the effect through `applyCopy` and nothing
 *  more — `sourceCopyExcept` is the CR 707.3 "except it's N/N" stamp the
 *  copied object carried, already cleared for a face-down source exactly as
 *  `applyCopy` decides for a live one. */
export type TimedCopyLayer = {
    /** The definition id the copied object presented (CR 707.2). */
    sourceDefId: string;
    sourceCopyExcept?: { basePower?: number; baseToughness?: number };
    opts: CopyEffectOptions;
};

export type LastKnownCopiable = {
    /** The definition id the permanent presented at the moment it left
     *  (CR 707.2). Already the COPIED object's id for a Clone (`card.id` is
     *  overwritten by `applyCopy`), already the back face for a transformed
     *  permanent, and already the face-down sentinel for a face-down one —
     *  because the snapshot is taken BEFORE `revertCopy` / `revertTransform` /
     *  the CR 708.9 reveal run at that same funnel. A token's id is
     *  content-derived and re-synthesizable (`cards/registry.ts`), so it stays
     *  resolvable after CR 704.5d removes the token's instance from state. */
    defId: string;
    /** CR 707.3 — the "except it's N/N" clause a previous copy effect stamped
     *  on this object (issue #2076), which copying it inherits. Omitted when
     *  the permanent carried none, and omitted for a FACE-DOWN permanent,
     *  which contributes no exception (CR 707.2 — its copiable values are the
     *  face-down body) exactly as `applyCopy` decides for a live source. */
    copyExcept?: { basePower?: number; baseToughness?: number };
    /** `GameState.turn` at departure — the key the CR 514 cleanup prune reads.
     *  Not information about the object. */
    turn: number;
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
    /** Seed for the per-game PRNG. Persisted on the state itself — there is no
     *  event log to log it to (`docs/PROJECT.md` § Data model). */
    rngSeed: number;
    /** Monotonic counter advanced by every consumption of randomness (shuffle,
     *  discard at random, coin flips). With rngSeed it makes a game's random
     *  choices reproducible — that is the determinism half of replay. The other
     *  half, a log of the actions to replay, does not exist. */
    rngCounter: number;
    /** CR 702.35a — the currently-open Madness cast window. Set when a reflexive
     *  madness trigger resolves (`openMadnessCastWindow`): the owner may cast the
     *  named exiled card for its madness cost while they hold priority; passing
     *  priority instead bins it (`declineMadness`). Cleared on cast or decline.
     *  Persisted so an owner who saves mid-decision resumes with the window open.
     *  At most one is open at a time (reflexive triggers resolve one by one). */
    madnessCastWindow?: { cardId: string; ownerId: string };
    /** CR 702.88a — the currently-open Rebound cast window. Set when a
     *  reflexive rebound trigger resolves (`openReboundCastWindow`,
     *  gre/rebound.ts): the caster may cast the named exiled card again for
     *  free while they hold priority; declining leaves it exiled
     *  (`declineRebound`, CR 702.88a rebound — unlike Madness, NOT a graveyard bin).
     *  Cleared on cast or decline. Persisted so a caster who saves
     *  mid-decision resumes with the window open. At most one is open at a
     *  time (reflexive triggers resolve one by one). Mirrors
     *  `madnessCastWindow`; a distinct field rather than a shared one because
     *  the two windows are independently schedulable (a rebound trigger can
     *  fire turns after its spell resolved, unlike Madness's immediate
     *  discard-time trigger). */
    reboundCastWindow?: { cardId: string; ownerId: string };
    /** Active spell payment in progress (CR 601.2). */
    pendingCast?: PendingCast;
    /** Active activated-ability payment in progress (CR 602.1). Mutually
     *  exclusive with pendingCast. */
    pendingActivation?: PendingActivation;
    /** CR 116.2 / 702.139a (ADR 0064) — the {3} payment for the
     *  `summon-companion` special action, in progress. A DEDICATED state
     *  rather than an overload of `pendingCast`: the companion summon has no
     *  target, mode, or resulting stack item, so forcing it through
     *  `pendingCast` would mean a special-case "no-stack, deliver-to-hand"
     *  flag threaded through every `pendingCast` consumer (SBA, projection,
     *  cancel, triggers). Reuses the shared auto-tap SOLVER
     *  (`solveSmartAutoTap`) without polluting the cast rail. In practice the
     *  `summonCompanion` mutation (game.ts) solves and applies the whole {3}
     *  payment SYNCHRONOUSLY in one call (a fixed generic-only cost has no
     *  player choice to suspend on), so this field is set and cleared within
     *  a single mutation and is never observed mid-flight by another action —
     *  it exists as a first-class optional `GameState` key (serialized like
     *  `pendingCast`) for architectural symmetry and to leave room for a
     *  future manual-tap UI on the same rail. Mutually exclusive with
     *  `pendingCast`/`pendingActivation`. */
    pendingCompanionPay?: PendingCompanionPay;
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
    /** CR 603.12 — REFLEXIVE triggered abilities created by an effect that is
     *  still resolving ("Sacrifice a creature. When you do, …"), queued by
     *  `SpellContext.pushReflexiveTrigger` and placed on the stack by the
     *  same `processPendingActionTriggers` drain that stacks event-derived
     *  triggers — so a reflexive ability and the dies-triggers of the very
     *  sacrifice that produced it land in ONE APNAP-ordered batch, which is
     *  exactly what CR 603.3b calls for (both became "waiting to be put on
     *  the stack" during the same resolution). Never non-empty at a stable
     *  save point: the drain runs at the end of every resolution. */
    pendingReflexiveTriggers?: StackItem[];
    /** ADR 0026 (Reveal dialog) — one-shot notifications produced when a pure
     *  look/peek/reveal effect resolves (Mishra's Bauble, Gitaxian Probe, …).
     *  Each entry drives a transient client dialog that shows the revealed
     *  cards to the players in `audience`; persistent visibility afterward is
     *  the separate per-card `knownTo` mechanism. Populated during a resolution
     *  via `SpellContext.notifyReveal` and cleared at the top of the next
     *  `resolveTopOfStack`, so it rides exactly one stable snapshot to the
     *  client (which dedups by `id` and auto-dismisses). Emitted by EVERY
     *  all-players reveal site including the `reveal` Op (issue #3425): the
     *  grant and the dialog are one indivisible pair, and the opt-in the
     *  `reveal` Op never exercised left 31 shipped cards revealing in silence.
     *  A `fail-to-find` entry (CR 701.23b) rides the same channel with an
     *  empty `cards`, enqueued outside a resolution by
     *  `enqueueFailToFindNotice`.
     *
     *  Doubles as the in-resolution record of what is CURRENTLY public:
     *  `putLibraryCardsOnTop` reads it back so a card publicly revealed a
     *  moment ago, then shuffled into its library and deterministically placed
     *  on top, stays known to everyone who saw the reveal rather than
     *  collapsing to owner-only knowledge. */
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
        /** CR 508.1g / 701.43d — the declared attackers whose controller chose
         *  to pay the OPTIONAL "you may exert this creature as it attacks"
         *  cost. Toggled while the declaration is still open (the choice is
         *  made AS attackers are declared, never at resolution), paid at
         *  `finalizeConfirmAttackers`: each id is exerted (CR 701.43a) and
         *  emits `PERMANENT_EXERTED`, whose linked "when you do" trigger
         *  (CR 607.2h) joins the same APNAP batch as `ATTACKERS_DECLARED`.
         *  Kept for the rest of combat once confirmed so the declaration
         *  record stays readable; cleared at END_OF_COMBAT with the rest of
         *  `combat`. Absent when nothing was exerted. */
        exertedIds?: string[];
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
         *  band members it is blocking). Banding (CR 702.22) is the only thing
         *  that produces blocker sources with 2+ targets. */
        damageAssignments?: Record<string, Record<string, number>>;
        /** false = waiting for manual assignment, undefined = auto-applied or not yet at damage step. */
        damageConfirmed?: boolean;
        /** Attacking bands declared this combat (CR 702.22c). A band is a
         *  group of attacking creatures (1+ with banding, at most 1 without)
         *  that attacks as a unit and is blocked as a group. */
        bands?: { bandId: string; memberIds: string[] }[];
        /** sourceId → playerId responsible for assigning that source's combat
         *  damage this step. Normally the source's controller; banding
         *  (CR 702.22j-k) shifts authority to the controller of the banding
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
    /** Monotonic counter advanced by each `pendingReveals` entry, so a reveal
     *  notification id is unique for the LIFE of the game rather than within
     *  one resolution (issue #3425 review). The natural key — stack item +
     *  resolution step — is NOT unique: an ACTIVATED ability's stack item
     *  borrows its source permanent's own id (`buildActivatedAbilityStackItem`
     *  clones the permanent), so activating Captain Sisay twice produced the
     *  same id twice, and the client's `dismissed` set — which by design
     *  suppresses an id it has already shown — swallowed every reveal after
     *  the first. Deterministic (never wall-clock), so replays reproduce the
     *  same ids. */
    nextRevealSeq?: number;
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
    /** Queue of ADDITIONAL phases owed by the turn in progress (CR 500.8).
     *  LIFO: pushed at the end, popped from the end — the most recently
     *  created extra phase occurs first. Ships one kind, `"combat"`, consumed
     *  at the `END_OF_COMBAT` exit inside `advancePhase()` (re-entry is at
     *  `BEGINNING_OF_COMBAT`, so CR 506.1's five steps run again in full and
     *  "at the beginning of combat" triggers fire again). Discarded wholesale
     *  by `advanceTurn()` — an entry that outlives its turn would otherwise
     *  leak a spurious combat into the OPPONENT's turn. `PHASE_ORDER` is not
     *  rewritten and no per-turn phase list is materialised; this queue is the
     *  only mutable turn-structure state (ADR 0111). */
    extraPhases?: ExtraPhase[];
    /** How many EXTRA combat phases (CR 500.8) the turn in progress has
     *  already entered — 0/absent during the turn's one normal combat, 1 while
     *  in the first additional combat, and so on. Incremented at the
     *  consumption seam in `advancePhase()`, cleared by `advanceTurn()`.
     *
     *  Exists for the player-visible marker alone: the queue is popped at
     *  consumption, so by the time the second combat is being played there is
     *  nothing left on `extraPhases` to distinguish it from the first, and
     *  every other cue is identical (the turn counter is unchanged, the phase
     *  rail walks backwards with no explanation, the compact phase tab renders
     *  a byte-identical caption, and there is no player-visible event log).
     *  `ControllerPhaseList` reads it for its `· Combat N` header marker. */
    extraCombatsThisTurn?: number;
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
    /** CR 114 — command-zone emblems (issue #1221). Each is a pure-data
     *  {@link EmblemInstance} referencing its closure-bearing definition by
     *  `emblemId`; the layer system and trigger scanner resolve the granted
     *  continuous / triggered abilities from the emblem registry
     *  (`convex/cards/emblems.ts`) at read time. Emblems can't be targeted,
     *  removed, or interacted with and persist the rest of the game (CR 114.4),
     *  so this list only ever grows. Absent means no emblems exist yet. */
    emblems?: EmblemInstance[];
    /** Monotonic counter advanced by each createEmblem() call. Generates
     *  deterministic `emblem-N` ids so replays reproduce the same identifiers. */
    nextEmblemSeq?: number;
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
    /** CR 506.3 / 508.1 — true once ANY player's creature has been declared as
     *  an attacker this turn. Set at attacker confirmation (`phases.ts`);
     *  reset at the start of each turn (`advanceTurn`), mirroring
     *  `deathsThisTurn` / `spellsCastThisTurn`.
     *
     *  Deliberately a GAME-level fact rather than a scan of the per-creature
     *  `hasAttackedThisTurn` flags: CR 506.4 keeps a creature that attacked
     *  "having attacked" after it is removed from combat, and an attacker that
     *  died in combat (or was bounced) is no longer on any battlefield to be
     *  scanned at all — so the scan would report "no creatures attacked" on
     *  exactly the turns where the fight was bloodiest. Read by "if no
     *  creatures attacked this turn" intervening-ifs (CR 603.4, Keldon
     *  Twilight). */
    creatureAttackedThisTurn?: boolean;
    /** Turn-scoped control-continuity ledger — instance ids whose CONTROLLER
     *  changed at some point during the current turn (either direction), so
     *  neither the old nor the new controller has controlled them "since the
     *  beginning of the turn". Appended by `recordControlChangeThisTurn`
     *  (`gre/controlContinuity.ts`) from `applyControlChange` /
     *  `revertControlChange`; reset at the start of each turn (`advanceTurn`).
     *  Read — together with the per-permanent `enteredOnTurn` entry stamp — by
     *  `hasControlledSinceTurnStart`, which backs
     *  `PermanentFilter.controlledSinceTurnStart`. See that module's header for
     *  why this is a ledger of BREAKS and not a start-of-turn snapshot. */
    controlChangedThisTurn?: string[];
    /** CR 608.2h / 111.12 (ADR 0086) — last known COPIABLE values of every
     *  permanent that has left the battlefield recently, keyed by the instance
     *  id it had there. Written at the single battlefield-departure funnel
     *  (`removePermanentTo`), read as `createTokenCopyOf`'s fallback so a
     *  NON-TARGETED "create a token that's a copy of it" still creates the
     *  token after its source is gone:
     *
     *  > CR 608.2h — "If the effect requires information from a specific
     *  > object, including the source of the ability itself … if it's no
     *  > longer in that zone, the effect uses the object's last known
     *  > information."
     *  > CR 111.12 — "If an effect instructs a player to create a token that
     *  > is a copy of a nonexistent object, no token is created … This does
     *  > not apply to an effect that would use the last known information of
     *  > an object."
     *
     *  An announced TARGET that has left is a DIFFERENT rule (CR 608.2b makes
     *  it an illegal target and the copy fizzles — Dance of Many), so the
     *  fallback is opt-in per call and never the default.
     *
     *  Distinct from the effective-P/T departure snapshot taken a few lines
     *  above it in the same funnel: layered buffs are right for "damage equal
     *  to its power" and WRONG for a copy, because CR 707.2 ends "Other
     *  effects … are not copied". The two LKI snapshots sit side by side with
     *  deliberately opposite semantics — do not unify them.
     *
     *  Pruned on a two-turn window at CLEANUP (CR 514, `finalizeCleanup`):
     *  the longest-lived referent the engine can produce is a delayed trigger
     *  ("at the beginning of your next upkeep" fires by turn N+2's upkeep),
     *  so row growth is bounded by two turns of departures rather than by the
     *  game. Row size is this system's Convex cost driver, so the entry is
     *  deliberately tiny and its definition id is interned through the v2
     *  cardId string table on the way to the DB (`serialize.ts`, issue #1780).
     *
     *  It crosses the wire UNREDACTED on purpose: the client Brain simulates
     *  on a local clone (ADR 0074) and would otherwise diverge from the server
     *  on exactly the cards this store enables. Safe because everything that
     *  was on the battlefield was public, and CR 708.9 reveals a face-down
     *  permanent to all players in the very act of leaving. Stated because
     *  unredacted state crossing `projectPublicState` is a known bug class
     *  here (#1977/#1982). */
    lastKnownCopiable?: Record<string, LastKnownCopiable>;
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
    /** Cumulative life GAINED by each player this turn (CR 119.3 tally, issue
     *  #1457). Map `playerId → total life gained`. Incremented inside
     *  `gainLifeEmitting` — the single choke point every gain sink funnels
     *  through (the `gainLife` primitive, the CR 702.15b lifelink gain, and
     *  every DSL `gainLife` Op) — with the ACTUAL amount gained, AFTER the
     *  CR 614 lifegain replacement layer has run. A gain fully replaced away
     *  (Lich) or of amount <= 0 never reaches the tally, so "gaining 0 life"
     *  correctly does NOT count as having gained life. Reset at turn start
     *  (`advanceTurn`), mirroring `deathsThisTurn` /
     *  `damageDealtToPlayerThisTurn`.
     *
     *  The retrospective half of the lifegain-payoff family: "whenever you
     *  gain life" reads the LIFE_GAINED event, while "if you gained life this
     *  turn" (CR 603.4 intervening-if — Crested Sunmare, Ocelot Pride,
     *  Resplendent Angel) reads THIS tally, both at trigger time and again on
     *  resolution. Also exposed to the DSL as the
     *  `{ lifeGainedThisTurn: { of } }` EffectValue grammar member. */
    lifeGainedThisTurn?: Record<string, number>;
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
     *  at the spell's resolution, so the DECLARE_BLOCKERS step confirms them
     *  with no blocker prompt (see `phases.ts`) — it still opens the step's own
     *  priority round, which CR 117.3a owes every step. Combat-scoped:
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
    /** CR 514.3a (issue #2472) — "another cleanup step begins" marker. The
     *  cleanup step normally grants no priority (CR 514.3); the single
     *  exception fires when state-based actions or triggered abilities are
     *  waiting at that point (a `next-cleanup-step` delayed trigger, or a
     *  trigger raised by the 514.1 discard itself — Madness). When that
     *  happens the active player gets priority and, once the stack empties and
     *  all players pass, ANOTHER cleanup step begins. This flag is what carries
     *  that obligation across the priority window (which spans mutations, so it
     *  must persist): set by `openCleanupPriorityWindow` (`gre/phases.ts`) as
     *  the window opens, consumed by `advancePhase`, which re-enters CLEANUP
     *  instead of ending the turn. Undefined at every other point — a cleanup
     *  step that puts nothing on the stack stays priority-less and single. */
    pendingExtraCleanupStep?: boolean;
    /** CR 514.3a (issue #2472) — the `turn` whose ONCE-PER-TURN cleanup
     *  bookkeeping has already run. Because 514.3a can start an additional
     *  cleanup step, `finalizeCleanup` (`gre/phases.ts`) runs more than once
     *  per turn. Almost all of it genuinely re-runs — removing damage that is
     *  already gone and ending effects that already ended are no-ops, and the
     *  repeat step MUST still end effects created during the 514.3a priority
     *  window. Exactly two things are keyed to the TURN rather than the step
     *  and are gated on this marker: the `skip` COUNTDOWN inside
     *  {@link tickDuration} (via `DurationTickView.boundaryAlreadyCounted`),
     *  and the per-creature `attackedDuringLastTurn` roll-forward (a snapshot
     *  of a flag the same pass clears). Persisted, because the 514.3a priority
     *  window spans mutations and a step suspended on a CR 514.1 discard
     *  prompt resumes in a later one. */
    cleanupBookkeepingTurn?: number;
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
        /** CR 106.3 (issue #3811) — the controller of the effect that adds
         *  the extra mana; keys `replaceProducedManaColor` for an additional
         *  rider. Absent on a row written before the field existed, which
         *  falls back to the tapping player. */
        controllerId?: string;
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
    /** CR 615.12 (issue #3303) — when true, NO damage can be prevented this
     *  turn, whatever its source and whatever its recipient (Stomp: "Damage
     *  can't be prevented this turn"). The GAME-scoped sibling of the
     *  per-permanent `damageLockThisTurn` flag: read through
     *  `isDamageUnpreventableThisTurn` and ORed into the `unpreventable`
     *  boolean every damage sink already computes, so no sink learns a second
     *  vocabulary. Cleared at CLEANUP (CR 514.2).
     *
     *  Deliberately prevention-ONLY: unlike `damageLockThisTurn`, which also
     *  carries Whippoorwill's CR 614.9 "or dealt instead to another permanent
     *  or player" clause, this flag never touches `unredirectable` — Stomp's
     *  Oracle line says only "can't be prevented", and a redirect is not a
     *  prevention (CR 614.9). */
    damageUnpreventableThisTurn?: boolean;
    /** CR 615 / 510.1c — SOURCE-scoped damage-prevention shields: each entry
     *  prevents damage a matched SOURCE would deal, to ANY recipient (a
     *  player, a creature, a planeswalker — recipient-agnostic, which is what
     *  distinguishes this list from every other shield on `GameState`).
     *
     *  This is the ONE seam for source-side prevention. It carries both
     *  spellings the catalogue needs:
     *   - CR 510.1c "assigns no combat damage this turn" (Farrel's Mantle /
     *     Zealot, Warning / Restrain) — `{ sourceIds, combatOnly: true }`.
     *   - CR 615 "prevent all combat damage <X> would deal this turn"
     *     (Falling Timber, Guard Dogs, Radiant Kavu) and its non-combat
     *     superset "prevent all damage a source of your choice would deal
     *     this turn" (Rith's Charm) — the same entry shape with `match` for
     *     the filter-scoped case and `combatOnly: false` for all damage.
     *
     *  Consumed at ONE place — `runDamageReplacement`, the universal CR 614
     *  pre-application funnel every damage sink calls — so a new damage path
     *  cannot silently miss it. Cleared at CLEANUP (CR 514.2). */
    sourcePreventionShields?: SourceDamagePreventionShield[];
    /** CR 615.1a (issue #3810) — RECIPIENT-scoped damage-prevention shields:
     *  each entry prevents damage that would be dealt TO every object its
     *  filter matches, from ANY source (Divine Light, "prevent all damage that
     *  would be dealt this turn to creatures you control").
     *
     *  The mirror of `sourcePreventionShields`, and source-agnostic in exactly
     *  the way that list is recipient-agnostic. What separates it from the two
     *  OTHER recipient-keyed lists is that it binds no id: `targetPrevention-
     *  Shields` and `playerDamagePrevention` lock one recipient at resolution,
     *  so neither can cover a creature that comes under the shielded player's
     *  control later in the turn. The filter here is re-read from the LIVE
     *  board on every damage event (CR 615.6), which is the whole point.
     *
     *  Consumed at ONE place — `runDamageReplacement`, on the FINAL recipient
     *  after every CR 614 replacement has run, so a redirect onto a shielded
     *  creature is prevented and a redirect OFF one is not. Cleared at
     *  CLEANUP (CR 514.2). */
    recipientPreventionShields?: RecipientDamagePreventionShield[];
    /** CR 601.3 / 514.2 — players under a turn-scoped "can't cast spells this
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
    /** CR 504.1 (issue #1097 — Elfhame Sanctuary's "you skip your draw step
     *  this turn"). Player ids that skip their OWN draw step the next time
     *  it is reached this turn. Armed by `SpellContext.skipDrawStepThisTurn`
     *  (the `skipDrawStepThisTurn` Op) at whatever step the resolving effect
     *  runs — Elfhame Sanctuary arms it at upkeep, earlier in the SAME turn
     *  than the draw step it consumes. Consumed — spliced back out — by
     *  `advancePhase` (`gre/phases.ts`) the first time the DRAW step is
     *  entered for a listed player: CR 500.8, a skipped step doesn't happen
     *  AT ALL, so the whole step (turn-based draw, CR 504.2 delayed
     *  triggers, and CR 603.2 beginning-of-step triggers like Howling
     *  Mine/Sylvan Library/Island Sanctuary) is bypassed, not merely the
     *  draw — `drawStep` itself is never invoked for that player this turn.
     *  Distinct from `CardDefinition.drawStepReplacement` (Fasting): that is
     *  a STATIC per-card flag re-evaluated every turn, offering an
     *  interactive may-skip choice AT the draw step itself via its own DRAW
     *  phase trigger; this is a plain per-player turn flag armed by a
     *  DIFFERENT step's effect, with no choice left to make once armed.
     *  Cleared unconditionally at CLEANUP as a safety net for the turn-1
     *  edge case (CR 103.8a skips only the DRAW step, not UPKEEP, so a flag
     *  armed on turn 1 would otherwise never be consumed). */
    skipDrawStepThisTurn?: string[];
    /** CR 601.3 / CR 514.2 (issue #1149, ADR 0093) — the TURN-SCOPED form of
     *  the one graveyard play permission record (Yawgmoth's Will: "Until end
     *  of turn, you may play lands and cast spells from your graveyard"),
     *  granted by the `grantGraveyardPlay` Op. Same grammar as the CONTINUOUS
     *  form `CardDefinition.graveyardPlayPermission`; the two differ only in
     *  lifetime. Each entry names its grantee and its granting source. Read
     *  ONLY through the single resolver `getGraveyardPlayPermissions`
     *  (`gre/rules.ts`), which applies every gate the record carries. A
     *  SCOPED once-per-turn permission (Serra Paragon, issue #1239) is a row
     *  of this same record with `oncePerTurn`/`yourTurnOnly`, never a
     *  per-instance grant. Cleared unconditionally at CLEANUP (CR 514.2),
     *  same boundary as `cannotCastSpellsThisTurn`. */
    graveyardPlayPermissionThisTurn?: (LiveGraveyardPlayPermission & {
        playerId: string;
    })[];
    /** CR 601.3 / CR 514.2 (ADR 0093) — the once-per-turn uses spent this
     *  turn, keyed by SOURCE: `{ playerId, sourceId }` per spent permission,
     *  so each once-per-turn permission spends its own use (two sources under
     *  one controller grant two uses). Written only by
     *  `markGraveyardPlayPermissionUsed` at cast commit / land play, read only
     *  by the resolver. Cleared unconditionally at CLEANUP (CR 514.2) —
     *  correct for "once during each of YOUR turns" because such a permission
     *  also carries `yourTurnOnly`, so no use can be spent across the boundary
     *  on the opponent's turn. */
    graveyardPlayPermissionUsesThisTurn?: {
        playerId: string;
        sourceId: string;
    }[];
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
    /** CR 702.16b/e/i (issue #674, The One Ring) — the players who currently
     *  have PROTECTION FROM EVERYTHING. Protection from everything is protection
     *  from each and every object regardless of its characteristics
     *  (CR 702.16i), so for a PLAYER (CR 115.4) exactly two of protection's
     *  clauses apply and both are unconditional — no source-controller
     *  exception, the protected player's OWN spells and sources included:
     *    - CR 702.16b — they can't be the target of any spell or ability
     *      (`playerHasProtectionFromEverything`, read by BOTH `getLegalTargets`
     *      and the `selectTarget` mutation so the offered set and the accepted
     *      set can't diverge).
     *    - CR 702.16e — all damage that would be dealt to them is prevented
     *      (`applyPlayerDamagePrevention`, the single chokepoint every
     *      player-damage sink already routes through). Being ATTACKED is still
     *      legal — protection prevents the damage, it doesn't bar the attack.
     *  Protection's remaining clauses (blocked / enchanted / equipped,
     *  CR 702.16c/d/f) are permanent-only and have no player analogue.
     *  Each grantee's entry is dropped at the START of THEIR OWN next turn
     *  (via `advanceTurn`) — the "until your next turn" boundary, mirroring
     *  `castTimingFlashGrants`, NOT CLEANUP. A LIST rather than a single slot
     *  (unlike `islandSanctuaryProtection`) because both players can hold the
     *  protection at once — each casting their own The One Ring on successive
     *  turns overlaps the two windows, and a single slot would clobber the
     *  first grant. */
    playerProtectionFromEverything?: string[];
    /** CR 601.3b (Teferi, Time Raveler +1) — per-player "you may cast spells of
     *  these types as though they had flash" grants. Each entry lets `playerId`
     *  cast a spell whose printed types intersect `cardTypes` (omitted/empty =
     *  every spell) at instant speed. Honored by the shared cast gate
     *  (`hasCastTimingFlashGrant`, `convex/cards/castRestrictions.ts`) that both
     *  `getLegalActions` and the client read. Cleared at the START of that
     *  player's next turn (via `advanceTurn`) — the "until your next turn"
     *  boundary, mirroring `islandSanctuaryProtection`, NOT CLEANUP. */
    castTimingFlashGrants?: { playerId: string; cardTypes?: CardType[] }[];
    /** CR 601.2f / 514.2 (issue #3340, Urza, Planeswalker's +2: "Artifact,
     *  instant, and sorcery spells you cast this turn cost {2} less to cast")
     *  — FLOATING, turn-scoped, per-player cost reductions over the spells
     *  their `playerId` casts. The floating twin of the `cost-modifier`
     *  StaticEffect: that one lives on a permanent and dies with it, this one
     *  outlives its source entirely (Urza's +2 keeps reducing after Urza has
     *  left) and ends at CLEANUP, the "this turn" boundary of CR 514.2 —
     *  NOT `advanceTurn`'s "until your next turn" boundary that
     *  `castTimingFlashGrants` above uses.
     *
     *  Read by the single 601.2f collector `getCostModifiers`, in the same
     *  accumulation as the battlefield scan and the two self-host arms, so
     *  every cast path, `canAffordCard`'s affordability probe and the Bot's
     *  `enumerateCastMoves` see it without a second code path. `filter` is an
     *  ordinary `SpellFilter` — the same selector `spellCastTrigger` matches a
     *  cast against — so the reduction is filter-shaped, never type-hard-coded
     *  (Urza: `{ types: ["Artifact", "Instant", "Sorcery"] }`); omitted matches
     *  every spell that player casts. `costReduction` is the shared
     *  `CostReductionAmount`, resolved by `resolveCostReductionGeneric` exactly
     *  as the static site resolves its own, so both can only ever reduce
     *  GENERIC mana and both floor at {0}.
     *
     *  A LIST, and additive rather than idempotent: CR 601.2f is "minus all
     *  cost reductions", so two +2 activations in a turn genuinely stack to
     *  {4}, and two different filters must not clobber each other. SPELL-only,
     *  per the Oracle's "spells you cast" — the `kind: "ability"` arm of
     *  `getCostModifiers` never folds these in. */
    spellCostReductionsThisTurn?: {
        playerId: string;
        costReduction: CostReductionAmount;
        filter?: SpellFilter;
    }[];
    /** CR 609.4b / 118.14 (issue #2890) — per-player ONE-SHOT "for one spell
     *  this turn, you may spend mana as though it were mana of any type/color"
     *  grants (North Star). Keyed by player id; a LIST because each activation
     *  buys one spell, so two activations must buy two (a single slot would
     *  clobber the first).
     *
     *  Read by `getManaSubstitutions` only for a payment that names a cast in
     *  progress — the Oracle says "to pay that SPELL's mana cost", so an
     *  activated ability's cost never sees it. Consumed by `payCastManaCost`
     *  (`convex/gre/activation.ts`) when the grant actually did work: the spell that
     *  spends it is the first one whose cost the pool could not cover WITHOUT
     *  the substitution, which is exactly the designation a player would make
     *  and leaves the grant intact after an on-colour cast. Cleared at CLEANUP
     *  (CR 514.2), the same "this turn" boundary as
     *  `cannotCastSpellsThisTurn` — NOT `advanceTurn` (that is the different
     *  "until your next turn" boundary `castTimingFlashGrants` uses). */
    spellManaSubstitutionGrants?: Record<string, ManaSubstitutionBreadth[]>;
    /** CR 609.4b / 514.2 (issue #3811) — per-player UNTIL-END-OF-TURN
     *  "you may spend `from` mana as though it were mana of any type/color"
     *  permissions (False Dawn). Unlike `spellManaSubstitutionGrants` these
     *  reach EVERY cost the player pays and are never consumed; a list so two
     *  grants of different colours coexist. Read by `getManaSubstitutions`;
     *  cleared at CLEANUP (CR 514.2). */
    manaSubstitutionGrantsThisTurn?: Record<
        string,
        { from: Color; breadth: ManaSubstitutionBreadth }[]
    >;
    /** CR 614.1a / 514.2 (issue #3811) — per-player UNTIL-END-OF-TURN
     *  replacement on mana production: coloured mana a spell or ability the
     *  keyed player controls would add is added as that much of this colour
     *  instead (False Dawn → white). Applied by `replaceProducedManaColor`;
     *  cleared at CLEANUP (CR 514.2). */
    manaProductionColorThisTurn?: Record<string, Color>;
    /** Player whose creatures must all attack THIS TURN if able (CR 508.1d,
     *  Siren's Call: "Creatures the active player controls attack this turn if
     *  able"). Turn-scoped, not combat-scoped — 508.1d is explicit that "if a
     *  requirement that says a creature attacks if able during a certain turn
     *  refers to a turn with multiple combat phases, the creature attacks if
     *  able during each declare attackers step in that turn". Checked in
     *  `getRequiredAttackerIds` alongside the per-creature
     *  `mustAttackThisTurn`. Cleared at CLEANUP (issue #1864). */
    allCreaturesMustAttack?: string;
    /** CR 608.2 / 603.3 (issue #1189) — per-source, per-turn tally of how many
     *  times a triggered ability has RESOLVED this turn, keyed by
     *  `${triggerSourceId}:${triggeredAbilityId}` (a triggered ability firing
     *  off a DIFFERENT source, or a DIFFERENT ability on the SAME source, each
     *  get an independent tally). Incremented by `resolveTopOfStackInner`
     *  exactly once per resolution, BEFORE the effect runs, so "the first
     *  time this ability has resolved this turn" reads 1, not 0. Read back by
     *  `SpellContext.getAbilityResolutionCount()` / the
     *  `{ abilityResolutionCount: true }` EffectValue grammar member (Omnath,
     *  Locus of Creation; Scythecat Cub's escalating branches). Cleared at
     *  CLEANUP (CR 514.2) — the tally is scoped to "this turn". */
    abilityResolutionCounts?: Record<string, number>;
    /** Transient destroy-replacement shields (CR 614, Pyramids mode 2). Each
     *  entry replaces the next destruction of its keyed permanent before
     *  `duration` expires. Consumed via `destroyWithReplacements`; unconsumed
     *  remainder purged at expiry. See ADR 0125. */
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
     *  source-leaves hook (Oubliette). See ADR 0126. */
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
    /** CR 720.1 — the Monarch designation (issue #1199). At most one player is
     *  ever the monarch; undefined means no one is (the game always starts
     *  with no monarch). Set exclusively through `becomeMonarch` (below) —
     *  CR 720.2's reassignment falls out for free from a single scalar: crowning
     *  a new monarch always displaces whoever held it, no explicit "stop being
     *  monarch" step needed. Read by the CR 720.3 combat-damage steal hook
     *  (`applyOneCombatDamage`, phases.ts) and the CR 720.4 end-step draw hook
     *  (phases.ts `END_STEP` phase entry). */
    monarchId?: string;
    /** Scryfall id of the card that most recently crowned the current monarch
     *  (issue #1305). Purely cosmetic: it themes the Monarch marker art on the
     *  end-step draw stack tile to the granting card's own set-printing (Forth
     *  Eorlingas → the LTR "The Monarch", Palace Jailer → the Conspiracy one),
     *  the way a token's art matches its producer. Set by `becomeMonarch` when
     *  the crown changes hands via a card, and CLEARED when the crown moves
     *  with no card source (the CR 720.3 combat-damage steal) so that draw
     *  falls back to the global `MONARCH_DESIGNATION.imagePrintId`. */
    monarchSourceCardId?: string;
    /** CR 720 (Palace Jailer, issue #1199) — pending "return the exiled
     *  creature the next time an opponent of `controllerId` becomes the
     *  monarch" watches, armed by `SpellContext.exileUntilMonarchChanges`.
     *  Consumed by `becomeMonarch`: when the newly-crowned monarch differs
     *  from a watch's `controllerId`, the matching `exileHeld` bundle (keyed
     *  by `sourceId`) is returned via `returnExiledForSource` and the watch is
     *  removed. Per the official ruling, ANY opponent becoming the monarch
     *  releases the hold — not necessarily the same opponent who controlled
     *  the exiled creature — which this engine's 2-player scope makes exact
     *  ("an opponent" has only one possible value). */
    monarchReturnWatch?: MonarchReturnWatch[];
    /** CR 702.131 — the City's Blessing designation (Ascend, issue #1460).
     *  The ids of every player who has ever obtained the city's blessing.
     *  Modeled on `monarchId` (a player designation held in game state, not on
     *  any object) but with two CR-driven differences: (1) it is a SET, not a
     *  single scalar — the blessing is not exclusive, both players can hold it
     *  at once (CR 702.131c); (2) it is MONOTONIC — once a player is added they
     *  are NEVER removed, because "you have the city's blessing for the rest of
     *  the game" (CR 702.131b): dropping below ten permanents does not revoke
     *  it. Written exclusively through `grantCityBlessing` (idempotent add);
     *  read through `hasCityBlessing` (`gre/cityBlessing.ts`). Undefined /
     *  empty means no one has the blessing yet (every game starts that way). */
    cityBlessingIds?: string[];
    /** CR 614.1c / 614.12a (ADR 0100 D2) — permanents that have left their
     *  origin zone but have NOT yet entered the battlefield because their
     *  controller still owes one or more "as it enters" choices (a matching
     *  PendingChoice is queued for the head of each entry's `owed` list). Held
     *  here — off EVERY zone — so no SBA (704.5f zero-toughness sweep, 704.5m
     *  unattached-Aura sweep), no layer read, no trigger scan and no wire
     *  projection ever observes a half-entered permanent. `finalizeAsEnters` /
     *  `finalizeAsEnters` pull the entry and run the deferred entry tail. Only
     *  ever populated transiently while a matching choice is pending; empty
     *  (undefined) at a fully-resolved stable point.
     *
     *  Generalised from the shipped `stagedAuraEntries` (CR 303.4f), which is
     *  now one `kind` of as-enters choice rather than a parallel mechanism. */
    stagedEntries?: StagedEntry[];
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
    /** The Continuous Effects Registry (ADR 0082, PRD #2064) — every
     *  CHARACTERISTIC-CHANGING continuous effect (CR 613) as one ordered list,
     *  whatever generated it. Provenance survives only as
     *  `ContinuousEffectExpiry`, which is what makes a uniform per-read
     *  recompute expressible: an effect a resolved spell left behind
     *  (CR 611.2a) has no permanent to walk, so it cannot be rebuilt by
     *  scanning the battlefield.
     *
     *  Read through `continuousEffectsInLayer` (`gre/continuousEffects.ts`) —
     *  the single CR 613.7 ordering authority. Never sort by `timestamp`
     *  inline.
     *
     *  EMPTY IN PRODUCTION as of slice S1 (#3002): the structure and its
     *  ordering contract ship first, and each layer migrates onto it in turn
     *  (S2 #3003 layer 7, S3 #3004 layer 6, S4 #3005 layers 2-5). Until then
     *  the materialised model in `beginApplyingStaticEffects` and friends stays
     *  authoritative. */
    continuousEffects?: ContinuousEffect[];
    /** SEARCH-ONLY. The decklist colour evidence the searching Bot was granted
     *  for each seat, lowered by `deckColorEvidence` (`gre/deckKnowledge.ts`)
     *  and stamped onto a determinized world by `determinize` — issue #3533,
     *  PRD #3526.
     *
     *  NOT GAME STATE, and it never reaches the database: it is listed in
     *  `TRANSIENT_KEYS` (`gre/serialize.ts`), so `compactState` drops it and
     *  the authoritative server path in `game.ts` never sees one. It lives on
     *  `GameState` because the quantity it feeds — the opponent colour-demand
     *  estimate in `gre/ai/observedColors.ts` — is read at every LEAF of the
     *  search tree, through `evaluate`, whose signature the whole engine calls;
     *  riding on the world the leaf already holds is what lets the estimate
     *  keep ONE home instead of growing a second, differently-fed derivation
     *  behind an extra parameter threaded through a dozen call sites.
     *
     *  ABSENCE IS THE GATE, and it is the same fail-closed discriminator
     *  `DeckKnowledgeBySeat` already is: `determinize` stamps a seat here only
     *  when it was handed that seat's decklist AND that seat is not the search
     *  observer — which is true exactly at `expert`
     *  (`DIFFICULTY_KNOWS_OPPONENT`, `gre/difficulty.ts`; the client's `blind`
     *  shape names the bot's OWN seat at every level, so gating on "a decklist
     *  exists" alone would leak into `easy`/`medium`/`hard`). Every other
     *  difficulty, every server path and every test that stamps nothing reads
     *  `undefined` and behaves exactly as it did before this field existed.
     *
     *  Small by construction — at most five numbers per seat — because the
     *  search's `cloneGameState` deep-copies it once per node. The decklist
     *  itself never rides here for that reason. */
    deckColorKnowledge?: DeckColorsBySeat;
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

/** State-level transient damage replacement (CR 614). Four kinds cover the
 *  LEA reanimation / replacement subset plus the PLS generalization:
 *
 *  - `prevent-from-source-gain-life`: source X's next damage to a chosen
 *    player is fully prevented; the player gains life equal to the
 *    prevented amount. Reverse Damage.
 *  - `to-self-redirect-to-owner`: the next N damage that would be dealt to
 *    a specific permanent is redirected to its owner. Personal
 *    Incarnation's `{0}` activated ability.
 *  - `from-source-to-permanent-redirect`: the next damage that source X
 *    (or, when `sourceInstanceId` is unset, ANY source) would deal to a
 *    specific creature is dealt to a chosen destination — a player OR a
 *    permanent — instead. Generalizes Jade Monolith's `{1}` activated
 *    ability (destination always a player, `redirectTo: {type:"player"}`)
 *    to also cover Mirrorwood Treefolk's `{2}{R}{W}` ability, whose
 *    "any target" destination is announced at activation (CR 601.2c /
 *    602.2b) via a `targetRequirement: { type: "any" }` and may be a
 *    permanent (issue #1939). */
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
          kind: "from-source-to-permanent-redirect";
          /** Source filter. `undefined` matches any source — Jade Monolith's
           *  oracle is "a source of your choice" but with no further
           *  re-target step at activation (the engine simplifies to "any
           *  source this turn" for the chosen creature); Mirrorwood
           *  Treefolk's "the next time damage would be dealt to this
           *  creature" has no source filter at all, so it is always unset. */
          sourceInstanceId?: string;
          targetInstanceId: string;
          /** Where the redirected damage lands — a player (Jade Monolith,
           *  always the activator) or a permanent (Mirrorwood Treefolk's
           *  "any target", announced at activation, CR 115.4/601.2c/602.2b).
           *  Reuses `TargetSelection`'s player/permanent shape rather than
           *  adding a bespoke destination type. */
          redirectTo:
              | { type: "player"; id: string }
              | { type: "permanent"; id: string };
          /** Remaining charges. `1` = one-shot, decrements per match. */
          remaining: number;
          duration: Duration;
      }
    | {
          /** CR 614.9 (issue #3810) — "the next N damage that would be dealt
           *  to <from> this turn is dealt to <to> instead" (Captain's
           *  Maneuver). RECIPIENT-keyed and source-agnostic, which is what
           *  separates it from `from-source-to-permanent-redirect` (Jade
           *  Monolith shields ONE permanent against ONE chosen source and
           *  spends a CHARGE per matched event). */
          kind: "next-n-to-recipient-redirect";
          /** The shielded RECIPIENT — a player or a permanent. */
          from:
              | { type: "player"; id: string }
              | { type: "permanent"; id: string };
          /** Where the redirected damage lands. Re-validated at redirection
           *  time: CR 614.9's "the effect does nothing" when a permanent
           *  destination has left the battlefield or stopped being
           *  damageable. */
          redirectTo:
              | { type: "player"; id: string }
              | { type: "permanent"; id: string };
          /** Remaining DAMAGE POINTS, not charges. An event larger than this
           *  is split: `remaining` points are redirected and the rest is
           *  still dealt to `from`. */
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
 *  removed. One-shot per charge. See ADR 0125. */
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

/** CR 720 (Palace Jailer, issue #1199) — a pending "return the exiled creature
 *  the next time an opponent of `controllerId` becomes the monarch" watch. See
 *  {@link GameState.monarchReturnWatch}. */
export interface MonarchReturnWatch {
    /** `exileHeld` bundle key (the exiling ability's source instance id). */
    sourceId: string;
    /** The exiling ability's controller — the watch releases when the newly
     *  crowned monarch is anyone ELSE (CR 720 "an opponent becomes the
     *  monarch"). */
    controllerId: string;
}

/** CR 614.1c / 614.12a (ADR 0100 D2) — a permanent removed from its origin zone
 *  and awaiting its controller's "as it enters" choices before it enters the
 *  battlefield. Carries the fat card object itself (it lives in no zone while
 *  staged) plus everything the deferred entry tail needs to finish. Matched to
 *  its PendingChoice by the card's instance id. See
 *  {@link GameState.stagedEntries}. */
export interface StagedEntry {
    /** The entering permanent, off every zone until every owed choice is
     *  answered. */
    card: CardInstanceState;
    /** Player under whose control the permanent enters. */
    controllerId: string;
    /** Which census row is resuming it — selects WHICH entry tail the finalize
     *  runs (ADR 0100 D2). It deliberately does NOT decide whether a suspended
     *  resolution resumes; that is `parkedStackItemId`'s job (D5). */
    origin: "spell" | "effect" | "token";
    /** The stack item whose resolution parked this entry, if there was one.
     *  This — never `origin` — is what the as-enters finalize branches on: still
     *  on the stack ⇒ `resolveTopOfStack` resumes it in the same mutation;
     *  absent or already popped ⇒ the finalize itself finishes the entry and
     *  hands priority to the active player (CR 117.3b, ADR 0100 D5). */
    parkedStackItemId?: string;
    /** Answered head-first; may GROW mid-flight when a `copy` answer reveals the
     *  copied definition's own `asEnters` (CR 707.6, ADR 0100 D4). The entry
     *  resumes only when this is empty. */
    owed: AsEntersChoice[];
    /** Definition ids whose `entersWith.asEnters` have already been folded into
     *  `owed` (CR 707.6 / ADR 0100 D4). A copy answer rewrites the staged card's
     *  presented definition; the refresh pass appends the new definition's
     *  clauses exactly once. */
    consultedDefIds?: string[];
    /** `origin: "token"` only — the remainder of the token entry tail
     *  (`createTokenPermanents`'s per-token loop body after the chokepoint),
     *  which cannot be re-derived from the instance alone. JSON-pure so the
     *  staged entry survives the DB round-trip. */
    tokenEntry?: {
        entryCounters?: Record<string, number>;
        entersTapped?: boolean;
        entersAttacking?: boolean;
    };
    /** CR 603.6a — carried across an as-enters park so the deferred entry tail
     *  (`runStagedEntryTail`) can still mark the eventual PERMANENT_ENTERED as
     *  "from graveyard" (Twilight Diviner's source-zone condition survives a
     *  reanimated permanent that owes an "as it enters" choice). */
    enteredFromGraveyard?: boolean;
}

/** The minimal state shape {@link sourcePreventionShieldApplies} reads: the
 *  shield list plus every battlefield, as `PermanentView`s. Deliberately
 *  structural rather than `GameState` so the SAME predicate runs against a
 *  wire-projected `PublicGameState` — the client Brain's combat evaluation
 *  (`gre/evaluate.ts`) only ever sees the projection, and a
 *  `GameState`-only signature is exactly how a shield ends up honoured
 *  server-side and invisible to the bot. */
export interface SourcePreventionStateView {
    sourcePreventionShields?: SourceDamagePreventionShield[];
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
}

/** The minimal state shape {@link recipientPreventionShieldApplies} reads —
 *  structural rather than `GameState` for the same reason its source-side twin
 *  is (the client Brain only ever sees the wire projection, and a
 *  `GameState`-only signature is how a shield ends up honoured server-side and
 *  invisible to the bot). */
export interface RecipientPreventionStateView {
    recipientPreventionShields?: RecipientDamagePreventionShield[];
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
}

/** CR 701.27f (issue #3537) — the put-onto-the-stack moment of a
 *  non-delayed activated or triggered ability, as its source permanent and
 *  that permanent's `transformCount` then. */
export interface StackTransformStamp {
    sourceInstanceId: string;
    count: number;
}

// Loose structural mana-cost shape used by the mana-payment helpers in
// `gre/state.ts` and by the declarations here. The
// value union includes the `phyrexian` object (CR 107.4f, ADR: Phyrexian mana)
// AND the `hybrid` array (CR 202.1a, issue #1338 — guild-hybrid pips) so a real
// `CardManaCost` carrying either is assignable here; the payment helpers ignore
// both keys (Phyrexian pips resolve to mana/life before payment, hybrid pips are
// paid via convoke — see `convex/gre/phyrexian.ts` / `convex/gre/payWith.ts`).
export type ManaCost = Record<
    string,
    | number
    | string
    | Partial<Record<Color, number>>
    | Array<[Color, Color]>
    // CR 107.3a (issue #3811) — `xSpendColors`, folded by `normalizeManaCost`.
    | Color[]
    | undefined
>;

/** Active "spend X as though Y" mana-substitution rules for one player.
 *  `from`-color mana may be spent to satisfy `to`-color requirements. */
export type ManaSubstitution = { from: string; to: string };

/** The result of a meaningful generic-spend choice (CR 601.2g): how much
 *  generic mana is owed, and the colors in the pool the player may draw it
 *  from. `null` from `genericSpendAmbiguity` means "no meaningful choice —
 *  auto-pick". */
export interface GenericSpendAmbiguity {
    generic: number;
    candidateColors: string[];
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

/** One resolved static NON-mana additional-cost requirement (CR 601.2f / 118.5,
 *  Drought): `count` permanents matching `filter` must be sacrificed by the
 *  announcing player. */
export interface StaticAdditionalSacrifice {
    filter: PermanentFilter;
    count: number;
}

/** Widened `may-pay` cost: the shared {@link CostLegs} leg vocabulary (ADR
 *  0079). Kept as its own alias so the "normalized" reading — a bare `ManaCost`
 *  has already been widened to `{ mana }` — stays visible at every call site. */
export type NormalizedMayPayCost = CostLegs;

/** The minimal hand-card shape may-pay HAND-leg assignment reads (CR 701.9 /
 *  118.9): the instance id, plus the card-definition id `handCardMatchesFilter`
 *  resolves in the registry. Both `CardInstanceState` (server) and
 *  `SlimCardInstance` / the client `CardInstance` (the projected wire state the
 *  vs-AI Brain and the UI reason over, ADR 0074) structurally satisfy it — so
 *  ONE assignment authority serves EVERY consumer of the leg, on both sides of
 *  the wire. Before PR #1963's review round 2 the client Brain, the bot view
 *  and the UI's Pay gate each re-derived the leg from a SUMMED COUNT
 *  (`hand.length >= total`) and picked by slicing N off the candidate union;
 *  both are wrong for a filtered multi-requirement leg (false-affordable, then
 *  an illegal pick the server rejects → bot freeze / disabled-Pay confusion). */
export type MayPayHandCard = { id: string; card: { id?: string } };
