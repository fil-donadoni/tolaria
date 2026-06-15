/**
 * Text-changing effects substrate (CR 612, layer 3).
 *
 * Tolaria has no card prose at runtime — abilities are structured data. CR 612
 * "change the text" therefore acts on the finite set of *structured* places a
 * substitutable word can live. That surface is captured here as a single
 * read-time transform, `applySubstitution`, rather than scattered across every
 * consumer.
 *
 * A substitution rides the instance as `CardInstanceState.textChanges` (see
 * `state.ts`), which gives the CR 612.6/612.7 duration for free: the field
 * lives on the instance, a zone change produces a new instance, so the effect
 * ends on a zone change with no bookkeeping.
 *
 * Enforcement (ADR 0011): the `switch` below is exhaustive over the
 * `TextChange["kind"]` union with an `assertNever` default — adding a new
 * word-bearing kind breaks the build until it is classified here. The
 * stringly-typed half is guarded by the token-coverage test in
 * `__tests__/textChanges.test.ts`.
 *
 * Current surface:
 *  - land-type slice (issue #120): land subtype → intrinsic mana
 *    (`getBasicLandMana` reads the rewritten subtypes) and landwalk keyword
 *    strings (`LANDWALK_KEYWORDS`).
 *  - color-word slice (issue #125, Sleight of Mind): color words inside
 *    `staticAbilities` strings (`"protection from <color>"`, read by
 *    `getProtectedColors`) and the structured `colorFilter` on color-targeted
 *    requirements (read by `substituteColorFilter` at the targeting
 *    chokepoints). A `"color-word"` entry is inert for the land readers and a
 *    `"land-type"` entry is inert for the color readers.
 */

import type { CardInstanceState } from "./state";
import type { Color } from "../cards/types";
import { LANDWALK_KEYWORDS } from "./constants";

function assertNever(x: never): never {
    throw new Error(`Unhandled text-change kind: ${JSON.stringify(x)}`);
}

// --- Color-word substitution surface (Sleight of Mind, issue #125) ---------
//
// A color word is the lowercase color name as it appears in ability text
// ("protection from white", "a blue source of your choice"). Sleight of Mind
// stores its change as `{ kind: "color-word", from: <word>, to: <word> }`. The
// word ⇄ color-code maps below bridge the two representations a color can take:
// the *word* inside a string field and the *code* on a structured colorFilter.

const COLOR_WORD_TO_CODE: Record<string, Color> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
};
const COLOR_CODE_TO_WORD: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
};

/** The color words (lowercase color names) recognized by the substitution
 *  surface — the legal `from`/`to` vocabulary for a color-word text change. */
export const COLOR_WORDS = Object.keys(COLOR_WORD_TO_CODE);

/** The color word naming a color code (`"W"` → `"white"`), or null for
 *  colorless (CR 105.2 — `"C"` has no color word). */
export function colorWordForCode(code: Color): string | null {
    return COLOR_CODE_TO_WORD[code] ?? null;
}

/** The color code a color word names (`"white"` → `"W"`), or null. */
export function codeForColorWord(word: string): Color | null {
    return COLOR_WORD_TO_CODE[word] ?? null;
}

/** Whole-word replacement of a color word inside an ability string (CR 612):
 *  `"protection from white"` with white→blue becomes `"protection from blue"`.
 *  Word-bounded so `"white"` inside a longer token is never touched. */
function rewriteColorWordInString(s: string, from: string, to: string): string {
    return s.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}

/** The landwalk keyword that references the given land subtype, or null
 *  (e.g. `"Forest"` → `"forestwalk"`). Built lazily from `LANDWALK_KEYWORDS`
 *  to avoid a module-init dependency in the constants ⇄ textChanges cycle. */
function landwalkForSubtype(subtype: string): string | null {
    for (const [keyword, sub] of Object.entries(LANDWALK_KEYWORDS)) {
        if (sub === subtype) return keyword;
    }
    return null;
}

/** Read-time rewritten view of an instance's word-bearing string fields under
 *  its active text-changing effects. The fields a substitution can touch
 *  today are `subtypes` and `staticAbilities`; the returned object is the same
 *  references when no `textChanges` are present (zero-copy fast path). */
export type SubstitutedText = {
    subtypes: string[];
    staticAbilities: string[];
};

export function applySubstitution(
    instance: Pick<
        CardInstanceState,
        "subtypes" | "staticAbilities" | "textChanges"
    >
): SubstitutedText {
    const changes = instance.textChanges;
    if (!changes || changes.length === 0) {
        return {
            subtypes: instance.subtypes,
            staticAbilities: instance.staticAbilities,
        };
    }
    let subtypes = instance.subtypes;
    let staticAbilities = instance.staticAbilities;
    // CR 612.6 — multiple text changes apply in timestamp (array) order.
    for (const change of changes) {
        switch (change.kind) {
            case "land-type": {
                if (subtypes.includes(change.from)) {
                    subtypes = subtypes.map((s) =>
                        s === change.from ? change.to : s
                    );
                }
                const fromWalk = landwalkForSubtype(change.from);
                const toWalk = landwalkForSubtype(change.to);
                if (fromWalk && toWalk && staticAbilities.includes(fromWalk)) {
                    staticAbilities = staticAbilities.map((a) =>
                        a === fromWalk ? toWalk : a
                    );
                }
                break;
            }
            case "color-word": {
                // CR 612: rewrite the color word inside every stringly-typed
                // ability ("protection from white" → "protection from blue").
                // The structured colorFilter half is rewritten separately by
                // `substituteColorFilter` (it isn't a string field). Guard the
                // map so the zero-copy fast path survives when the word is
                // absent from this object's text.
                if (
                    staticAbilities.some((a) =>
                        new RegExp(`\\b${change.from}\\b`).test(a)
                    )
                ) {
                    staticAbilities = staticAbilities.map((a) =>
                        rewriteColorWordInString(a, change.from, change.to)
                    );
                }
                break;
            }
            default:
                assertNever(change.kind);
        }
    }
    return { subtypes, staticAbilities };
}

/** The set of basic land types currently *present* in a target — the legal
 *  `from` choices for a land-type text change (CR 612: you may only replace a
 *  word that appears). Reads the post-substitution view so a second Magical
 *  Hack chains off the first one's result (CR 612.6). A type is "present" if
 *  it is a land subtype on the object OR is referenced by one of its landwalk
 *  keywords (so a `forestwalk` creature offers `Forest`). */
export function landTypesPresent(
    instance: Pick<
        CardInstanceState,
        "subtypes" | "staticAbilities" | "textChanges"
    >
): string[] {
    const view = applySubstitution(instance);
    const present = new Set<string>();
    for (const subtype of view.subtypes) {
        // A basic land subtype iff some landwalk keyword references it.
        if (landwalkForSubtype(subtype) !== null) present.add(subtype);
    }
    for (const ability of view.staticAbilities) {
        const subtype = LANDWALK_KEYWORDS[ability];
        if (subtype) present.add(subtype);
    }
    return [...present];
}

/** The effective color a structured `colorFilter` (CR 202.2) resolves to under
 *  an instance's active color-word changes (CR 612.6). A Circle of Protection:
 *  Blue whose blue→red word change is active filters targets to red sources.
 *  Colorless (`"C"`) and any color with no word pass through unchanged. */
export function substituteColorFilter(
    instance: Pick<CardInstanceState, "textChanges">,
    color: Color
): Color {
    const changes = instance.textChanges;
    if (!changes || changes.length === 0) return color;
    let word = COLOR_CODE_TO_WORD[color];
    if (!word) return color; // colorless source — no color word to change
    // CR 612.6 — chained changes apply in timestamp (array) order.
    for (const change of changes) {
        if (change.kind === "color-word" && change.from === word) {
            word = change.to;
        }
    }
    return COLOR_WORD_TO_CODE[word] ?? color;
}

/** The color words an object currently references in its text, read through any
 *  active changes (CR 612.6) — the legal `from` choices for a color-word text
 *  change. Two sources, both deduped to lowercase color names:
 *   - color words inside its (post-substitution) `staticAbilities` strings,
 *     e.g. `"protection from white"`;
 *   - the structured color filters its abilities declare (`extraColorCodes`,
 *     e.g. a Circle of Protection's "<color> source of your choice"), each
 *     mapped through the active changes so a second Sleight chains off the
 *     first. */
export function colorWordsPresent(
    instance: Pick<
        CardInstanceState,
        "subtypes" | "staticAbilities" | "textChanges"
    >,
    extraColorCodes: readonly Color[] = []
): string[] {
    const view = applySubstitution(instance);
    const present = new Set<string>();
    for (const ability of view.staticAbilities) {
        for (const word of COLOR_WORDS) {
            if (new RegExp(`\\b${word}\\b`).test(ability)) present.add(word);
        }
    }
    for (const code of extraColorCodes) {
        const word = colorWordForCode(substituteColorFilter(instance, code));
        if (word) present.add(word);
    }
    return [...present];
}
