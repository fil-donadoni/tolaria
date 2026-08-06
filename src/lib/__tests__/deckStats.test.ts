// `computeDeckStats` — the pure Maindeck statistics module behind the
// deckbuilder's Stats dialog (PRD #1617, issue #1630). Uses real LEA/DRK/RTR/
// NPH/ATQ/MH2 registry ids (mirrors `deckColors.test.ts`'s pattern) plus one
// synthetic `CardDefinition` (via a custom `resolve`) for the one case no
// shipped card exercises: a printed `{C}` colourless mana-cost symbol.
import { describe, it, expect } from "vitest";
import {
    computeDeckStats,
    CURVE_BUCKET_COUNT,
    type DeckCardDefinitionResolver,
} from "../deckStats";
import type { CardDefinition } from "@convex/cards/types";
import type { DeckCard } from "~/types/game";

// Non-land spells, ascending mana value.
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // {1}{G}, MV 2, vanilla — no mana ability
const LLANOWAR_ELVES = "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb"; // {G}, MV 1, dork — taps for {G}
const DEATHRITE_SHAMAN = "70496f16-c4c0-4c03-beef-454eb4824cd1"; // {B/G} hybrid, MV 1
const GITAXIAN_PROBE = "995486ce-58bb-4753-a812-0ca73ef1a235"; // {U/P} phyrexian, MV 1
const DISMEMBER = "064dfdeb-485f-473e-9fa0-8fdb7638cdc6"; // {1}{B/P}{B/P}, MV 3
const PHYREXIAN_METAMORPH = "d2e27911-87cb-49a0-a34f-6afe4bddd592"; // {3}{U/P}, MV 4, Artifact Creature
const KALDRA_COMPLEAT = "87cc2855-6b14-44dd-a398-7dc2bbae081f"; // {7}, MV 7 exactly — curve boundary
const COLOSSUS_OF_SARDIA = "067c44e9-1b23-42fd-9acb-daafb62c32a2"; // {9}, MV 9 — above the 7+ boundary

// Mana sources.
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // basic land, produces R
const BAYOU = "412ceddd-2b9a-4551-a6bf-ae2830a2010a"; // dual land, subtypes Swamp+Forest, produces B and G
const MOX_RUBY = "8945585f-4773-493d-a0fe-d707db910b38"; // non-land rock, produces R
const SOL_RING = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd"; // non-land rock, produces {C}{C} ONLY — not a colour source

function deckOf(...cardIds: string[]): DeckCard[] {
    return cardIds.map((cardId) => ({ cardId, cardName: cardId }));
}

describe("computeDeckStats", () => {
    describe("mana curve (CR 202.3)", () => {
        it("excludes lands from the curve", () => {
            const stats = computeDeckStats(deckOf(MOUNTAIN, LLANOWAR_ELVES));
            // Mountain contributes nothing; Llanowar Elves (MV 1) contributes.
            expect(stats.curve.reduce((a, b) => a + b, 0)).toBe(1);
            expect(stats.curve[1]).toBe(1);
        });

        it("buckets 0..6 by exact mana value", () => {
            const stats = computeDeckStats(
                deckOf(LLANOWAR_ELVES, GRIZZLY_BEARS, DISMEMBER)
            );
            expect(stats.curve[1]).toBe(1); // Llanowar Elves
            expect(stats.curve[2]).toBe(1); // Grizzly Bears {1}{G}
            expect(stats.curve[3]).toBe(1); // Dismember {1}{B/P}{B/P}
        });

        it("collects everything at or above 7 into the last '7+' bucket", () => {
            const stats = computeDeckStats(
                deckOf(KALDRA_COMPLEAT, COLOSSUS_OF_SARDIA)
            );
            expect(stats.curve.length).toBe(CURVE_BUCKET_COUNT);
            expect(stats.curve[CURVE_BUCKET_COUNT - 1]).toBe(2); // MV 7 and MV 9 both land here
            // Nothing spilled into any lower or out-of-range bucket.
            expect(stats.curve.slice(0, CURVE_BUCKET_COUNT - 1)).toEqual([
                0, 0, 0, 0, 0, 0, 0,
            ]);
        });

        it("counts a printed variable {X} at 0 (CR 202.3b — unpaid on a deck-list card)", () => {
            // Sol Ring's cost is `{ X: 1 }` — a NUMERIC X (fixed generic), not
            // the variable marker, so it's mana value 1. This is exercised
            // indirectly by the sources test below; the direct {X} (string)
            // case needs a synthetic fixture since Fireball/Hurricane-style
            // cards resolve X only on cast, never off a bare CardDefinition
            // read differently from any other card — `manaValue` (reused,
            // not reimplemented) already treats a string X as 0 (CR 202.3b),
            // so a card whose only mana symbol is a variable {X}{G} (e.g.
            // Hurricane) has printed mana value 1 from the {G} alone.
            const resolve: DeckCardDefinitionResolver = (cardId) =>
                cardId === "fake-x-spell"
                    ? ({
                          id: "fake-x-spell",
                          name: "Fake X Spell",
                          rarity: "common",
                          manaCost: { X: "X", G: 1 },
                          types: ["Sorcery"],
                      } as CardDefinition)
                    : null;
            const stats = computeDeckStats(deckOf("fake-x-spell"), resolve);
            expect(stats.curve[1]).toBe(1); // {X}{G} counts as MV 1, not MV "X"
        });
    });

    describe("colour pips (CR 202.2)", () => {
        it("a guild-hybrid pip contributes 1 to EACH of its colours", () => {
            const stats = computeDeckStats(deckOf(DEATHRITE_SHAMAN));
            expect(stats.pips.B).toBe(1);
            expect(stats.pips.G).toBe(1);
        });

        it("a Phyrexian pip is still a coloured pip toward its one colour", () => {
            const stats = computeDeckStats(deckOf(GITAXIAN_PROBE, DISMEMBER));
            expect(stats.pips.U).toBe(1); // Gitaxian Probe {U/P}
            expect(stats.pips.B).toBe(2); // Dismember {B/P}{B/P}
        });

        it("generic and {X} contribute no pips", () => {
            // Dismember is {1}{B/P}{B/P} — the {1} must not leak into any pip.
            const stats = computeDeckStats(deckOf(DISMEMBER));
            expect(Object.keys(stats.pips)).toEqual(["B"]);
        });

        it("a colourless mana symbol {C} contributes to no colour's pip count", () => {
            // No shipped catalogue card prints a {C} cost symbol yet — this is
            // the one fixture built via a custom resolver rather than a real
            // registry id (the module's `resolve` seam exists exactly for
            // this: swap in a synthetic CardDefinition without touching the
            // registry-only default).
            const resolve: DeckCardDefinitionResolver = (cardId) =>
                cardId === "fake-colorless-spell"
                    ? ({
                          id: "fake-colorless-spell",
                          name: "Fake Colourless Spell",
                          rarity: "common",
                          manaCost: { C: 2, W: 1 },
                          types: ["Sorcery"],
                      } as CardDefinition)
                    : null;
            const stats = computeDeckStats(
                deckOf("fake-colorless-spell"),
                resolve
            );
            expect(stats.pips).toEqual({ W: 1 });
            expect(stats.pips.C).toBeUndefined();
        });

        it("activation costs are not counted (only the card's own casting cost)", () => {
            // Llanowar Elves' activated ability is a free {T} tap — no mana
            // cost on the ability at all — so its only pip is its casting
            // cost {G}. This guards against a future change that reads
            // `activatedAbilities[].cost.mana` into the pip count.
            const stats = computeDeckStats(deckOf(LLANOWAR_ELVES));
            expect(stats.pips).toEqual({ G: 1 });
        });
    });

    describe("colour sources (CR 106.4, reusing getDefinitionProducibleColors)", () => {
        it("a basic land is a source of the colour its subtype produces", () => {
            const stats = computeDeckStats(deckOf(MOUNTAIN));
            expect(stats.sources.lands.R).toBe(1);
            expect(stats.sources.nonlands.R).toBeUndefined();
        });

        it("a dual land counts on BOTH of its colours", () => {
            const stats = computeDeckStats(deckOf(BAYOU));
            expect(stats.sources.lands.B).toBe(1);
            expect(stats.sources.lands.G).toBe(1);
        });

        it("a non-land mana rock is a source, reported under non-lands", () => {
            const stats = computeDeckStats(deckOf(MOX_RUBY));
            expect(stats.sources.nonlands.R).toBe(1);
            expect(stats.sources.lands.R).toBeUndefined();
        });

        it("a mana dork is a source, reported under non-lands", () => {
            const stats = computeDeckStats(deckOf(LLANOWAR_ELVES));
            expect(stats.sources.nonlands.G).toBe(1);
        });

        it("a card with no mana ability counts for nothing", () => {
            const stats = computeDeckStats(deckOf(GRIZZLY_BEARS));
            expect(stats.sources.lands).toEqual({});
            expect(stats.sources.nonlands).toEqual({});
        });

        it("a card that only produces {C} counts for nothing — colourless is not a colour", () => {
            // Sol Ring taps for {C}{C} only. Getting this wrong is invisible
            // in a mono-coloured test deck (it would silently disappear into
            // whichever colour a bug misattributed it to) — assert it
            // produces NO colour at all.
            const stats = computeDeckStats(deckOf(SOL_RING));
            expect(stats.sources.nonlands).toEqual({});
            expect(stats.sources.lands).toEqual({});
        });

        it("sources are split into lands and non-lands even for the same colour", () => {
            const stats = computeDeckStats(deckOf(MOUNTAIN, MOX_RUBY));
            expect(stats.sources.lands.R).toBe(1);
            expect(stats.sources.nonlands.R).toBe(1);
        });
    });

    describe("types and subtypes (CR 300)", () => {
        it("a multi-type card is counted in EACH of its types", () => {
            const stats = computeDeckStats(deckOf(PHYREXIAN_METAMORPH));
            expect(stats.types.Artifact).toBe(1);
            expect(stats.types.Creature).toBe(1);
        });

        it("subtype counts include land subtypes", () => {
            const stats = computeDeckStats(deckOf(MOUNTAIN, BAYOU));
            expect(stats.subtypes.Mountain).toBe(1);
            expect(stats.subtypes.Swamp).toBe(1);
            expect(stats.subtypes.Forest).toBe(1);
        });

        it("subtype counts include creature subtypes", () => {
            const stats = computeDeckStats(deckOf(DEATHRITE_SHAMAN));
            expect(stats.subtypes.Elf).toBe(1);
            expect(stats.subtypes.Shaman).toBe(1);
        });

        it("type/subtype sum can exceed the card count for a single card", () => {
            const stats = computeDeckStats(deckOf(PHYREXIAN_METAMORPH));
            const typeSum = Object.values(stats.types).reduce(
                (a, b) => a + b,
                0
            );
            expect(typeSum).toBe(2); // Artifact + Creature, from ONE card
        });
    });

    describe("edge cases", () => {
        it("an empty deck produces all-empty stats", () => {
            const stats = computeDeckStats([]);
            expect(stats.curve).toEqual(new Array(CURVE_BUCKET_COUNT).fill(0));
            expect(stats.pips).toEqual({});
            expect(stats.sources).toEqual({ lands: {}, nonlands: {} });
            expect(stats.types).toEqual({});
            expect(stats.subtypes).toEqual({});
        });

        it("silently ignores an unresolvable card id rather than throwing", () => {
            expect(() =>
                computeDeckStats(deckOf("not-a-real-card"))
            ).not.toThrow();
            const stats = computeDeckStats(deckOf("not-a-real-card"));
            expect(stats.curve.reduce((a, b) => a + b, 0)).toBe(0);
        });
    });
});
