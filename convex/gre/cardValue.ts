// Shared latent Card Value primitive (ADR 0018, issue #195; extracted for
// issue #1113 / PRD #1107). Scores the WORTH of a card from its raw printed
// characteristics alone — no `GameState`, no battlefield context. This is the
// exact core `evaluate.ts`'s Hand term and resolution-choice ordering already
// used for the vs-AI Brain; it now ALSO backs the Limited Bot Drafter's Pick
// Heuristic (`convex/limited/botDrafter.ts`), so both consumers score card
// quality identically instead of drifting apart.
//
// Isomorphic (no `convex/server`, `convex/values`, `_generated`, `ctx.*`) —
// importable from Convex mutations (the Bot Drafter, server-side) AND from
// the client bundle (`src/lib/ai/bot-view.ts`, `src/lib/ai/selfplay/*`) via
// the `convex/gre` barrel. The client keeps importing FROM convex/, never the
// reverse (CLAUDE.md).
//
// PURE: no Math.random, no mutation. `evaluate.ts` re-exports `cardValueById`
// verbatim and keeps `cardValue(state, card)` / `evaluateCreature` locally
// (those genuinely need `GameState` — effective P/T through the layer system)
// but now delegates their shared body math (`creatureValueRaw`, the latent
// core) to this module so there is exactly one implementation.
import { tryGetDefinition } from "../cards";
import { manaValue } from "./constants";

// --- Forge `evaluateCreature` port (ADR 0018) ------------------------------
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

/** Pure Forge-scale creature body value from raw characteristics — no game
 *  state. Shared by the realized `evaluateCreature` (effective P/T) and the
 *  latent `cardValue*` (base P/T), so both read the identical formula. Power /
 *  toughness must already be floored at 0. */
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

// --- Latent `cardValue` primitive (ADR 0018, issue #195) -------------------
// The worth of a specific card while it is NOT in play (hand / library /
// graveyard), used for the Hand term and (slice 4) the resolution-choice path,
// and now the Bot Drafter's Pick Heuristic's card-quality component.
// Creatures reuse the Forge `evaluateCreature` body, discounted because a card
// in hand still has to be cast (and survive) to realize its board value; non-
// creatures get `base + MV × k`. An `aiValue` override on the CardDefinition
// replaces the derived value verbatim.
const LATENT_DISCOUNT = 0.85; // latent creature worth = discounted realized
const NONCREATURE_BASE = 8; // base latent worth of a non-creature card (MV 0)
const W_NC_MV = 10; // per mana value, non-creature latent worth

/** Latent worth from a card's raw characteristics (ADR 0018) — the SHARED core
 *  of every `cardValue*` entry point. An `aiValue` override wins outright (the
 *  Forge `SVar` analog); otherwise a creature is its discounted creature body
 *  (a card in hand must still be cast and survive), and a non-creature is
 *  `NONCREATURE_BASE + MV × W_NC_MV`. A basic land scores `NONCREATURE_BASE`
 *  (MV 0) — below its realized in-play worth, so developing it stays strictly
 *  positive (issue #149). */
export function latentValue(chars: {
    isCreature: boolean;
    power: number;
    toughness: number;
    manaValue: number;
    staticAbilities: readonly string[];
    aiValue?: number;
}): number {
    if (chars.aiValue !== undefined) return chars.aiValue;
    if (chars.isCreature) {
        return (
            LATENT_DISCOUNT *
            creatureValueRaw(
                Math.max(0, chars.power),
                Math.max(0, chars.toughness),
                chars.manaValue,
                chars.staticAbilities
            )
        );
    }
    return NONCREATURE_BASE + chars.manaValue * W_NC_MV;
}

/** Latent worth of a card from its registry id alone — the resolution-choice
 *  entry point (ADR 0018, issue #197), and the Bot Drafter Pick Heuristic's
 *  card-quality term (issue #1113, PRD #1107 story 29). Derives the value from
 *  the `CardDefinition` (base P/T, mana value, keywords, `aiValue`) via the
 *  `latentValue` core above. Returns 0 for an unknown id (a token or a card
 *  the registry lacks — it simply ranks lowest). */
export function cardValueById(cardId: string): number {
    const def = tryGetDefinition(cardId);
    if (!def) return 0;
    return latentValue({
        isCreature: def.types.includes("Creature"),
        power: def.power ?? 0,
        toughness: def.toughness ?? 0,
        manaValue: manaValue(def.manaCost),
        staticAbilities: def.staticAbilities ?? [],
        aiValue: def.aiValue,
    });
}
