type CardId = string;

export type Color = "W" | "U" | "B" | "R" | "G" | "C";

export const colors: Color[] = ["W", "U", "B", "R", "G", "C"];

export type ManaCost = {
    X?: number | string;
    W?: number;
    U?: number;
    B?: number;
    R?: number;
    G?: number;
    C?: number;
};

export type CardType =
    | "Creature"
    | "Planeswalker"
    | "Instant"
    | "Sorcery"
    | "Artifact"
    | "Enchantment"
    | "Land"
    | "Battle"
    | "Kindred";

export type CardSupertype =
    | "Basic"
    | "Legendary"
    | "Ongoing"
    | "Snow"
    | "World";

// --- Targeting ---

export interface TargetRequirement {
    /** Card type(s) to target, "player", "any", or "spell" (stack target). */
    type:
        | CardType
        | "player"
        | "any"
        | "spell"
        | (CardType | "player" | "any" | "spell")[];
    count: number;
}

export interface TargetSelection {
    /** "permanent" = battlefield card, "player" = player, "spell" = stack item. */
    type: "permanent" | "player" | "spell";
    id: string; // cardInstanceId, playerId, or stackItem.id
}

export interface ActivatedAbilityContext {
    addMana: (cost: ManaCost) => void;
}

export interface ActivatedAbility {
    id: string;
    cost: {
        tap?: boolean;
        mana?: ManaCost;
        sacrifice?: boolean;
    };
    /** Oracle text for this ability (displayed in context menus and on the stack). */
    oracleText: string;
    /** Effect for mana abilities (useStack: false). */
    effect?: (ctx: ActivatedAbilityContext) => void;
    /** Mana abilities don't use the stack — they resolve immediately (CR 605.3a). */
    useStack: boolean;
    /** Effect for stack abilities (useStack: true) — called with full SpellContext on resolution. */
    resolve?: (ctx: SpellContext) => void;
    /** Fixed mana output — used by the engine to track pool changes without executing the effect. */
    manaProduced?: ManaCost;
    /** Multiple mana options the player can choose from (e.g. Talisman: "{T}: Add {U} or {B}"). */
    manaChoices?: ManaCost[];
}

// --- Spell resolution context ---

export interface SpellContext {
    /** The player who cast the spell / activated the ability. */
    caster: string;
    /** The controller of the spell/ability on the stack. */
    controller: string;
    /** Chosen targets (validated at cast time). */
    targets: TargetSelection[];
    // --- Primitives ---
    dealDamage: (target: TargetSelection, amount: number) => void;
    gainLife: (playerId: string, amount: number) => void;
    loseLife: (playerId: string, amount: number) => void;
    getLife: (playerId: string) => number;
    getPower: (target: TargetSelection) => number;
    getToughness: (target: TargetSelection) => number;
    modifyPower: (target: TargetSelection, amount: number) => void;
    modifyToughness: (target: TargetSelection, amount: number) => void;
    getController: (target: TargetSelection) => string;
    destroy: (target: TargetSelection) => void;
    exile: (target: TargetSelection) => void;
    destroyAll: (type?: CardType | CardType[]) => void;
    destroyAllBySubtype: (subtype: string) => void;
    /** Player draws N cards one at a time (CR 121.1). Stops if library empties; sets hasDrawnFromEmpty (CR 704.5b). */
    drawCards: (playerId: string, amount: number) => void;
    /** Counters a spell or ability on the stack (CR 701.5a). Target must be TargetSelection with type "spell". No-op if target no longer on stack (CR 608.2b). */
    counter: (target: TargetSelection) => void;
    /** Player discards `amount` cards chosen uniformly at random (CR 701.8a).
     *  Capped at current hand size — no-op on an empty hand. Randomness is
     *  drawn from the game's seeded PRNG so replays reproduce the same picks. */
    discardAtRandom: (playerId: string, amount: number) => void;
}

// --- Continuous static effects (CR 611, 613) ---
// Minimal layer-system subset: P/T buffs (layer 7c) applied at read time.
// No layer ordering, no CDA support, no text-changing effects yet.
//
// Effects are expressed via an `applies` predicate (like SpellContext.resolve
// for spells). This keeps the engine small: no enum of scopes/filters to
// maintain — each card declares its own eligibility rule.

/** Minimal permanent shape exposed to static-effect predicates. */
export interface PermanentView {
    id: string;
    controllerId: string;
    ownerId: string;
    types: CardType[];
    subtypes: string[];
    isTapped: boolean;
    power?: number;
    toughness?: number;
    /** Raw card definition reference — predicates read manaCost for color, etc. */
    card: Record<string, unknown>;
}

export interface StaticEffectContext {
    /** Colors of a card derived from its mana cost (CR 202.2). Returns W/U/B/R/G subset. */
    getColors: (card: PermanentView) => Color[];
    /** True if card has type "Creature" (CR 208.2). */
    isCreature: (card: PermanentView) => boolean;
    /** True if card has the given subtype. */
    hasSubtype: (card: PermanentView, subtype: string) => boolean;
}

export interface StaticPTBuff {
    kind: "pt-buff";
    /** Predicate: does this buff apply to `target` given its `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    power: number;
    toughness: number;
}

export type StaticEffect = StaticPTBuff;

// --- Triggered abilities (CR 603) ---
// Inline structure mirroring ActivatedAbility: each trigger declares which
// game event it listens to, a predicate identifying relevant occurrences, and
// a resolve function invoked from the stack after both players pass priority.

export type GameEventType = "DAMAGE_DEALT";

/** Damage event emitted whenever a source inflicts damage on a target
 *  (CR 120.3). Used by "whenever ~ deals damage" triggers. */
export interface DamageDealtEvent {
    type: "DAMAGE_DEALT";
    /** Instance id of the permanent or stack item that dealt the damage. */
    sourceInstanceId: string;
    /** Controller of the damage source at the time of the event. */
    sourceControllerId: string;
    /** Target that took damage — player or permanent. */
    target: TargetSelection;
    amount: number;
    /** True for combat damage (CR 510), false for spell/ability damage. */
    isCombat: boolean;
}

export type GameEvent = DamageDealtEvent;

export interface TriggeredAbility {
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** Which event kind can fire this ability. Used to index-filter before matches(). */
    event: GameEventType;
    /** True if `event` triggers this ability on the permanent carrying it. */
    matches: (event: GameEvent, self: PermanentView) => boolean;
    /** Effect run when the trigger resolves from the stack. */
    resolve: (ctx: SpellContext, event: GameEvent) => void;
}

/** Full card definition used by the GRE. */
export interface CardDefinition {
    id: CardId;
    name: string;
    manaCost?: ManaCost;
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    loyalty?: number;
    /** Target requirements declared at cast time (CR 601.2c). */
    targetRequirement?: TargetRequirement;
    /** Imperative resolve function — called when the spell resolves from the stack. */
    resolve?: (ctx: SpellContext) => void;
    /** Permanent enters the battlefield tapped (e.g. Nevinyrral's Disk). */
    entersTapped?: boolean;
    staticAbilities?: string[];
    /** Continuous static effects (CR 611). Applied at stat-read time by the layer system. */
    staticEffects?: StaticEffect[];
    activatedAbilities?: ActivatedAbility[];
    triggeredAbilities?: TriggeredAbility[];
    sbaMods?: string[];
}
