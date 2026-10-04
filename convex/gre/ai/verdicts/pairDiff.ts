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
// positions are equal realises no Discriminant).
//
// - `card`: the spec's cards, a `count` of N read as N cards, in order. One
//   card added, removed or swapped for another; the rest keep their relative
//   order (a library is read top-down, so a reorder is a change).
// - `step`: the phase, the turn holder, priority and what a step boundary
//   implies (pools empty, combat ends). The turn-scoped state — the per-turn
//   tallies, marked damage, activations — moves only when the turn itself
//   advances.
// - `life`: ONE seat's life total. `mana`: the floating pool. `stack`: the
//   declared stack. `sequence`: the half's setup is the anchor's plus at least
//   one earlier move.
// - `other` names no footprint, so it admits exactly ONE differing value
//   anywhere in the position, and never a changed number of entries — the
//   strictest reading of "the judge's own words".
//
// The decision seat and the decklists the search may know are never a
// Discriminant: they differ → refused.
//
// Pure, types only — the same bundle rule as `pairDerivation.ts`.

import type { ScenarioCard, ScenarioSpec } from "../../../debugScenarioSpec";
import type { Discriminant } from "./types";
import { PER_TURN_SPEC_KEYS, type PairPosition } from "./pairDerivation";

type Json = unknown;

/** Key-sorted JSON: two spellings of one value compare equal, as the verdict
 *  identity hash does (`identity.ts`). */
function canon(value: Json): string {
    if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const rec = value as Record<string, Json>;
        return `{${Object.keys(rec)
            .filter((k) => rec[k] !== undefined)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canon(rec[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

const same = (a: Json, b: Json): boolean => canon(a) === canon(b);

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isObject = (x: Json): x is Record<string, Json> =>
    typeof x === "object" && x !== null && !Array.isArray(x);

/** Every path at which `a` and `b` differ, to the leaf. An array of unequal
 *  length differs at the array itself and is also listed in `resized`. */
function differingPaths(
    a: Json,
    b: Json,
    path = "",
    resized: string[] = []
): { paths: string[]; resized: string[] } {
    if (same(a, b)) return { paths: [], resized };
    if (isObject(a) && isObject(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        const paths = [...keys].flatMap(
            (k) => differingPaths(a[k], b[k], `${path}.${k}`, resized).paths
        );
        return { paths, resized };
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            resized.push(path);
            return { paths: [path], resized };
        }
        const paths = a.flatMap(
            (item, i) =>
                differingPaths(item, b[i], `${path}[${i}]`, resized).paths
        );
        return { paths, resized };
    }
    return { paths: [path], resized };
}

type SpecKey = Exclude<keyof ScenarioSpec, "cards">;

/** The spec keys a step boundary moves inside one turn (CR 106.4: pools
 *  empty; CR 506.1: a combat lives inside its turn). */
const STEP_KEYS: readonly SpecKey[] = [
    "phase",
    "activePlayer",
    "priority",
    "passCount",
    "manaPool",
    "combat",
];

/** What a NEW turn adds: its cleanup and the turn-scoped tallies
 *  (`deriveRightHalfPosition`, `advanceTurn`). */
const NEW_TURN_KEYS: readonly SpecKey[] = [
    "turn",
    "turnsTaken",
    "qualifyingActionLastTurn",
    ...PER_TURN_SPEC_KEYS,
];

/** Per-card state a new turn clears. */
const NEW_TURN_CARD_KEYS = [
    "damageMarked",
    "activations",
    "abilityResolutions",
] as const;

/** A copy of `position` with `keys` erased from its spec. */
function without(
    position: PairPosition,
    keys: readonly SpecKey[]
): PairPosition {
    const out = copy(position);
    for (const key of keys) delete out.spec[key];
    return out;
}

/** Everything but the footprint must be identical. */
function restDefect(a: PairPosition, b: PairPosition): string | null {
    const { paths } = differingPaths(a, b);
    return paths.length === 0
        ? null
        : `differs beyond the Discriminant at ${paths.slice(0, 4).join(", ")}${paths.length > 4 ? ` (+${paths.length - 4} more)` : ""}`;
}

/** The spec's cards as the engine sees them: a `count` of N is N cards. */
function units(cards: readonly ScenarioCard[]): string[] {
    return cards.flatMap((card) => {
        const { count, ...one } = card;
        return Array.from({ length: count ?? 1 }, () => canon(one));
    });
}

/** `from` without one occurrence of each of `drop`, order kept. */
function removing(from: readonly string[], drop: readonly string[]): string[] {
    const left = new Map<string, number>();
    for (const key of drop) left.set(key, (left.get(key) ?? 0) + 1);
    return from.filter((key) => {
        const n = left.get(key) ?? 0;
        if (n === 0) return true;
        left.set(key, n - 1);
        return false;
    });
}

const cardName = (json: string): string =>
    String((JSON.parse(json) as { name?: unknown }).name);

function cardDefect(anchor: PairPosition, half: PairPosition): string | null {
    const a = units(anchor.spec.cards);
    const b = units(half.spec.cards);
    const gone = removing(a, b);
    const added = removing(b, a);
    if (gone.length + added.length === 0) {
        return same(a, b)
            ? "the two positions hold the same cards, so no card realises the Discriminant"
            : "the cards are the same but listed in another order — a library is read top-down, so a reorder is not a card";
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
    // The cards both halves share keep their relative order.
    if (!same(removing(a, gone), removing(b, added))) {
        return "the shared cards are reordered between the halves — a library is read top-down";
    }
    const x = copy(anchor);
    const y = copy(half);
    x.spec.cards = [];
    y.spec.cards = [];
    return restDefect(x, y);
}

function stepDefect(anchor: PairPosition, half: PairPosition): string | null {
    const moved = (key: SpecKey) => !same(anchor.spec[key], half.spec[key]);
    if (!moved("phase") && !moved("activePlayer") && !moved("turn")) {
        return "the halves share a step and a turn, so nothing realises the step Discriminant";
    }
    const newTurn = moved("turn");
    const keys = newTurn ? [...STEP_KEYS, ...NEW_TURN_KEYS] : STEP_KEYS;
    const a = without(anchor, keys);
    const b = without(half, keys);
    if (newTurn) {
        for (const position of [a, b]) {
            for (const card of position.spec.cards) {
                for (const key of NEW_TURN_CARD_KEYS) delete card[key];
            }
        }
    }
    return restDefect(a, b);
}

function lifeDefect(anchor: PairPosition, half: PairPosition): string | null {
    const { paths } = differingPaths(anchor.spec.life, half.spec.life);
    if (paths.length === 0) {
        return "the halves share their life totals, so nothing realises the Discriminant";
    }
    if (paths.length > 1) {
        return `${paths.length} life totals differ — a life Discriminant moves one seat's`;
    }
    return restDefect(without(anchor, ["life"]), without(half, ["life"]));
}

function erasedDefect(
    anchor: PairPosition,
    half: PairPosition,
    key: SpecKey,
    what: string
): string | null {
    if (same(anchor.spec[key], half.spec[key])) {
        return `the halves share their ${what}, so nothing realises the Discriminant`;
    }
    return restDefect(without(anchor, [key]), without(half, [key]));
}

function sequenceDefect(
    anchor: PairPosition,
    half: PairPosition
): string | null {
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

function otherDefect(anchor: PairPosition, half: PairPosition): string | null {
    const { paths, resized } = differingPaths(
        { spec: anchor.spec, setup: anchor.setup },
        { spec: half.spec, setup: half.setup }
    );
    if (resized.length > 0) {
        return `an "other" Discriminant changes a value, not how many entries there are (${resized.slice(0, 3).join(", ")})`;
    }
    if (paths.length === 1) return null;
    return paths.length === 0
        ? "the two positions are identical, so nothing realises the Discriminant"
        : `an "other" Discriminant admits exactly one differing value; these differ at ${paths.length} (${paths.slice(0, 4).join(", ")})`;
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
        case "step":
            return stepDefect(anchor, half);
        case "life":
            return lifeDefect(anchor, half);
        case "mana":
            return erasedDefect(anchor, half, "manaPool", "floating mana");
        case "stack":
            return erasedDefect(anchor, half, "stack", "stack");
        case "sequence":
            return sequenceDefect(anchor, half);
        case "other":
            return otherDefect(anchor, half);
        default: {
            const never: never = discriminant.kind;
            return `unknown Discriminant kind ${String(never)}`;
        }
    }
}
