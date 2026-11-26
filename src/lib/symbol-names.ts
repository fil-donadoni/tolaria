/**
 * THE symbol mapping (issue #9834): which `{…}` tokens are symbols, and what
 * each one is called when it cannot be drawn.
 *
 * A token is MAPPABLE exactly when it has a row here — and every row has an
 * SVG under `public/img/symbols/` (`symbol-names.test.ts` pins the two sets
 * equal, both ways). An unmappable `{…}` is not a symbol: the parser leaves it
 * as text, so a code-like brace never turns into a broken image.
 *
 * Pure data, no JSX: the parser (`oracle-text.tsx`), the static guard
 * (`scripts/lib/ui-symbol-literal-scan.ts`) and the `check:ui` probe's drift
 * test all read this one table.
 */

const COLOR_NAMES: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

/** The ten two-colour hybrid pairs, in the order the symbol files spell them. */
const HYBRID_PAIRS = [
    "W/U",
    "U/B",
    "B/R",
    "R/G",
    "G/W",
    "W/B",
    "U/R",
    "B/G",
    "R/W",
    "G/U",
] as const;

const GENERIC_NUMBERS = [
    ...Array.from({ length: 21 }, (_, i) => String(i)),
    "100",
    "1000000",
] as const;

function buildSymbolNames(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const [c, name] of Object.entries(COLOR_NAMES)) {
        names[c] = `${name} mana`;
        names[`${c}/P`] = `Phyrexian ${name} mana`;
        names[`2/${c}`] = `two generic or ${name} mana`;
    }
    for (const pair of HYBRID_PAIRS) {
        const [a, b] = pair.split("/");
        names[pair] = `${COLOR_NAMES[a]} or ${COLOR_NAMES[b]} mana`;
    }
    for (const n of GENERIC_NUMBERS) names[n] = `${n} generic mana`;
    Object.assign(names, {
        "½": "half generic mana",
        "∞": "infinite generic mana",
        C: "colorless mana",
        X: "X generic mana",
        Y: "Y generic mana",
        Z: "Z generic mana",
        P: "Phyrexian mana",
        S: "snow mana",
        HW: "half white mana",
        HR: "half red mana",
        T: "tap",
        Q: "untap",
        E: "energy",
        A: "acorn",
        PW: "planeswalker",
        CHAOS: "chaos",
    });
    return names;
}

/** Canonical token (upper case, `/` for hybrids) → its spoken name. */
export const SYMBOL_NAMES: Readonly<Record<string, string>> =
    buildSymbolNames();

/** Every `{…}` token, captured without its braces. */
export const BRACE_TOKEN_RE = /\{([^}]+)\}/g;

/** The canonical spelling a token's row is keyed by (`{t}` ≡ `{T}`). */
export function canonicalSymbol(token: string): string {
    return token.toUpperCase();
}

/** The spoken name of a mappable token, `undefined` for an unmappable one. */
export function symbolName(token: string): string | undefined {
    return SYMBOL_NAMES[canonicalSymbol(token)];
}

/** The SVG a mappable token draws. Hybrid symbols use `_` for `/`. */
export function symbolSrc(token: string): string {
    return `/img/symbols/${canonicalSymbol(token).replace(/\//g, "_")}.svg`;
}

/** Whether `text` holds at least one mappable `{…}` token. */
export function hasSymbolToken(text: string): boolean {
    for (const m of text.matchAll(BRACE_TOKEN_RE)) {
        if (symbolName(m[1]) !== undefined) return true;
    }
    return false;
}

/**
 * The plain-text rendering for a sink that cannot hold an icon (`title`,
 * `aria-label`, `<option>`): each mappable token becomes its spoken name,
 * adjacent symbols separated by a space ("{2}{R}" → "2 generic mana red
 * mana"). Unmappable braces stay as written.
 */
export function symbolsToSpokenText(text: string): string {
    return text
        .replace(BRACE_TOKEN_RE, (whole, token: string) => {
            const name = symbolName(token);
            return name === undefined ? whole : ` ${name} `;
        })
        .replace(/ {2,}/g, " ")
        .replace(/ ([.,:;?!)])/g, "$1")
        .replace(/\( /g, "(")
        .trim();
}
