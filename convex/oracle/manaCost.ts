/**
 * Mana cost / mana symbol reading (CR 107.4, CR 202.1).
 *
 * A printed mana cost is a sequence of symbols with no prose in it, so this is
 * a tokeniser, not a grammar — but it is held to the same rule as the grammar:
 * the symbol sequence is consumed WHOLE or the read fails. An unrecognised
 * symbol never degrades to "generic 1"; it fails the card. That matters because
 * the shapes `ManaCost` cannot represent (monocolour hybrid `{2/W}`, snow
 * `{S}`) are exactly the ones a lenient reader would silently approximate.
 */

import type { Color, ManaCost } from "../cards/types";

export type ManaReadResult =
    | { readonly ok: true; readonly cost: ManaCost }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

const COLORS = new Set<string>(["W", "U", "B", "R", "G", "C"]);

/** Every `{…}` symbol in order; fails if any character sits outside a symbol. */
export function tokenizeManaSymbols(
    text: string
):
    | { ok: true; symbols: string[] }
    | { ok: false; reason: string; fragment: string } {
    const symbols: string[] = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] !== "{") {
            return {
                ok: false,
                reason: `stray "${text[i]}" outside a mana symbol`,
                fragment: text,
            };
        }
        const close = text.indexOf("}", i);
        if (close === -1)
            return {
                ok: false,
                reason: "unclosed mana symbol",
                fragment: text,
            };
        symbols.push(text.slice(i + 1, close));
        i = close + 1;
    }
    return { ok: true, symbols };
}

/**
 * Read a printed mana cost into `ManaCost`.
 *
 * Encoding notes, matching `convex/cards/types.ts`:
 *  - CR 107.3 — generic mana lives in the `X` slot when it is a plain number;
 *    `generic` carries the fixed portion only when a VARIABLE {X} is also
 *    present and has taken the `X` slot.
 *  - CR 107.3 — repeated `{X}` pips become `xFactor` (Recall's `{X}{X}{U}`).
 *  - CR 107.4f — Phyrexian pips are declared, not folded into the requirement.
 *  - CR 107.4e — guild hybrid pips become `hybrid` pairs.
 */
export function readManaCost(printed: string): ManaReadResult {
    const trimmed = printed.trim();
    if (trimmed.length === 0) return { ok: true, cost: {} };
    const tokens = tokenizeManaSymbols(trimmed);
    if (!tokens.ok) return tokens;

    let generic = 0;
    let xPips = 0;
    const colored: Partial<Record<Color, number>> = {};
    const phyrexian: Partial<Record<Color, number>> = {};
    const hybrid: [Color, Color][] = [];

    for (const sym of tokens.symbols) {
        if (/^\d+$/.test(sym)) {
            generic += Number(sym);
        } else if (sym === "X") {
            xPips += 1;
        } else if (COLORS.has(sym)) {
            const c = sym as Color;
            colored[c] = (colored[c] ?? 0) + 1;
        } else if (/^[WUBRG]\/P$/.test(sym)) {
            const c = sym[0] as Color;
            phyrexian[c] = (phyrexian[c] ?? 0) + 1;
        } else if (/^[WUBRG]\/[WUBRG]$/.test(sym)) {
            hybrid.push([sym[0] as Color, sym[2] as Color]);
        } else {
            // {2/W} monocolour hybrid, {S} snow, {W/U/P}, … — representable
            // nowhere in `ManaCost`, so the card fails rather than being
            // approximated.
            return {
                ok: false,
                reason: `mana symbol {${sym}} is not representable`,
                fragment: printed,
            };
        }
    }

    const cost: ManaCost = {};
    if (xPips > 0) {
        cost.X = "X";
        if (xPips > 1) cost.xFactor = xPips;
        if (generic > 0) cost.generic = generic;
    } else if (generic > 0) {
        cost.X = generic;
    }
    for (const c of ["W", "U", "B", "R", "G", "C"] as const) {
        if (colored[c]) cost[c] = colored[c];
    }
    if (Object.keys(phyrexian).length > 0) cost.phyrexian = phyrexian;
    if (hybrid.length > 0) cost.hybrid = hybrid;
    return { ok: true, cost };
}
