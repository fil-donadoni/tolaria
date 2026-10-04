// Do two DECLARED positions differ by their Discriminant only? (issue #4796,
// PRD #4792, ADR 0148)
//
// `pairDerivation.ts` WRITES a right-hand half from its anchor, so the half
// differs by construction. A registry pair is the other direction: two blade
// entries a person wrote by hand, which the data then DECLARES a pair. Nothing
// stopped the two from differing in ten things, and "two boards differing in
// ten things attribute the difference to the wrong term" (ADR 0148, considered
// options) — so the declaration is only believed once this check passes.
//
// ONE FOOTPRINT PER KIND, mirroring what `deriveRightHalfPosition` edits for
// that kind: the footprint is erased from both positions and what is left must
// be identical, and the footprint itself must actually differ (a pair whose two
// positions are equal realises no Discriminant). A `card` footprint is the
// multiset of `spec.cards` and admits one card added, removed or swapped for
// another. `other` names no footprint, so it admits exactly ONE differing value
// anywhere in the position — the strictest reading of "the judge's own words".
// The decision seat and the decklists the search may know are never a
// Discriminant: they differ → refused.
//
// Pure, types only — the same bundle rule as `pairDerivation.ts`.

import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { Discriminant } from "./types";
import { PER_TURN_SPEC_KEYS, type PairPosition } from "./pairDerivation";

type Json = unknown;

const same = (a: Json, b: Json): boolean =>
    JSON.stringify(a) === JSON.stringify(b);

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Every path at which `a` and `b` differ, to the leaf. Arrays of unequal
 *  length differ at the array itself. */
function differingPaths(a: Json, b: Json, path = ""): string[] {
    if (same(a, b)) return [];
    const isObject = (x: Json): x is Record<string, Json> =>
        typeof x === "object" && x !== null && !Array.isArray(x);
    if (isObject(a) && isObject(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        return [...keys].flatMap((k) =>
            differingPaths(a[k], b[k], `${path}.${k}`)
        );
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
        return a.flatMap((item, i) =>
            differingPaths(item, b[i], `${path}[${i}]`)
        );
    }
    return [path];
}

/** The spec keys a `step` Discriminant legitimately moves
 *  (`deriveRightHalfPosition`, header: a step boundary). */
const STEP_SPEC_KEYS = [
    "phase",
    "activePlayer",
    "priority",
    "passCount",
    "manaPool",
    "combat",
    "turn",
    "turnsTaken",
    "qualifyingActionLastTurn",
    ...PER_TURN_SPEC_KEYS,
] as const satisfies readonly (keyof ScenarioSpec)[];

/** Per-card state a new turn clears. */
const STEP_CARD_KEYS = [
    "damageMarked",
    "activations",
    "abilityResolutions",
] as const;

type SpecKey = keyof ScenarioSpec;

/** Erase `keys` from the spec of a copy of `position`. */
function without(position: PairPosition, keys: readonly SpecKey[]) {
    const out = copy(position);
    for (const key of keys) delete out.spec[key];
    return out;
}

/** Both positions with `keys` erased, and whether those keys differed. */
function eraseSpecKeys(
    anchor: PairPosition,
    half: PairPosition,
    keys: readonly SpecKey[]
) {
    const touched = keys.some((k) => !same(anchor.spec[k], half.spec[k]));
    return { a: without(anchor, keys), b: without(half, keys), touched };
}

/** The cards in `from` that `other` lacks, multiset-wise. */
function surplus(from: readonly Json[], other: readonly Json[]): string[] {
    const left = new Map<string, number>();
    for (const card of other) {
        const key = JSON.stringify(card);
        left.set(key, (left.get(key) ?? 0) + 1);
    }
    const out: string[] = [];
    for (const card of from) {
        const key = JSON.stringify(card);
        const n = left.get(key) ?? 0;
        if (n > 0) left.set(key, n - 1);
        else out.push(key);
    }
    return out;
}

const cardName = (json: string): string =>
    String((JSON.parse(json) as { name?: unknown }).name);

function cardDefect(anchor: PairPosition, half: PairPosition): string | null {
    const gone = surplus(anchor.spec.cards, half.spec.cards);
    const added = surplus(half.spec.cards, anchor.spec.cards);
    if (gone.length + added.length === 0) {
        return "the two positions hold the same cards, so no card realises the Discriminant";
    }
    if (gone.length > 1 || added.length > 1) {
        return `${gone.length} card(s) leave and ${added.length} arrive — a card Discriminant is one card added, removed or swapped`;
    }
    if (
        gone.length === 1 &&
        added.length === 1 &&
        cardName(gone[0]) === cardName(added[0])
    ) {
        return `the only card difference is a property of ${cardName(gone[0])}, not a different card`;
    }
    const a = copy(anchor);
    const b = copy(half);
    a.spec.cards = [];
    b.spec.cards = [];
    return restDefect(a, b);
}

/** Everything but the footprint must be identical. */
function restDefect(a: PairPosition, b: PairPosition): string | null {
    const paths = differingPaths(a, b);
    return paths.length === 0
        ? null
        : `differs beyond the Discriminant at ${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ` (+${paths.length - 4} more)` : ""}`;
}

/**
 * Why `half` is not `anchor` with only `discriminant` changed, or `null` when
 * it is. A defect is an authoring error in the declaration, never a verdict.
 */
export function pairPositionDefect(
    anchor: PairPosition,
    half: PairPosition,
    discriminant: Discriminant
): string | null {
    if (anchor.seat !== half.seat) {
        return `the halves are decided by different seats (${anchor.seat}, ${half.seat}) — one pair, one decision`;
    }
    if (!same(anchor.deckKnowledge ?? [], half.deckKnowledge ?? [])) {
        return "the halves carry different deck knowledge — the search was told different things";
    }

    switch (discriminant.kind) {
        case "card":
            return cardDefect(anchor, half);
        case "step": {
            const { a, b, touched } = eraseSpecKeys(
                anchor,
                half,
                STEP_SPEC_KEYS
            );
            for (const position of [a, b]) {
                for (const card of position.spec.cards) {
                    for (const key of STEP_CARD_KEYS) delete card[key];
                }
            }
            if (!touched) {
                return "the halves share a step, so nothing realises the step Discriminant";
            }
            return restDefect(a, b);
        }
        case "life":
        case "mana":
        case "stack": {
            const keys: SpecKey[] =
                discriminant.kind === "life"
                    ? ["life"]
                    : discriminant.kind === "mana"
                      ? ["manaPool", "landCount"]
                      : ["stack"];
            const { a, b, touched } = eraseSpecKeys(anchor, half, keys);
            if (!touched) {
                return `the halves share their ${discriminant.kind}, so nothing realises the Discriminant`;
            }
            return restDefect(a, b);
        }
        case "sequence": {
            const earlier = anchor.setup ?? [];
            const later = half.setup ?? [];
            if (
                later.length <= earlier.length ||
                !same(later.slice(0, earlier.length), earlier)
            ) {
                return "the half's setup is not the anchor's setup plus at least one earlier move";
            }
            const a = copy(anchor);
            const b = copy(half);
            delete a.setup;
            delete b.setup;
            return restDefect(a, b);
        }
        case "other": {
            const paths = differingPaths(
                { spec: anchor.spec, setup: anchor.setup },
                { spec: half.spec, setup: half.setup }
            );
            if (paths.length === 1) return null;
            return paths.length === 0
                ? "the two positions are identical, so nothing realises the Discriminant"
                : `an "other" Discriminant admits exactly one differing value; these differ at ${paths.length} (${paths.slice(0, 4).join(", ")})`;
        }
        default: {
            const never: never = discriminant.kind;
            return `unknown Discriminant kind ${String(never)}`;
        }
    }
}
