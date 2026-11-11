// Castability model — "can this deck pay this spell's coloured pips by the
// turn it wants to be cast?" (PRD #8772). ONE model, read by both the builder
// that chooses a Maindeck (`autoBuild.ts`'s castability term) and the Draft
// Table Audit that measures one (`src/lib/limited/draftTableAudit.ts`), so the
// build optimises exactly the number the audit's Floors hold.
//
// Declared and simple: a spell of mana value `mv` is cast on the play on turn
// `max(1, mv)`, having seen `7 + turn − 1` cards of the deck. For each coloured
// pip colour `c` it needs `pips[c]` sources of `c` among those cards. The
// colours are treated as independent hypergeometric draws and multiplied.
// Not modelled, deliberately: the generic part of the cost and the total land
// drop, a dual paying only one pip at a time, `{C}` pips, mulligans, the draw
// on the draw.
//
// Pure: no DB, no registry, no RNG.
import type { Color } from "../cards/types";

/** Opening hand size, the first of the cards seen by a turn. */
export const OPENING_HAND = 7;

const TRUE_COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** `P(X ≥ atLeast)` for `X ~ Hypergeometric(population, successes, draws)`. */
export function hypergeometricAtLeast(
    population: number,
    successes: number,
    draws: number,
    atLeast: number
): number {
    if (atLeast <= 0) return 1;
    const n = Math.min(draws, population);
    if (successes < atLeast || n < atLeast) return 0;
    const lnC = (a: number, b: number): number => {
        let s = 0;
        for (let i = 0; i < b; i++) s += Math.log(a - i) - Math.log(i + 1);
        return s;
    };
    const failures = population - successes;
    let below = 0;
    for (let k = Math.max(0, n - failures); k < atLeast; k++) {
        below += Math.exp(
            lnC(successes, k) + lnC(failures, n - k) - lnC(population, n)
        );
    }
    return Math.max(0, Math.min(1, 1 - below));
}

/** The probability, under the declared model, that a spell with these
 *  coloured `pips` and this `manaValue` has every pip payable by its own turn
 *  in a `deckSize`-card deck holding `sources[c]` sources of each colour. A
 *  spell with no coloured pip reads 1: nothing to pay for. */
export function pipCastability(
    pips: Partial<Record<Color, number>>,
    manaValue: number,
    deckSize: number,
    sources: Partial<Record<Color, number>>
): number {
    const draws = OPENING_HAND + Math.max(1, Math.round(manaValue)) - 1;
    let p = 1;
    for (const c of TRUE_COLORS) {
        const need = pips[c] ?? 0;
        if (need <= 0) continue;
        p *= hypergeometricAtLeast(deckSize, sources[c] ?? 0, draws, need);
    }
    return p;
}

/** True when the spell has at least one coloured pip to pay for. */
export function hasColouredPip(pips: Partial<Record<Color, number>>): boolean {
    return TRUE_COLORS.some((c) => (pips[c] ?? 0) > 0);
}
