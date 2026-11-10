// Draft Table Audit harness (issue #8894): the script drafts a full table per
// seed, Auto-Builds EVERY seat and reports every per-deck field, on a profiled
// scope (the Vintage Cube) and a profile-less one (LEA); a broken Floor is a
// red exit. The Floors' VALUES are not asserted here: they are measured on
// `1..DEFAULT_AUDIT_SEEDS` and any cube addition reshuffles the seeds' packs.
import { describe, expect, it } from "vitest";
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
