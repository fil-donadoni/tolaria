// Draft Signal read + colourSignal / archetypeSignal terms (PRD #1616, ADR
// 0134, issue #3736). The Pick Invariants of the issue, over the PURE fold
// (`draftSignal.ts`) and the scorer terms (`botDrafter.ts`) — facts are
// synthetic so a pack's power is exactly what each test says it is.
import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";
import {
    contextCapForPick,
    scoreCandidate,
    sumTraceTerms,
    type CardEvalMeta,
    type PickCandidateTrace,
    type PickTermKey,
} from "../botDrafter";
import type { CardProfile, GetCardProfile } from "../cardProfilesCore";
import type { BoosterConfig } from "../boosterTypes";
import {
    computeExpectedShares,
    effectiveSignal,
    emptySeatSignalState,
    foldPackIntoRead,
    emptyDraftSignalRead,
    observePack,
    type CardSignalFacts,
    type DraftSignalRead,
    type ExpectedShares,
    type GetSignalFacts,
} from "../draftSignal";
import type { DraftPackCard } from "../eventTypes";

const FACTS: Record<string, CardSignalFacts> = {
    blue: { power: 3, colours: ["U"], archetypes: ["control"] },
    red: { power: 3, colours: ["R"], archetypes: ["aggro"] },
    gold: { power: 4, colours: ["U", "R"], archetypes: [] },
    artifact: { power: 2, colours: [], archetypes: [] },
};
const getFacts: GetSignalFacts = (id) => FACTS[id] ?? null;

function pack(...ids: string[]): DraftPackCard[] {
    return ids.map((id, i) => ({
        scryfallId: id,
        cardId: id,
        cardName: id,
        pickId: `${id}-${i}`,
    }));
}

/** Expected: a fresh pack is half blue, half red by power. */
const EVEN: ExpectedShares = {
    colour: { W: 0, U: 0.5, B: 0, R: 0.5, G: 0 },
    archetype: { control: 0.5, aggro: 0.5 },
};

function fold(read: DraftSignalRead, p: DraftPackCard[], removed: number) {
    return foldPackIntoRead(
        read,
        p,
        { direction: 1, removedUpstream: removed },
        EVEN,
        getFacts
    );
}

function metaOf(name: string, over: Partial<CardEvalMeta> = {}): CardEvalMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        ...over,
    };
}
const blueCandidate = metaOf("Grizzly Bears", {
    colors: ["U"],
    manaValue: 2,
    pips: { U: 1 },
});
const greenFiller = metaOf("Grizzly Bears", { colors: ["G"], manaValue: 0 });

function term(t: PickCandidateTrace, key: PickTermKey) {
    return t.terms.find((x) => x.term === key)!;
}

/** A read in which blue is open (more blue left than expected). */
const blueOpen = fold(
    emptyDraftSignalRead(),
    pack("blue", "blue", "blue", "red"),
    6
);

describe("Draft Signal read — fold invariants", () => {
    it("monotonic: a late pack with more blue power never lowers colourSignal", () => {
        const less = fold(
            emptyDraftSignalRead(),
            pack("blue", "red", "red"),
            6
        );
        const more = fold(
            emptyDraftSignalRead(),
            pack("blue", "blue", "red"),
            6
        );
        const score = (read: DraftSignalRead) =>
            term(
                scoreCandidate(blueCandidate, [], 3, {
                    draftSignal: { read, direction: 1 },
                }),
                "colourSignal"
            ).rawValue;
        expect(more.left.colour.U).toBeGreaterThan(less.left.colour.U!);
        expect(score(more)).toBeGreaterThanOrEqual(score(less));
        expect(score(more)).toBeGreaterThan(0);
    });

    it("an untouched pack (nothing removed upstream) leaves the read unchanged", () => {
        const before = structuredClone(blueOpen);
        expect(fold(blueOpen, pack("blue", "blue", "blue"), 0)).toEqual(before);
        const state = observePack(
            emptySeatSignalState(),
            pack("blue", "blue", "red"),
            0,
            1,
            EVEN,
            getFacts
        );
        expect(state.read).toEqual(emptyDraftSignalRead());
    });

    it("removed-upstream comes from the first pack the seat saw that round", () => {
        let s = observePack(
            emptySeatSignalState(),
            pack("blue", "blue", "blue", "red"),
            0,
            1,
            EVEN,
            getFacts
        );
        s = observePack(s, pack("blue", "blue"), 0, 1, EVEN, getFacts);
        // 2 cards gone, all blue left → blue surplus (1 − 0.5) × 2.
        expect(s.read.left.colour.U).toBeCloseTo(1, 10);
    });

    it("the read is independent of the Pool; the Pool only moves the weight", () => {
        const snapshot = structuredClone(blueOpen);
        const score = (pool: CardEvalMeta[]) =>
            term(
                scoreCandidate(blueCandidate, pool, 3, {
                    draftSignal: { read: blueOpen, direction: 1 },
                }),
                "colourSignal"
            ).rawValue;
        const empty = score([]);
        const settled = score(Array(14).fill(greenFiller));
        expect(blueOpen).toEqual(snapshot);
        expect(settled).toBeLessThan(empty);
    });

    it("adding a card of the Pool's dominant colour does not raise the weight", () => {
        const greenPip = metaOf("Grizzly Bears", {
            colors: ["G"],
            manaValue: 0,
            pips: { G: 1 },
        });
        const blueBit = { ...greenPip, colors: ["U" as const], pips: { U: 1 } };
        let prev = Infinity;
        for (let n = 1; n <= 14; n++) {
            const pool = [blueBit, ...Array(n).fill(greenPip)];
            const v = term(
                scoreCandidate(blueCandidate, pool, 3, {
                    draftSignal: { read: blueOpen, direction: 1 },
                }),
                "colourSignal"
            ).rawValue;
            expect(v).toBeLessThanOrEqual(prev + 1e-12);
            prev = v;
        }
    });

    it("a round-1 pack moves the round-3 read at least as much as the round-2 read", () => {
        const read = fold(
            emptyDraftSignalRead(),
            pack("blue", "blue", "red"),
            5
        );
        const round2 = effectiveSignal(read, -1, "colour", "U");
        const round3 = effectiveSignal(read, 1, "colour", "U");
        expect(round3).toBeGreaterThanOrEqual(round2);
        expect(round2).toBeGreaterThan(0);
    });

    it("colourless cards do not move the colour read; unprofiled do not move the Archetype read", () => {
        const colourless = fold(emptyDraftSignalRead(), pack("artifact"), 5);
        // colourless-only pack: no colour share exceeds expected anywhere.
        for (const v of Object.values(colourless.left.colour)) {
            expect(v).toBeLessThanOrEqual(0);
        }
        const unprofiled = fold(
            emptyDraftSignalRead(),
            pack("gold", "artifact"),
            5
        );
        expect(unprofiled.left.archetype.control).toBeLessThanOrEqual(0);
        expect(unprofiled.left.archetype.aggro).toBeLessThanOrEqual(0);
        // multicolour power splits evenly: gold gives U and R the same share.
        expect(unprofiled.left.colour.U).toBeCloseTo(
            unprofiled.left.colour.R!,
            10
        );
    });

    it("both terms are >= 0 and the contextual sum respects contextCapForPick", () => {
        const profiles: GetCardProfile = () =>
            ({
                archetypes: ["control"],
                provides: [],
                requires: [],
                reviewed: true,
            }) satisfies CardProfile;
        const huge = fold(
            emptyDraftSignalRead(),
            pack("blue", "blue", "blue"),
            14
        );
        const trace = scoreCandidate(blueCandidate, [], 3, {
            draftSignal: { read: huge, direction: 1 },
            getCardProfile: profiles,
        });
        expect(term(trace, "colourSignal").value).toBeGreaterThanOrEqual(0);
        expect(term(trace, "archetypeSignal").value).toBeGreaterThanOrEqual(0);
        expect(term(trace, "archetypeSignal").rawValue).toBeGreaterThan(0);
        const ctx = sumTraceTerms(
            trace.terms.filter((t) => t.term !== "baseRating")
        );
        expect(ctx).toBeLessThanOrEqual(contextCapForPick(1) + 1e-9);
    });

    it("without a read both terms contribute exactly 0", () => {
        const trace = scoreCandidate(blueCandidate, [], 3);
        expect(term(trace, "colourSignal").rawValue).toBe(0);
        expect(term(trace, "archetypeSignal").rawValue).toBe(0);
    });
});

describe("Expected share — derived from the generator config", () => {
    const config: BoosterConfig = {
        setCode: "tst",
        boostersTotalWeight: 1,
        boosters: [{ contents: { main: 2 }, weight: 1 }],
        sheets: {
            main: { cards: { blue: 1, red: 3 }, totalWeight: 4 },
        },
    };

    it("weights sheet cards by sheet weight and power", () => {
        const e = computeExpectedShares(
            "tst",
            () => config,
            undefined,
            getFacts
        )!;
        // blue 0.25×3 = 0.75, red 0.75×3 = 2.25 → 25% / 75%.
        expect(e.colour.U).toBeCloseTo(0.25, 10);
        expect(e.colour.R).toBeCloseTo(0.75, 10);
    });

    it("is uniform over the pool for a cube", () => {
        const e = computeExpectedShares(
            "cube",
            () => null,
            ["blue", "red"],
            getFacts
        )!;
        expect(e.colour.U).toBeCloseTo(0.5, 10);
    });

    it("is null when the source has nothing to derive from", () => {
        expect(
            computeExpectedShares("nope", () => null, undefined, getFacts)
        ).toBeNull();
    });
});
