// Draft Table Audit harness (issue #8894): the script drafts a full table per
// seed, Auto-Builds EVERY seat and reports every per-deck field, on a profiled
// scope (the Vintage Cube) and a profile-less one (LEA); a broken Floor is a
// red exit. The Floors' VALUES are not asserted here: they are measured on
// `1..DEFAULT_AUDIT_SEEDS` and any cube addition reshuffles the seeds' packs.
import { describe, expect, it } from "vitest";
import {
    countOffColourDuals,
    earlyCastability,
    splashDiscipline,
} from "../../src/lib/limited/draftTableAudit";
import {
    aggregateAudit,
    castabilityOf,
    checkFloors,
    floorsExitCode,
    hypergeometricAtLeast,
    runDraftAudit,
    type DeckAudit,
} from "../lib/draft-audit";
import {
    DRAFT_LAB_SEAT_COUNT,
    buildDraftLabBuiltSeats,
    runFullDraftLab,
    standardPackSlots,
} from "../../src/lib/limited/draftLabEngine";
import type { AutoBuildCardMeta } from "../../convex/limited/autoBuild";

const cube = runDraftAudit("vintage-cube", [1]);
const lea = runDraftAudit("lea", [1]);

function expectEveryField(deck: DeckAudit): void {
    expect(deck.legal).toBe(true);
    expect(deck.unresolved).toBe(0);
    expect(deck.colors.length).toBeGreaterThanOrEqual(2);
    expect(deck.landCount + deck.spellCount).toBe(deck.mainSize);
    expect(deck.curve.reduce((a, b) => a + b, 0)).toBe(deck.spellCount);
    expect(deck.castability.length).toBeGreaterThan(0);
    for (const c of deck.castability) {
        expect(c.p).toBeGreaterThanOrEqual(0);
        expect(c.p).toBeLessThanOrEqual(1);
    }
    expect(deck.meanCastability).not.toBeNull();
    const early = deck.earlyCastability;
    expect(early.spells).toBe(
        deck.castability.filter((c) => c.manaValue <= 2).length
    );
    expect(early.below).toBeLessThanOrEqual(early.spells);
    expect(deck.splash === null).toBe(deck.colors.length === 2);
    if (deck.splash) {
        expect(deck.splash.strained).toBeLessThanOrEqual(deck.splash.cards);
        expect(deck.splash.cards).toBeLessThanOrEqual(deck.spellCount);
    }
    expect(deck.offColourDuals).toBeLessThanOrEqual(deck.landCount);
    expect(deck.capabilityPairs).toBeGreaterThanOrEqual(0);
    expect(deck).toHaveProperty("unreviewedShare.archetypes");
    expect(deck).toHaveProperty("unreviewedShare.capabilities");
}

describe("draft:audit builds every seat and reports every field", () => {
    it("the Vintage Cube: eight seats, each with a plan from the Pool's archetypes", () => {
        expect(cube.decks).toHaveLength(DRAFT_LAB_SEAT_COUNT);
        expect(new Set(cube.decks.map((d) => d.seatIndex)).size).toBe(
            DRAFT_LAB_SEAT_COUNT
        );
        for (const deck of cube.decks) {
            expectEveryField(deck);
            expect(deck.planArchetype).not.toBeNull();
            expect(deck.planShare).toBeGreaterThan(0);
            expect(deck.unreviewedShare.archetypes).not.toBeNull();
        }
        expect(cube.aggregate.builtShare).toBe(1);
        expect(cube.aggregate.meanPlanShare).not.toBeNull();
    });

    it("LEA, a scope with no archetype profiles: every seat built, no plan", () => {
        expect(lea.decks).toHaveLength(DRAFT_LAB_SEAT_COUNT);
        for (const deck of lea.decks) {
            expectEveryField(deck);
            expect(deck.planArchetype).toBeNull();
            expect(deck.planShare).toBeNull();
            expect(deck.unreviewedShare.archetypes).toBeNull();
        }
        expect(lea.aggregate.meanPlanShare).toBeNull();
    });

    it("is deterministic for a given seed", () => {
        expect(runDraftAudit("vintage-cube", [1])).toEqual(cube);
    });

    it("the Draft Lab's Built deck view reports the very decks the audit measures (issue #8899)", () => {
        const lab = buildDraftLabBuiltSeats(
            runFullDraftLab(1, standardPackSlots("vintage-cube"))
        );
        expect(lab.map((s) => s.audit)).toEqual(cube.decks);
    });
});

describe("castability model", () => {
    it("hypergeometric tail matches hand-computed values", () => {
        // 1 success in 2 of 4: P(X ≥ 1) = 1 − C(3,2)/C(4,2) = 1 − 3/6.
        expect(hypergeometricAtLeast(4, 1, 2, 1)).toBeCloseTo(0.5, 12);
        expect(hypergeometricAtLeast(40, 0, 7, 1)).toBe(0);
        expect(hypergeometricAtLeast(40, 40, 7, 7)).toBeCloseTo(1, 12);
        expect(hypergeometricAtLeast(40, 17, 7, 0)).toBe(1);
    });

    it("more sources of the pip's colour never lower a spell's castability", () => {
        const meta = (
            id: string,
            pips: AutoBuildCardMeta["pips"],
            produced: AutoBuildCardMeta["producedColors"]
        ): AutoBuildCardMeta => ({
            cardId: id,
            colors: [],
            manaValue: 2,
            rarity: "common",
            pips,
            producedColors: produced,
            isLand: produced.length > 0,
            isBasicLand: produced.length > 0,
        });
        const spell = meta("spell", { U: 2 }, []);
        const deckWith = (islands: number): AutoBuildCardMeta[] => [
            spell,
            ...Array.from({ length: 39 }, (_, i) =>
                i < islands ? meta(`i${i}`, {}, ["U"]) : meta(`x${i}`, {}, [])
            ),
        ];
        const few = castabilityOf(spell, deckWith(6), 0);
        const many = castabilityOf(spell, deckWith(12), 0);
        expect(many).toBeGreaterThan(few);
        expect(castabilityOf(spell, deckWith(0), 0)).toBe(0);
    });
});

describe("colour coherence (issue #9335)", () => {
    const meta = (
        id: string,
        manaValue: number,
        pips: AutoBuildCardMeta["pips"],
        produced: AutoBuildCardMeta["producedColors"] = []
    ): AutoBuildCardMeta => ({
        cardId: id,
        colors: [],
        manaValue,
        rarity: "common",
        pips,
        producedColors: produced,
        isLand: manaValue === 0 && produced.length > 0,
        isBasicLand: false,
    });

    it("early castability: MV ≤ 2 spells only, a stumble is below 0.8", () => {
        const early = earlyCastability([
            { cardId: "a", manaValue: 1, p: 0.95 },
            { cardId: "b", manaValue: 2, p: 0.79 },
            { cardId: "c", manaValue: 2, p: 0.8 },
            { cardId: "d", manaValue: 3, p: 0.1 },
        ]);
        expect(early).toEqual({
            spells: 3,
            mean: expect.closeTo((0.95 + 0.79 + 0.8) / 3, 12),
            below: 1,
        });
        expect(earlyCastability([])).toEqual({
            spells: 0,
            mean: null,
            below: 0,
        });
    });

    it("splash discipline: the third colour's cards, strained by a double pip or MV ≤ 2", () => {
        const main = [
            meta("on-colour", 2, { U: 1, R: 1 }),
            meta("splash-cheap", 2, { G: 1 }),
            meta("splash-double", 4, { G: 2 }),
            meta("splash-clean", 4, { U: 1, G: 1 }),
            meta("splash-land", 0, {}, ["G"]),
        ];
        expect(splashDiscipline(["U", "R", "G"], main)).toEqual({
            cards: 3,
            strained: 2,
        });
        expect(splashDiscipline(["U", "R"], main)).toBeNull();
    });

    it("off-colour duals: a land producing a colour outside the deck's, never an any-colour land", () => {
        const main = [
            meta("on-dual", 0, {}, ["U", "R"]),
            meta("off-dual", 0, {}, ["U", "B"]),
            meta("off-fetch", 0, {}, ["B", "G"]),
            meta("rainbow", 0, {}, ["W", "U", "B", "R", "G"]),
            meta("colourless", 0, {}, ["C"]),
            meta("mox", 0, {}, ["B"]),
        ];
        main[5] = { ...main[5], isLand: false };
        expect(countOffColourDuals(["U", "R"], main)).toBe(2);
    });

    it("the aggregate pools early spells and splits the stumble share by colour count", () => {
        const a = aggregateAudit(cube.decks);
        const early = cube.decks.flatMap((d) =>
            d.castability.filter((c) => c.manaValue <= 2)
        );
        expect(a.earlyBelowShare).toBeCloseTo(
            early.filter((c) => c.p < 0.8).length / early.length,
            12
        );
        expect(Object.keys(a.earlyBelowShareByColours).sort()).toEqual(
            Object.keys(a.colourCounts).sort()
        );
        expect(a.splashDecks).toBe(
            cube.decks.filter((d) => d.colors.length >= 3).length
        );
    });
});

describe("Floors", () => {
    it("a deliberately broken Floor is a red exit; a held one is green", () => {
        const aggregate = aggregateAudit(cube.decks);
        const value = aggregate.meanCastability!;
        const broken = checkFloors(aggregate, {
            meanCastability: value + 0.01,
        });
        expect(broken[0].held).toBe(false);
        expect(floorsExitCode(broken)).toBe(1);
        const held = checkFloors(aggregate, { meanCastability: value });
        expect(floorsExitCode(held)).toBe(0);
        expect(floorsExitCode(null)).toBe(0);
    });
});
