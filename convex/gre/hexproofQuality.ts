// Hexproof and its "hexproof from [quality]" variant (CR 702.11) — a
// DEPENDENCY-FREE LEAF.
//
// Both forms are stored on a card as `staticAbilities[]` strings: plain
// `"hexproof"` (CR 702.11b) and `"hexproof from <quality>"` (CR 702.11d). This
// module is the ONE authority on two questions every consumer asks of those
// strings:
//
//   1. Which qualities can the engine honour? (`parseHexproofQuality`) — the
//      parser is TOTAL and FAILS CLOSED, exactly like `parseProtectionQuality`
//      (`gre/protection.ts`): a "hexproof from …" string whose quality it
//      cannot name returns `null`, never a quality that matches everything or
//      nothing. The Oracle grammar accepts a quality only when this parser can
//      name it (`oracle/grammar/shared/hexproofFromKeyword.ts`), and a
//      catalogue guard reds a shipped card declaring an unparseable one.
//
//   2. Does a keyword string count as "hexproof"? (`keywordDenotes`) — CR
//      702.11d: a "hexproof from [quality]" ability IS a hexproof ability, so
//      CR 702.11e makes every effect that removes hexproof remove it and every
//      effect that looks for hexproof find it. Routing those consumers through
//      one predicate is what keeps hexproof-from from being a separate keyword
//      that merely looks similar.
//
// Imports nothing at runtime, so card modules, the layer system, the filter
// matchers and the client can all read it without joining the card-registry
// import cycle (`docs/findings/1969-figure-of-fable-import-cycle.md`).

import type { Color } from "../cards/types";

/** CR 702.11b — the plain keyword's spelling, as `staticAbilities` carries it. */
export const HEXPROOF_KEYWORD = "hexproof";

const HEXPROOF_FROM_PREFIX = "hexproof from ";

/** One quality a "hexproof from" ability names (CR 702.11d).
 *
 *  - `color` — "hexproof from black": a source with that colour (CR 105.1).
 *  - `monocolored` — exactly one of the five colours (CR 105.2a).
 *  - `multicolored` — two or more of the five colours (CR 105.2b).
 *
 *  Colourless matches none of them (CR 105.2c — a colourless object has no
 *  colour, so it is neither monocolored nor multicolored). */
export type HexproofQuality =
    | { readonly kind: "color"; readonly color: Color }
    | { readonly kind: "monocolored" }
    | { readonly kind: "multicolored" };

const HEXPROOF_COLOR_WORDS: Readonly<Record<string, Color>> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
};

/** CR 105.1 — the five colours a colour count is taken over. A colour list may
 *  carry the colourless marker `"C"` on some shapes; it is no colour (CR
 *  105.2c), so it never counts. */
const FIVE_COLORS: ReadonlySet<Color> = new Set(["W", "U", "B", "R", "G"]);

/** True for ANY "hexproof from …" string, whether or not its quality parses —
 *  the catalogue guard uses it to find the strings that MUST parse. */
export function isHexproofFromAbility(ability: string): boolean {
    return ability.trim().toLowerCase().startsWith(HEXPROOF_FROM_PREFIX);
}

/** CR 702.11d — the quality a "hexproof from <quality>" string names, or
 *  `null` when the string is not one or names a quality the engine cannot
 *  honour (fail-closed). */
export function parseHexproofQuality(ability: string): HexproofQuality | null {
    const lower = ability.trim().toLowerCase();
    if (!lower.startsWith(HEXPROOF_FROM_PREFIX)) return null;
    const quality = lower.slice(HEXPROOF_FROM_PREFIX.length);
    if (quality === "monocolored") return { kind: "monocolored" };
    if (quality === "multicolored") return { kind: "multicolored" };
    const color = HEXPROOF_COLOR_WORDS[quality];
    return color === undefined ? null : { kind: "color", color };
}

/** CR 702.11d — true when an object with `colors` has `quality`. For a spell
 *  this is the spell's colours; for an ability, its SOURCE's ("abilities …
 *  from [quality] sources"). */
export function hasHexproofQuality(
    quality: HexproofQuality,
    colors: ReadonlyArray<Color>
): boolean {
    switch (quality.kind) {
        case "color":
            return colors.includes(quality.color);
        case "monocolored":
            return colorCount(colors) === 1;
        case "multicolored":
            return colorCount(colors) >= 2;
    }
}

function colorCount(colors: ReadonlyArray<Color>): number {
    return new Set(colors.filter((c) => FIVE_COLORS.has(c))).size;
}

/** CR 702.11d/e — true when the keyword string `declared` (as it sits on an
 *  object's `staticAbilities`) is an instance of the ability an effect NAMES
 *  as `named`. Equality, plus the one variant family the Comprehensive Rules
 *  fold into a named keyword: every "hexproof from [quality]" ability is a
 *  hexproof ability, so an effect naming "hexproof" — to remove it, or to look
 *  for it — reaches it. The converse does not hold: an effect naming
 *  "hexproof from black" means that ability only. */
export function keywordDenotes(declared: string, named: string): boolean {
    if (declared === named) return true;
    return named === HEXPROOF_KEYWORD && isHexproofFromAbility(declared);
}

/** CR 702.11e — "any effect that looks for a card with hexproof will find a
 *  card with a 'hexproof from [quality]' ability": true when `abilities`
 *  carries an instance of the named keyword (see `keywordDenotes`). */
export function hasKeywordAbility(
    abilities: ReadonlyArray<string> | undefined,
    named: string
): boolean {
    return abilities?.some((kw) => keywordDenotes(kw, named)) ?? false;
}
