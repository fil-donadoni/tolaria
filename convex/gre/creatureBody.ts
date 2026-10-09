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

/** The realized worth of the SMALLEST creature this scale can produce: a 1/1
 *  with mana value 0 and no keywords. Nothing on a battlefield moves the
 *  `creatures` eval term by less than this and is still a creature — a +1/+1
 *  counter is `W_CR_POWER + W_CR_TOUGHNESS`, a fifth of it.
 *
 *  Exported for the debug UI (issue #3404), which needs a floor below which a
 *  change in the term must NOT be read as "a creature appeared or died".
 *  Derived here rather than typed as a literal over there: these four
 *  constants are the scale's definition, and a copy of 129 in another file
 *  goes stale the first time one of them moves. */
export const SMALLEST_CREATURE_BODY =
    CREATURE_BASE + W_CR_POWER + W_CR_TOUGHNESS;

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
    // Evasion / combat amplifiers the table once left at 0 (issue #5152).
    // Menace (CR 702.111) needs two blockers: weaker than flying, still power-scaled.
    menace: (p) => 6 * p,
    // Lifelink (CR 702.15): a life swing per damage dealt, so power-scaled.
    lifelink: (p) => 6 * p,
    // Deathtouch (CR 702.2): flat kill threat plus a small share of the body.
    deathtouch: (p) => 20 + 2 * p,
    // Double strike (CR 702.4) ≈ first strike + the extra power it deals.
    "double strike": (p) => 5 + 14 * p,
    "double-strike": (p) => 5 + 14 * p,
    // Infect / wither (CR 702.90 / 702.80): damage-equivalent, power-scaled.
    infect: (p) => 8 * p,
    wither: (p) => 5 * p,
    // Resilience — flat (CR 702.18 shroud / 702.11 hexproof).
    shroud: () => 15,
    hexproof: () => 15,
    // NOT here (priced once, by their expanded trigger script via
    // `dslRealizedAbilityValueById`, so a row would count twice): exalted,
    // prowess, battle cry, annihilator, ward, fading. Only a keyword whose
    // expansion carries no `effects`/`aiEffects` script is priced in this table.
    // Negative rows: a permanent that stays tapped or leaves is worth less.
    "does-not-untap": () => -40,
    "may-choose-not-to-untap": () => -10,
    // Echo (CR 702.30) — a one-shot upkeep payment, small.
    echo: () => -8,
};

/** Parametrized keyword families (a colour, a land type, a number in the
 *  printed string), matched against the FULL declared string — the same shape
 *  the Mechanics Registry's `bindingPattern` rows use. One row per family
 *  (issue #5152). Fading / vanishing are NOT here: their worth depends on the
 *  remaining counters, see `timeLimitedPenalty`. */
const KEYWORD_FAMILY_BONUS: readonly {
    readonly pattern: RegExp;
    readonly bonus: (power: number, match: RegExpExecArray) => number;
}[] = [
    // Landwalk (CR 702.14): evasion against a deck that has the land.
    {
        pattern:
            /^(snow )?(plains|island|swamp|mountain|forest|desert)walk$|^legendary landwalk$/,
        bonus: (p) => 4 * p,
    },
    // Protection (CR 702.16): resilience, one flat value for every quality.
    { pattern: /^protection from /, bonus: () => 15 },
    // Rampage (CR 702.23): its trigger carries no script value.
    { pattern: /^rampage \d+$/, bonus: () => 6 },
];

const VANISHING_KEYWORD = /^vanishing (\d+)$/;

/** Counters a creature's vanishing keyword reads. */
export type KeywordCounters = Readonly<Record<string, number>>;

/** The time-limited discount of a vanishing creature (CR 702.63): the fewer
 *  time counters left, the sooner it is sacrificed. `counters` is the live
 *  instance's counter bag; omitted (the definition path), the printed `N`.
 *  Fading is NOT priced here: its upkeep trigger carries an `aiEffects`
 *  script the realized ability reader already values, and vanishing's has
 *  none — a second fading row would count the same clock twice. */
function timeLimitedPenalty(
    keyword: string,
    counters: KeywordCounters | undefined
): number {
    const match = VANISHING_KEYWORD.exec(keyword);
    if (!match) return 0;
    const remaining = counters ? (counters.time ?? 0) : Number(match[1]);
    return -(12 + 12 * Math.max(0, 5 - remaining));
}

/** The flat `KEYWORD_BONUS` contribution one keyword occurrence makes at
 *  `power`, or 0 for a keyword the table does not price. Exported so a caller
 *  that must UNDO one occurrence's contribution reads the same table
 *  `creatureValueRaw` added it from, rather than re-typing the magnitude —
 *  `evaluate.ts` subtracts the occurrences that came from a duration-scoped
 *  defensive grant, which are priced by threat instead (issues #2937/#2938,
 *  `ai/protectionValue.ts`). */
export function keywordBonusFor(
    keyword: string,
    power: number,
    counters?: KeywordCounters
): number {
    const exact = KEYWORD_BONUS[keyword];
    if (exact) return exact(power);
    for (const family of KEYWORD_FAMILY_BONUS) {
        const match = family.pattern.exec(keyword);
        if (match) return family.bonus(power, match);
    }
    return timeLimitedPenalty(keyword, counters);
}

/** Pure Forge-scale creature body value from raw characteristics — no game
 *  state. Shared by the realized `evaluateCreature` (effective P/T), the
 *  latent `cardValue*` (base P/T), and the per-Op `createToken` valuer, so all
 *  read the identical formula. Power / toughness must already be floored at 0. */
export function creatureValueRaw(
    power: number,
    toughness: number,
    mv: number,
    staticAbilities: readonly string[],
    /** The live instance's counters (fading / vanishing read them); omitted on
     *  the definition path, which uses the printed count. */
    counters?: KeywordCounters
): number {
    let value =
        CREATURE_BASE +
        power * W_CR_POWER +
        toughness * W_CR_TOUGHNESS +
        mv * W_CR_MV;
    for (const keyword of staticAbilities)
        value += keywordBonusFor(keyword, power, counters);
    return value;
}

// The non-creature twin (issue #4903): the latent worth of a non-creature
// card with no script, `base + MV × k`. Here rather than in `cardValue.ts` so
// the Representative Victim (`ai/representativeVictim.ts`) prices a typical
// artifact or enchantment from the same formula without importing the latent
// card-value primitive.
const NONCREATURE_BASE = 8; // base latent worth of a non-creature card (MV 0)
const W_NC_MV = 10; // per mana value, non-creature latent worth

/** `NONCREATURE_BASE + MV × W_NC_MV` — a script-less non-creature's worth. */
export function nonCreatureBodyRaw(mv: number): number {
    return NONCREATURE_BASE + mv * W_NC_MV;
}
