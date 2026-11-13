// Castability model (issue #9338): each mana source pays ONE coloured pip, so
// a dual land is never a full source of both its colours on the same turn.
// The exact allocation-aware probability is checked against a brute force
// over every possible draw of small decks.
import { describe, expect, it } from "vitest";
import type { Color } from "../../cards/types";
import {
    OPENING_HAND,
    addProducer,
    hypergeometricAtLeast,
    manaSourceKinds,
    pipCastability,
} from "../castability";

type Pips = Partial<Record<Color, number>>;

/** Can these drawn sources pay these pips, one pip per source? Tries every
 *  assignment — the brute force the model must agree with. */
function payable(drawn: readonly (readonly Color[])[], pips: Pips): boolean {
    const left = new Map(Object.entries(pips) as [Color, number][]);
    const go = (i: number): boolean => {
        if ([...left.values()].every((n) => n <= 0)) return true;
        if (i === drawn.length) return false;
        if (go(i + 1)) return true;
        for (const c of drawn[i]) {
            const n = left.get(c) ?? 0;
            if (n <= 0) continue;
            left.set(c, n - 1);
            const ok = go(i + 1);
            left.set(c, n);
            if (ok) return true;
        }
        return false;
    };
    return go(0);
}

/** The exact probability by enumerating every `draws`-card subset of `deck`
 *  (each entry is one card's produced colours; `[]` = a non-source). */
function bruteForce(
    deck: readonly (readonly Color[])[],
    pips: Pips,
    draws: number
): number {
    let hit = 0;
    let all = 0;
    const pick: (readonly Color[])[] = [];
    const walk = (start: number): void => {
        if (pick.length === draws) {
            all += 1;
            if (payable(pick, pips)) hit += 1;
            return;
        }
        for (let i = start; i <= deck.length - (draws - pick.length); i++) {
            pick.push(deck[i]);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    return hit / all;
}

function deckOf(spec: [readonly Color[], number][], size: number): Color[][] {
    const deck: Color[][] = [];
    for (const [colors, n] of spec) {
        for (let i = 0; i < n; i++) deck.push([...colors]);
    }
    while (deck.length < size) deck.push([]);
    return deck;
}

function model(deck: readonly Color[][], pips: Pips, mv: number): number {
    return pipCastability(
        pips,
        mv,
        deck.length,
        manaSourceKinds(
            deck.map((producedColors) => ({ producedColors })),
            () => 1
        )
    );
}

/** A producer whose `half` colours count as half a source (a one-shot
 *  source, `botDrafter.ts#sourceWeight`). */
interface Producer {
    producedColors: Color[];
    half?: Color[];
}
const halfWeight = (p: Producer, c: Color): number =>
    !p.producedColors.includes(c) ? 0 : p.half?.includes(c) ? 0.5 : 1;

describe("pipCastability — one pip per source (issue #9338)", () => {
    it("a lone dual cannot pay both pips of a two-colour spell", () => {
        // Eight cards, all drawn by turn 2: the dual is always there, yet a
        // {U}{B} spell needs a second source.
        const deck = deckOf([[["U", "B"], 1]], 8);
        expect(model(deck, { U: 1, B: 1 }, 2)).toBe(0);
    });

    it("a dual plus a basic pays a two-colour spell once both are drawn", () => {
        const deck = deckOf(
            [
                [["U", "B"], 1],
                [["U"], 1],
            ],
            8
        );
        expect(model(deck, { U: 1, B: 1 }, 2)).toBeCloseTo(1, 12);
    });

    it("duals alone: two pips need two duals, not one counted twice", () => {
        // The old per-colour model read every dual as a full U AND a full B
        // source: P(≥1 of 3)². Each dual pays one pip: P(≥2 of 3).
        const deck = deckOf([[["U", "B"], 3]], 20);
        const draws = OPENING_HAND + 2 - 1;
        expect(model(deck, { U: 1, B: 1 }, 2)).toBeCloseTo(
            hypergeometricAtLeast(20, 3, draws, 2),
            12
        );
        expect(model(deck, { U: 1, B: 1 }, 2)).toBeLessThan(
            hypergeometricAtLeast(20, 3, draws, 1) ** 2 - 0.1
        );
    });

    it.each<[string, [readonly Color[], number][], Pips, number]>([
        [
            "UB gold two-drop",
            [
                [["U", "B"], 2],
                [["U"], 2],
                [["B"], 1],
            ],
            { U: 1, B: 1 },
            2,
        ],
        [
            "double-pip plus splash",
            [
                [["U", "B"], 1],
                [["U"], 3],
                [["B"], 1],
                [["W", "U", "B", "R", "G"], 1],
            ],
            { U: 2, B: 1 },
            4,
        ],
        [
            "three colours, tri-land and duals",
            [
                [["W", "U"], 1],
                [["U", "B"], 1],
                [["W", "U", "B"], 1],
                [["W"], 1],
                [["B"], 1],
            ],
            { W: 1, U: 1, B: 1 },
            3,
        ],
        [
            "irrelevant sources are non-sources",
            [
                [["R", "G"], 3],
                [["G"], 2],
                [["G", "U"], 1],
            ],
            { G: 2 },
            3,
        ],
    ])("matches a brute force over every draw: %s", (_, spec, pips, mv) => {
        const deck = deckOf(spec, 13);
        const draws = OPENING_HAND + mv - 1;
        expect(model(deck, pips, mv)).toBeCloseTo(
            bruteForce(deck, pips, draws),
            12
        );
    });

    it("a single-colour spell keeps the plain hypergeometric tail", () => {
        const deck = deckOf(
            [
                [["U", "B"], 3],
                [["U"], 5],
            ],
            40
        );
        expect(model(deck, { U: 2 }, 3)).toBeCloseTo(
            hypergeometricAtLeast(40, 8, OPENING_HAND + 2, 2),
            12
        );
    });

    it("a spell with no coloured pip reads 1", () => {
        expect(model(deckOf([], 40), {}, 3)).toBe(1);
    });
});

describe("pipCastability — fractional one-shot sources (issue #9337)", () => {
    const basics = (u: number, b: number): Producer[] => [
        ...Array.from({ length: u }, () => ({
            producedColors: ["U" as Color],
        })),
        ...Array.from({ length: b }, () => ({
            producedColors: ["B" as Color],
        })),
    ];
    const petal: Producer = {
        producedColors: ["W", "U", "B", "R", "G"],
        half: ["W", "U", "B", "R", "G"],
    };
    const castWith = (producers: Producer[]): number =>
        pipCastability(
            { U: 1, B: 1 },
            2,
            30,
            manaSourceKinds(producers, halfWeight)
        );

    it("a half source reads halfway between none and one whole source", () => {
        const without = castWith(basics(3, 3));
        const whole = pipCastability(
            { U: 1, B: 1 },
            2,
            30,
            manaSourceKinds(
                [...basics(3, 3), { producedColors: petal.producedColors }],
                halfWeight
            )
        );
        expect(whole).toBeGreaterThan(without);
        expect(castWith([...basics(3, 3), petal])).toBeCloseTo(
            (without + whole) / 2,
            12
        );
    });

    it("one colour: the fractional count matches hypergeometricAtLeast's interpolation", () => {
        const kinds = manaSourceKinds([...basics(5, 0), petal], halfWeight);
        expect(pipCastability({ U: 2 }, 3, 40, kinds)).toBeCloseTo(
            hypergeometricAtLeast(40, 5.5, OPENING_HAND + 2, 2),
            12
        );
    });

    it("a producer full for one colour and half for another splits into layers", () => {
        const kinds = manaSourceKinds(
            [{ producedColors: ["U", "B"], half: ["B"] }],
            halfWeight
        );
        expect(Object.fromEntries(kinds)).toEqual({ UB: 0.5, U: 0.5 });
        addProducer(
            kinds,
            { producedColors: ["U", "B"], half: ["B"] },
            halfWeight,
            -1
        );
        expect(kinds.size).toBe(0);
    });
});
