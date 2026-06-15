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
 * Current surface (the land-type slice, issue #120):
 *  - land subtype → intrinsic mana (`getBasicLandMana` reads the rewritten
 *    subtypes) and landwalk keyword strings (`LANDWALK_KEYWORDS`).
 * The color-word surface (protection-from, color-targeted requirements) is
 * wired by issue #125 (Sleight of Mind); a `"color-word"` entry is inert for
 * the land-mana / landwalk readers below.
 */

import type { CardInstanceState } from "./state";
import { LANDWALK_KEYWORDS } from "./constants";

function assertNever(x: never): never {
    throw new Error(`Unhandled text-change kind: ${JSON.stringify(x)}`);
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
            case "color-word":
                // Color words don't touch land mana or landwalk; their read
                // surfaces (protection-from, color-targeted requirements) are
                // wired by issue #125 (Sleight of Mind).
                break;
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
