// Visual grouping for a categorized reveal-and-keep pick (issue #1364, Atraxa /
// Niv-Mizzet). Pins the display partition: one disjoint section per category
// in choice order, first-match wins, cards matching no category trailing.

import { describe, it, expect } from "vitest";
import { buildCategorySections, type PileCategory } from "../categorized-pile";
import type { CardInstance } from "~/types/game";

/** Minimal CardInstance — only `id` matters to the partition. */
const card = (id: string): CardInstance =>
    ({
        id,
        card: { id: `def-${id}` },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    }) as CardInstance;

describe("buildCategorySections (issue #1364)", () => {
    it("splits the pile into one section per category, in category order", () => {
        const cards = [card("bear"), card("swamp"), card("bolt")];
        const categories: PileCategory[] = [
            { label: "Creature", cardIds: ["bear"] },
            { label: "Instant", cardIds: ["bolt"] },
            { label: "Land", cardIds: ["swamp"] },
        ];
        const { sections, ungrouped } = buildCategorySections(
            cards,
            categories
        );
        expect(sections.map((s) => s.label)).toEqual([
            "Creature",
            "Instant",
            "Land",
        ]);
        expect(sections.map((s) => s.cards.map((c) => c.id))).toEqual([
            ["bear"],
            ["bolt"],
            ["swamp"],
        ]);
        expect(ungrouped).toEqual([]);
    });

    it("shows a multi-category card ONCE, under the first category listing it", () => {
        // An artifact creature qualifies for Artifact and Creature; Artifact is
        // first in Atraxa's list, so it displays there and not again.
        const cards = [card("golemBear"), card("bear")];
        const categories: PileCategory[] = [
            { label: "Artifact", cardIds: ["golemBear"] },
            { label: "Creature", cardIds: ["golemBear", "bear"] },
        ];
        const { sections } = buildCategorySections(cards, categories);
        expect(sections.map((s) => s.cards.map((c) => c.id))).toEqual([
            ["golemBear"],
            ["bear"],
        ]);
    });

    it("drops a category with no revealed member (no empty header)", () => {
        const cards = [card("bear")];
        const categories: PileCategory[] = [
            { label: "Creature", cardIds: ["bear"] },
            { label: "Planeswalker", cardIds: [] },
            { label: "Land", cardIds: [] },
        ];
        const { sections } = buildCategorySections(cards, categories);
        expect(sections.map((s) => s.label)).toEqual(["Creature"]);
    });

    it("puts a card matching no category into `ungrouped` (Niv-Mizzet monocolour)", () => {
        const cards = [card("bear"), card("mono")];
        const categories: PileCategory[] = [{ label: "WU", cardIds: ["bear"] }];
        const { sections, ungrouped } = buildCategorySections(
            cards,
            categories
        );
        expect(sections).toHaveLength(1);
        expect(ungrouped.map((c) => c.id)).toEqual(["mono"]);
    });

    it("preserves the reveal order within a section (the category's cardIds order)", () => {
        const cards = [card("a"), card("b"), card("c")];
        const categories: PileCategory[] = [
            { label: "Creature", cardIds: ["c", "a", "b"] },
        ];
        const { sections } = buildCategorySections(cards, categories);
        expect(sections[0].cards.map((c) => c.id)).toEqual(["c", "a", "b"]);
    });
});
