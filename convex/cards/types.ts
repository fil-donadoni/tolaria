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

export type TargetType =
    | "creature"
    | "player"
    | "land"
    | "enchantment"
    | "artifact"
    | "permanent"
    | "any";

export interface TargetRequirement {
    type: TargetType;
    count: number;
}

export interface TargetSelection {
    type: "creature" | "player";
    id: string; // cardInstanceId or playerId
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
    getController: (target: TargetSelection) => string;
    destroy: (target: TargetSelection) => void;
    exile: (target: TargetSelection) => void;
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
    staticAbilities?: string[];
    activatedAbilities?: string[];
    triggeredAbilities?: string[];
    sbaMods?: string[];
}
