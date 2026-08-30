// Pure Forge-scale creature body math (ADR 0018), extracted from `cardValue.ts`
// (issue #1426) so it is a LEAF module both the latent `cardValue` primitive
// AND the per-Op value model (`gre/ai/**`, which values a `createToken` Op by
// its token's body) can import without a cycle. No `GameState`, no
// `Math.random`, no mutation — importable from the client bundle exactly like
// `cardValue.ts`.

// Realized worth of a creature on the battlefield: a base, power- and
// toughness-weighted body, a mana-value term, plus keyword bonuses. Forge
// magnitudes (a vanilla 2/2 ≈ 170). Power-scales evasion / combat amplifiers
// (their value grows with the damage they push through), flat for binary
// keywords, negative for defender.
const CREATURE_BASE = 100;
const W_CR_POWER = 15;
const W_CR_TOUGHNESS = 14;
const W_CR_MV = 5;

/** Keyword → realized-value bonus, as a function of the creature's (floored)
 *  effective power. Structured as a table so an unimplemented keyword is
 *  zero-cost to add: drop in one entry. Restricted to the implemented keyword
 *  vocabulary (CR 702). Evasion and combat amplifiers are power-scaled; binary
 *  keywords are flat; `defender` is a penalty (the creature can't attack, so its
 *  power pushes no damage). Both `"first strike"` (the canonical engine spelling,
 *  see phases.ts) and the hyphenated form are accepted. */
const KEYWORD_BONUS: Record<string, (power: number) => number> = {
    // Evasion — harder-to-block damage scales with power (CR 509.1b).
    flying: (p) => 10 * p,
    fear: (p) => 8 * p,
    unblockable: (p) => 12 * p,
    intimidate: (p) => 8 * p,
    skulk: (p) => 6 * p,
    horsemanship: (p) => 10 * p,
    shadow: (p) => 10 * p,
    // Combat amplifiers — value grows with power.
    trample: (p) => 5 * p,
    "first strike": (p) => 5 + 4 * p,
    "first-strike": (p) => 5 + 4 * p,
    // Binary keywords — flat.
    vigilance: () => 8,
    reach: () => 5,
    indestructible: () => 30,
    haste: () => 10,
    banding: () => 5,
    // Defender — can't attack: its power is dead weight (CR 702.3a).
    defender: () => -30,
};

/** The flat `KEYWORD_BONUS` contribution one keyword occurrence makes at
 *  `power`, or 0 for a keyword the table does not price. Exported so a caller
 *  that must UNDO one occurrence's contribution reads the same table
 *  `creatureValueRaw` added it from, rather than re-typing the magnitude —
 *  `evaluate.ts` subtracts the occurrences that came from a duration-scoped
 *  defensive grant, which are priced by threat instead (issues #2937/#2938,
 *  `ai/protectionValue.ts`). */
export function keywordBonusFor(keyword: string, power: number): number {
    return KEYWORD_BONUS[keyword]?.(power) ?? 0;
}

/** Pure Forge-scale creature body value from raw characteristics — no game
 *  state. Shared by the realized `evaluateCreature` (effective P/T), the
 *  latent `cardValue*` (base P/T), and the per-Op `createToken` valuer, so all
 *  read the identical formula. Power / toughness must already be floored at 0. */
export function creatureValueRaw(
    power: number,
    toughness: number,
    mv: number,
    staticAbilities: readonly string[]
): number {
    let value =
        CREATURE_BASE +
        power * W_CR_POWER +
        toughness * W_CR_TOUGHNESS +
        mv * W_CR_MV;
    for (const keyword of staticAbilities) {
        const bonus = KEYWORD_BONUS[keyword];
        if (bonus) value += bonus(power);
    }
    return value;
}
